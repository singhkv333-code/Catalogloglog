// Saved page (new design)
// PORT FROM OLD PROJECT: uses FastAPI wishlist endpoints:
// - GET /api/users/bookmarks
// - DELETE /api/bookmarks/{restaurant_id}
// - POST /api/visits/{restaurant_id}

import { requireAuth, getToken, logout } from './auth.js';
import { FASTAPI_BASE } from './config.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function ensureAccountDropdown({ user }) {
  const accountBtn = document.getElementById('navAccountBtn');
  if (!accountBtn) return;

  const initial = (user?.username || 'U')[0]?.toUpperCase?.() || 'U';
  accountBtn.setAttribute('aria-label', 'Account menu');
  accountBtn.textContent = '';

  const chip = document.createElement('div');
  chip.className =
    'w-10 h-10 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold';
  chip.textContent = initial;
  accountBtn.appendChild(chip);

  const menu = document.createElement('div');
  menu.id = 'navAccountMenu';
  menu.className = 'hidden fixed z-50 w-72 bg-surface-container-lowest rounded-xl editorial-shadow p-5';
  menu.innerHTML = `
    <div class="flex items-center gap-4 mb-4">
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(
        initial
      )}</div>
      <div class="min-w-0">
        <div class="font-label font-bold text-sm truncate">${escapeHtml(user?.username || 'User')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(user?.email || '')}</div>
      </div>
    </div>
    <div class="h-px w-full bg-on-surface/10 my-4"></div>
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile.html?id=${encodeURIComponent(
      user?.id ?? ''
    )}">View profile</a>
    <button class="w-full text-left font-label text-sm py-2 hover:text-primary transition-colors" type="button" id="navLogoutBtn">Log out</button>
  `.trim();
  document.body.appendChild(menu);

  function positionMenu() {
    const rect = accountBtn.getBoundingClientRect();
    const gap = 12;
    const width = menu.offsetWidth || 288;
    const leftIdeal = rect.right - width;
    const left = Math.min(Math.max(leftIdeal, gap), window.innerWidth - width - gap);
    const top = rect.bottom + gap;
    menu.style.left = `${Math.max(gap, left)}px`;
    menu.style.top = `${top}px`;
  }

  function setOpen(open) {
    if (open) positionMenu();
    menu.classList.toggle('hidden', !open);
  }
  accountBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(menu.classList.contains('hidden'));
  });
  document.addEventListener('click', () => setOpen(false));
  menu.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (!menu.classList.contains('hidden')) positionMenu();
    },
    { passive: true }
  );
  menu.querySelector('#navLogoutBtn')?.addEventListener('click', () => logout('login.html'));
}

function formatCuisineArea(r) {
  const cuisine = r?.cuisine ? String(r.cuisine) : '';
  const area = r?.area ? String(r.area) : '';
  if (cuisine && area) return `${cuisine} • ${area}`;
  return cuisine || area || '';
}

function formatWhen(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

function setSortButtons(active) {
  const recent = document.getElementById('savedSortRecent');
  const name = document.getElementById('savedSortName');
  const mk = (btn, on) => {
    if (!btn) return;
    btn.className = on
      ? 'bg-primary text-on-primary px-6 py-3 rounded-full font-label text-[10px] font-bold tracking-widest uppercase transition-colors editorial-shadow'
      : 'bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors editorial-shadow';
  };
  mk(recent, active === 'recent');
  mk(name, active === 'name');
}

function renderRowCard(b) {
  const slug = b?.slug || b?.restaurant_id || '';
  const href = slug ? `restaurant.html?slug=${encodeURIComponent(slug)}` : 'restaurant.html';
  const imgUrl = b?.image_url || b?.images?.[0] || '';
  const when = formatWhen(b?.added_at);

  return `
    <div class="group" data-restaurant-id="${escapeHtml(slug)}">
      <div class="aspect-[4/5] overflow-hidden rounded-xl bg-surface-container-lowest editorial-shadow relative">
        <a class="block w-full h-full" href="${escapeHtml(href)}">
          ${
            imgUrl
              ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="${escapeHtml(b?.name || 'Restaurant')}" src="${escapeHtml(imgUrl)}" loading="lazy" />`
              : `<div class="w-full h-full flex items-center justify-center font-headline italic text-6xl opacity-20">${escapeHtml((b?.name || 'R')[0]?.toUpperCase?.() || 'R')}</div>`
          }
        </a>
      </div>
      <div class="mt-6 flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <a href="${escapeHtml(href)}">
            <h3 class="font-headline text-xl italic mb-1 truncate hover:text-primary transition-colors">${escapeHtml(b?.name || slug || 'Restaurant')}</h3>
          </a>
          <p class="font-label text-sm text-on-surface-variant truncate">${escapeHtml(formatCuisineArea(b))}</p>
          ${when ? `<p class="font-label text-xs uppercase tracking-widest opacity-60 mt-3">Saved ${escapeHtml(when)}</p>` : ''}
        </div>
        <button
          class="material-symbols-outlined text-primary hover:scale-95 transition-transform flex-none mt-0.5"
          style="font-variation-settings:'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
          type="button"
          data-action="remove-saved"
          aria-label="Remove bookmark"
          title="Remove bookmark"
        >bookmark</button>
      </div>
      <p class="font-label text-sm text-error hidden mt-4" data-row-error></p>
    </div>
  `.trim();
}

async function init() {
  const user = await requireAuth({ redirectTo: 'login.html' });
  if (!user) return;
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;
  const headers = { Authorization: `Bearer ${token}` };

  const grid = document.getElementById('savedGrid');
  const empty = document.getElementById('savedEmpty');
  const err = document.getElementById('savedError');
  const countLabel = document.getElementById('savedCountLabel');
  const searchInput = document.getElementById('savedSearchInput');

  let items = [];
  try {
    const d = await fetchJson(`${FASTAPI_BASE}/api/users/bookmarks`, { headers });
    items = Array.isArray(d?.bookmarks) ? d.bookmarks : [];
  } catch (ex) {
    items = [];
    if (err) {
      err.textContent = ex?.message || 'Could not load saved places.';
      err.classList.remove('hidden');
    }
  }

  const all = items.slice();
  let sortMode = 'recent';
  let query = '';

  function apply() {
    const q = String(query || '').trim().toLowerCase();
    let list = all.slice();

    if (q) {
      list = list.filter((v) => {
        const name = String(v?.name || '').toLowerCase();
        const cuisine = String(v?.cuisine || '').toLowerCase();
        const area = String(v?.area || '').toLowerCase();
        return name.includes(q) || cuisine.includes(q) || area.includes(q);
      });
    }

    if (sortMode === 'name') {
      list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    } else {
      list.sort((a, b) => new Date(b?.added_at || 0) - new Date(a?.added_at || 0));
    }

    if (countLabel) countLabel.textContent = `${list.length} saved`;

    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    grid.innerHTML = list.map(renderRowCard).join('\n');
  }

  setSortButtons(sortMode);
  document.getElementById('savedSortRecent')?.addEventListener('click', () => {
    sortMode = 'recent';
    setSortButtons(sortMode);
    apply();
  });
  document.getElementById('savedSortName')?.addEventListener('click', () => {
    sortMode = 'name';
    setSortButtons(sortMode);
    apply();
  });

  searchInput?.addEventListener('input', (e) => {
    query = e.target.value || '';
    apply();
  });

  grid?.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;
    const card = btn.closest?.('[data-restaurant-id]');
    if (!card) return;
    const rid = card.getAttribute('data-restaurant-id');
    if (!rid) return;

    const action = btn.getAttribute('data-action');
    const rowErr = card.querySelector('[data-row-error]');
    if (rowErr) {
      rowErr.textContent = '';
      rowErr.classList.add('hidden');
    }

    btn.disabled = true;
    try {
      if (action === 'remove-saved') {
        await fetchJson(`${FASTAPI_BASE}/api/bookmarks/${encodeURIComponent(rid)}`, { method: 'DELETE', headers });
        const idx = all.findIndex((x) => String(x?.restaurant_id || x?.slug || '') === String(rid));
        if (idx >= 0) all.splice(idx, 1);
        apply();
      }
      if (action === 'mark-been') {
        await fetchJson(`${FASTAPI_BASE}/api/visits/${encodeURIComponent(rid)}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
        // Keep the item saved; just give a subtle confirmation by changing label.
        btn.innerHTML =
          '<span class="material-symbols-outlined text-sm">done</span> Been';
      }
    } catch (ex) {
      if (rowErr) {
        rowErr.textContent = ex?.message || 'Action failed.';
        rowErr.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  });

  apply();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
