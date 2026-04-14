import { EXPRESS_BASE } from './config.js';
import { setToken } from './auth.js';

function setError(message) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = message || 'Login failed.';
  el.classList.toggle('hidden', !message);
}

async function login(email, password) {
  const res = await fetch(`${EXPRESS_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Login failed (${res.status})`);
  }
  if (!data?.token) throw new Error('No token returned from server.');
  return data.token;
}

async function init() {
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginBtn');
  if (!form || !btn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Logging in…';

    const email = document.getElementById('email')?.value?.trim() || '';
    const password = document.getElementById('password')?.value || '';

    try {
      const token = await login(email, password);
      setToken(token);
      window.location.replace('newindex.html');
    } catch (err) {
      setError(err?.message || 'Login failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

