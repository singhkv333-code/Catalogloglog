// auth.js — Supabase-backed auth utilities
// All pages import from here for login checks, user data, and logout.

import { getSupabaseClient } from './supabase-client.js';

const supabase = getSupabaseClient();

// ─── User cache (sessionStorage, 5-min TTL) ──────────────────────────────────
// Eliminates the supabase.auth.getUser() network round-trip + /api/me call on
// every page navigation for authenticated users.

const _USER_CACHE_KEY = '_cat_u1';
const _USER_CACHE_TTL = 5 * 60 * 1000;

function _readUserCache() {
  try {
    const raw = sessionStorage.getItem(_USER_CACHE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (!e || Date.now() > e.x) { sessionStorage.removeItem(_USER_CACHE_KEY); return null; }
    return e.u;
  } catch { return null; }
}

function _writeUserCache(user) {
  try { sessionStorage.setItem(_USER_CACHE_KEY, JSON.stringify({ u: user, x: Date.now() + _USER_CACHE_TTL })); }
  catch {}
}

function _clearUserCache() {
  try { sessionStorage.removeItem(_USER_CACHE_KEY); } catch {}
}

// ─── Session helpers ──────────────────────────────────────────────────────────

// Returns the current access token synchronously from Supabase's localStorage key.
// Safe to call without await for quick "is logged in?" checks.
export function getToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    const session = JSON.parse(localStorage.getItem(key));
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

// No-op — Supabase manages its own session in localStorage.
export function setToken() {}

// ─── Auth header (for any non-Supabase fetch calls still in the codebase) ────

export function authHeader(token = getToken()) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Clear & logout ───────────────────────────────────────────────────────────

export function clearAuthStorage() {
  // Supabase clears its own keys on signOut; also clear legacy keys
  localStorage.removeItem('token');
  localStorage.removeItem('signupEmail');
  sessionStorage.clear();
}

export async function logout(redirectTo = '/') {
  _clearUserCache();
  await supabase.auth.signOut();
  clearAuthStorage();
  window.location.replace(redirectTo);
}

// ─── Current user ─────────────────────────────────────────────────────────────

// Returns the current user, or null if not authenticated.
// `id` is the integer DB primary key (not the Supabase UUID).
// Pass redirectOnFail to auto-redirect unauthenticated visitors.
//
// Uses getSession() (reads localStorage — no network) instead of getUser()
// (validates token with Supabase server). The token is still validated on every
// authenticated API call server-side. Result is cached in sessionStorage for 5
// minutes so repeat navigations skip the /api/me round-trip entirely.
export async function fetchCurrentUser({ redirectOnFail = null } = {}) {
  const cached = _readUserCache();
  if (cached) return cached;

  try {
    // getSession() reads from localStorage — zero network latency
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw new Error('not_authenticated');
    const user = session.user;
    const token = session.access_token ?? getToken();

    let dbId = null;
    let dbUsername = user.user_metadata?.username ?? null;
    let dbName = user.user_metadata?.full_name ?? null;
    let dbBio = null;

    if (token) {
      try {
        const resp = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok) {
          const me = await resp.json();
          dbId = me.id;
          dbUsername = me.username ?? dbUsername;
          dbName = me.name ?? dbName;
          dbBio = me.bio ?? null;
        }
      } catch { /* ignore — server may not be running */ }
    }

    const resolved = {
      ...user,
      id:         dbId ?? user.id,
      supabaseId: user.id,
      email:      user.email,
      name:       dbName ?? user.user_metadata?.full_name ?? null,
      username:   dbUsername,
      bio:        dbBio,
    };
    _writeUserCache(resolved);
    return resolved;
  } catch {
    if (redirectOnFail) {
      clearAuthStorage();
      window.location.replace(redirectOnFail);
    }
    return null;
  }
}

// Alias used by protected pages
export async function requireAuth({ redirectTo = 'login' } = {}) {
  return fetchCurrentUser({ redirectOnFail: redirectTo });
}

// Show a non-redirecting sign-in prompt for action gating on open pages
export function showSignInPrompt({ message = 'Sign in to continue.' } = {}) {
  document.getElementById('catalog-signin-prompt')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'catalog-signin-prompt';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(29,27,23,0.45);z-index:100;display:flex;align-items:center;justify-content:center;padding:1rem';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fef9f1;border-radius:1.25rem;padding:2rem;max-width:360px;width:100%;box-shadow:0 12px 40px rgba(29,27,23,0.18)';

  const h = document.createElement('h2');
  h.style.cssText = 'font-family:Newsreader,serif;font-style:italic;font-size:1.5rem;margin:0 0 0.5rem';
  h.textContent = 'Sign in to continue';

  const p = document.createElement('p');
  p.style.cssText = 'font-family:Manrope,sans-serif;font-size:0.875rem;opacity:0.65;margin:0 0 1.5rem';
  p.textContent = message;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:0.75rem';

  const signInBtn = document.createElement('a');
  signInBtn.href = 'login';
  signInBtn.style.cssText = 'flex:1;text-align:center;background:#690008;color:#fff;padding:0.75rem 1.5rem;border-radius:9999px;font-family:Manrope,sans-serif;font-size:0.625rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none';
  signInBtn.textContent = 'Sign in';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.style.cssText = 'flex:1;background:#ece7e1;color:#1d1b17;padding:0.75rem 1.5rem;border-radius:9999px;border:none;cursor:pointer;font-family:Manrope,sans-serif;font-size:0.625rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase';
  cancelBtn.textContent = 'Cancel';

  row.append(signInBtn, cancelBtn);
  card.append(h, p, row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// ─── JWT decode (kept for backwards compat) ───────────────────────────────────

export function decodeJwtPayload(token = getToken()) {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}
