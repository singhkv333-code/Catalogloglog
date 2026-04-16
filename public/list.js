// List detail controller (new design)
// PORT FROM OLD PROJECT: list detail + list item add/remove + list like/unlike.

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
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(initial)}</div>
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

function getListId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || '';
}

function normalizeCount(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return v;
}

function renderItemCard(item, { isOwner } = {}) {
  const slug = item?.slug || '';
  const name = item?.name || 'Restaurant';
  const meta = [item?.cuisine, item?.area].filter(Boolean).join(' • ');
  const imgUrl = item?.image_url || (Array.isArray(item?.images) ? item.images[0] : '');
  const href = slug ? `restaurant.html?slug=${encodeURIComponent(slug)}` : 'restaurant.html';

  const removeBtn = isOwner
    ? `<button class="absolute top-4 left-4 bg-surface/90 backdrop-blur px-3 py-1 rounded-full font-label tracking-widest font-bold text-[10px] hover:bg-surface-container-lowest transition-colors" type="button" data-action="remove-item" data-item-id="${escapeHtml(
        String(item?.id ?? '')
      )}" title="Remove">Remove</button>`
    : '';

  return `
    <a class="group block" href="${href}">
      <div class="relative aspect-[4/5] rounded-xl overflow-hidden bg-surface-container-lowest editorial-shadow">
        ${imgUrl ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="${escapeHtml(name)}" src="${escapeHtml(imgUrl)}" />` : ''}
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        ${removeBtn}
      </div>
      <div class="mt-5">
        <div class="font-headline italic text-2xl leading-tight">${escapeHtml(name)}</div>
        <div class="font-label text-sm text-on-surface-variant mt-1">${escapeHtml(meta)}</div>
      </div>
    </a>
  `.trim();
}

function renderItemCardSkeleton() {
  return `
    <div class="group block" aria-hidden="true">
      <div class="relative aspect-[4/5] rounded-xl overflow-hidden bg-surface-container-lowest editorial-shadow">
        <div class="absolute inset-0 catalog-skeleton"></div>
      </div>
      <div class="mt-5">
        <div class="h-7 w-3/4 rounded catalog-skeleton"></div>
        <div class="h-4 w-1/2 rounded catalog-skeleton mt-3"></div>
      </div>
    </div>
  `.trim();
}

function renderItemsSkeletonGrid(count = 6) {
  const n = Math.max(4, Math.min(12, Number(count || 6)));
  return new Array(n).fill(0).map(() => renderItemCardSkeleton()).join('\n');
}

function openEditListModal({ list, onSave }) {
  if (document.getElementById('editListModal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'editListModal';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/30 backdrop-blur-sm flex items-center justify-center p-6';

  overlay.innerHTML = `
    <div class="w-full max-w-xl bg-surface-container-lowest rounded-xl editorial-shadow p-8">
      <div class="flex items-start justify-between gap-6 mb-6">
        <div>
          <p class="font-label uppercase tracking-widest text-xs text-primary mb-2">Edit list</p>
          <h2 class="font-headline text-3xl italic">Update details</h2>
        </div>
        <button type="button" id="closeEditList" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close">close</button>
      </div>

      <form id="editListForm" class="space-y-5">
        <div>
          <label class="block font-label text-sm font-bold mb-2" for="editListTitle">Title</label>
          <input id="editListTitle" class="w-full bg-surface-container-lowest py-4 px-5 rounded-full editorial-shadow focus:ring-2 focus:ring-primary-container outline-none text-base font-body" value="${escapeHtml(list?.title || '')}" required />
        </div>
        <div>
          <label class="block font-label text-sm font-bold mb-2" for="editListDesc">Description</label>
          <textarea id="editListDesc" rows="3" class="w-full bg-surface-container-lowest py-4 px-5 rounded-xl editorial-shadow focus:ring-2 focus:ring-primary-container outline-none text-base font-body" placeholder="Optional">${escapeHtml(list?.description || '')}</textarea>
        </div>

        <label class="flex items-center justify-between gap-4 bg-surface-container-low p-4 rounded-xl">
          <div>
            <div class="font-label text-sm font-bold">Public</div>
            <div class="font-label text-xs opacity-60 mt-1">Public lists show up in Discover.</div>
          </div>
          <input id="editListPublic" type="checkbox" class="rounded" ${list?.is_public ? 'checked' : ''} />
        </label>

        <p class="font-label text-sm text-error hidden" id="editListError"></p>

        <div class="flex gap-3 justify-end pt-2">
          <button type="button" class="bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" id="cancelEditList">Cancel</button>
          <button type="submit" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:opacity-90 active:scale-95 transition-all editorial-shadow">Save</button>
        </div>
      </form>
    </div>
  `.trim();

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#closeEditList')?.addEventListener('click', close);
  overlay.querySelector('#cancelEditList')?.addEventListener('click', close);

  overlay.querySelector('#editListForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = overlay.querySelector('#editListTitle')?.value?.trim() || '';
    const description = overlay.querySelector('#editListDesc')?.value?.trim() || '';
    const isPublic = !!overlay.querySelector('#editListPublic')?.checked;
    const err = overlay.querySelector('#editListError');
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
    try {
      await onSave({ title, description: description || null, is_public: isPublic });
      close();
    } catch (ex) {
      if (err) { err.textContent = ex?.message || 'Failed to save.'; err.classList.remove('hidden'); }
    }
  });
}

function openAddRestaurantModal({ token, listId, onAdded }) {
  if (document.getElementById('addRestaurantModal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'addRestaurantModal';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/30 backdrop-blur-sm flex items-center justify-center p-6';

  overlay.innerHTML = `
    <div class="w-full max-w-2xl bg-surface-container-lowest rounded-xl editorial-shadow p-8">
      <div class="flex items-start justify-between gap-6 mb-6">
        <div>
          <p class="font-label uppercase tracking-widest text-xs text-primary mb-2">Search</p>
          <h2 class="font-headline text-3xl italic">Add restaurants</h2>
        </div>
        <button type="button" id="closeAddRestaurant" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close">close</button>
      </div>

      <div class="relative mb-4">
        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
        <input id="addRestaurantSearch" class="w-full bg-surface-container-lowest border-none rounded-full py-3 pl-12 pr-6 text-sm font-label focus:ring-1 focus:ring-primary-container outline-none transition-all editorial-shadow" placeholder="Search restaurants…" type="text" />
      </div>

      <div id="addRestaurantResults" class="space-y-3 max-h-[420px] overflow-auto pr-1">
        <div class="font-label text-sm opacity-60">Type to search.</div>
      </div>
      <p class="font-label text-sm text-error hidden mt-4" id="addRestaurantError"></p>
    </div>
  `.trim();

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#closeAddRestaurant')?.addEventListener('click', close);

  const input = overlay.querySelector('#addRestaurantSearch');
  const results = overlay.querySelector('#addRestaurantResults');
  const errorEl = overlay.querySelector('#addRestaurantError');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = `<div class="font-label text-sm opacity-60">Type to search.</div>`;
      return;
    }
    timeout = setTimeout(async () => {
      results.innerHTML = `<div class="font-label text-sm opacity-60">Searching…</div>`;
      if (errorEl) errorEl.classList.add('hidden');
      try {
        const list = await fetch(`${FASTAPI_BASE}/restaurants?search=${encodeURIComponent(q)}`).then((r) => r.json());
        const items = Array.isArray(list) ? list.slice(0, 12) : [];
        if (!items.length) {
          results.innerHTML = `<div class="font-label text-sm opacity-60">No results.</div>`;
          return;
        }

        results.innerHTML = items
          .map((r) => {
            const id = String(r?.id || '');
            const name = r?.name || 'Restaurant';
            const meta = [r?.cuisine, r?.area].filter(Boolean).join(' • ');
            const img = r?.image_url || '';
            return `
              <button type="button" class="w-full text-left flex items-center gap-4 p-4 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors" data-action="add" data-id="${escapeHtml(id)}">
                <div class="w-14 h-14 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0">
                  ${img ? `<img class="w-full h-full object-cover" src="${escapeHtml(img)}" alt="${escapeHtml(name)}" />` : ''}
                </div>
                <div class="min-w-0">
                  <div class="font-label font-bold text-sm truncate">${escapeHtml(name)}</div>
                  <div class="font-label text-xs opacity-60 truncate">${escapeHtml(meta)}</div>
                </div>
                <span class="material-symbols-outlined ml-auto text-on-surface-variant">add</span>
              </button>
            `.trim();
          })
          .join('\n');
      } catch (ex) {
        results.innerHTML = `<div class="font-label text-sm text-error">Search failed.</div>`;
      }
    }, 250);
  });

  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="add"][data-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    btn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/items`, {
        method: 'POST',
        headers,
        body: { restaurant_id: id, notes: null },
      });
      onAdded?.();
    } catch (ex) {
      if (errorEl) {
        errorEl.textContent = ex?.message || 'Failed to add.';
        errorEl.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  });
}

async function init() {
  const user = await requireAuth({ redirectTo: 'login.html' });
  if (!user) return;
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;

  const listId = getListId();
  if (!listId) {
    document.getElementById('listTitle').textContent = 'List not found';
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  const els = {
    eyebrow: document.getElementById('listEyebrow'),
    title: document.getElementById('listTitle'),
    desc: document.getElementById('listDesc'),
    owner: document.getElementById('listOwner'),
    count: document.getElementById('listCount'),
    privacySep: document.getElementById('listPrivacySep'),
    privacy: document.getElementById('listPrivacy'),
    items: document.getElementById('itemsGrid'),
    likeBtn: document.getElementById('likeListBtn'),
    likeIcon: document.getElementById('likeIcon'),
    likeCount: document.getElementById('likeCount'),
    addBtn: document.getElementById('addRestaurantBtn'),
    editBtn: document.getElementById('editListBtn'),
    deleteBtn: document.getElementById('deleteListBtn'),
  };

  let listData = null;

  async function load() {
    els.items.innerHTML = renderItemsSkeletonGrid(6);
    const data = await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}`, { headers });
    listData = data;

    document.title = `${data?.title || 'List'} — Catalog`;

    els.title.textContent = data?.title || 'Untitled';
    els.desc.textContent = data?.description || '';
    els.owner.textContent = `@${data?.owner_username || 'unknown'}`;

    const itemCount = normalizeCount(data?.items?.length || data?.item_count || 0);
    els.count.textContent = `${itemCount} place${itemCount === 1 ? '' : 's'}`;

    if (data?.is_owner) {
      els.privacy.style.display = '';
      els.privacySep.style.display = '';
      els.privacy.textContent = data?.is_public ? 'Public' : 'Private';
      els.addBtn.style.display = '';
      els.editBtn.style.display = '';
      els.deleteBtn.style.display = '';
    } else {
      els.privacy.style.display = 'none';
      els.privacySep.style.display = 'none';
      els.addBtn.style.display = 'none';
      els.editBtn.style.display = 'none';
      els.deleteBtn.style.display = 'none';
    }

    // Like button for non-owner public lists
    const likedByUser = !!data?.liked_by_user;
    const likesCount = normalizeCount(data?.likes_count || 0);
    if (!data?.is_owner && data?.is_public) {
      els.likeBtn.style.display = '';
      els.likeCount.textContent = String(likesCount);
      els.likeIcon.style.fontVariationSettings = `'FILL' ${likedByUser ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;
      els.likeBtn.dataset.liked = likedByUser ? '1' : '0';
    } else {
      els.likeBtn.style.display = 'none';
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      els.items.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-8 sm:col-span-2 lg:col-span-3">
          <p class="font-label uppercase tracking-widest text-xs text-primary mb-3">Empty list</p>
          <p class="font-body text-on-surface-variant">Add restaurants to start building this collection.</p>
        </div>
      `.trim();
      return;
    }

    els.items.innerHTML = items.map((it) => renderItemCard(it, { isOwner: !!data?.is_owner })).join('\n');
  }

  els.addBtn.addEventListener('click', () => {
    if (!listData?.is_owner) return;
    openAddRestaurantModal({
      token,
      listId,
      onAdded: () => load(),
    });
  });

  els.items.addEventListener('click', async (e) => {
    const remove = e.target.closest('[data-action="remove-item"][data-item-id]');
    if (!remove) return;
    e.preventDefault();
    e.stopPropagation();
    if (!listData?.is_owner) return;

    const itemId = remove.getAttribute('data-item-id');
    if (!itemId) return;

    remove.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers,
      });
      await load();
    } catch {
      remove.disabled = false;
    }
  });

  els.likeBtn.addEventListener('click', async () => {
    if (els.likeBtn.style.display === 'none') return;
    const liked = els.likeBtn.dataset.liked === '1';
    els.likeBtn.disabled = true;
    try {
      const resp = await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/like`, {
        method: liked ? 'DELETE' : 'POST',
        headers,
      });
      els.likeBtn.dataset.liked = resp?.liked ? '1' : '0';
      els.likeCount.textContent = String(normalizeCount(resp?.likes_count || 0));
      els.likeIcon.style.fontVariationSettings = `'FILL' ${resp?.liked ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;
    } catch {
      // ignore
    } finally {
      els.likeBtn.disabled = false;
    }
  });

  els.deleteBtn.addEventListener('click', async () => {
    if (!listData?.is_owner) return;
    if (!confirm('Delete this list? This cannot be undone.')) return;
    els.deleteBtn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}`, {
        method: 'DELETE',
        headers,
      });
      window.location.href = 'lists.html';
    } catch {
      els.deleteBtn.disabled = false;
    }
  });

  els.editBtn.addEventListener('click', () => {
    if (!listData?.is_owner) return;
    openEditListModal({
      list: listData,
      onSave: async (payload) => {
        await fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: payload,
        });
        await load();
      },
    });
  });

  await load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
