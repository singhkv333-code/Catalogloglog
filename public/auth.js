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

export async function logout(redirectTo = '/') {
  await supabase.auth.signOut();
  clearAuthStorage();
  window.location.replace(redirectTo);
}

// ─── Current user ─────────────────────────────────────────────────────────────

// Returns the current user, or null if not authenticated.
// `id` is the integer DB primary key (not the Supabase UUID).
// Pass redirectOnFail to auto-redirect unauthenticated visitors.
export async function fetchCurrentUser({ redirectOnFail = null } = {}) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('not_authenticated');

    // Resolve the integer DB id via /api/me so API calls that use userId in the
    // URL (e.g. /api/users/:userId/visits/recent) work correctly.
    const token = getToken();
    let dbId = null;
    let dbUsername = user.user_metadata?.username ?? null;
    let dbName = user.user_metadata?.full_name ?? null;
    let dbBio = null;
    if (token) {
      try {
        const resp = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const me = await resp.json();
          dbId = me.id;
          dbUsername = me.username ?? dbUsername;
          dbName = me.name ?? dbName;
          dbBio = me.bio ?? null;
        }
      } catch { /* ignore — server may not be running */ }
    }

    const resolvedId = dbId ?? user.id;
    return {
      ...user,
      id:         resolvedId,
      supabaseId: user.id,
      email:      user.email,
      name:       dbName ?? user.user_metadata?.full_name ?? null,  // editable full name
      username:   dbUsername,                                        // permanent handle
      bio:        dbBio,
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
export async function requireAuth({ redirectTo = 'login' } = {}) {
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
