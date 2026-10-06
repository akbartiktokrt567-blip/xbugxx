document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('username');
  if (saved) {
    window.location.href = `/dashboard?username=${saved}`;
    return;
  }

  const loginForm = document.getElementById('loginForm');
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const errorContainer = document.getElementById('errorContainer');
  const errorMessage = document.getElementById('errorMessage');
  const submitButton = document.getElementById('submitButton');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) return;

    // Clear previous error
    errorContainer.classList.add('hidden');
    submitButton.disabled = true;
    submitButton.innerText = 'AUTHORIZING...';
    submitButton.classList.add('opacity-50', 'cursor-not-allowed');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('username', data.username);
        window.location.href = `/dashboard?username=${data.username}`;
      } else {
        showError(data.error || 'INVALID USERNAME');
      }
    } catch (err) {
      showError('SERVER UNREACHABLE');
    } finally {
      submitButton.disabled = false;
      submitButton.innerText = 'AUTHORIZE ACCESS';
      submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  });

  function showError(msg) {
    errorMessage.innerText = `⚠️ ${msg}`;
    errorContainer.classList.remove('hidden');
  }
});
