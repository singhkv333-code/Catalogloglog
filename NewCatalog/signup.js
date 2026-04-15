// signup.js — two-step registration (no OTP).
// Step 1: email + password validation → Next
// Step 2: full name + username → Create account via Supabase

import { getSupabaseClient } from './supabase-client.js';

const supabase = getSupabaseClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function clearError(id) { setError(id, ''); }

function setButtonState(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = label;
}

function isValidEmail(email) {
  // RFC-5322-ish: must have local@domain.tld with no spaces
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

// ─── Password strength ────────────────────────────────────────────────────────

const STRENGTH_LEVELS = [
  { min: 0,  label: '',       color: '#690008', width: '0%'   },
  { min: 1,  label: 'Weak',   color: '#c62828', width: '25%'  },
  { min: 3,  label: 'Fair',   color: '#e65100', width: '50%'  },
  { min: 5,  label: 'Good',   color: '#2e7d32', width: '75%'  },
  { min: 7,  label: 'Strong', color: '#1b5e20', width: '100%' },
];

function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8)            score += 1;
  if (pw.length >= 12)           score += 1;
  if (/[A-Z]/.test(pw))         score += 1;
  if (/[a-z]/.test(pw))         score += 1;
  if (/[0-9]/.test(pw))         score += 1;
  if (/[^A-Za-z0-9]/.test(pw))  score += 2;
  return score;
}

function updateStrengthBar(password) {
  const bar   = document.getElementById('strengthBar');
  const label = document.getElementById('strengthLabel');
  if (!bar) return;
  const score = scorePassword(password);
  const level = [...STRENGTH_LEVELS].reverse().find(l => score >= l.min) || STRENGTH_LEVELS[0];
  bar.style.width           = password ? level.width : '0%';
  bar.style.backgroundColor = level.color;
  if (label) label.textContent = password ? level.label : '';
}

// ─── Password toggle ──────────────────────────────────────────────────────────

function wirePasswordToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (!input || !btn) return;
  btn.addEventListener('click', () => {
    const isText = input.type === 'text';
    input.type   = isText ? 'password' : 'text';
    btn.textContent = isText ? 'visibility_off' : 'visibility';
  });
}

// ─── Step management ──────────────────────────────────────────────────────────

function showStep(step) {
  document.getElementById('stepCredentials').classList.toggle('hidden', step !== 1);
  document.getElementById('stepProfile').classList.toggle('hidden', step !== 2);

  // Update step dots
  const dot1 = document.getElementById('dot1');
  const dot2 = document.getElementById('dot2');
  if (dot1) {
    dot1.className = step === 1
      ? 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-label bg-primary text-white'
      : 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-label bg-primary/20 text-primary';
    dot1.textContent = step > 1 ? '✓' : '1';
  }
  if (dot2) {
    dot2.className = step === 2
      ? 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-label bg-primary text-white'
      : 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-label bg-surface-container-high text-on-surface-variant';
    dot2.textContent = '2';
  }
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let _email    = '';
let _password = '';

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  showStep(1);

  wirePasswordToggle('password', 'togglePassword');
  wirePasswordToggle('confirmPassword', 'toggleConfirmPassword');

  const passwordEl = document.getElementById('password');
  const confirmEl  = document.getElementById('confirmPassword');
  const emailEl    = document.getElementById('email');

  passwordEl?.addEventListener('input', () => {
    updateStrengthBar(passwordEl.value);
    clearError('confirmPasswordError');
  });
  confirmEl?.addEventListener('input', () => clearError('confirmPasswordError'));
  emailEl?.addEventListener('input', () => clearError('emailError'));

  // ── Step 1: credentials ──────────────────────────────────────────────────

  document.getElementById('credentialsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError('credentialsError');
    clearError('emailError');
    clearError('confirmPasswordError');

    const email    = (emailEl?.value || '').trim();
    const password = passwordEl?.value || '';
    const confirm  = confirmEl?.value  || '';

    if (!email) {
      setError('emailError', 'Email is required.');
      emailEl?.focus();
      return;
    }
    if (!isValidEmail(email)) {
      setError('emailError', 'Please enter a valid email address.');
      emailEl?.focus();
      return;
    }
    if (!password) {
      setError('credentialsError', 'Password is required.');
      return;
    }
    if (password.length < 8) {
      setError('credentialsError', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('confirmPasswordError', "Passwords don't match.");
      confirmEl?.focus();
      return;
    }

    // Store for step 2
    _email    = email;
    _password = password;
    showStep(2);
    document.getElementById('fullName')?.focus();
  });

  // ── Step 2: profile ──────────────────────────────────────────────────────

  const createBtn = document.getElementById('createAccountBtn');

  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('profileError');
    clearError('fullNameError');
    clearError('usernameError');

    const fullName = (document.getElementById('fullName')?.value || '').trim();
    const username = (document.getElementById('username')?.value || '').trim().toLowerCase();

    if (!fullName) {
      setError('fullNameError', 'Please enter your full name.');
      document.getElementById('fullName')?.focus();
      return;
    }
    if (!username) {
      setError('usernameError', 'Please choose a username.');
      document.getElementById('username')?.focus();
      return;
    }
    if (!isValidUsername(username)) {
      setError('usernameError', 'Username must be 3–30 characters: letters, numbers, underscores only.');
      document.getElementById('username')?.focus();
      return;
    }

    setButtonState(createBtn, true, 'Creating account…');

    try {
      // Sign up via Supabase Auth — stores name + username in user_metadata
      const { data, error } = await supabase.auth.signUp({
        email: _email,
        password: _password,
        options: {
          data: {
            full_name: fullName,
            username: username,
          },
        },
      });

      if (error) throw error;

      // Insert into profiles table if the user object is available
      // (Supabase may return a user immediately if email confirmation is off,
      //  or a session-less user if confirmation is on)
      const userId = data?.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({
          id:        userId,
          email:     _email,
          full_name: fullName,
          username:  username,
        }, { onConflict: 'id' });
      }

      // Redirect to login with a success flag
      window.location.replace('login.html?verified=1');

    } catch (err) {
      const msg = err?.message || 'Something went wrong. Please try again.';
      // Surface friendly messages for common errors
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
        setError('profileError', 'An account with this email already exists. Try signing in.');
      } else {
        setError('profileError', msg);
      }
    } finally {
      setButtonState(createBtn, false, 'Create account');
    }
  });

  // Back button
  document.getElementById('backToCredentials')?.addEventListener('click', () => {
    clearError('profileError');
    showStep(1);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
