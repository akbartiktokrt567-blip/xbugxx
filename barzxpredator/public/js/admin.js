document.addEventListener('DOMContentLoaded', () => {
  const savedUsername = localStorage.getItem('username');
  if (!savedUsername) {
    window.location.href = '/login';
    return;
  }

  // Element references
  const adminPanelContainer = document.getElementById('adminPanelContainer');
  const gatewayLoadingState = document.getElementById('gatewayLoadingState');
  const usersListWrapper = document.getElementById('usersListWrapper');

  // Modal references
  const addUserModal = document.getElementById('addUserModal');
  const addUserModalBackdrop = document.getElementById('addUserModalBackdrop');
  const openAddUserModalButton = document.getElementById('openAddUserModalButton');
  const cancelModalButton = document.getElementById('cancelModalButton');
  const saveUserForm = document.getElementById('saveUserForm');

  // Form inputs
  const usernameInput = document.getElementById('usernameInput');
  const roleSelect = document.getElementById('roleSelect');
  const limitInput = document.getElementById('limitInput');
  const activeUntilInput = document.getElementById('activeUntilInput');
  const passwordInput = document.getElementById('passwordInput');

  // Toast
  const toastContainer = document.getElementById('toastContainer');

  // Global states
  let users = [];
  let requesterRole = '';

  // Initialize
  fetchUsers();

  async function fetchUsers() {
    try {
      const res = await fetch(`/api/admin/users?requester=${savedUsername}`);
      if (!res.ok) {
        window.location.href = '/dashboard';
        return;
      }

      const data = await res.json();
      users = data.users || [];

      // Find requester's own role
      const me = users.find(u => u.username === savedUsername);
      if (!me || (me.status !== 'Owner' && me.status !== 'Reseller')) {
        window.location.href = '/dashboard';
        return;
      }

      requesterRole = me.status;

      // Show panel
      gatewayLoadingState.classList.add('hidden');
      adminPanelContainer.classList.remove('hidden');

      // Render list
      renderUsersList();
    } catch (err) {
      console.error(err);
      triggerToast('FAILED TO FETCH USERS', 'error');
    }
  }

  function renderUsersList() {
    if (users.length === 0) {
      usersListWrapper.innerHTML = `
        <div class="glass p-8 text-center">
          <p class="text-xs text-zinc-500 font-bold tracking-wider">NO REGISTERED USERS FOUND</p>
        </div>
      `;
      return;
    }

    usersListWrapper.innerHTML = users.map(u => {
      // Role badge class selection
      let badgeClass = 'bg-zinc-800 border-zinc-700 text-zinc-400';
      if (u.status === 'Owner') {
        badgeClass = 'bg-red-500/15 border-red-500/30 text-red-400';
      } else if (u.status === 'Reseller') {
        badgeClass = 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400';
      } else if (u.status === 'VIP') {
        badgeClass = 'bg-amber-500/15 border-amber-500/30 text-amber-400 glow-amber';
      }

      // Check if delete button should be rendered
      const isMe = u.username === savedUsername;
      const canDelete = requesterRole === 'Owner' && !isMe;
      
      const deleteButtonHtml = canDelete 
        ? `<button onclick="deleteUser('${u.username}')" class="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 text-red-400 active:scale-95 transition-all cursor-pointer">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
               <polyline points="3 6 5 6 21 6"></polyline>
               <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
             </svg>
           </button>`
        : '';

      return `
        <div class="glass p-5 relative overflow-hidden group border border-white/5">
          <div class="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r ${
            u.status === 'Owner' ? 'from-red-500 to-amber-500' : u.status === 'Reseller' ? 'from-purple-500 to-indigo-500' : u.status === 'VIP' ? 'from-amber-500 to-yellow-500' : 'from-zinc-700 to-zinc-600'
          }"></div>
          
          <div class="flex justify-between items-start">
            <div>
              <h3 class="text-md font-bold tracking-wider text-white font-orbitron uppercase">${u.username}</h3>
              <div class="flex items-center gap-2 mt-2">
                <span class="text-[8px] px-2 py-0.5 rounded border tracking-wider font-extrabold uppercase ${badgeClass}">
                  ${u.status}
                </span>
                <span class="text-[9px] text-zinc-500 font-mono">
                  LIMIT: ${u.limit || 0}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1.5">
              <button onclick="editUser('${u.username}')" class="w-8 h-8 rounded-xl glass flex items-center justify-center hover:bg-white/5 text-zinc-400 hover:text-zinc-200 active:scale-95 transition-all cursor-pointer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path>
                </svg>
              </button>
              ${deleteButtonHtml}
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-white/5 flex justify-between items-center text-[9px] text-zinc-500 font-mono">
            <span>SENDERS: ${(u.whatsappSenders || []).length}</span>
            <span>EXP: ${u.activeUntil || 'N/A'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Edit user action
  window.editUser = function(uname) {
    const user = users.find(u => u.username === uname);
    if (!user) return;

    // Load inputs
    usernameInput.value = user.username;
    usernameInput.disabled = true; // username shouldn't be edited directly once created
    roleSelect.value = user.status;
    limitInput.value = String(user.limit || 10);
    activeUntilInput.value = user.activeUntil || '2026-12-31';
    passwordInput.value = user.password || '123';

    addUserModal.classList.remove('hidden');
  };

  // Delete user action
  window.deleteUser = async function(targetUsername) {
    if (targetUsername === savedUsername) {
      triggerToast('CANNOT DELETE YOURSELF', 'error');
      return;
    }
    if (!confirm(`Are you sure you want to delete user "${targetUsername}"?`)) return;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requester: savedUsername, username: targetUsername })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        triggerToast('USER DELETED', 'success');
        fetchUsers();
      } else {
        triggerToast(data.error || 'FAILED TO DELETE USER', 'error');
      }
    } catch (err) {
      triggerToast('SERVER ERROR', 'error');
    }
  };

  // Open add user modal
  openAddUserModalButton.addEventListener('click', () => {
    usernameInput.value = '';
    usernameInput.disabled = false;
    roleSelect.value = 'User';
    limitInput.value = '10';
    activeUntilInput.value = '2026-12-31';
    
    // Generate a random 6-character password
    const randomPass = Math.random().toString(36).substring(2, 8);
    passwordInput.value = randomPass;
    
    addUserModal.classList.remove('hidden');
  });

  // Modal actions
  cancelModalButton.addEventListener('click', () => {
    addUserModal.classList.add('hidden');
  });

  addUserModalBackdrop.addEventListener('click', () => {
    addUserModal.classList.add('hidden');
  });

  // Save/Create user submit
  saveUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) return;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester: savedUsername,
          username,
          status: roleSelect.value,
          activeUntil: activeUntilInput.value.trim(),
          limit: parseInt(limitInput.value, 10),
          password: passwordInput.value
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        triggerToast('USER SAVED SUCCESSFULLY', 'success');
        addUserModal.classList.add('hidden');
        fetchUsers();
      } else {
        triggerToast(data.error || 'FAILED TO SAVE USER', 'error');
      }
    } catch (err) {
      triggerToast('SERVER ERROR', 'error');
    }
  });

  // Toast alerts
  function triggerToast(message, type = 'success') {
    toastContainer.innerHTML = `
      <div class="glass px-6 py-3.5 flex items-center gap-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] ${
        type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 glow-green' : 'bg-red-500/10 border-red-500/30 glow-red'
      }">
        <span class="text-xs font-bold tracking-[0.15em] ${type === 'success' ? 'text-emerald-300' : 'text-red-300'}">${message}</span>
      </div>
    `;
    
    toastContainer.classList.remove('hidden');
    setTimeout(() => {
      toastContainer.classList.add('hidden');
    }, 2500);
  }
});
