// Been page (new design)
// PORT FROM OLD PROJECT: uses FastAPI `GET /api/users/{id}/visits/recent?limit=...` for visit history.

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
  menu.className =
    'hidden fixed z-50 w-72 bg-surface-container-lowest rounded-xl editorial-shadow p-5';
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

function renderCard(v) {
  // storedId is the integer restaurant_id — used for DELETE API calls
  const storedId = String(v?.restaurant_id || '');
  // nameSlug is for page navigation only — computed from name or from the slug field the server returns
  const nameSlug = v?.slug || (v?.name ? v.name.toLowerCase().replace(/\s+/g, '-') : storedId);
  const href = nameSlug ? `restaurant.html?slug=${encodeURIComponent(nameSlug)}` : 'restaurant.html';
  const imgUrl = v?.image_url || v?.images?.[0] || '';
  const rating = Number(v?.user_rating ?? 0) || 0;
  const when = formatWhen(v?.visited_at);
  const starCount = Math.max(0, Math.min(5, Math.round(rating)));
  const starsHtml = starCount
    ? Array.from({ length: 5 }, (_, idx) => {
        const filled = idx + 1 <= starCount;
        return `<span class="material-symbols-outlined text-[14px]" style="font-variation-settings:'FILL' ${
          filled ? 1 : 0
        }, 'wght' 400, 'GRAD' 0, 'opsz' 24; color: ${
          filled ? '#690008' : 'rgba(88, 65, 63, 0.35)'
        }">star</span>`;
      }).join('')
    : '';

  return `
    <div class="group relative" data-restaurant-id="${escapeHtml(storedId)}">
      <button
        class="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-surface-container-lowest/90 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-error hover:text-on-error editorial-shadow"
        type="button"
        data-action="remove-been"
        aria-label="Remove from been"
        title="Remove from been"
      >
        <span class="material-symbols-outlined text-sm" style="font-size:16px">close</span>
      </button>
      <a class="block" href="${escapeHtml(href)}">
        <div class="aspect-[4/5] overflow-hidden rounded-xl bg-surface-container-lowest editorial-shadow">
          ${
            imgUrl
              ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="${escapeHtml(
                  v?.name || 'Restaurant'
                )}" src="${escapeHtml(imgUrl)}" loading="lazy" />`
              : `<div class="w-full h-full flex items-center justify-center font-headline italic text-6xl opacity-20">${escapeHtml(
                  (v?.name || 'R')[0]?.toUpperCase?.() || 'R'
                )}</div>`
          }
        </div>
        <div class="mt-6 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="font-headline text-xl italic mb-1 truncate">${escapeHtml(v?.name || nameSlug || 'Restaurant')}</h3>
            <p class="font-label text-sm text-on-surface-variant truncate">${escapeHtml(formatCuisineArea(v))}</p>
            ${when ? `<p class="font-label text-xs uppercase tracking-widest opacity-60 mt-3">${escapeHtml(when)}</p>` : ''}
          </div>
          ${
            starsHtml
              ? `<span class="inline-flex items-center gap-0.5 bg-surface-container-highest px-3 py-1 rounded-full editorial-shadow" aria-label="${escapeHtml(
                  `${starCount} out of 5 stars`
                )}" title="${escapeHtml(`${starCount} / 5`)}">${starsHtml}</span>`
              : ''
          }
        </div>
      </a>
    </div>
  `.trim();
}

function setSortButtons(active) {
  const recent = document.getElementById('beenSortRecent');
  const name = document.getElementById('beenSortName');
  const mk = (btn, on) => {
    if (!btn) return;
    btn.className = on
      ? 'bg-primary text-on-primary px-6 py-3 rounded-full font-label text-[10px] font-bold tracking-widest uppercase transition-colors editorial-shadow'
      : 'bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors editorial-shadow';
  };
  mk(recent, active === 'recent');
  mk(name, active === 'name');
}

async function init() {
  const user = await requireAuth({ redirectTo: 'login.html' });
  if (!user) return;
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;

  const grid = document.getElementById('beenGrid');
  const empty = document.getElementById('beenEmpty');
  const countLabel = document.getElementById('beenCountLabel');
  const searchInput = document.getElementById('beenSearchInput');

  let visits = [];
  try {
    // PORT FROM OLD PROJECT: visit history is served via `visits/recent` with a high limit.
    visits = await fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(user.id)}/visits/recent?limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    visits = [];
  }

  const all = Array.isArray(visits) ? visits : [];
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
      list.sort((a, b) => new Date(b?.visited_at || 0) - new Date(a?.visited_at || 0));
    }

    if (countLabel) countLabel.textContent = `${list.length} visit${list.length === 1 ? '' : 's'}`;

    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    grid.innerHTML = list.map(renderCard).join('\n');
  }

  grid?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="remove-been"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const card = btn.closest('[data-restaurant-id]');
    const storedId = card?.getAttribute('data-restaurant-id');
    if (!storedId) return;

    btn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/visits/${encodeURIComponent(storedId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      // Remove from local array and re-render without a network reload
      const idx = all.findIndex((v) => String(v?.restaurant_id || '') === storedId);
      if (idx !== -1) all.splice(idx, 1);
      apply();
    } catch {
      btn.disabled = false;
    }
  });

  setSortButtons(sortMode);
  document.getElementById('beenSortRecent')?.addEventListener('click', () => {
    sortMode = 'recent';
    setSortButtons(sortMode);
    apply();
  });
  document.getElementById('beenSortName')?.addEventListener('click', () => {
    sortMode = 'name';
    setSortButtons(sortMode);
    apply();
  });

  searchInput?.addEventListener('input', (e) => {
    query = e.target.value || '';
    apply();
  });

  apply();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
