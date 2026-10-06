const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const token = config.TELEGRAM_BOT_TOKEN;
const ownerEnvId = config.OWNER_TELEGRAM_ID ? parseInt(config.OWNER_TELEGRAM_ID, 10) : null;

if (!token || token === "your_bot_token_here") {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is not configured in config.js!");
  console.error("Please open config.js and enter your bot token.");
  process.exit(1);
}

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });

// Handle polling errors gracefully without flooding console
bot.on('polling_error', (error) => {
  if (error.message.includes('404')) {
    // Only log once in a while or log cleanly
    if (!global.lastPollingErrorLogged || Date.now() - global.lastPollingErrorLogged > 60000) {
      console.warn("⚠️ Telegram Bot Polling Error: Token bot tidak valid (404 Not Found). Silakan perbarui TELEGRAM_BOT_TOKEN di config.js.");
      global.lastPollingErrorLogged = Date.now();
    }
  } else {
    console.error("⚠️ Telegram Bot Polling Error:", error.message);
  }
});

// Global Error Catching Patch to prevent crashes from Telegram API rejections
const originalSendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = (...args) => {
  return originalSendMessage(...args).catch(err => {
    console.error("⚠️ Telegram sendMessage error caught:", err.message);
  });
};

const originalEditMessageText = bot.editMessageText.bind(bot);
bot.editMessageText = (...args) => {
  return originalEditMessageText(...args).catch(err => {
    console.error("⚠️ Telegram editMessageText error caught:", err.message);
  });
};

const dbPath = path.join(__dirname, 'database.json');

// Memory map to track interactive user creation/deletion states
const botStates = new Map();

// Helper to read DB
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
    
    // Sync owner ID from env if DB owner ID is 0 or unconfigured
    if ((!db.botConfig || !db.botConfig.ownerId || db.botConfig.ownerId === 0) && ownerEnvId) {
      if (!db.botConfig) db.botConfig = {};
      db.botConfig.ownerId = ownerEnvId;
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
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
        console.log(`[DB-BOT] Migrated owner account from "${existingOwnerKey}" to "${ownerName}"`);
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

// Helper to write DB
function writeDb(db) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error writing database:", err);
    return false;
  }
}

// Helper to check roles
function getRole(telegramId, db) {
  const ownerId = db.botConfig?.ownerId;
  const resellers = db.botConfig?.resellers || [];
  
  if (telegramId === ownerId) return 'Owner';
  if (resellers.includes(telegramId)) return 'Reseller';
  return 'Guest';
}

console.log("⚡ THE EXECUTOR Telegram Bot Account Manager is starting...");
console.log("📂 Database path: " + dbPath);
if (ownerEnvId) {
  console.log("👑 Owner ID configured: " + ownerEnvId);
} else {
  console.log("⚠️ Owner ID not configured. Send /start to find your ID.");
}

// Generate Main Menu Keyboard based on user role
function getMainMenuMarkup(userId, role, username = '') {
  const keyboard = [];

  // 1. WebApp Dashboard Button (Only if it's a public URL, not localhost/127.0.0.1, as Telegram rejects local URLs)
  if (username && !config.DASHBOARD_URL.includes('localhost') && !config.DASHBOARD_URL.includes('127.0.0.1')) {
    const isHttps = config.DASHBOARD_URL.startsWith('https://');
    if (isHttps) {
      keyboard.push([
        { 
          text: "🌐 BUKA DASHBOARD WEBSITE", 
          web_app: { url: `${config.DASHBOARD_URL}/dashboard?username=${username}` } 
        }
      ]);
    } else {
      keyboard.push([
        { 
          text: "🌐 BUKA DASHBOARD WEBSITE", 
          url: `${config.DASHBOARD_URL}/dashboard?username=${username}` 
        }
      ]);
    }
  }

  // 2. Creator / Management controls
  if (role === 'Owner' || role === 'Reseller') {
    keyboard.push([
      { text: "👤 Buat User Baru", callback_data: "menu_create" },
      { text: "❌ Hapus User", callback_data: "menu_delete" }
    ]);
    keyboard.push([
      { text: "📋 Daftar Semua User", callback_data: "menu_list" },
      { text: "ℹ️ Informasi Akun", callback_data: "menu_info" }
    ]);
  } else {
    // Guest options
    keyboard.push([
      { text: "ℹ️ Informasi Akun", callback_data: "menu_info" }
    ]);
  }

  // 3. Owner-only reseller controls
  if (role === 'Owner') {
    keyboard.push([
      { text: "👑 + Reseller", callback_data: "menu_add_reseller" },
      { text: "🗑️ - Reseller", callback_data: "menu_del_reseller" }
    ]);
  }

  return { inline_keyboard: keyboard };
}

// Command: /start or /help or /menu
bot.onText(/^\/(start|help|menu)/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const db = readDb();
  const role = getRole(userId, db);

  // Check if this Telegram ID corresponds to any registered web user to link WebApp button
  let matchedUsername = '';
  if (db.users) {
    for (const uname in db.users) {
      if (uname === msg.from.username?.toLowerCase() || uname === msg.chat.username?.toLowerCase()) {
        matchedUsername = uname;
        break;
      }
    }
  }

  // If no match by username, check if a user with their first name exists, or default to owner name if they are owner
  if (!matchedUsername && role === 'Owner') {
    matchedUsername = config.DEFAULT_OWNER_USERNAME || 'pepet'; // Default owner username
  }

  let welcomeMsg = `<b>⚡ THE EXECUTOR ACCESS PANEL ⚡</b>\n\n`;
  welcomeMsg += `🌐 <b>Sistem Integrasi Gateway WhatsApp</b>\n`;
  welcomeMsg += `───────────────────\n`;
  welcomeMsg += `👤 <b>ID Telegram:</b> <code>${userId}</code>\n`;
  welcomeMsg += `🏷️ <b>Akses Level:</b> <code>${role.toUpperCase()}</code>\n`;
  welcomeMsg += `───────────────────\n`;
  welcomeMsg += `<i>Silakan gunakan tombol menu interaktif di bawah untuk mengelola node dan akun Anda.</i>`;

  bot.sendMessage(chatId, welcomeMsg, { 
    parse_mode: 'HTML',
    reply_markup: getMainMenuMarkup(userId, role, matchedUsername)
  });
});

// Command: /info
bot.onText(/^\/info/, (msg) => {
  sendAccountInfo(msg.chat.id, msg.from);
});

function sendAccountInfo(chatId, from) {
  const db = readDb();
  const role = getRole(from.id, db);

  let infoMsg = `<b>ℹ️ DETAIL INFORMASI AKUN</b>\n\n`;
  infoMsg += `👤 <b>Nama Pengguna:</b> ${from.first_name || ''} ${from.last_name || ''}\n`;
  infoMsg += `🆔 <b>Telegram ID:</b> <code>${from.id}</code>\n`;
  infoMsg += `🏷️ <b>Role Sistem:</b> <code>${role}</code>\n`;
  if (from.username) {
    infoMsg += `🔗 <b>Username:</b> @${from.username}\n`;
  }

  bot.sendMessage(chatId, infoMsg, { 
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]]
    }
  });
}

// Helper to list all users
function sendUserList(chatId, userId) {
  const db = readDb();
  const role = getRole(userId, db);

  if (role !== 'Owner' && role !== 'Reseller') {
    return bot.sendMessage(chatId, "⚠️ <b>Akses Ditolak!</b> Hanya Owner atau Reseller yang dapat melihat daftar user.", { parse_mode: 'HTML' });
  }

  const users = db.users || {};
  const usernames = Object.keys(users);

  if (usernames.length === 0) {
    return bot.sendMessage(chatId, "📭 <b>Database Kosong:</b> Belum ada user terdaftar.", {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]]
      }
    });
  }

  let listMsg = `<b>👥 DAFTAR OPERATOR REGISTERED (${usernames.length})</b>\n\n`;
  usernames.forEach((uname, index) => {
    const u = users[uname];
    listMsg += `${index + 1}. <b>${u.username.toUpperCase()}</b> [<code>${u.status}</code>]\n`;
    listMsg += `   📅 Exp: <code>${u.activeUntil}</code> | ⚡ Limit: <code>${u.limit}</code>\n`;
    const senders = u.whatsappSenders || [];
    const senderText = senders.length > 0 ? `${senders.length} Senders` : 'None';
    listMsg += `   📱 WA Senders: <code>${senderText}</code>\n\n`;
  });

  bot.sendMessage(chatId, listMsg, { 
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]]
    }
  });
}

// Callback Query Handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const db = readDb();
  const role = getRole(userId, db);

  // Acknowledge the click
  bot.answerCallbackQuery(query.id);

  if (data === "menu_start") {
    // Delete message and resend menu
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    
    let matchedUsername = '';
    if (db.users) {
      for (const uname in db.users) {
        if (uname === query.from.username?.toLowerCase()) {
          matchedUsername = uname;
          break;
        }
      }
    }
    if (!matchedUsername && role === 'Owner') matchedUsername = 'pepet';

    let welcomeMsg = `<b>⚡ THE EXECUTOR ACCESS PANEL ⚡</b>\n\n`;
    welcomeMsg += `🌐 <b>Sistem Integrasi Gateway WhatsApp</b>\n`;
    welcomeMsg += `───────────────────\n`;
    welcomeMsg += `👤 <b>ID Telegram:</b> <code>${userId}</code>\n`;
    welcomeMsg += `🏷️ <b>Akses Level:</b> <code>${role.toUpperCase()}</code>\n`;
    welcomeMsg += `───────────────────\n`;
    welcomeMsg += `<i>Silakan gunakan tombol menu interaktif di bawah untuk mengelola node dan akun Anda.</i>`;

    bot.sendMessage(chatId, welcomeMsg, { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuMarkup(userId, role, matchedUsername)
    });
  } 
  
  else if (data === "menu_info") {
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    sendAccountInfo(chatId, query.from);
  } 
  
  else if (data === "menu_list") {
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    sendUserList(chatId, userId);
  }

  else if (data === "menu_create") {
    if (role !== 'Owner' && role !== 'Reseller') return;
    botStates.set(chatId, { step: 'input_username' });
    bot.sendMessage(chatId, "<b>👤 [CREATE USER] - STEP 1</b>\n\nMasukkan <b>username</b> untuk akun baru:\n<i>(Hanya boleh huruf, angka, dan underscore)</i>", {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Batal", callback_data: "action_cancel" }]]
      }
    });
  }

  else if (data === "menu_delete") {
    if (role !== 'Owner' && role !== 'Reseller') return;
    botStates.set(chatId, { step: 'delete_username' });
    bot.sendMessage(chatId, "<b>❌ [DELETE USER]</b>\n\nMasukkan <b>username</b> akun yang ingin dihapus:", {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Batal", callback_data: "action_cancel" }]]
      }
    });
  }

  else if (data === "menu_add_reseller") {
    if (role !== 'Owner') return;
    botStates.set(chatId, { step: 'add_reseller_id' });
    bot.sendMessage(chatId, "<b>👑 [ADD RESELLER]</b>\n\nMasukkan <b>Telegram ID</b> yang ingin dijadikan Reseller:", {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Batal", callback_data: "action_cancel" }]]
      }
    });
  }

  else if (data === "menu_del_reseller") {
    if (role !== 'Owner') return;
    botStates.set(chatId, { step: 'del_reseller_id' });
    bot.sendMessage(chatId, "<b>🗑️ [REMOVE RESELLER]</b>\n\nMasukkan <b>Telegram ID</b> reseller yang ingin dihapus:", {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Batal", callback_data: "action_cancel" }]]
      }
    });
  }

  else if (data === "action_cancel") {
    botStates.delete(chatId);
    bot.sendMessage(chatId, "❌ Tindakan dibatalkan.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]]
      }
    });
  }

  // Interactive selection steps
  else if (data.startsWith("status_")) {
    const state = botStates.get(chatId);
    if (!state || state.step !== 'select_status') return;

    state.status = data.split('_')[1];
    state.step = 'select_duration';

    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    bot.sendMessage(chatId, `<b>👤 [CREATE USER] - STEP 3</b>\n\nUsername: <code>${state.username}</code>\nRole: <code>${state.status}</code>\n\nPilih <b>durasi aktif</b> akun:`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 30 Hari", callback_data: "dur_30" },
            { text: "📅 90 Hari", callback_data: "dur_90" }
          ],
          [
            { text: "📅 365 Hari", callback_data: "dur_365" },
            { text: "♾️ Permanen", callback_data: "dur_inf" }
          ],
          [{ text: "❌ Batal", callback_data: "action_cancel" }]
        ]
      }
    });
  }

  else if (data.startsWith("dur_")) {
    const state = botStates.get(chatId);
    if (!state || state.step !== 'select_duration') return;

    const type = data.split('_')[1];
    let expiryDate = "9999-12-31";

    if (type !== 'inf') {
      const days = parseInt(type, 10);
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiryDate = d.toISOString().split('T')[0];
    }

    state.activeUntil = expiryDate;
    state.step = 'input_limit';

    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    bot.sendMessage(chatId, `<b>👤 [CREATE USER] - STEP 4</b>\n\nUsername: <code>${state.username}</code>\nRole: <code>${state.status}</code>\nExp: <code>${state.activeUntil}</code>\n\nMasukkan <b>limit eksekusi</b> untuk akun ini (ketik berupa angka di chat, contoh: <code>100</code>):`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Batal", callback_data: "action_cancel" }]]
      }
    });
  }
});

// Interactive Message Handler (for text inputs)
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';
  const state = botStates.get(chatId);

  if (!state || !text) return;
  if (text.startsWith('/')) return; // Ignore slash commands

  const db = readDb();

  // Create User Process: Input Username
  if (state.step === 'input_username') {
    const username = text.toLowerCase();
    const usernameRegex = /^[a-zA-Z0-9_]+$/;

    if (!usernameRegex.test(username)) {
      return bot.sendMessage(chatId, "⚠️ <b>Format username salah!</b>\nUsername hanya boleh mengandung huruf, angka, dan underscore (_). Silakan coba lagi:", { parse_mode: 'HTML' });
    }

    if (db.users && db.users[username]) {
      return bot.sendMessage(chatId, `⚠️ Username <code>${username}</code> sudah terdaftar. Masukkan username lain:`, { parse_mode: 'HTML' });
    }

    state.username = username;
    state.step = 'select_status';

    bot.sendMessage(chatId, `<b>👤 [CREATE USER] - STEP 2</b>\n\nUsername: <code>${state.username}</code>\n\nPilih <b>status/role</b> di website untuk user ini:`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "User", callback_data: "status_User" },
            { text: "VIP", callback_data: "status_VIP" }
          ],
          [
            { text: "Reseller", callback_data: "status_Reseller" },
            { text: "Owner", callback_data: "status_Owner" }
          ],
          [{ text: "❌ Batal", callback_data: "action_cancel" }]
        ]
      }
    });
  }

  // Create User Process: Input Limit
  else if (state.step === 'input_limit') {
    const limit = parseInt(text, 10);
    if (isNaN(limit) || limit < 0) {
      return bot.sendMessage(chatId, "⚠️ <b>Limit tidak valid!</b> Limit harus berupa angka positif. Silakan coba lagi:", { parse_mode: 'HTML' });
    }

    // Save to Database
    if (!db.users) db.users = {};
    if (!db.history) db.history = {};

    const randomPass = Math.random().toString(36).substring(2, 8); // Generate 6-char random password
    db.users[state.username] = {
      username: state.username,
      password: randomPass,
      status: state.status,
      activeUntil: state.activeUntil,
      limit: limit,
      whatsappSenders: []
    };
    db.history[state.username] = [];

    botStates.delete(chatId);

    if (writeDb(db)) {
      const dashboardLink = `${config.DASHBOARD_URL}/dashboard?username=${state.username}`;
      let successMsg = `<b>✅ Akun Berhasil Dibuat!</b>\n\n`;
      successMsg += `👤 <b>Username:</b> <code>${state.username}</code>\n`;
      successMsg += `🔑 <b>Password:</b> <code>${randomPass}</code>\n`;
      successMsg += `🏷️ <b>Website Role:</b> <code>${state.status}</code>\n`;
      successMsg += `📅 <b>Masa Aktif:</b> <code>${state.activeUntil}</code>\n`;
      successMsg += `⚡ <b>Limit Eksekusi:</b> <code>${limit}</code>\n\n`;
      successMsg += `🔗 <b>Tautan Dashboard:</b> <a href="${dashboardLink}">Buka Dashboard</a>`;
      successMsg += `📅 <b>Masa Aktif:</b> <code>${state.activeUntil}</code>\n`;
      successMsg += `⚡ <b>Limit Eksekusi:</b> <code>${limit}</code>\n\n`;
      successMsg += `🔗 <b>Tautan Dashboard:</b> <a href="${dashboardLink}">Buka Dashboard</a>`;
      
      bot.sendMessage(chatId, successMsg, { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]]
        }
      });
    } else {
      bot.sendMessage(chatId, "❌ Gagal menyimpan data ke database. Hubungi developer.");
    }
  }

  // Delete User Process
  else if (state.step === 'delete_username') {
    const username = text.toLowerCase();

    if (!db.users || !db.users[username]) {
      botStates.delete(chatId);
      return bot.sendMessage(chatId, `⚠️ Username <code>${username}</code> tidak ditemukan di database.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    }

    delete db.users[username];
    if (db.history && db.history[username]) {
      delete db.history[username];
    }

    botStates.delete(chatId);

    if (writeDb(db)) {
      bot.sendMessage(chatId, `✅ Akun dengan username <code>${username}</code> berhasil dihapus.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    } else {
      bot.sendMessage(chatId, "❌ Gagal menghapus akun dari database. Hubungi developer.");
    }
  }

  // Add Reseller Process
  else if (state.step === 'add_reseller_id') {
    const resellerId = parseInt(text, 10);
    if (isNaN(resellerId)) {
      return bot.sendMessage(chatId, "⚠️ <b>ID tidak valid!</b> ID harus berupa angka. Coba lagi:", { parse_mode: 'HTML' });
    }

    if (!db.botConfig) db.botConfig = { ownerId: ownerEnvId || 0, resellers: [] };
    if (!db.botConfig.resellers) db.botConfig.resellers = [];

    if (db.botConfig.resellers.includes(resellerId)) {
      botStates.delete(chatId);
      return bot.sendMessage(chatId, `⚠️ Telegram ID <code>${resellerId}</code> sudah terdaftar sebagai Reseller.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    }

    db.botConfig.resellers.push(resellerId);
    botStates.delete(chatId);

    if (writeDb(db)) {
      bot.sendMessage(chatId, `✅ Telegram ID <code>${resellerId}</code> berhasil ditambahkan sebagai Reseller.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    } else {
      bot.sendMessage(chatId, "❌ Gagal menyimpan data ke database. Hubungi developer.");
    }
  }

  // Remove Reseller Process
  else if (state.step === 'del_reseller_id') {
    const resellerId = parseInt(text, 10);
    if (isNaN(resellerId)) {
      return bot.sendMessage(chatId, "⚠️ <b>ID tidak valid!</b> ID harus berupa angka. Coba lagi:", { parse_mode: 'HTML' });
    }

    if (!db.botConfig || !db.botConfig.resellers || !db.botConfig.resellers.includes(resellerId)) {
      botStates.delete(chatId);
      return bot.sendMessage(chatId, `⚠️ Telegram ID <code>${resellerId}</code> tidak terdaftar sebagai Reseller.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    }

    db.botConfig.resellers = db.botConfig.resellers.filter(id => id !== resellerId);
    botStates.delete(chatId);

    if (writeDb(db)) {
      bot.sendMessage(chatId, `✅ Telegram ID <code>${resellerId}</code> berhasil dihapus dari daftar Reseller.`, { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Kembali ke Menu", callback_data: "menu_start" }]] }
      });
    } else {
      bot.sendMessage(chatId, "❌ Gagal menyimpan data ke database. Hubungi developer.");
    }
  }
});

// Original Slash Commands (kept as fallback compatibility)
bot.onText(/^\/createuser(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const db = readDb();
  const role = getRole(userId, db);

  if (role !== 'Owner' && role !== 'Reseller') return;

  const argsString = match[1];
  if (!argsString) return;

  const args = argsString.trim().split(/\s+/);
  if (args.length < 4) return;

  const [usernameInput, statusInput, activeUntil, limitInput] = args;
  const username = usernameInput.toLowerCase().trim();
  const limit = parseInt(limitInput, 10);

  if (!db.users) db.users = {};
  const randomPass = Math.random().toString(36).substring(2, 8);
  db.users[username] = {
    username,
    password: randomPass,
    status: statusInput,
    activeUntil,
    limit,
    whatsappSenders: []
  };
  writeDb(db);
});

bot.onText(/^\/deleteuser(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const db = readDb();
  const role = getRole(userId, db);
  if (role !== 'Owner' && role !== 'Reseller') return;

  const usernameInput = match[1];
  if (!usernameInput) return;
  const username = usernameInput.trim().toLowerCase();

  if (db.users && db.users[username]) {
    delete db.users[username];
    writeDb(db);
  }
});

bot.onText(/^\/listusers/, (msg) => {
  sendUserList(msg.chat.id, msg.from.id);
});

bot.onText(/^\/addreseller(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const db = readDb();
  if (getRole(userId, db) !== 'Owner') return;

  const resellerIdInput = match[1];
  if (!resellerIdInput) return;
  const resellerId = parseInt(resellerIdInput.trim(), 10);

  if (!db.botConfig) db.botConfig = { ownerId: ownerEnvId || 0, resellers: [] };
  if (!db.botConfig.resellers) db.botConfig.resellers = [];
  if (!db.botConfig.resellers.includes(resellerId)) {
    db.botConfig.resellers.push(resellerId);
    writeDb(db);
  }
});

bot.onText(/^\/removereseller(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const db = readDb();
  if (getRole(userId, db) !== 'Owner') return;

  const resellerIdInput = match[1];
  if (!resellerIdInput) return;
  const resellerId = parseInt(resellerIdInput.trim(), 10);

  if (db.botConfig && db.botConfig.resellers) {
    db.botConfig.resellers = db.botConfig.resellers.filter(id => id !== resellerId);
    writeDb(db);
  }
});

// Error handling for polling errors
bot.on('polling_error', (error) => {
  console.error("⚠️ Telegram Bot Polling Error:", error.message || error);
});
