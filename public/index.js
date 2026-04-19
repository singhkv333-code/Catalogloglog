// Home (new design) controller
// Goal for this step: auth-gate + nav avatar/dropdown/logout wiring.
// Next step will populate dynamic sections (popular, friend activity, lists, etc.).

import { fetchCurrentUser, logout, getToken } from './auth.js';
import { FASTAPI_BASE } from './config.js';
import { getSupabaseClient } from './supabase-client.js';
import { startProgress, finishProgress } from './progress.js';


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageUrl(path) {
  return new URL(String(path || ''), window.location.href).toString();
}

function ensureAccountDropdown({ user }) {
  const accountBtn = document.getElementById('navAccountBtn');
  if (!accountBtn) return;
  accountBtn.style.visibility = 'visible';

  // ── Unauthenticated: show "Sign in" link ──────────────────────────────
  if (!user) {
    accountBtn.setAttribute('aria-label', 'Sign in');
    accountBtn.textContent = '';
    const signInChip = document.createElement('a');
    signInChip.href = 'login';
    signInChip.className =
      'inline-flex items-center gap-1.5 font-label text-xs font-bold tracking-widest uppercase text-primary hover:opacity-80 transition-opacity';
    signInChip.textContent = 'Sign in';
    accountBtn.appendChild(signInChip);
    return;
  }

  // ── Authenticated: avatar chip + dropdown ─────────────────────────────
  const initial = (user.username || 'U')[0]?.toUpperCase?.() || 'U';
  accountBtn.setAttribute('aria-label', 'Account menu');
  accountBtn.textContent = '';

  const chip = document.createElement('div');
  chip.className =
    'w-10 h-10 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold cursor-pointer';
  chip.textContent = initial;
  accountBtn.appendChild(chip);

  const menu = document.createElement('div');
  menu.id = 'navAccountMenu';
  menu.className =
    'hidden fixed z-50 w-72 bg-surface-container-lowest rounded-xl editorial-shadow p-5';
  menu.innerHTML = `
    <div class="flex items-center gap-4 mb-4">
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(initial)}</div>
      <div class="min-w-0">
        <div class="font-label font-bold text-sm truncate">${escapeHtml(user.username || 'User')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(user.email || '')}</div>
      </div>
    </div>
    <div class="h-px w-full bg-on-surface/10 my-4"></div>
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile?id=${encodeURIComponent(
      user.id ?? ''
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
  window.addEventListener('scroll', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  }, { passive: true });

  menu.querySelector('#navLogoutBtn')?.addEventListener('click', () => {
    logout('/'); // redirect to homepage (public), not login
  });
}

function formatCuisineArea(r) {
  const cuisine = r?.cuisine ? String(r.cuisine) : '';
  const area = r?.area ? String(r.area) : '';
  if (cuisine && area) return `${cuisine} • ${area}`;
  return cuisine || area || '';
}

function formatRating(r) {
  const value = Number(r?.avg_rating ?? r?.average_rating ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(1);
}

function safeImgSrc(url, width = 400) {
  const str = String(url || '').trim();
  if (!str) return null;
  if (str.includes('res.cloudinary.com') && str.includes('/image/upload/')) {
    return str.replace('/image/upload/', `/image/upload/w_${width * 2 > 1200 ? 1200 : width * 2},c_limit,q_auto:best,f_auto/`);
  }
  return str;
}

async function fetchJson(url, { headers } = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function getPopularSectionEls() {
  const heading = Array.from(document.querySelectorAll('h2')).find(
    (h) => (h.textContent || '').trim().toLowerCase() === 'popular right now'
  );
  const section = heading?.closest('section');
  if (!section) return null;

  const viewLink = section.querySelector('a');

  const grid = section.querySelector('.grid');
  if (!grid) return null;

  const slots = Array.from(grid.children).filter((el) => el && el.nodeType === 1);
  if (slots.length < 3) return null;

  return {
    section,
    grid,
    viewLink,
    featureCard: slots[0],
    card2: slots[1],
    card3: slots[2],
  };
}

function ensureViewAllLink() {
  const els = getPopularSectionEls();
  if (!els?.viewLink) return;
  const a = els.viewLink;
  const label = (a.textContent || '').trim().toLowerCase();
  if (label === 'view map' || label === 'view all' || a.getAttribute('href') === '#') {
    a.textContent = 'View All';
    a.setAttribute('href', pageUrl('all-restaurants'));
  }
}

function hydratePopularCardFeature(cardEl, restaurant) {
  if (!cardEl || !restaurant) return;

  const img = cardEl.querySelector('img');
  const title = cardEl.querySelector('h3');
  const meta = cardEl.querySelector('p');
  const badge = cardEl.querySelector('span.bg-primary-container');

  const slug = restaurant.slug || restaurant.id || '';
  const clickUrl = pageUrl(`restaurant?slug=${encodeURIComponent(slug)}`);

  cardEl.style.cursor = 'pointer';
  cardEl.onclick = () => {
    window.location.href = clickUrl;
  };

  const src = safeImgSrc(restaurant.image_url, 800);
  if (img) {
    if (src) {
      img.src = src;
      img.alt = restaurant.name ? String(restaurant.name) : img.alt;
    } else {
      img.removeAttribute('src');
    }
  }

  if (title) title.textContent = restaurant.name || 'Restaurant';
  if (meta) meta.textContent = formatCuisineArea(restaurant);

  const rating = formatRating(restaurant);
  if (badge) {
    if (rating) {
      badge.textContent = rating;
      badge.classList.remove('invisible');
    } else {
      badge.classList.add('invisible');
    }
  }
}

function hydratePopularCardSmall(cardEl, restaurant) {
  if (!cardEl || !restaurant) return;

  const img = cardEl.querySelector('img');
  const title = cardEl.querySelector('h3');
  const meta = cardEl.querySelector('p');

  const slug = restaurant.slug || restaurant.id || '';
  const clickUrl = pageUrl(`restaurant?slug=${encodeURIComponent(slug)}`);

  cardEl.style.cursor = 'pointer';
  cardEl.onclick = () => {
    window.location.href = clickUrl;
  };

  const src = safeImgSrc(restaurant.image_url);
  if (img) {
    if (src) {
      img.src = src;
      img.alt = restaurant.name ? String(restaurant.name) : img.alt;
    } else {
      img.removeAttribute('src');
    }
  }

  if (title) title.textContent = restaurant.name || 'Restaurant';
  if (meta) meta.textContent = formatCuisineArea(restaurant);
}

function setCuisinePillActive(pillsRoot, activeCuisine) {
  if (!pillsRoot) return;
  const buttons = Array.from(pillsRoot.querySelectorAll('button[data-cuisine]'));
  buttons.forEach((btn) => {
    const isActive = (btn.dataset.cuisine || '').toLowerCase() === String(activeCuisine || '').toLowerCase();
    btn.className = isActive
      ? 'bg-primary text-on-primary px-8 py-3 rounded-full font-label text-sm font-bold whitespace-nowrap'
      : 'bg-surface-container-high text-on-surface px-8 py-3 rounded-full font-label text-sm whitespace-nowrap hover:bg-surface-container-highest transition-colors';
  });
}

function setupCuisinePills({ allRestaurants, onChange }) {
  const root = document.getElementById('cuisinePills');
  if (!root) return { setActive: () => {} };

  let activeCuisine = 'all';
  setCuisinePillActive(root, activeCuisine);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cuisine]');
    if (!btn) return;
    activeCuisine = btn.dataset.cuisine || 'all';
    setCuisinePillActive(root, activeCuisine);
    onChange?.(activeCuisine, allRestaurants);
  });

  return {
    setActive: (cuisine) => {
      activeCuisine = cuisine || 'all';
      setCuisinePillActive(root, activeCuisine);
      onChange?.(activeCuisine, allRestaurants);
    },
  };
}

function applyCuisineFilter(restaurants, cuisine) {
  const c = String(cuisine || 'all').trim();
  if (!c || c.toLowerCase() === 'all') return restaurants;
  return (restaurants || []).filter((r) => {
    const hay = `${r?.cuisine || ''}`.toLowerCase();
    return hay.includes(c.toLowerCase());
  });
}

async function loadPopularRestaurants() {
  // PORT FROM OLD PROJECT: `GET /restaurants/popular?limit=6`
  return fetchJson(`${FASTAPI_BASE}/restaurants/popular?limit=12`);
}

function renderPopularRightNow({ restaurants, cuisine }) {
  const els = getPopularSectionEls();
  if (!els) return;

  const filtered = applyCuisineFilter(restaurants, cuisine);
  const top = filtered.slice(0, 3);

  if (top[0]) hydratePopularCardFeature(els.featureCard, top[0]);
  if (top[1]) hydratePopularCardSmall(els.card2, top[1]);
  if (top[2]) hydratePopularCardSmall(els.card3, top[2]);

  // If not enough results, hide remaining slots to avoid showing stale placeholder data.
  if (!top[1]) els.card2.style.display = 'none';
  else els.card2.style.display = '';
  if (!top[2]) els.card3.style.display = 'none';
  else els.card3.style.display = '';
}

function setupHomeSearch() {
  const input = document.getElementById('homeSearchInput');
  if (!input) return;

  const searchBtn = document.getElementById('homeSearchBtn');

  const host = input.closest('div.relative');
  if (!host) return;

  const panel = document.createElement('div');
  panel.id = 'homeSearchResults';
  panel.className =
    'hidden absolute left-0 right-0 mt-3 bg-surface-container-lowest rounded-xl editorial-shadow p-4 max-h-96 overflow-auto text-left';
  host.appendChild(panel);

  function hide() {
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }

  function showLoading() {
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="font-label text-sm opacity-60 py-2">Searching…</div>`;
  }

  function showEmpty(q) {
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="py-2">
        <div class="font-label text-sm font-bold">No results</div>
        <div class="font-body text-sm text-on-surface-variant mt-1">No restaurants found for “${escapeHtml(q)}”.</div>
      </div>
    `.trim();
  }

  function showError() {
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="font-label text-sm text-error py-2">Search failed. Try again.</div>`;
  }

  function renderResults(list) {
    panel.classList.remove('hidden');
    panel.innerHTML = '';

    list.forEach((r) => {
      const slug = r.slug || r.id || '';
      const a = document.createElement('a');
      a.href = pageUrl(`restaurant?slug=${encodeURIComponent(slug)}`);
      a.className =
        'flex items-center gap-4 p-3 rounded-xl hover:bg-surface-container-low transition-colors w-full text-left';

      const imgWrap = document.createElement('div');
      imgWrap.className = 'w-14 h-14 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0';

      const src = safeImgSrc(r.image_url);
      if (src) {
        const img = document.createElement('img');
        img.className = 'w-full h-full object-cover';
        img.alt = r.name ? String(r.name) : 'Restaurant';
        img.src = src;
        imgWrap.appendChild(img);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'w-full h-full flex items-center justify-center font-label font-bold opacity-60';
        fallback.textContent = (r.name || 'R')[0]?.toUpperCase?.() || 'R';
        imgWrap.appendChild(fallback);
      }

      const info = document.createElement('div');
      info.className = 'min-w-0';
      info.innerHTML = `
        <div class="font-label font-bold text-sm truncate">${escapeHtml(r.name || 'Restaurant')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(formatCuisineArea(r))}</div>
      `.trim();

      a.appendChild(imgWrap);
      a.appendChild(info);
      panel.appendChild(a);
    });
  }

  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = input.value.trim();
    if (!q) {
      hide();
      return;
    }
    timeout = setTimeout(async () => {
      showLoading();
      try {
        const data = await fetchJson(`${FASTAPI_BASE}/restaurants?search=${encodeURIComponent(q)}`);
        const list = Array.isArray(data) ? data.slice(0, 8) : [];
        if (!list.length) {
          showEmpty(q);
          return;
        }
        renderResults(list);
      } catch {
        showError();
      }
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hide();
      input.blur();
    }
    if (e.key === 'Enter') {
      const q = input.value.trim();
      window.location.href = q
        ? `all-restaurants??search=${encodeURIComponent(q)}`
        : 'all-restaurants';
    }
  });

  searchBtn?.addEventListener('click', () => {
    const q = input.value.trim();
    window.location.href = q
      ? `all-restaurants??search=${encodeURIComponent(q)}`
      : 'all-restaurants';
  });

  document.addEventListener('click', (e) => {
    if (host.contains(e.target)) return;
    hide();
  });
}

function getCuratedListsEls() {
  const heading = Array.from(document.querySelectorAll('h2')).find(
    (h) => (h.textContent || '').trim().toLowerCase() === 'curated lists'
  );
  const section = heading?.closest('section');
  if (!section) return null;
  const grid = section.querySelector('.grid');
  if (!grid) return null;
  const cards = Array.from(grid.children).filter((el) => el && el.nodeType === 1);
  return { section, grid, cards };
}

function normalizePublicListsPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.lists)) return payload.lists;
  return [];
}

function pickListCoverImage(list) {
  const coverImages = Array.isArray(list?.cover_images) ? list.cover_images : null;
  if (coverImages && coverImages.length) return coverImages.find(Boolean) || null;

  const previewRestaurants = Array.isArray(list?.preview_restaurants) ? list.preview_restaurants : null;
  if (previewRestaurants && previewRestaurants.length) {
    const first = previewRestaurants.find((r) => r && (r.image_url || r.imageUrl));
    return first?.image_url || first?.imageUrl || null;
  }

  return null;
}

function listMetaLine(list) {
  const rawCount =
    list?.item_count ??
    list?._itemCount ??
    list?.restaurant_count ??
    list?.restaurants_count ??
    0;
  const count = Number(rawCount || 0);
  const owner = (list?.owner_username || list?.ownerUsername || list?.username || 'Unknown').toString();
  const ownerUpper = owner.toUpperCase();
  return `${Number.isFinite(count) ? count : 0} PLACES • BY ${ownerUpper}`;
}

async function loadPublicLists({ token }) {
  // PORT FROM OLD PROJECT: prefer `/api/public-lists`, fall back to `/api/lists/public`
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const primary = await fetchJson(`${FASTAPI_BASE}/api/public-lists?limit=10`, { headers });
    return normalizePublicListsPayload(primary);
  } catch {
    try {
      const fallback = await fetchJson(`${FASTAPI_BASE}/api/lists/public?limit=10`, { headers });
      return normalizePublicListsPayload(fallback);
    } catch {
      return [];
    }
  }
}

async function hydrateCuratedLists({ token, lists: prefetched } = {}) {
  const els = getCuratedListsEls();
  if (!els) return;

  const lists = prefetched?.length ? prefetched : await loadPublicLists({ token });
  const top = (lists || []).slice(0, els.cards.length || 3);
  if (!top.length) return;

  els.cards.forEach((card, idx) => {
    const list = top[idx];
    if (!list) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    const previewRestaurants = Array.isArray(list?.preview_restaurants) ? list.preview_restaurants : [];

    // The stack has 3 layers in DOM order: [back-shadow, mid-shadow, main-card]
    const stackRoot = card.querySelector('div.relative');
    const stackLayers = stackRoot
      ? Array.from(stackRoot.children).filter((el) => el.classList.contains('absolute'))
      : [];

    // Main card image (front layer)
    const mainLayer = stackLayers[2] || card.querySelector('.absolute.overflow-hidden');
    const mainImg = mainLayer?.querySelector('img');
    const cover = safeImgSrc(previewRestaurants[0]?.image_url || pickListCoverImage(list), 400);
    if (mainImg) {
      if (cover) {
        mainImg.src = cover;
        mainImg.alt = list?.title ? String(list.title) : '';
        mainImg.style.display = '';
      } else {
        mainImg.style.display = 'none';
      }
    }

    // Middle shadow layer — 2nd restaurant image
    const midImg = stackLayers[1]?.querySelector('img');
    if (midImg && previewRestaurants[1]?.image_url) {
      midImg.src = safeImgSrc(previewRestaurants[1].image_url, 200);
    }

    // Back shadow layer — 3rd restaurant image (or reuse 2nd if only 2 available)
    const backImg = stackLayers[0]?.querySelector('img');
    if (backImg) {
      const backSrc = previewRestaurants[2]?.image_url || previewRestaurants[1]?.image_url;
      if (backSrc) backImg.src = safeImgSrc(backSrc, 200);
    }

    const titleOverlay = card.querySelector('p.absolute.bottom-4');
    if (titleOverlay) titleOverlay.textContent = list?.title || 'Untitled List';

    const meta = card.querySelector('p.font-label.uppercase');
    if (meta) meta.textContent = listMetaLine(list);

    card.style.cursor = 'pointer';
    card.onclick = () => {
      const id = list?.id ?? '';
      window.location.href = `list?id=${encodeURIComponent(id)}`;
    };
  });
}

function getJournalEls() {
  const heading = Array.from(document.querySelectorAll('h2')).find(
    (h) => (h.textContent || '').trim().toLowerCase() === 'the journal'
  );
  const section = heading?.closest('section');
  if (!section) return null;
  const articles = Array.from(section.querySelectorAll('article'));
  return { section, articles };
}

function normalizeBlogRow(blog) {
  return {
    slug: blog?.slug ? String(blog.slug) : '',
    title: blog?.title ? String(blog.title) : 'Untitled',
    tag: blog?.tag ? String(blog.tag) : 'Blog',
    excerpt: blog?.excerpt ? String(blog.excerpt) : '',
    heroImage: blog?.hero_image ? String(blog.hero_image) : '',
  };
}

async function loadJournalBlogs() {
  // PORT FROM OLD PROJECT: Supabase `blogs` table
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('blogs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function hydrateJournal() {
  const els = getJournalEls();
  if (!els) return;

  let blogs = [];
  try {
    blogs = await loadJournalBlogs();
  } catch {
    return; // Keep Stitch placeholders if Supabase unavailable
  }

  const normalized = blogs.map(normalizeBlogRow).filter((b) => b.slug);
  if (!normalized.length) return;

  const max = Math.min(els.articles.length, normalized.length);
  for (let i = 0; i < els.articles.length; i++) {
    const article = els.articles[i];
    if (i >= max) {
      article.style.display = 'none';
      continue;
    }
    article.style.display = '';

    const b = normalized[i];
    const href = `blog?slug=${encodeURIComponent(b.slug)}`;

    const imgWrap = article.querySelector('.aspect-video');
    const img = article.querySelector('img');
    if (img && b.heroImage) {
      img.src = b.heroImage;
      img.alt = b.title;
      imgWrap?.classList.remove('catalog-skeleton');
    }

    const tagEl = article.querySelector('span.font-label.uppercase');
    if (tagEl) tagEl.textContent = b.tag;

    const titleEl = article.querySelector('h3');
    if (titleEl) titleEl.textContent = b.title;

    const excerptEl = article.querySelector('p.font-body');
    if (excerptEl) excerptEl.textContent = b.excerpt || '';

    const linkEl = article.querySelector('a');
    if (linkEl) {
      linkEl.href = href;
      linkEl.textContent = 'Read more →';
    }

    article.style.cursor = 'pointer';
    article.onclick = () => {
      window.location.href = href;
    };
  }
}

function getFriendActivityEls() {
  const heading = Array.from(document.querySelectorAll('h2')).find(
    (h) => (h.textContent || '').trim().toLowerCase() === 'friend activity'
  );
  const section = heading?.closest('section');
  if (!section) return null;

  const grid = section.querySelector('.grid');
  if (!grid) return null;
  const cards = Array.from(grid.children).filter((el) => el && el.nodeType === 1);
  return { section, grid, cards };
}

function getRecentlyVisitedEls() {
  // Robust locator: the only section with an overflow-x card row.
  const sections = Array.from(document.querySelectorAll('section'));
  const section = sections.find((s) => s.querySelector('div.flex.gap-12.overflow-x-auto'));
  if (!section) return null;

  const row = section.querySelector('div.flex.gap-12.overflow-x-auto');
  if (!row) return null;
  const heading = section.querySelector('h2');
  const cards = Array.from(row.children).filter((el) => el && el.nodeType === 1);
  return { section, row, cards, heading };
}

function timeAgoVisited(dateStr) {
  if (!dateStr) return 'Visited recently';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'Visited recently';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 60) return `Visited ${Math.max(1, mins)}m ago`;
  if (hours < 48) return `Visited ${hours}h ago`;
  if (days < 14) return `Visited ${days}d ago`;
  const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `Visited ${label}`;
}

async function loadRestaurantDetails(slug) {
  if (!slug) return null;
  try {
    return await fetchJson(`${FASTAPI_BASE}/restaurants/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

async function loadFriendActivity({ token }) {
  // PORT FROM OLD PROJECT: `GET /api/friends/activity?limit=3`
  return fetchJson(`${FASTAPI_BASE}/api/friends/activity?limit=3`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function hydrateFriendActivity({ token, activity: prefetched } = {}) {
  const els = getFriendActivityEls();
  if (!els) return;

  let activity;
  if (prefetched) {
    activity = Array.isArray(prefetched) ? prefetched.slice(0, 3) : [];
  } else {
    let data;
    try { data = await loadFriendActivity({ token }); } catch { data = null; }
    activity = Array.isArray(data?.activity) ? data.activity.slice(0, 3) : [];
  }
  if (!activity.length) {
    els.grid.innerHTML = `
      <div class="catalog-glass p-8 rounded-xl">
        <p class="font-label uppercase tracking-widest text-xs text-primary mb-3">No activity yet</p>
        <p class="font-body text-on-surface-variant leading-relaxed">Add friends to see where they’re dining.</p>
        <a class="font-label text-sm font-bold inline-block mt-5 text-primary border-b border-primary/40 hover:border-primary transition-colors" href="friends">Find Friends →</a>
      </div>
    `.trim();
    return;
  }

  // Activity items already contain image_url, restaurant_name, slug from the server JOIN —
  // no need for a separate restaurant details fetch.
  const enriched = activity.map((item) => ({ item, details: null }));

  const cardSlots = els.cards.length ? els.cards.slice(0, 3) : [];
  // If Stitch card slots exist, hydrate them; otherwise replace grid entirely.
  if (!cardSlots.length) {
    els.grid.innerHTML = '';
  }

  enriched.forEach(({ item, details }, idx) => {
    const friendName = item?.friend_name || item?.friend_username || 'Friend';
    const restaurantName = item?.restaurant_name || 'Restaurant';
    const restaurantMeta = formatCuisineArea({ cuisine: item?.restaurant_cuisine, area: item?.restaurant_area });
    const quote = item?.review_snippet ? `"${item.review_snippet}"` : 'Visited recently.';
    const when = item?.visited_at ? timeAgoVisited(item.visited_at).replace(/^Visited /, '') : '';

    const imgUrl = safeImgSrc(item?.image_url);
    const avatarInitial = (friendName || 'F')[0]?.toUpperCase?.() || 'F';

    const slug = item?.slug || '';
    const href = slug
      ? pageUrl(`restaurant?slug=${encodeURIComponent(slug)}`)
      : pageUrl('restaurant');

    const target = cardSlots[idx];
    if (!target) {
      // Create a fresh card if we ran out of placeholders.
      const card = document.createElement('div');
      card.className = 'catalog-glass p-8 rounded-xl';
      els.grid.appendChild(card);
      cardSlots.push(card);
    }

    const cardEl = cardSlots[idx];
    cardEl.classList.add('cursor-pointer');
    cardEl.onclick = () => {
      window.location.href = href;
    };

    // Header row: avatar + name + time
    const header = cardEl.querySelector('.flex.items-center.gap-4.mb-6');
    if (header) {
      const avatarImg = header.querySelector('img');
      if (avatarImg) {
        avatarImg.style.display = 'none';
      }
      // Remove the placeholder skeleton div before inserting the real chip
      const skeletonAvatar = header.querySelector('.rounded-full.catalog-skeleton');
      if (skeletonAvatar) skeletonAvatar.remove();

      const friendProfileHref = item?.friend_id
        ? pageUrl(`profile?id=${encodeURIComponent(item.friend_id)}`)
        : null;

      let avatarChip = header.querySelector('[data-avatar-chip="1"]');
      if (!avatarChip) {
        avatarChip = document.createElement('a');
        avatarChip.setAttribute('data-avatar-chip', '1');
        avatarChip.className =
          'w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold flex-shrink-0 hover:opacity-80 transition-opacity';
        header.insertBefore(avatarChip, header.firstChild);
      }
      if (friendProfileHref) {
        avatarChip.href = friendProfileHref;
        avatarChip.addEventListener('click', (e) => e.stopPropagation());
      }
      avatarChip.textContent = avatarInitial;

      const nameEl = header.querySelector('p.font-label.font-bold');
      if (nameEl) {
        nameEl.textContent = friendName;
        if (friendProfileHref) {
          nameEl.style.cursor = 'pointer';
          nameEl.onclick = (e) => { e.stopPropagation(); window.location.href = friendProfileHref; };
        }
      }
      const timeEl = header.querySelector('p.font-label.text-xs.opacity-50');
      if (timeEl) timeEl.textContent = when || 'Recently';
    }

    // Quote
    const quoteEl = cardEl.querySelector('p.font-body.italic');
    if (quoteEl) quoteEl.textContent = quote;

    // Restaurant row
    const restRow = cardEl.querySelector('.flex.items-center.gap-4.group');
    if (restRow) {
      const restImg = restRow.querySelector('img');
      if (restImg) {
        if (imgUrl) {
          restImg.src = imgUrl;
          restImg.alt = restaurantName;
        } else {
          restImg.removeAttribute('src');
        }
      }
      const restTitle = restRow.querySelector('h4');
      if (restTitle) restTitle.textContent = restaurantName;
      const restSub = restRow.querySelector('p.font-label.text-xs.opacity-60');
      if (restSub) restSub.textContent = restaurantMeta || '';
    }
  });

  // Hide any unused Stitch placeholders
  els.cards.forEach((c, idx) => {
    c.style.display = idx < enriched.length ? '' : 'none';
  });
}

async function loadRecentVisits({ token, userId }) {
  // PORT FROM OLD PROJECT: `GET /api/users/{id}/visits/recent?limit=8`
  return fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(userId)}/visits/recent?limit=8`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function hydrateRecentlyVisited({ token, userId, visits: prefetched } = {}) {
  const els = getRecentlyVisitedEls();
  if (!els) return;

  if (els.heading) els.heading.textContent = 'Recently Visited';

  let visits;
  if (prefetched) {
    visits = prefetched;
  } else {
    try { visits = await loadRecentVisits({ token, userId }); } catch { visits = []; }
  }

  const list = Array.isArray(visits) ? visits : [];
  if (!list.length) {
    els.row.innerHTML = `
      <div class="catalog-glass p-8 rounded-xl w-full">
        <p class="font-label uppercase tracking-widest text-xs text-primary mb-3">No visits yet</p>
        <p class="font-body text-on-surface-variant leading-relaxed">Start logging restaurants to build your history.</p>
      </div>
    `.trim();
    return;
  }

  const cards = els.cards;
  const max = Math.min(cards.length, list.length);

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (i >= max) {
      card.style.display = 'none';
      continue;
    }
    card.style.display = '';

    const v = list[i];
    const slug = v?.slug || v?.restaurant_id || '';
    const href = slug
      ? pageUrl(`restaurant?slug=${encodeURIComponent(slug)}`)
      : pageUrl('restaurant');
    card.style.cursor = 'pointer';
    card.onclick = () => {
      window.location.href = href;
    };

    const img = card.querySelector('img');
    const imgUrl = safeImgSrc(v?.image_url) || safeImgSrc(v?.images?.[0]);
    if (img) {
      if (imgUrl) {
        img.src = imgUrl;
        img.alt = v?.name ? String(v.name) : img.alt;
      } else {
        img.removeAttribute('src');
      }
    }

    const title = card.querySelector('h4');
    if (title) title.textContent = v?.name || v?.slug || 'Restaurant';
    const meta = card.querySelector('p.font-label.text-xs.opacity-50');
    if (meta) meta.textContent = timeAgoVisited(v?.visited_at);

    // Remove "Rebook" overlay CTA from the Stitch template card
    const rebookOverlay = card.querySelector('div.absolute.inset-0.flex.items-center.justify-center');
    if (rebookOverlay) rebookOverlay.remove();
  }
}

async function init() {
  startProgress();
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Single request replaces 5 separate API calls — one cold start, parallel DB queries server-side.
  // Falls back to individual endpoints if home-data is unavailable (e.g. first deploy, cold error).
  let homeData = { popular: [], lists: [], activity: [], recent: [], user: null };
  try {
    homeData = await fetchJson(`${FASTAPI_BASE}/api/home-data`, { headers });
  } catch { /* fall through to per-section fallbacks below */ }

  // Popular fallback — ensures images always show even if home-data endpoint fails
  if (!homeData.popular?.length) {
    try {
      homeData.popular = await fetchJson(`${FASTAPI_BASE}/restaurants/popular?limit=12`);
    } catch { homeData.popular = []; }
  }

  const user = homeData.user || (token ? await fetchCurrentUser({ redirectOnFail: null }) : null);

  ensureAccountDropdown({ user });
  ensureViewAllLink();

  const guestSection = document.getElementById('guestSection');
  const friendActivitySection = document.getElementById('friendActivitySection');
  const recentlyVisitedSection = document.getElementById('recentlyVisitedSection');
  if (user) {
    guestSection?.classList.add('hidden');
    friendActivitySection?.classList.remove('hidden');
    recentlyVisitedSection?.classList.remove('hidden');
  } else {
    guestSection?.classList.remove('hidden');
  }

  const popularRestaurants = Array.isArray(homeData.popular) ? homeData.popular : [];
  const cuisineState = { active: 'all' };
  setupCuisinePills({
    allRestaurants: popularRestaurants,
    onChange: (cuisine) => {
      cuisineState.active = cuisine || 'all';
      renderPopularRightNow({ restaurants: popularRestaurants, cuisine: cuisineState.active });
    },
  });
  renderPopularRightNow({ restaurants: popularRestaurants, cuisine: cuisineState.active });

  setupHomeSearch();
  finishProgress();

  // Pass pre-fetched data; each function falls back to its own fetch if data is missing
  hydrateCuratedLists({ token, lists: homeData.lists?.length ? homeData.lists : null }).catch(() => {});
  hydrateJournal().catch(() => {});

  if (user?.id != null) {
    hydrateFriendActivity({ token, activity: homeData.activity?.length ? homeData.activity : null }).catch(() => {});
    hydrateRecentlyVisited({ token, userId: user.id, visits: homeData.recent?.length ? homeData.recent : null }).catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
