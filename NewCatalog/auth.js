// auth.js — Supabase-backed auth utilities
// All pages import from here for login checks, user data, and logout.

import { getSupabaseClient } from './supabase-client.js';

const supabase = getSupabaseClient();

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

export async function logout(redirectTo = 'newindex.html') {
  await supabase.auth.signOut();
  clearAuthStorage();
  window.location.replace(redirectTo);
}

// ─── Current user ─────────────────────────────────────────────────────────────

// Returns the Supabase user object, or null if not authenticated.
// Pass redirectOnFail to auto-redirect unauthenticated visitors.
export async function fetchCurrentUser({ redirectOnFail = null } = {}) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('not_authenticated');
    // Normalise to the shape the rest of the app expects
    return {
      id:       user.id,
      email:    user.email,
      name:     user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
      username: user.user_metadata?.username  ?? null,
      ...user,
    };
  } catch {
    if (redirectOnFail) {
      clearAuthStorage();
      window.location.replace(redirectOnFail);
    }
    return null;
  }
}

// Alias used by protected pages
export async function requireAuth({ redirectTo = 'login.html' } = {}) {
  return fetchCurrentUser({ redirectOnFail: redirectTo });
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
