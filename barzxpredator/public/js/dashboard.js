document.addEventListener('DOMContentLoaded', () => {
  // 1. Session check
  const savedUsername = localStorage.getItem('username');
  if (!savedUsername) {
    window.location.href = '/login';
    return;
  }

  // Check URL params
  const urlParams = new URLSearchParams(window.location.search);
  const urlUsername = urlParams.get('username');
  if (urlUsername !== savedUsername) {
    window.location.href = `/dashboard?username=${savedUsername}`;
    return;
  }

  // 2. Element references
  const accessDeniedScreen = document.getElementById('accessDeniedScreen');
  const unregisteredUsername = document.getElementById('unregisteredUsername');
  const authorizedPanel = document.getElementById('authorizedPanel');
  
  // Header / API Status
  const apiStatusBadge = document.getElementById('apiStatusBadge');
  const apiStatusDot = document.getElementById('apiStatusDot');
  const apiStatusText = document.getElementById('apiStatusText');

  // Profile fields
  const profileLetter = document.getElementById('profileLetter');
  const profileUsername = document.getElementById('profileUsername');
  const profileRole = document.getElementById('profileRole');
  const profileExpiry = document.getElementById('profileExpiry');
  
  const profileLetterBig = document.getElementById('profileLetterBig');
  const profileUsernameBig = document.getElementById('profileUsernameBig');
  const profileRoleBig = document.getElementById('profileRoleBig');
  const profileDetailsList = document.getElementById('profileDetailsList');

  // Stats
  const onlineSendersCount = document.getElementById('onlineSendersCount');
  const onlineStatusPulse = document.getElementById('onlineStatusPulse');
  const totalSendersCount = document.getElementById('totalSendersCount');
  const totalSendersBar = document.getElementById('totalSendersBar');
  const totalSendersPulse = document.getElementById('totalSendersPulse');
  const totalSendersIconBg = document.getElementById('totalSendersIconBg');
  const totalSendersLabel = document.getElementById('totalSendersLabel');

  // Senders List Manager
  const addSenderButton = document.getElementById('addSenderButton');
  const sendersListWrapper = document.getElementById('sendersListWrapper');

  // Execution
  const execForm = document.getElementById('execForm');
  const targetPhoneInput = document.getElementById('targetPhoneInput');
  const protocolDropdownTrigger = document.getElementById('protocolDropdownTrigger');
  const selectedProtocolText = document.getElementById('selectedProtocolText');
  const dropdownArrow = document.getElementById('dropdownArrow');
  const protocolDropdownMenu = document.getElementById('protocolDropdownMenu');
  const executeButton = document.getElementById('executeButton');
  const offlineWarningText = document.getElementById('offlineWarningText');

  // Logs
  const logsCountText = document.getElementById('logsCountText');
  const logsWrapper = document.getElementById('logsWrapper');

  // Nav Buttons
  const navButtons = document.querySelectorAll('.nav-tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Modal Senders Pairing
  const pairingModal = document.getElementById('pairingModal');
  const pairingModalBackdrop = document.getElementById('pairingModalBackdrop');
  const pairingStepPhone = document.getElementById('pairingStepPhone');
  const pairingPhoneForm = document.getElementById('pairingPhoneForm');
  const pairingPhoneInput = document.getElementById('pairingPhoneInput');
  const pairingOfflineText = document.getElementById('pairingOfflineText');

  const pairingStepCode = document.getElementById('pairingStepCode');
  const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');
  const pairingTargetDisplay = document.getElementById('pairingTargetDisplay');
  const countdownTimer = document.getElementById('countdownTimer');
  const pairingBackButton = document.getElementById('pairingBackButton');
  const pairingConfirmButton = document.getElementById('pairingConfirmButton');

  const pairingStepSuccess = document.getElementById('pairingStepSuccess');

  // Sidebar
  const openSidebarButton = document.getElementById('openSidebarButton');
  const closeSidebarButton = document.getElementById('closeSidebarButton');
  const sidebarDrawer = document.getElementById('sidebarDrawer');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const adminPanelLinkWrapper = document.getElementById('adminPanelLinkWrapper');
  const logoutButton = document.getElementById('logoutButton');

  // Toast
  const toastContainer = document.getElementById('toastContainer');

  // 3. Global states
  let activeTab = 'dashboard';
  let senders = [];
  let isServerOnline = true;
  let selectedProtocol = 'A';
  let countdownSeconds = 0;
  let countdownInterval = null;
  let lastLogsJson = '';
  let lastDetailsJson = '';

  // Initialize
  initDashboard();

  async function initDashboard() {
    try {
      const res = await fetch(`/api/dashboard/init?username=${savedUsername}`);
      const data = await res.json();
      
      if (!res.ok || !data.user) {
        // Clear invalid session and redirect to login page
        localStorage.clear();
        window.location.href = '/login';
        return;
      }

      // Render elements
      accessDeniedScreen.classList.add('hidden');
      authorizedPanel.classList.remove('hidden');

      // Populate data initially
      syncDashboardDataWithPayload(data);

      // Render Senders initial
      updateSendersView();

      // Start Polling WhatsApp status & dashboard stats in background
      pollSendersStatus();
      setInterval(pollSendersStatus, 5000);
      
      // Start Realtime Background Sync (sync every 3 seconds)
      setInterval(syncDashboardData, 3000);

      // Show Home Tab initially
      switchTab('dashboard');

    } catch (err) {
      console.error(err);
      triggerToast('FAILED TO INITIALIZE DASHBOARD', 'info');
    }
  }

  // Realtime dynamic sync without page refresh
  async function syncDashboardData() {
    try {
      const res = await fetch(`/api/dashboard/init?username=${savedUsername}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.user) return;
      
      syncDashboardDataWithPayload(data);
    } catch (err) {
      console.error('Failed to sync dashboard:', err);
    }
  }

  function syncDashboardDataWithPayload(data) {
    const user = data.user;
    const history = data.history || [];
    senders = user.whatsappSenders || [];

    // Render developer credits dynamically
    if (data.credits && Array.isArray(data.credits)) {
      const devEl = document.getElementById('developerCredits');
      if (devEl) {
        const creditsHtml = data.credits.join('<br>');
        if (devEl.innerHTML !== creditsHtml) {
          devEl.innerHTML = creditsHtml;
        }
      }
    }

    // Render profile header fields
    const initial = (user.username || 'U')[0].toUpperCase();
    if (profileLetter.innerText !== initial) profileLetter.innerText = initial;
    if (profileLetterBig.innerText !== initial) profileLetterBig.innerText = initial;
    if (profileUsername.innerText !== user.username) profileUsername.innerText = user.username || 'GUEST';
    if (profileUsernameBig.innerText !== user.username) profileUsernameBig.innerText = user.username || 'GUEST';
    
    const statusVal = user.status || 'USER';
    if (profileRole.innerText !== statusVal) profileRole.innerText = statusVal;
    if (profileRoleBig.innerText !== statusVal) profileRoleBig.innerText = statusVal;
    
    const expiryText = `EXP ${user.activeUntil || 'N/A'}`;
    if (profileExpiry.innerText !== expiryText) profileExpiry.innerText = expiryText;

    // Sidebar admin access menu check
    const hasAdminAccess = (user.status === 'Owner' || user.status === 'Reseller');
    const hasExistingAdminBtn = adminPanelLinkWrapper.querySelector('a') !== null;
    if (hasAdminAccess && !hasExistingAdminBtn) {
      adminPanelLinkWrapper.innerHTML = `
        <a href="/admin" class="flex items-center gap-3 p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/15 hover:border-indigo-500/30 transition-all group">
          <div class="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
          <div class="flex-1 min-w-0 text-left">
            <p class="text-[10px] font-bold tracking-[0.15em] text-indigo-300">ADMIN PANEL</p>
            <p class="text-[8px] tracking-[0.1em] text-zinc-500 font-semibold mt-0.5 uppercase">MANAGE USERS</p>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-indigo-400/60 group-hover:translate-x-0.5 transition-transform">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </a>
      `;
    } else if (!hasAdminAccess) {
      adminPanelLinkWrapper.innerHTML = '';
    }

    // Profile details list block
    const details = [
      { label: 'USERNAME', value: user.username || 'Guest', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>', color: 'text-indigo-400' },
      { label: 'ROLE', value: user.status || 'User', icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>', color: 'text-purple-400' },
      { label: 'EXEC LIMIT', value: user.limit || 0, icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>', color: 'text-amber-400' },
      { label: 'EXPIRES', value: user.activeUntil || 'N/A', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>', color: 'text-emerald-400' }
    ];

    const detailsJson = JSON.stringify(details);
    if (detailsJson !== lastDetailsJson) {
      lastDetailsJson = detailsJson;
      profileDetailsList.innerHTML = details.map((item, idx) => `
        <div class="flex items-center gap-3.5 py-4 ${idx === 0 ? 'pt-0' : ''} ${idx === details.length - 1 ? 'pb-0' : ''}">
          <div class="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${item.color}">${item.icon}</svg>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[9px] tracking-[0.15em] text-zinc-500 font-bold">${item.label}</p>
            <p class="text-[13px] font-bold text-zinc-200 tracking-wider truncate mt-0.5">${item.value}</p>
          </div>
        </div>
      `).join('');
    }

    // Render Logs (internally optimized in renderLogs to prevent redraw if identical)
    renderLogs(history);
  }

  // 4. Tab Switcher
  function switchTab(tabId) {
    activeTab = tabId;
    tabPanes.forEach(pane => {
      if (pane.id === `tab-${tabId}`) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });

    navButtons.forEach(btn => {
      const isTarget = btn.getAttribute('data-tab') === tabId;
      const indicator = btn.querySelector('.active-indicator');
      const bg = btn.querySelector('.active-bg');
      const label = btn.querySelector('span');

      if (isTarget) {
        btn.classList.add('text-white');
        btn.classList.remove('text-zinc-600', 'hover:text-zinc-400', 'active:scale-95');
        indicator.classList.remove('opacity-0');
        indicator.classList.add('opacity-100');
        bg.classList.remove('opacity-0');
        bg.classList.add('opacity-100');
        label.classList.add('text-indigo-300');
      } else {
        btn.classList.remove('text-white');
        btn.classList.add('text-zinc-600', 'hover:text-zinc-400', 'active:scale-95');
        indicator.classList.add('opacity-0');
        indicator.classList.remove('opacity-100');
        bg.classList.add('opacity-0');
        bg.classList.remove('opacity-100');
        label.classList.remove('text-indigo-300');
      }
    });
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  // 5. Polling WhatsApp senders status
  async function pollSendersStatus() {
    try {
      const res = await fetch(`/api/senders?username=${savedUsername}`);
      if (res.ok) {
        const data = await res.json();
        if (data.whatsappSenders) {
          senders = data.whatsappSenders;
          updateSendersView();
        }
        setServerOnlineState(true);
      } else {
        setServerOnlineState(false);
      }
    } catch (err) {
      setServerOnlineState(false);
    }
  }

  function setServerOnlineState(online) {
    isServerOnline = online;
    if (online) {
      apiStatusBadge.className = "inline-flex items-center gap-1 text-[8px] font-bold tracking-wider text-emerald-400";
      apiStatusDot.className = "w-1 h-1 rounded-full bg-emerald-400 glow-dot";
      apiStatusText.innerText = "API ONLINE";
      
      executeButton.disabled = false;
      executeButton.classList.remove('opacity-50', 'cursor-not-allowed');
      offlineWarningText.classList.add('hidden');
      pairingOfflineText.classList.add('hidden');
    } else {
      apiStatusBadge.className = "inline-flex items-center gap-1 text-[8px] font-bold tracking-wider text-red-400 animate-pulse";
      apiStatusDot.className = "w-1 h-1 rounded-full bg-red-400";
      apiStatusText.innerText = "API OFFLINE";
      
      executeButton.disabled = true;
      executeButton.classList.add('opacity-50', 'cursor-not-allowed');
      offlineWarningText.classList.remove('hidden');
      pairingOfflineText.classList.remove('hidden');
    }
  }

  // 6. Update Senders List UI
  function updateSendersView() {
    const onlineList = senders.filter(s => s.linked);
    onlineSendersCount.innerText = onlineList.length;
    if (onlineList.length > 0) {
      onlineStatusPulse.classList.remove('hidden');
      totalSendersPulse.classList.remove('hidden');
    } else {
      onlineStatusPulse.classList.add('hidden');
      totalSendersPulse.classList.add('hidden');
    }

    totalSendersCount.innerText = senders.length;
    if (senders.length > 0) {
      totalSendersBar.className = "absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-emerald-500 to-emerald-400";
      totalSendersIconBg.className = "w-10 h-10 rounded-xl border border-emerald-500/20 text-emerald-400 bg-emerald-500/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110";
      totalSendersLabel.innerText = "ACTIVE DEPLOYED";
      totalSendersLabel.className = "text-[9px] mt-3 tracking-widest font-semibold text-emerald-400";
    } else {
      totalSendersBar.className = "absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-zinc-600 to-zinc-500";
      totalSendersIconBg.className = "w-10 h-10 rounded-xl border border-zinc-600/30 text-zinc-500 bg-zinc-800/50 flex items-center justify-center transition-all duration-300 group-hover:scale-110";
      totalSendersLabel.innerText = "NO SENDERS";
      totalSendersLabel.className = "text-[9px] mt-3 tracking-widest font-semibold text-zinc-500";
    }

    // Render list
    if (senders.length === 0) {
      sendersListWrapper.innerHTML = `
        <div class="glass-subtle p-6 text-center border border-dashed border-zinc-800 rounded-xl">
          <p class="text-[10px] text-zinc-500 tracking-[0.15em] font-bold uppercase mb-1">No Senders Connected</p>
          <p class="text-[9px] text-zinc-600 leading-relaxed max-w-[280px] mx-auto">Link your first WhatsApp account using the Pairing Code method to start sending messages.</p>
        </div>
      `;
    } else {
      sendersListWrapper.innerHTML = senders.map(sender => `
        <div data-number="${sender.number}" class="sender-item-card glass-subtle p-3.5 rounded-xl border border-white/5 flex items-center justify-between transition-all hover:border-zinc-800">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-[#0e0e14] border border-zinc-800 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="${sender.linked ? 'text-emerald-400' : 'text-zinc-500'}">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.327 0-4.47-.781-6.191-2.093l-.367-.291-2.694.903.903-2.694-.291-.367A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-zinc-200 font-mono tracking-wider truncate">${sender.number}</p>
              <p class="text-[8px] text-zinc-500 font-semibold tracking-wider uppercase mt-0.5">
                ${sender.connectedAt ? `Linked: ${sender.connectedAt}` : 'Linked status unknown'}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[8px] px-2 py-0.5 rounded border tracking-[0.15em] font-semibold ${sender.linked
              ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5'
              : 'border-zinc-800 text-zinc-500 bg-zinc-900/50'
            }">
              ${sender.linked ? 'ONLINE' : 'OFFLINE'}
            </span>
            <button onclick="requestDisconnect('${sender.number}')" class="w-8 h-8 rounded-lg bg-zinc-950/40 border border-zinc-800/80 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:border-red-500/20 active:scale-95 transition-all" title="Disconnect">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  // 7. Disconnect session confirm state trigger
  window.requestDisconnect = function (num) {
    const card = document.querySelector(`.sender-item-card[data-number="${num}"]`);
    if (!card) return;

    card.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <span class="text-[9px] tracking-[0.15em] text-red-400 font-bold uppercase">Disconnect Sender?</span>
        <div class="flex gap-2">
          <button onclick="confirmDisconnect('${num}')" class="px-2.5 py-1 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-[9px] tracking-[0.12em] font-bold hover:bg-red-500/35 active:scale-95">
            DISCONNECT
          </button>
          <button onclick="cancelDisconnect()" class="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px] tracking-[0.12em] font-bold hover:bg-zinc-700 active:scale-95">
            CANCEL
          </button>
        </div>
      </div>
    `;
  };

  window.cancelDisconnect = function () {
    updateSendersView();
  };

  window.confirmDisconnect = async function (num) {
    try {
      triggerToast("DISCONNECTING...", "info");
      const res = await fetch('/api/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: savedUsername, number: num })
      });
      if (res.ok) {
        senders = senders.filter(s => s.number !== num);
        updateSendersView();
        triggerToast("SENDER DISCONNECTED", "info");
      } else {
        triggerToast("FAILED TO DISCONNECT", "info");
      }
    } catch (err) {
      triggerToast("SERVER UNREACHABLE", "info");
    }
  };

  // 8. Render logs list
  function renderLogs(logs) {
    const logsJson = JSON.stringify(logs);
    if (logsJson === lastLogsJson) return;
    lastLogsJson = logsJson;

    logsCountText.innerText = `${logs.length} RECORDS`;
    if (logs.length === 0) {
      logsWrapper.innerHTML = `
        <div class="text-center py-12">
          <div class="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <p class="label text-zinc-600">NO RECORDS FOUND</p>
        </div>
      `;
    } else {
      logsWrapper.innerHTML = logs.map((h, idx) => `
        <div class="glass-subtle p-4 hover:border-white/10 transition-all duration-300 anim-slide-up anim-stagger-${Math.min(idx + 2, 4)}">
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-zinc-600 font-mono">#${String(h.id).padStart(3, '0')}</span>
              <div class="w-1.5 h-1.5 rounded-full ${h.status === 'Success' ? 'bg-emerald-400' : 'bg-zinc-500'}"></div>
            </div>
            <span class="text-[10px] px-3 py-1.5 rounded-lg border tracking-[0.15em] font-semibold ${
              h.status === 'Success' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-400 bg-zinc-800/50'
            }">${h.status}</span>
          </div>
          <p class="text-[15px] text-zinc-200 tracking-wider font-bold mb-2 font-mono">${h.target}</p>
          <div class="flex justify-between items-center">
            <span class="label text-zinc-600">${h.payload}</span>
            <span class="text-[10px] text-zinc-700 tracking-wide">${h.date}</span>
          </div>
        </div>
      `).join('');
    }
  }

  // 9. Toast notification trigger
  function triggerToast(message, type = 'success') {
    const icon = type === 'success' 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' 
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    
    toastContainer.innerHTML = `
      <div class="glass px-6 py-3.5 flex items-center gap-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] ${
        type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 glow-green' : 'bg-indigo-500/10 border-indigo-500/30 glow-indigo'
      }">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center ${type === 'success' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}">
          <div class="${type === 'success' ? 'text-emerald-400' : 'text-indigo-400'}">${icon}</div>
        </div>
        <span class="text-xs font-bold tracking-[0.15em] ${type === 'success' ? 'text-emerald-300' : 'text-indigo-300'}">${message}</span>
      </div>
    `;
    
    toastContainer.classList.remove('hidden');
    setTimeout(() => {
      toastContainer.classList.add('hidden');
    }, 2500);
  }

  // 10. Execution Tab - Custom Dropdown
  protocolDropdownTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    protocolDropdownMenu.classList.toggle('hidden');
    dropdownArrow.classList.toggle('rotate-180');
  });

  document.addEventListener('click', () => {
    protocolDropdownMenu.classList.add('hidden');
    dropdownArrow.classList.remove('rotate-180');
  });

  const options = protocolDropdownMenu.querySelectorAll('.protocol-option');
  options.forEach(opt => {
    opt.addEventListener('click', () => {
      selectedProtocol = opt.getAttribute('data-protocol');
      selectedProtocolText.innerText = opt.querySelector('span:first-child').innerText;
      
      // Update backgrounds inside dropdown selection
      options.forEach(o => {
        o.className = "w-full text-left p-3 rounded-xl transition-all duration-200 flex flex-col gap-0.5 border border-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200";
      });
      opt.className = "w-full text-left p-3 rounded-xl transition-all duration-200 flex flex-col gap-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300";
    });
  });

  execForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = targetPhoneInput.value.trim();
    if (!target) return;

    triggerToast("SENDING PAYLOAD...", "info");

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: savedUsername,
          targetNumber: target,
          protocol: selectedProtocol
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        triggerToast("EXECUTION INITIATED", "success");
        targetPhoneInput.value = '';
        
        // Refresh logs list after sending
        const dataInit = await (await fetch(`/api/dashboard/init?username=${savedUsername}`)).json();
        if (dataInit.history) renderLogs(dataInit.history);
      } else {
        triggerToast(data.error || "FAILED TO SEND PAYLOAD", "info");
      }
    } catch (err) {
      console.error(err);
      triggerToast("SERVER UNREACHABLE", "info");
    }
  });

  // 11. Modal Link Senders
  addSenderButton.addEventListener('click', () => {
    pairingStepPhone.classList.remove('hidden');
    pairingStepCode.classList.add('hidden');
    pairingStepSuccess.classList.add('hidden');
    pairingPhoneInput.value = '';
    pairingModal.classList.remove('hidden');
  });

  pairingModalBackdrop.addEventListener('click', () => {
    closePairingModal();
  });

  function closePairingModal() {
    pairingModal.classList.add('hidden');
    clearInterval(countdownInterval);
  }

  pairingBackButton.addEventListener('click', () => {
    pairingStepCode.classList.add('hidden');
    pairingStepPhone.classList.remove('hidden');
    clearInterval(countdownInterval);
  });

  pairingConfirmButton.addEventListener('click', () => {
    closePairingModal();
    triggerToast("WAITING FOR WHATSAPP TO SYNC...", "info");
  });

  pairingPhoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = pairingPhoneInput.value.trim();
    if (!phone) return;

    triggerToast("GENERATING CODE...", "info");

    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: savedUsername, number: phone })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.alreadyLinked) {
          triggerToast("SENDER ALREADY LINKED", "success");
          closePairingModal();
          pollSendersStatus();
        } else {
          pairingCodeDisplay.innerText = `${data.pairingCode.substring(0, 4)}-${data.pairingCode.substring(4)}`;
          pairingTargetDisplay.innerText = phone;
          
          pairingStepPhone.classList.add('hidden');
          pairingStepCode.classList.remove('hidden');
          triggerToast("PAIRING CODE GENERATED", "info");
          
          // Start timer
          startCountdown(120);
        }
      } else {
        triggerToast(data.error || "FAILED TO GENERATE CODE", "info");
      }
    } catch (err) {
      console.error(err);
      triggerToast("SERVER UNREACHABLE", "info");
    }
  });

  function startCountdown(seconds) {
    countdownSeconds = seconds;
    clearInterval(countdownInterval);
    
    updateTimerText();
    countdownInterval = setInterval(() => {
      countdownSeconds--;
      updateTimerText();
      if (countdownSeconds <= 0) {
        clearInterval(countdownInterval);
        countdownTimer.innerHTML = '<span class="text-red-400 font-bold">EXPIRED</span>';
      }
    }, 1000);
  }

  function updateTimerText() {
    const mins = Math.floor(countdownSeconds / 60);
    const secs = String(countdownSeconds % 60).padStart(2, '0');
    countdownTimer.innerText = `${mins}:${secs}`;
    if (countdownSeconds < 30) {
      countdownTimer.className = "font-bold text-red-400";
    } else {
      countdownTimer.className = "font-bold text-indigo-300";
    }
  }

  // 12. Sidebar
  openSidebarButton.addEventListener('click', () => {
    sidebarDrawer.classList.remove('hidden');
  });

  closeSidebarButton.addEventListener('click', () => {
    sidebarDrawer.classList.add('hidden');
  });

  sidebarBackdrop.addEventListener('click', () => {
    sidebarDrawer.classList.add('hidden');
  });

  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('username');
    window.location.href = '/login';
  });


  // 15. SSH VPS Installer Actions
  const sshInstallForm = document.getElementById('sshInstallForm');
  const sshIp = document.getElementById('sshIp');
  const sshPort = document.getElementById('sshPort');
  const sshUsername = document.getElementById('sshUsername');
  const sshPassword = document.getElementById('sshPassword');
  const sshScriptSelect = document.getElementById('sshScriptSelect');
  const sshCustomCommandWrapper = document.getElementById('sshCustomCommandWrapper');
  const sshCustomCommand = document.getElementById('sshCustomCommand');
  const btnExecuteSsh = document.getElementById('btnExecuteSsh');
  const sshConsoleWrapper = document.getElementById('sshConsoleWrapper');
  const sshConsole = document.getElementById('sshConsole');
  const btnClearConsole = document.getElementById('btnClearConsole');

  if (sshScriptSelect) {
    sshScriptSelect.addEventListener('change', () => {
      if (sshScriptSelect.value === 'custom') {
        sshCustomCommandWrapper.classList.remove('hidden');
        if (sshCustomCommand) sshCustomCommand.setAttribute('required', 'true');
      } else {
        sshCustomCommandWrapper.classList.add('hidden');
        if (sshCustomCommand) sshCustomCommand.removeAttribute('required');
      }
    });
  }

  if (btnClearConsole) {
    btnClearConsole.addEventListener('click', () => {
      if (sshConsole) {
        sshConsole.innerHTML = '<div>Console cleared.</div>';
      }
    });
  }

  const appendToConsole = (text) => {
    if (!sshConsole) return;
    
    // Create element to preserve line endings & spaces
    const line = document.createElement('div');
    line.className = 'whitespace-pre-wrap font-mono py-0.5 break-all';
    line.innerText = text;
    sshConsole.appendChild(line);
    
    // Scroll to bottom
    sshConsole.scrollTop = sshConsole.scrollHeight;
  };

  if (sshInstallForm) {
    sshInstallForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const ip = sshIp.value.trim();
      const port = sshPort.value || 22;
      const username = sshUsername.value.trim() || 'root';
      const password = sshPassword.value;
      const scriptOption = sshScriptSelect.value;
      
      let command = '';
      if (scriptOption === 'ptero-panel') {
        command = 'bash <(curl -s https://pterodactyl-installer.se)';
      } else if (scriptOption === 'ptero-theme') {
        command = 'bash <(curl -sL https://raw.githubusercontent.com/pterodactyl-installer/pterodactyl-installer/master/theme.sh)';
      } else {
        command = sshCustomCommand.value.trim();
      }

      if (!command) {
        triggerToast('COMMAND CANNOT BE EMPTY', 'info');
        return;
      }

      // Show console and clear previous output
      sshConsoleWrapper.classList.remove('hidden');
      sshConsole.innerHTML = '<div>[SYSTEM] Initializing stream...</div>';
      
      // Disable execute button
      btnExecuteSsh.disabled = true;
      const originalBtnText = btnExecuteSsh.innerHTML;
      btnExecuteSsh.innerHTML = `<span class="relative z-10 animate-pulse">EXECUTING INSTALLATION...</span>`;

      triggerToast('CONNECTING TO VPS...', 'info');

      try {
        const response = await fetch('/api/tools/execute-ssh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ip,
            port,
            username,
            password,
            command
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          appendToConsole(`[SYSTEM ERROR] Server returned HTTP ${response.status}: ${errText}`);
          triggerToast('CONNECTION/EXECUTION FAILED', 'info');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Split by newline and append to terminal
          const lines = buffer.split('\n');
          // Keep the last partial line in the buffer
          buffer = lines.pop();
          
          for (const line of lines) {
            appendToConsole(line);
          }
        }
        
        // Print remaining buffer if any
        if (buffer) {
          appendToConsole(buffer);
        }

        appendToConsole('[SYSTEM] Execution connection closed.');
        triggerToast('INSTALLATION COMPLETED', 'success');

      } catch (err) {
        console.error(err);
        appendToConsole(`[SYSTEM ERROR] Fetch error: ${err.message}`);
        triggerToast('SERVER UNREACHABLE OR TIMEOUT', 'info');
      } finally {
        btnExecuteSsh.disabled = false;
        btnExecuteSsh.innerHTML = originalBtnText;
      }
    });
  }

  // 16. Tools Sub-navigation Routing
  const menuLinkPtero = document.getElementById('menuLinkPtero');
  const menuLinkChat = document.getElementById('menuLinkChat');
  const toolsSubMenu = document.getElementById('toolsSubMenu');
  const toolsInstallerPanel = document.getElementById('toolsInstallerPanel');
  const toolsChatPanel = document.getElementById('toolsChatPanel');
  const btnBackFromInstaller = document.getElementById('btnBackFromInstaller');
  const btnBackFromChat = document.getElementById('btnBackFromChat');

  const showSubPanel = (panelToShow) => {
    if (toolsSubMenu) toolsSubMenu.classList.add('hidden');
    if (toolsInstallerPanel) toolsInstallerPanel.classList.add('hidden');
    if (toolsChatPanel) toolsChatPanel.classList.add('hidden');
    
    if (panelToShow) panelToShow.classList.remove('hidden');
  };

  const showSubMenu = () => {
    if (toolsSubMenu) toolsSubMenu.classList.remove('hidden');
    if (toolsInstallerPanel) toolsInstallerPanel.classList.add('hidden');
    if (toolsChatPanel) toolsChatPanel.classList.add('hidden');
    
    // Stop chat polling
    stopChatPolling();
  };

  if (menuLinkPtero && toolsInstallerPanel) {
    menuLinkPtero.addEventListener('click', () => {
      showSubPanel(toolsInstallerPanel);
    });
  }

  if (menuLinkChat && toolsChatPanel) {
    menuLinkChat.addEventListener('click', () => {
      showSubPanel(toolsChatPanel);
      startChatPolling();
    });
  }

  if (btnBackFromInstaller) {
    btnBackFromInstaller.addEventListener('click', showSubMenu);
  }
  if (btnBackFromChat) {
    btnBackFromChat.addEventListener('click', showSubMenu);
  }

  // 17. Global Chat Logic
  const chatMessagesBox = document.getElementById('chatMessagesBox');
  const chatInputForm = document.getElementById('chatInputForm');
  const chatInputText = document.getElementById('chatInputText');
  let chatPollInterval = null;
  let lastChatCount = 0;

  async function fetchChats() {
    try {
      const res = await fetch('/api/chat');
      if (!res.ok) return;
      const data = await res.json();
      const chats = data.chats || [];
      
      // Render messages
      renderChatMessages(chats);
    } catch (err) {
      console.error('Failed to fetch chats:', err);
    }
  }

  function renderChatMessages(chats) {
    if (!chatMessagesBox) return;
    
    if (chats.length === 0) {
      chatMessagesBox.innerHTML = `
        <div class="text-center text-[10px] text-zinc-600 tracking-wider py-12 uppercase font-bold">
          No messages yet. Start the conversation!
        </div>
      `;
      return;
    }

    const isAtBottom = chatMessagesBox.scrollHeight - chatMessagesBox.clientHeight <= chatMessagesBox.scrollTop + 50;

    chatMessagesBox.innerHTML = chats.map(chat => {
      // Role coloring logic
      let badgeClass = 'border-zinc-800 text-zinc-500 bg-zinc-900/50';
      if (chat.status === 'Owner') {
        badgeClass = 'border-red-500/30 text-red-400 bg-red-500/10 glow-red';
      } else if (chat.status === 'Reseller') {
        badgeClass = 'border-purple-500/30 text-purple-400 bg-purple-500/10';
      } else if (chat.status === 'User') {
        badgeClass = 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10';
      } else if (chat.status === 'VIP') {
        badgeClass = 'border-amber-500/30 text-amber-300 bg-amber-500/10 glow-amber';
      }

      // Format time
      const timeStr = chat.date ? chat.date.substring(11, 16) : '--:--';
      
      // Determine if self or other
      const isSelf = chat.username === savedUsername;
      
      const isOwner = chat.status === 'Owner';
      const verifiedBadge = isOwner ? `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" class="inline-block flex-shrink-0 drop-shadow-[0_0_4px_rgba(0,149,246,0.65)] ml-0.5 align-middle">
          <path d="M22.25 12c0-1.43-.88-2.67-2.15-3.26.15-.39.24-.82.24-1.27 0-2-1.61-3.64-3.6-3.64-.45 0-.87.09-1.27.24C14.88 2.8 13.56 2 12 2s-2.88.8-3.47 2.07c-.4-.15-.82-.24-1.27-.24-1.99 0-3.6 1.64-3.6 3.64 0 .45.09.88.24 1.27-1.27.59-2.15 1.83-2.15 3.26 0 1.43.88 2.67 2.15 3.26-.15.39-.24.82-.24 1.27 0 2 1.61 3.64 3.6 3.64.45 0 .87-.09 1.27-.24.59 1.27 1.91 2.07 3.47 2.07s2.88-.8 3.47-2.07c.4.15.82.24 1.27.24 1.99 0 3.6-1.64 3.6-3.64 0-.45-.09-.88-.24-1.27 1.27-.59 2.15-1.83 2.15-3.26z" fill="#0095f6"/>
          <path d="M7.5 12.5L10 15L16.5 8.5" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      ` : '';
      
      return `
        <div class="flex flex-col gap-1 ${isSelf ? 'items-end' : 'items-start'} anim-slide-up">
          <div class="flex items-center gap-1.5 text-[9px] tracking-wide text-zinc-500 font-bold uppercase">
            <span class="${isSelf ? 'text-indigo-400' : 'text-zinc-400'} font-orbitron inline-flex items-center gap-0.5">${chat.username}${verifiedBadge}</span>
            <span class="text-[8px] px-1.5 py-0.5 rounded border tracking-widest ${badgeClass}">${chat.status}</span>
            <span class="text-[8px] text-zinc-600 font-mono">${timeStr}</span>
          </div>
          <div class="max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[11px] leading-relaxed break-all font-sans ${
            isSelf 
              ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-200 rounded-tr-none' 
              : 'bg-zinc-900/60 border border-zinc-800/80 text-zinc-300 rounded-tl-none'
          }">
            ${escapeHtml(chat.message)}
          </div>
        </div>
      `;
    }).join('');

    // Auto scroll if user was already at bottom or new chats are loaded for first time
    if (isAtBottom || chats.length !== lastChatCount) {
      chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
      lastChatCount = chats.length;
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function startChatPolling() {
    fetchChats();
    clearInterval(chatPollInterval);
    chatPollInterval = setInterval(fetchChats, 3000);
  }

  // Bind stop chat polling to original switch tab functionality to prevent unnecessary background polling when tab changes
  const originalSwitchTab = switchTab;
  switchTab = function(tabId) {
    originalSwitchTab(tabId);
    if (tabId !== 'tools') {
      stopChatPolling();
    }
  };

  function stopChatPolling() {
    clearInterval(chatPollInterval);
  }

  if (chatInputForm) {
    chatInputForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = chatInputText.value.trim();
      if (!message) return;

      chatInputText.value = '';
      
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: savedUsername,
            message
          })
        });

        if (res.ok) {
          // Immediately reload messages
          fetchChats();
        } else {
          triggerToast('Failed to send message', 'info');
        }
      } catch (err) {
        console.error(err);
        triggerToast('Server unreachable', 'info');
      }
    });
  }
});
