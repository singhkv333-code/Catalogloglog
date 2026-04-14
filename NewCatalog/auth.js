// Shared auth utilities (shared)
// PORT FROM OLD PROJECT: token storage + `/profile` auth check patterns.

import { EXPRESS_BASE, STORAGE_KEYS } from './config.js';

export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.token);
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(STORAGE_KEYS.token, token);
}

export function clearAuthStorage() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.signupEmail);
  sessionStorage.clear();
}

export function logout(redirectTo = 'login.html') {
  clearAuthStorage();
  window.location.replace(redirectTo);
}

export function authHeader(token = getToken()) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

export async function fetchCurrentUser({ token = getToken(), redirectOnFail = null } = {}) {
  if (!token) {
    if (redirectOnFail) window.location.replace(redirectOnFail);
    return null;
  }
  try {
    const res = await fetch(`${EXPRESS_BASE}/profile`, {
      headers: { ...authHeader(token) },
    });
    if (!res.ok) throw new Error('auth_failed');
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    if (redirectOnFail) {
      clearAuthStorage();
      window.location.replace(redirectOnFail);
    }
    return null;
  }
}

export async function requireAuth({ redirectTo = 'login.html' } = {}) {
  const user = await fetchCurrentUser({ redirectOnFail: redirectTo });
  return user;
}

