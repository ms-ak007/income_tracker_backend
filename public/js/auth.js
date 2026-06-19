/* ═══════════════════════════════════════════════
   auth.js — Login & Signup Logic
   ═══════════════════════════════════════════════ */

// Redirect to dashboard if already logged in
(function () {
  if (localStorage.getItem('ft_token')) {
    window.location.href = '/dashboard.html';
  }
})();

// ─── Tab switching ────────────────────────────────────────────
function switchTab(tab) {
  const isLogin = tab === 'login';

  document.getElementById('form-login').classList.toggle('hidden', !isLogin);
  document.getElementById('form-signup').classList.toggle('hidden', isLogin);

  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);

  document.getElementById('tab-login').setAttribute('aria-selected', String(isLogin));
  document.getElementById('tab-signup').setAttribute('aria-selected', String(!isLogin));

  // Clear errors
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('signup-error').classList.remove('show');
}

// ─── Login ────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');
  const btnText  = document.getElementById('login-btn-text');
  const spinner  = document.getElementById('login-btn-spinner');

  errEl.classList.remove('show');
  if (!email || !password) {
    showError(errEl, 'Please fill in all fields.');
    return;
  }

  setLoading(btn, btnText, spinner, true);

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(errEl, data.error || 'Login failed. Please try again.');
      return;
    }

    localStorage.setItem('ft_token', data.token);
    localStorage.setItem('ft_user',  JSON.stringify(data.user));
    showToast('Welcome back, ' + data.user.name + '! 👋', 'success');

    setTimeout(() => { window.location.href = '/dashboard.html'; }, 600);
  } catch (err) {
    showError(errEl, 'Network error. Is the server running?');
  } finally {
    setLoading(btn, btnText, spinner, false);
  }
}

// ─── Signup ───────────────────────────────────────────────────
async function handleSignup(e) {
  e.preventDefault();
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl    = document.getElementById('signup-error');
  const btn      = document.getElementById('signup-btn');
  const btnText  = document.getElementById('signup-btn-text');
  const spinner  = document.getElementById('signup-btn-spinner');

  errEl.classList.remove('show');

  if (!name || !email || !password) {
    showError(errEl, 'Please fill in all fields.'); return;
  }
  if (password.length < 6) {
    showError(errEl, 'Password must be at least 6 characters.'); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(errEl, 'Please enter a valid email address.'); return;
  }

  setLoading(btn, btnText, spinner, true);

  try {
    const res  = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(errEl, data.error || 'Signup failed. Please try again.');
      return;
    }

    localStorage.setItem('ft_token', data.token);
    localStorage.setItem('ft_user',  JSON.stringify(data.user));
    showToast('Account created! Welcome to FinFlow 🎉', 'success');

    setTimeout(() => { window.location.href = '/dashboard.html'; }, 700);
  } catch (err) {
    showError(errEl, 'Network error. Is the server running?');
  } finally {
    setLoading(btn, btnText, spinner, false);
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

function setLoading(btn, text, spinner, loading) {
  btn.disabled = loading;
  text.classList.toggle('hidden', loading);
  spinner.classList.toggle('hidden', !loading);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}
