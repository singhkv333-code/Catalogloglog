// Shared runtime config for the Catalog frontend (no build step).
// Keep all base URLs in one place to avoid duplication across pages.

export const FASTAPI_BASE = 'http://localhost:4000';
export const EXPRESS_BASE = 'http://localhost:4000';

// Storage keys (must match old project)
export const STORAGE_KEYS = {
  token: 'token',
  signupEmail: 'signupEmail',
};

