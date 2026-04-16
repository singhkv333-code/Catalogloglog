// Lists page controller (new design)
// PORT FROM OLD PROJECT: uses FastAPI list endpoints and the same JWT token in `localStorage.token`.

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

function safeImgSrc(url) {
  const str = String(url || '').trim();
  return str || null;
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
  accountBtn.style.visibility = 'visible';

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
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(initial)}</div>
      <div class="min-w-0">
        <div class="font-label font-bold text-sm truncate">${escapeHtml(user?.username || 'User')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(user?.email || '')}</div>
      </div>
    </div>
    <div class="h-px w-full bg-on-surface/10 my-4"></div>
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile??id=${encodeURIComponent(
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
  menu.querySelector('#navLogoutBtn')?.addEventListener('click', () => logout('login'));
}

function setToggleActive(activeView) {
  const discover = document.getElementById('discoverTab');
  const mine = document.getElementById('mineTab');
  if (!discover || !mine) return;

  const activeBtn = activeView === 'mine' ? mine : discover;
  const inactiveBtn = activeView === 'mine' ? discover : mine;

  activeBtn.className = 'font-label text-sm font-bold tracking-tight text-primary relative';
  inactiveBtn.className =
    'font-label text-sm font-bold tracking-tight text-on-surface-variant opacity-60 hover:opacity-100 transition-opacity';

  // underline indicator lives only in the Discover template; ensure it exists on active
  const underline = activeBtn.querySelector('div');
  if (!underline) {
    const u = document.createElement('div');
    u.className = 'absolute -bottom-[18px] left-0 right-0 h-0.5 bg-primary';
    activeBtn.appendChild(u);
  }
  inactiveBtn.querySelector('div')?.remove();
}

function extractCoverImages(list) {
  const cover = Array.isArray(list?.cover_images) ? list.cover_images.filter(Boolean) : [];
  if (cover.length) return cover.slice(0, 3);
  const previews = Array.isArray(list?.preview_restaurants) ? list.preview_restaurants : [];
  const imgs = previews.map((r) => r?.image_url).filter(Boolean);
  return imgs.slice(0, 3);
}

function renderListCard(list, { view = 'discover' } = {}) {
  const id = list?.id ?? '';
  const title = list?.title || 'Untitled List';
  const itemCount = Number(list?.item_count ?? 0);
  const owner = list?.owner_username || list?.ownerUsername || (view === 'mine' ? 'You' : 'Unknown');
  const isPublic = view === 'discover' ? true : !!list?.is_public;

  const imgs = extractCoverImages(list);
  // Fill missing slots with earlier images so the front card is never blank
  const img1 = safeImgSrc(imgs[0]);
  const img2 = safeImgSrc(imgs[1] ?? imgs[0]);
  const img3 = safeImgSrc(imgs[2] ?? imgs[1] ?? imgs[0]);

  const icon = isPublic ? 'public' : 'lock';
  const badge = `${Number.isFinite(itemCount) ? itemCount : 0} SPOTS`;

  const ownerInitial = (String(owner || 'U')[0] || 'U').toUpperCase();

  const saveCount = Number(list?.likes_count ?? 0);
  const saved = !!list?.liked_by_user;

  // Keep the exact visual pattern from `newlists?` (stack + card), but add a small save button for Discover.
  const saveBtnHtml =
    view === 'discover'
      ? `
      <button
        class="absolute top-4 left-4 bg-surface/90 backdrop-blur px-3 py-1 rounded-full font-label tracking-widest font-bold text-[10px] flex items-center gap-2 hover:bg-surface-container-lowest transition-colors"
        type="button"
        data-action="toggle-save"
        data-id="${escapeHtml(id)}"
        aria-label="Save list"
        title="Save list"
      >
        <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' ${saved ? 1 : 0}">bookmark</span>
        <span>${escapeHtml(String(saveCount))}</span>
      </button>`
      : '';

  const noImgFallback = `<div class="w-full h-full flex items-center justify-center bg-surface-container-high"><span class="material-symbols-outlined text-4xl opacity-20">restaurant</span></div>`;

  const coverHtml = `
    <div class="relative h-[400px] mb-8 flex items-center justify-center">
      <div class="absolute inset-0 bg-surface-container-high rounded-xl stack-image-1 overflow-hidden opacity-40">
        ${img1 ? `<img alt="" class="w-full h-full object-cover grayscale" src="${escapeHtml(img1)}"/>` : noImgFallback}
      </div>
      <div class="absolute inset-0 bg-surface-container-high rounded-xl stack-image-2 overflow-hidden opacity-70">
        ${img2 ? `<img alt="" class="w-full h-full object-cover" src="${escapeHtml(img2)}"/>` : noImgFallback}
      </div>
      <div class="relative z-10 w-full h-full bg-surface-container-lowest rounded-xl overflow-hidden editorial-shadow transition-transform group-hover:-translate-y-2">
        ${img3 ? `<img alt="" class="w-full h-full object-cover" src="${escapeHtml(img3)}"/>` : noImgFallback}
        <div class="absolute top-4 right-4 bg-on-surface/90 text-surface text-[10px] px-3 py-1 rounded-full font-label tracking-widest font-bold backdrop-blur-md">${escapeHtml(
          badge
        )}</div>
        ${saveBtnHtml}
      </div>
    </div>
  `.trim();

  const metaHtml = `
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h3 class="font-headline italic text-2xl text-on-surface">${escapeHtml(title)}</h3>
        <span class="material-symbols-outlined text-on-surface-variant text-lg" data-icon="${escapeHtml(
          icon
        )}">${escapeHtml(icon)}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-5 h-5 rounded-full overflow-hidden bg-surface-container-high flex items-center justify-center font-label text-[10px] font-bold text-on-surface-variant">
          ${escapeHtml(ownerInitial)}
        </div>
        <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-bold">@${escapeHtml(
          owner
        )}</span>
      </div>
    </div>
  `.trim();

  return `
    <div class="group cursor-pointer" data-id="${escapeHtml(id)}" data-action="open">
      ${coverHtml}
      ${metaHtml}
    </div>
  `.trim();
}

function renderListCardSkeleton() {
  return `
    <div class="group" aria-hidden="true">
      <div class="relative h-[400px] mb-8 flex items-center justify-center">
        <div class="absolute inset-0 rounded-xl stack-image-1 overflow-hidden opacity-40 catalog-skeleton"></div>
        <div class="absolute inset-0 rounded-xl stack-image-2 overflow-hidden opacity-70 catalog-skeleton"></div>
        <div class="relative z-10 w-full h-full rounded-xl editorial-shadow catalog-skeleton"></div>
      </div>
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-4">
          <div class="h-7 w-2/3 rounded catalog-skeleton"></div>
          <div class="w-6 h-6 rounded-full catalog-skeleton"></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 rounded-full catalog-skeleton"></div>
          <div class="h-4 w-1/2 rounded catalog-skeleton"></div>
        </div>
      </div>
    </div>
  `.trim();
}

function renderListsSkeletonGrid(count = 6) {
  const n = Math.max(3, Math.min(12, Number(count || 6)));
  return new Array(n).fill(0).map(() => renderListCardSkeleton()).join('\n');
}

async function loadLists({ token }) {
  // PORT FROM OLD PROJECT
  const headers = { Authorization: `Bearer ${token}` };
  const [mine, pub] = await Promise.all([
    fetchJson(`${FASTAPI_BASE}/api/lists`, { headers }),
    fetchJson(`${FASTAPI_BASE}/api/public-lists?limit=100`, { headers }),
  ]);
  return {
    mine: Array.isArray(mine?.lists) ? mine.lists : [],
    pub: Array.isArray(pub?.lists) ? pub.lists : [],
  };
}

async function enrichMyListsWithCovers({ token, lists }) {
  // My lists endpoint currently returns `cover_images: []`.
  // PORT FROM OLD PROJECT: list detail returns items with restaurant `image_url`.
  const headers = { Authorization: `Bearer ${token}` };

  const enriched = await Promise.all(
    (lists || []).map(async (l) => {
      if (Array.isArray(l?.cover_images) && l.cover_images.length) return l;
      try {
        const detail = await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(l.id)}`, { headers });
        const items = Array.isArray(detail?.items) ? detail.items : [];
        const imgs = items.map((it) => it?.image_url).filter(Boolean).slice(0, 3);
        return { ...l, cover_images: imgs };
      } catch {
        return l;
      }
    })
  );
  return enriched;
}

function openCreateListModal({ onCreate }) {
  if (document.getElementById('createListModal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'createListModal';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/30 backdrop-blur-sm flex items-center justify-center p-6';

  overlay.innerHTML = `
    <div class="w-full max-w-xl bg-surface-container-lowest rounded-xl editorial-shadow p-8">
      <div class="flex items-start justify-between gap-6 mb-6">
        <div>
          <p class="font-label uppercase tracking-widest text-xs text-primary mb-2">New list</p>
          <h2 class="font-headline text-3xl italic">Create a list</h2>
        </div>
        <button type="button" id="closeCreateList" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close">close</button>
      </div>

      <form id="createListForm" class="space-y-5">
        <div>
          <label class="block font-label text-sm font-bold mb-2" for="listTitle">Title</label>
          <input id="listTitle" class="w-full bg-surface-container-lowest py-4 px-5 rounded-full editorial-shadow focus:ring-2 focus:ring-primary-container outline-none text-base font-body" placeholder="e.g., Late Night Bites" required />
        </div>
        <div>
          <label class="block font-label text-sm font-bold mb-2" for="listDesc">Description</label>
          <textarea id="listDesc" rows="3" class="w-full bg-surface-container-lowest py-4 px-5 rounded-xl editorial-shadow focus:ring-2 focus:ring-primary-container outline-none text-base font-body" placeholder="Optional"></textarea>
        </div>

        <label class="flex items-center justify-between gap-4 bg-surface-container-low p-4 rounded-xl">
          <div>
            <div class="font-label text-sm font-bold">Public</div>
            <div class="font-label text-xs opacity-60 mt-1">Public lists show up in Discover.</div>
          </div>
          <input id="listPublic" type="checkbox" class="rounded" />
        </label>

        <p class="font-label text-sm text-error hidden" id="createListError"></p>

        <div class="flex gap-3 justify-end pt-2">
          <button type="button" class="bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" id="cancelCreateList">Cancel</button>
          <button type="submit" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:opacity-90 active:scale-95 transition-all editorial-shadow" id="submitCreateList">Create</button>
        </div>
      </form>
    </div>
  `.trim();

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#closeCreateList')?.addEventListener('click', close);
  overlay.querySelector('#cancelCreateList')?.addEventListener('click', close);

  overlay.querySelector('#createListForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = overlay.querySelector('#listTitle')?.value?.trim() || '';
    const description = overlay.querySelector('#listDesc')?.value?.trim() || '';
    const isPublic = !!overlay.querySelector('#listPublic')?.checked;
    const err = overlay.querySelector('#createListError');
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    try {
      const created = await onCreate({ title, description: description || null, is_public: isPublic });
      close();
      if (created?.id != null) {
        window.location.href = `list??id=${encodeURIComponent(created.id)}`;
      }
    } catch (ex) {
      if (err) {
        err.textContent = ex?.message || 'Failed to create list.';
        err.classList.remove('hidden');
      }
    }
  });
}

async function toggleSave({ token, listId, liked }) {
  // PORT FROM OLD PROJECT: POST/DELETE /api/lists/{id}/like
  const method = liked ? 'DELETE' : 'POST';
  const headers = { Authorization: `Bearer ${token}` };
  return fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/like`, { method, headers });
}

async function init() {
  const user = await requireAuth({ redirectTo: 'login' });
  if (!user) return;
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;

  const grid = document.getElementById('listsGrid');
  const searchInput = document.getElementById('listSearchInput');
  const toggle = document.getElementById('listsToggle');
  const createBtn = document.getElementById('createListBtn');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (loadMoreWrap) loadMoreWrap.style.display = 'none';

  let activeView = 'discover';
  let search = '';
  let myLists = [];
  let publicLists = [];

  function currentSource() {
    const source = activeView === 'mine' ? myLists : publicLists;
    if (!search) return source;
    const q = search.toLowerCase();
    return source.filter((l) => {
      const t = String(l?.title || '').toLowerCase();
      const d = String(l?.description || '').toLowerCase();
      const o = String(l?.owner_username || '').toLowerCase();
      return t.includes(q) || d.includes(q) || o.includes(q);
    });
  }

  function render() {
    if (!grid) return;
    const data = currentSource();

    if (!data.length) {
      grid.innerHTML = `
        <div class="group border-2 border-dashed border-surface-container-high rounded-xl h-[400px] flex flex-col items-center justify-center p-12 text-center lg:mt-12 md:col-span-2 lg:col-span-3">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-4" data-icon="auto_awesome">auto_awesome</span>
          <h3 class="font-headline italic text-xl text-on-surface-variant/60 mb-2">Build your own journey</h3>
          <p class="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/50 leading-relaxed mb-6">Create a private list to keep track of your favorites or share your taste with the world.</p>
          <button class="font-label text-xs font-bold tracking-widest uppercase text-primary border-b border-primary/30 pb-1 hover:border-primary transition-all" id="emptyCreateBtn" type="button">Start a new list</button>
        </div>
      `.trim();

      grid.querySelector('#emptyCreateBtn')?.addEventListener('click', () => {
        openCreateListModal({
          onCreate: async (payload) => {
            const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
            const res = await fetchJson(`${FASTAPI_BASE}/api/lists`, { method: 'POST', headers, body: payload });
            return res?.list;
          },
        });
      });
      return;
    }

    grid.innerHTML = data
      .slice(0, 30)
      .map((l) => renderListCard(l, { view: activeView }))
      .join('\n');
  }

  async function refresh() {
    grid.innerHTML = renderListsSkeletonGrid(6);
    const loaded = await loadLists({ token });
    publicLists = loaded.pub;
    myLists = await enrichMyListsWithCovers({ token, lists: loaded.mine });
    render();
  }

  setToggleActive(activeView);
  toggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    activeView = btn.dataset.view === 'mine' ? 'mine' : 'discover';
    setToggleActive(activeView);
    render();
  });

  searchInput?.addEventListener('input', () => {
    search = searchInput.value.trim();
    render();
  });

  createBtn?.addEventListener('click', () => {
    openCreateListModal({
      onCreate: async (payload) => {
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const res = await fetchJson(`${FASTAPI_BASE}/api/lists`, { method: 'POST', headers, body: payload });
        return res?.list;
      },
    });
  });

  grid?.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-action="toggle-save"]');
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      const listId = saveBtn.getAttribute('data-id');
      if (!listId) return;
      const target = publicLists.find((l) => String(l.id) === String(listId));
      if (!target) return;
      try {
        const resp = await toggleSave({ token, listId, liked: !!target.liked_by_user });
        target.liked_by_user = !!resp?.liked;
        target.likes_count = Number(resp?.likes_count ?? target.likes_count ?? 0);
        render();
      } catch {
        // ignore for now (no toast system yet in new rebuild)
      }
      return;
    }

    const card = e.target.closest('[data-action="open"][data-id]');
    if (!card) return;
    const id = card.getAttribute('data-id');
    if (!id) return;
    window.location.href = `list??id=${encodeURIComponent(id)}`;
  });

  await refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
