// PORT FROM OLD PROJECT: Uses FastAPI `GET /restaurants` search endpoint.
// Backend returns all matching restaurants (no server-side limit). UI paginates client-side (12 at a time).

import { FASTAPI_BASE } from './config.js';
import { getToken, fetchCurrentUser, logout } from './auth.js';

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

  if (!user) {
    accountBtn.setAttribute('aria-label', 'Sign in');
    accountBtn.textContent = 'login';
    accountBtn.style.cursor = 'pointer';
    accountBtn.onclick = () => (window.location.href = 'login.html');
    return;
  }

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
    )}">Profile</a>
    <button id="navLogoutBtn" class="w-full text-left font-label text-sm py-2 hover:text-primary transition-colors">Log out</button>
  `;
  document.body.appendChild(menu);

  function positionMenu() {
    const rect = accountBtn.getBoundingClientRect();
    const width = 288;
    const margin = 16;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
    const top = rect.bottom + 10;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openMenu() {
    positionMenu();
    menu.classList.remove('hidden');
  }
  function closeMenu() {
    menu.classList.add('hidden');
  }
  function toggleMenu() {
    if (menu.classList.contains('hidden')) openMenu();
    else closeMenu();
  }

  accountBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  };
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeMenu);
  window.addEventListener('scroll', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });
  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  menu.querySelector('#navLogoutBtn')?.addEventListener('click', () => logout('login.html'));
}

function primaryCuisineLabel(cuisine) {
  const raw = String(cuisine || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim();
  return first || raw;
}

function cuisineTokens(cuisine) {
  const raw = String(cuisine || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length ? raw : [];
}

function normalizeRestaurant(r) {
  return {
    id: r?.id ?? null,
    slug: r?.slug ? String(r.slug) : r?.id ? String(r.id) : '',
    name: r?.name ? String(r.name) : 'Restaurant',
    area: r?.area ? String(r.area) : '',
    cuisine: r?.cuisine ? String(r.cuisine) : '',
    image_url: r?.image_url ? String(r.image_url) : '',
  };
}

function restaurantCardHtml(r, rating) {
  const href = r.slug ? `restaurant.html?slug=${encodeURIComponent(r.slug)}` : 'restaurant.html';
  const meta = [primaryCuisineLabel(r.cuisine), r.area].filter(Boolean).join(' · ');
  const ratingVal = rating?.total_ratings
    ? Number(rating.average_rating || 0).toFixed(1)
    : null;

  const imagePart = r.image_url
    ? `<img alt="${escapeHtml(r.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" src="${escapeHtml(r.image_url)}" loading="lazy" />`
    : `<div class="w-full h-full flex items-center justify-center font-headline italic text-6xl text-on-surface/20">${escapeHtml((r.name || 'R')[0]?.toUpperCase?.() || 'R')}</div>`;

  return `
    <a class="group bg-surface-container-lowest rounded-2xl overflow-hidden editorial-shadow hover:-translate-y-0.5 transition-all duration-300 border border-on-surface/5 flex flex-col" href="${href}">
      <div class="aspect-[3/2] overflow-hidden flex-none relative bg-surface-container">
        ${imagePart}
        ${ratingVal ? `
        <div class="absolute top-4 right-4">
          <span class="bg-[#1d1b17]/70 backdrop-blur-sm text-white px-3 py-1.5 rounded-full font-label font-bold text-xs tabular-nums flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px]" style="font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24">star</span>
            ${escapeHtml(ratingVal)}
          </span>
        </div>` : ''}
      </div>
      <div class="p-5 flex flex-col flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-headline italic text-xl leading-snug tracking-tight truncate group-hover:underline underline-offset-4">${escapeHtml(r.name)}</h3>
            <p class="font-label text-xs text-on-surface-variant mt-1 truncate">${escapeHtml(meta)}</p>
          </div>
          <span class="material-symbols-outlined text-on-surface/25 group-hover:text-primary transition-colors flex-none mt-0.5">arrow_forward</span>
        </div>
      </div>
    </a>
  `;
}

function restaurantSkeletonCardHtml() {
  return `
    <div class="group block">
      <div class="aspect-[4/5] overflow-hidden rounded-xl mb-6 relative catalog-skeleton"></div>
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="h-6 w-3/4 rounded catalog-skeleton"></div>
          <div class="h-4 w-1/2 rounded catalog-skeleton mt-3"></div>
        </div>
        <div class="w-6 h-6 rounded-full catalog-skeleton"></div>
      </div>
    </div>
  `.trim();
}

function restaurantsSkeletonGridHtml(count = 9) {
  const n = Math.max(1, Math.min(18, Number(count || 9)));
  return new Array(n).fill(0).map(() => restaurantSkeletonCardHtml()).join('\n');
}

function makePillDropdown({ btnId, panelId, chevronId }) {
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  const chevron = document.getElementById(chevronId);
  if (!btn || !panel) return null;

  function reposition() {
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 200;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    panel.style.top = `${r.bottom + 6}px`;
    panel.style.left = `${left}px`;
  }

  function open() { reposition(); panel.classList.remove('hidden'); chevron?.classList.add('rotate-180'); }
  function close() { panel.classList.add('hidden'); chevron?.classList.remove('rotate-180'); }
  function toggle() { panel.classList.contains('hidden') ? open() : close(); }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  window.addEventListener('scroll', () => { if (!panel.classList.contains('hidden')) reposition(); }, { passive: true });
  window.addEventListener('resize', () => { if (!panel.classList.contains('hidden')) reposition(); });

  return { open, close };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const token = getToken();
  const user = token ? await fetchCurrentUser({ token, redirectOnFail: null }) : null;
  ensureAccountDropdown({ user });

  const grid = document.getElementById('restaurantsGrid');
  const meta = document.getElementById('allMeta');
  const searchInput = document.getElementById('allSearchInput');
  const searchBtn = document.getElementById('allSearchBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const clearBtn = document.getElementById('clearFiltersBtn');

  if (!grid || !meta || !searchInput || !loadMoreBtn || !clearBtn) return;

  const ratingsCache = new Map(); // slug -> summary
  let restaurants = [];
  let visibleCount = 12;
  let activeCuisine = 'all';
  let sortMode = 'name';
  let currentQuery = '';
  let loadingRatings = false;

  function setMeta(text) {
    meta.textContent = text || '';
  }

  const PREDEFINED_CUISINES = [
    'North Indian', 'South Indian', 'Chinese', 'Italian',
    'Cafe', 'Pizza', 'Seafood', 'Dessert',
  ];

  function setCuisineOptions() {
    const panel = document.getElementById('cuisineDropdownPanel');
    const label = document.getElementById('cuisineDropdownLabel');
    if (!panel) return;

    const allOptions = [
      { value: 'all', label: 'All cuisines' },
      ...PREDEFINED_CUISINES.map((c) => ({ value: c, label: c })),
    ];

    panel.innerHTML = allOptions
      .map(
        (opt) =>
          `<button class="w-full text-left px-4 py-2.5 font-label text-sm transition-colors ${
            opt.value === activeCuisine
              ? 'text-primary font-bold bg-surface-container-low'
              : 'hover:bg-surface-container-high'
          }" data-cuisine="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</button>`
      )
      .join('');

    const current = allOptions.find((o) => o.value === activeCuisine);
    if (label) label.textContent = current?.label || 'All cuisines';
  }

  function passesCuisine(r) {
    if (!activeCuisine || activeCuisine === 'all') return true;
    const tokens = cuisineTokens(r.cuisine).map((t) => t.toLowerCase());
    return tokens.includes(String(activeCuisine).toLowerCase());
  }

  function getRating(slug) {
    return ratingsCache.get(slug) || null;
  }

  function computeFiltered() {
    const filtered = restaurants.filter(passesCuisine);
    if (sortMode === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      return filtered;
    }
    // rating
    filtered.sort((a, b) => {
      const ra = getRating(a.slug)?.average_rating ?? -1;
      const rb = getRating(b.slug)?.average_rating ?? -1;
      return rb - ra;
    });
    return filtered;
  }

  async function ensureRatingsFor(list) {
    const need = list.filter((r) => r.slug && !ratingsCache.has(r.slug));
    if (!need.length) return;
    loadingRatings = true;
    setMeta('Loading ratings…');

    await mapWithConcurrency(need, 6, async (r) => {
      try {
        const d = await fetchJson(`${FASTAPI_BASE}/api/ratings/${encodeURIComponent(r.slug)}`);
        ratingsCache.set(r.slug, d || { average_rating: 0, total_ratings: 0 });
      } catch {
        ratingsCache.set(r.slug, { average_rating: 0, total_ratings: 0 });
      }
    });

    loadingRatings = false;
  }

  function render() {
    const filtered = computeFiltered();
    const shown = filtered.slice(0, visibleCount);
    const total = filtered.length;

    if (!total) {
      grid.innerHTML = `<div class="font-label text-sm opacity-60">No restaurants found.</div>`;
      loadMoreBtn.classList.add('hidden');
      setMeta(currentQuery ? 'No results' : 'No restaurants');
      return;
    }

    setMeta(
      `${total} restaurant${total === 1 ? '' : 's'}${currentQuery ? ` • “${currentQuery}”` : ''}${
        activeCuisine !== 'all' ? ` • ${activeCuisine}` : ''
      }${sortMode === 'rating' && loadingRatings ? ' • loading ratings…' : ''}`
    );

    grid.innerHTML = shown
      .map((r) => restaurantCardHtml(r, sortMode === 'rating' ? getRating(r.slug) : null))
      .join('');

    if (visibleCount < total) loadMoreBtn.classList.remove('hidden');
    else loadMoreBtn.classList.add('hidden');
  }

  async function loadRestaurants({ query }) {
    currentQuery = String(query || '').trim();
    setMeta('Loading…');
    grid.innerHTML = restaurantsSkeletonGridHtml(9);
    visibleCount = 12;
    ratingsCache.clear();
    loadMoreBtn.classList.add('hidden');

    const url = currentQuery
      ? `${FASTAPI_BASE}/restaurants?search=${encodeURIComponent(currentQuery)}`
      : `${FASTAPI_BASE}/restaurants`;

    const data = await fetchJson(url);
    restaurants = (Array.isArray(data) ? data : []).map(normalizeRestaurant).filter((r) => r.slug);

    const cuisines = Array.from(
      new Set(
        restaurants
          .flatMap((r) => cuisineTokens(r.cuisine))
          .map((c) => c.trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    setCuisineOptions(cuisines);

    render();

    if (sortMode === 'rating') {
      await ensureRatingsFor(restaurants);
      render();
    }
  }

  function setFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('search') || '';
    if (q) searchInput.value = q;
    return q;
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (currentQuery) params.set('search', currentQuery);
    if (activeCuisine && activeCuisine !== 'all') params.set('cuisine', activeCuisine);
    if (sortMode && sortMode !== 'name') params.set('sort', sortMode);
    const qs = params.toString();
    const next = qs ? `all-restaurants.html?${qs}` : 'all-restaurants.html';
    window.history.replaceState({}, '', next);
  }

  const initialQuery = setFromUrl();
  await loadRestaurants({ query: initialQuery });

  // Init custom pill dropdowns
  const cuisineDropdown = makePillDropdown({ btnId: 'cuisineDropdownBtn', panelId: 'cuisineDropdownPanel', chevronId: 'cuisineDropdownChevron' });
  const sortDropdown = makePillDropdown({ btnId: 'sortDropdownBtn', panelId: 'sortDropdownPanel', chevronId: 'sortDropdownChevron' });

  // Cuisine panel: delegate click on options
  document.getElementById('cuisineDropdownPanel')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cuisine]');
    if (!btn) return;
    activeCuisine = btn.getAttribute('data-cuisine') || 'all';
    setCuisineOptions();
    cuisineDropdown?.close();
    visibleCount = 12;
    render();
    updateUrl();
  });

  // Sort panel: delegate click on options
  const SORT_LABELS = { name: 'Name (A–Z)', rating: 'Rating' };
  document.getElementById('sortDropdownPanel')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    sortMode = btn.getAttribute('data-sort') || 'name';
    const sortLabel = document.getElementById('sortDropdownLabel');
    if (sortLabel) sortLabel.textContent = SORT_LABELS[sortMode] || 'Name (A–Z)';
    sortDropdown?.close();
    visibleCount = 12;
    if (sortMode === 'rating') await ensureRatingsFor(restaurants);
    render();
    updateUrl();
  });

  function goSearch() {
    const q = searchInput.value.trim();
    loadRestaurants({ query: q }).catch(() => {
      grid.innerHTML = `<div class="font-label text-sm text-error">Failed to load restaurants.</div>`;
      loadMoreBtn.classList.add('hidden');
    });
  }

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(goSearch, 350);
  });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goSearch(); });
  searchBtn?.addEventListener('click', goSearch);

  loadMoreBtn.addEventListener('click', () => { visibleCount += 12; render(); });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    activeCuisine = 'all';
    sortMode = 'name';
    visibleCount = 12;
    const sortLabel = document.getElementById('sortDropdownLabel');
    if (sortLabel) sortLabel.textContent = 'Name (A–Z)';
    setCuisineOptions();
    updateUrl();
    loadRestaurants({ query: '' }).catch(() => {
      grid.innerHTML = `<div class="font-label text-sm text-error">Failed to load restaurants.</div>`;
    });
  });
}

main();
