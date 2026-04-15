// signup.js — two-step registration: form submission → OTP verification.
// Backend endpoints (server.js):
//   POST /signup      { email, password } → sends OTP email
//   POST /verify-otp  { email, otp }      → verifies and activates account

import { EXPRESS_BASE, STORAGE_KEYS } from './config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function clearError(id) {
  setError(id, '');
}

function setButtonState(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = label;
}

// ─── Password strength ────────────────────────────────────────────────────────

const STRENGTH_LEVELS = [
  { min: 0,  max: 3,  label: '',           color: '#690008', width: '0%'   },
  { min: 1,  max: 3,  label: 'Weak',       color: '#c62828', width: '25%'  },
  { min: 3,  max: 5,  label: 'Fair',       color: '#e65100', width: '50%'  },
  { min: 5,  max: 7,  label: 'Good',       color: '#2e7d32', width: '75%'  },
  { min: 7,  max: 99, label: 'Strong',     color: '#1b5e20', width: '100%' },
];

function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8)  score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw)) score += 1;
  if (/[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 2;
  return score;
}

function updateStrengthBar(password) {
  const bar = document.getElementById('strengthBar');
  const label = document.getElementById('strengthLabel');
  if (!bar) return;

  const score = scorePassword(password);
  const level = STRENGTH_LEVELS.findLast((l) => score >= l.min) || STRENGTH_LEVELS[0];

  bar.style.width = password ? level.width : '0%';
  bar.style.backgroundColor = level.color;
  if (label) label.textContent = password ? level.label : '';
}

// ─── Toggle password visibility ───────────────────────────────────────────────

function wirePasswordToggle(inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(toggleBtnId);
  if (!input || !btn) return;
  btn.addEventListener('click', () => {
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.textContent = isText ? 'visibility_off' : 'visibility';
    btn.setAttribute('aria-label', isText ? 'Show password' : 'Hide password');
  });
}

// ─── Step management ──────────────────────────────────────────────────────────

function showStep(stepId) {
  for (const id of ['stepRegister', 'stepOtp']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle('hidden', id !== stepId);
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function apiSignup(email, password) {
  const res = await fetch(`${EXPRESS_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Signup failed (${res.status})`);
  return data;
}

async function apiVerifyOtp(email, otp) {
  const res = await fetch(`${EXPRESS_BASE}/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Verification failed (${res.status})`);
  return data;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

let _pendingEmail = '';

function init() {
  // Step 1 — Registration form
  const signupForm = document.getElementById('signupForm');
  const signupBtn  = document.getElementById('signupBtn');
  const passwordEl = document.getElementById('password');
  const confirmEl  = document.getElementById('confirmPassword');

  wirePasswordToggle('password', 'togglePassword');
  wirePasswordToggle('confirmPassword', 'toggleConfirmPassword');

  passwordEl?.addEventListener('input', () => {
    updateStrengthBar(passwordEl.value);
    clearError('confirmPasswordError');
  });

  confirmEl?.addEventListener('input', () => clearError('confirmPasswordError'));

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('signupError');
    clearError('confirmPasswordError');

    const email    = (document.getElementById('email')?.value || '').trim();
    const password = passwordEl?.value || '';
    const confirm  = confirmEl?.value  || '';

    if (!email || !password) {
      setError('signupError', 'Email and password are required.');
      return;
    }
    if (password.length < 8) {
      setError('signupError', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('confirmPasswordError', "Passwords don't match.");
      return;
    }

    setButtonState(signupBtn, true, 'Creating account…');
    try {
      await apiSignup(email, password);
      _pendingEmail = email;
      localStorage.setItem(STORAGE_KEYS.signupEmail, email);

      // Update OTP hint with masked email
      const hint = document.getElementById('otpHint');
      if (hint) {
        const [local, domain] = email.split('@');
        const masked = local.length > 2
          ? `${local[0]}${'*'.repeat(Math.min(local.length - 2, 4))}${local.at(-1)}@${domain}`
          : email;
        hint.textContent = `We sent a 4-digit code to ${masked}. Enter it below to activate your account.`;
      }

      showStep('stepOtp');
      document.getElementById('otpCode')?.focus();
    } catch (err) {
      setError('signupError', err?.message || 'Signup failed. Please try again.');
    } finally {
      setButtonState(signupBtn, false, 'Create account');
    }
  });

  // Step 2 — OTP verification
  const otpForm = document.getElementById('otpForm');
  const otpBtn  = document.getElementById('otpBtn');

  otpForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('otpError');

    const otp = (document.getElementById('otpCode')?.value || '').trim();
    if (!otp || otp.length !== 4) {
      setError('otpError', 'Enter the 4-digit code from your email.');
      return;
    }

    const email = _pendingEmail || localStorage.getItem(STORAGE_KEYS.signupEmail) || '';
    if (!email) {
      setError('otpError', 'Session expired. Please start again.');
      showStep('stepRegister');
      return;
    }

    setButtonState(otpBtn, true, 'Verifying…');
    try {
      await apiVerifyOtp(email, otp);
      localStorage.removeItem(STORAGE_KEYS.signupEmail);
      // Account verified — redirect to login with success hint
      window.location.replace(`login.html?verified=1`);
    } catch (err) {
      setError('otpError', err?.message || 'Verification failed. Check the code and try again.');
    } finally {
      setButtonState(otpBtn, false, 'Verify & continue');
    }
  });

  // Back to signup
  document.getElementById('backToSignup')?.addEventListener('click', () => {
    clearError('otpError');
    showStep('stepRegister');
  });

  // Resend OTP
  const resendBtn = document.getElementById('resendOtp');
  resendBtn?.addEventListener('click', async () => {
    const email = _pendingEmail || localStorage.getItem(STORAGE_KEYS.signupEmail) || '';
    if (!email) { showStep('stepRegister'); return; }

    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    clearError('otpError');

    try {
      const pw = document.getElementById('password')?.value || '';
      if (pw) await apiSignup(email, pw);
    } catch {
      // ignore — server may say "already exists", which is fine; OTP is resent
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
    }
  });

  // Handle ?verified=1 redirect from login.html (shows success banner there)
  // Also support returning to this page for any step restoration
  const savedEmail = localStorage.getItem(STORAGE_KEYS.signupEmail);
  if (savedEmail) {
    _pendingEmail = savedEmail;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
