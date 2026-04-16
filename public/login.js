// login.js — signs in via Supabase Auth, no Express backend needed.

import { getSupabaseClient } from './supabase-client.js';

const supabase = getSupabaseClient();

function setError(message) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function setButtonState(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Signing in…' : 'Log in';
}

async function init() {
  const form = document.getElementById('loginForm');
  const btn  = document.getElementById('loginBtn');
  if (!form || !btn) return;

  // Password visibility toggle
  const passwordInput  = document.getElementById('password');
  const togglePassword = document.getElementById('togglePassword');
  togglePassword?.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    togglePassword.textContent = isText ? 'visibility_off' : 'visibility';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    setButtonState(btn, true);

    const email    = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';

    if (!email || !password) {
      setError('Email and password are required.');
      setButtonState(btn, false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Map Supabase error messages to friendly ones
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
          throw new Error('Incorrect email or password. Please try again.');
        }
        if (msg.includes('email not confirmed')) {
          throw new Error('Please confirm your email before signing in.');
        }
        throw new Error(error.message || 'Sign in failed. Please try again.');
      }

      if (!data?.session) throw new Error('No session returned. Please try again.');

      // Supabase stores the session automatically — go straight to the app
      window.location.replace('newindex.html');

    } catch (err) {
      setError(err?.message || 'Sign in failed. Please try again.');
    } finally {
      setButtonState(btn, false);
    }
  });
}

// Show success banner when redirected from signup
if (new URLSearchParams(window.location.search).get('verified') === '1') {
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('verifiedBanner');
    if (banner) banner.classList.remove('hidden');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
