// Profile page (new design)
// PORT FROM OLD PROJECT: Express /profile + /api/users/:id/public + PUT /api/profile
// PORT FROM OLD PROJECT: FastAPI /api/users/{id}/stats + /visits/recent + /reviews + friendship-status

import { requireAuth, getToken, logout } from './auth.js';
import { FASTAPI_BASE, EXPRESS_BASE } from './config.js';

function cloudinaryResize(url, width = 400) {
  const str = String(url || '').trim();
  if (!str || !str.includes('res.cloudinary.com') || !str.includes('/image/upload/')) return str;
  return str.replace('/image/upload/', `/image/upload/w_${width},c_fill,q_auto,f_auto/`);
}

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
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile?id=${encodeURIComponent(
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

function getProfileId(fallbackId) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id');
  const v = raw ? Number(raw) : null;
  if (Number.isFinite(v) && v > 0) return v;
  return fallbackId;
}

function setTabsActive(tab) {
  const ids = ['been', 'saved', 'lists', 'reviews'];
  ids.forEach((id) => {
    const btn = document.querySelector(`#profileTabs button[data-tab="${id}"]`);
    const panel = document.getElementById(`panel${id[0].toUpperCase()}${id.slice(1)}`);
    const active = id === tab;
    if (btn) {
      btn.className = active
        ? 'bg-primary text-on-primary px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase transition-colors'
        : 'bg-surface-container-high text-on-surface px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors';
    }
    panel?.classList.toggle('hidden', !active);
  });
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

function renderRestaurantTile(v, { showWhen = false } = {}) {
  const slug = v?.slug || v?.restaurant_id || '';
  const href = slug ? `restaurant?slug=${encodeURIComponent(slug)}` : 'restaurant';
  const imgUrl = cloudinaryResize(v?.image_url || v?.images?.[0] || '', 400);
  const when = showWhen ? formatWhen(v?.visited_at || v?.added_at) : '';
  return `
    <a class="group block" href="${escapeHtml(href)}">
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
      <div class="mt-6">
        <h3 class="font-headline text-xl italic mb-1 truncate">${escapeHtml(v?.name || slug || 'Restaurant')}</h3>
        <p class="font-label text-sm text-on-surface-variant truncate">${escapeHtml(formatCuisineArea(v))}</p>
        ${when ? `<p class="font-label text-xs uppercase tracking-widest opacity-60 mt-3">${escapeHtml(when)}</p>` : ''}
      </div>
    </a>
  `.trim();
}

function renderSavedRow(b) {
  const slug = b?.slug || b?.restaurant_id || '';
  const href = slug ? `restaurant?slug=${encodeURIComponent(slug)}` : 'restaurant';
  const imgUrl = cloudinaryResize(b?.image_url || b?.images?.[0] || '', 400);
  const when = formatWhen(b?.added_at);
  return `
    <a class="bg-surface-container-lowest rounded-xl editorial-shadow p-7 block group" href="${escapeHtml(href)}">
      <div class="flex gap-6 items-start">
        <div class="w-28 h-28 rounded-xl overflow-hidden bg-surface-container-low flex-none">
          ${
            imgUrl
              ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="${escapeHtml(
                  b?.name || 'Restaurant'
                )}" src="${escapeHtml(imgUrl)}" loading="lazy" />`
              : `<div class="w-full h-full flex items-center justify-center font-headline italic text-5xl opacity-20">${escapeHtml(
                  (b?.name || 'R')[0]?.toUpperCase?.() || 'R'
                )}</div>`
          }
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h3 class="font-headline text-2xl italic leading-tight truncate group-hover:text-primary transition-colors">${escapeHtml(
                b?.name || slug || 'Restaurant'
              )}</h3>
              <p class="font-label text-sm text-on-surface-variant truncate mt-1">${escapeHtml(formatCuisineArea(b))}</p>
            </div>
            <span class="material-symbols-outlined text-primary flex-none" style="font-variation-settings:'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" aria-hidden="true">bookmark</span>
          </div>
          ${when ? `<p class="font-label text-[10px] uppercase tracking-widest opacity-60 mt-4">Saved ${escapeHtml(when)}</p>` : ''}
        </div>
      </div>
    </a>
  `.trim();
}

function renderListCard(l) {
  const href = `list?id=${encodeURIComponent(String(l?.id ?? ''))}`;
  const title = l?.title || 'List';
  const desc = l?.description || '';
  const count = Number(l?.item_count ?? 0) || 0;
  const pub = !!l?.is_public;
  return `
    <a class="block group" href="${escapeHtml(href)}">
      <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-8 hover:bg-surface-container-low transition-colors">
        <div class="flex items-center justify-between gap-4 mb-3">
          <h3 class="font-headline italic text-3xl truncate group-hover:text-primary transition-colors">${escapeHtml(
            title
          )}</h3>
          <span class="font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full ${
            pub ? 'bg-primary-fixed text-on-surface' : 'bg-surface-container-high text-on-surface'
          }">${pub ? 'Public' : 'Private'}</span>
        </div>
        ${desc ? `<p class="font-body text-on-surface-variant leading-relaxed line-clamp-3">${escapeHtml(desc)}</p>` : ''}
        <div class="mt-6 flex items-center justify-between">
          <div class="font-label text-xs uppercase tracking-widest opacity-60">${escapeHtml(String(count))} places</div>
          <span class="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">arrow_forward</span>
        </div>
      </div>
    </a>
  `.trim();
}

function renderUserReviewCard(r) {
  const slug = r?.slug || r?.restaurant_id || '';
  const href = slug ? `restaurant?slug=${encodeURIComponent(slug)}` : 'restaurant';
  const stars = r?.rating ? Number(r.rating) : null;
  const starsText = stars ? '★'.repeat(Math.round(stars)) + '☆'.repeat(5 - Math.round(stars)) : '';
  const when = r?.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const meta = [r?.cuisine, r?.restaurant_area].filter(Boolean).join(' • ');
  return `
    <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-7">
      <div class="flex items-start justify-between gap-6 mb-3">
        <div class="min-w-0">
          <a class="font-headline italic text-3xl hover:text-primary transition-colors truncate block" href="${escapeHtml(
            href
          )}">${escapeHtml(r?.restaurant_name || 'Restaurant')}</a>
          <div class="font-label text-xs uppercase tracking-widest opacity-60 mt-2">${escapeHtml(meta)}</div>
        </div>
        <div class="flex-none text-right">
          <div class="font-label text-xs uppercase tracking-widest opacity-60">${escapeHtml(when)}</div>
          ${starsText ? `<div class="font-label text-xs text-primary tracking-widest mt-2">${escapeHtml(starsText)}</div>` : ''}
        </div>
      </div>
      <p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(r?.content || '')}</p>
    </div>
  `.trim();
}

function openEditProfileModal({ token, user, onSaved }) {
  if (document.getElementById('editProfileModal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'editProfileModal';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/30 backdrop-blur-sm flex items-center justify-center p-6';

  overlay.innerHTML = `
    <div class="w-full max-w-xl bg-surface-container-lowest rounded-xl editorial-shadow p-8">
      <div class="flex items-start justify-between gap-6 mb-6">
        <div>
          <p class="font-label uppercase tracking-widest text-xs text-primary mb-2">Profile</p>
          <h2 class="font-headline text-3xl italic">Edit profile</h2>
        </div>
        <button type="button" id="closeEditProfile" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close">close</button>
      </div>

      <form id="editProfileForm" class="space-y-5">
        <label class="block">
          <div class="font-label text-xs uppercase tracking-widest opacity-60 mb-2">Full name</div>
          <input class="w-full bg-surface-container-lowest border-none rounded-full py-3 px-5 text-sm font-label focus:ring-1 focus:ring-primary-container outline-none editorial-shadow" id="editName" placeholder="Your full name" value="${escapeHtml(user?.name || '')}" />
          ${user?.username ? `<p class="font-label text-xs opacity-50 mt-1.5 px-1">Username: @${escapeHtml(user.username)} <span class="opacity-70">(cannot be changed)</span></p>` : ''}
        </label>
        <label class="block">
          <div class="font-label text-xs uppercase tracking-widest opacity-60 mb-2">Bio</div>
          <textarea class="w-full bg-surface-container-lowest border-none rounded-xl p-4 text-sm font-body focus:ring-1 focus:ring-primary-container outline-none editorial-shadow min-h-[120px]" id="editBio" placeholder="A few words about your taste…">${escapeHtml(
            user?.bio || ''
          )}</textarea>
        </label>

        <p class="font-label text-sm text-error hidden" id="editProfileError"></p>
        <div class="flex items-center justify-end gap-3 pt-2">
          <button type="button" class="bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" id="cancelEditProfile">Cancel</button>
          <button type="submit" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:opacity-90 active:scale-95 transition-all editorial-shadow" id="saveEditProfile">Save</button>
        </div>
      </form>
    </div>
  `.trim();

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#closeEditProfile')?.addEventListener('click', close);
  overlay.querySelector('#cancelEditProfile')?.addEventListener('click', close);

  overlay.querySelector('#editProfileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = overlay.querySelector('#editProfileError');
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    const name = overlay.querySelector('#editName')?.value ?? '';
    const bio = overlay.querySelector('#editBio')?.value ?? '';
    const btn = overlay.querySelector('#saveEditProfile');
    if (btn) btn.disabled = true;
    try {
      await fetchJson(`${EXPRESS_BASE}/api/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: { name, bio },
      });
      close();
      onSaved?.({ name, bio });
    } catch (ex) {
      if (err) {
        err.textContent = ex?.message || 'Could not update profile.';
        err.classList.remove('hidden');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function init() {
  const currentUser = await requireAuth({ redirectTo: 'login' });
  if (!currentUser) return;
  ensureAccountDropdown({ user: currentUser });

  const token = getToken();
  if (!token) return;
  const headers = { Authorization: `Bearer ${token}` };

  const profileId = getProfileId(currentUser.id);
  const isOwn = Number(profileId) === Number(currentUser.id);

  // Clean URL for own profile
  if (isOwn) {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('id')) {
      window.history.replaceState(null, '', `profile?id=${encodeURIComponent(currentUser.id)}`);
    }
  }

  const heroAvatar = document.getElementById('heroAvatar');
  const heroName = document.getElementById('heroName');
  const heroUsername = document.getElementById('heroUsername');
  const heroBio = document.getElementById('heroBio');
  const heroErr = document.getElementById('profileHeroError');
  const actionsWrap = document.getElementById('profileActions');

  const statsNote = document.getElementById('statsNote');
  const statFriends = document.getElementById('statFriends');
  const statTotal = document.getElementById('statTotal');
  const statMonth = document.getElementById('statMonth');

  let profileUser = null;
  try {
    if (isOwn) {
      profileUser = currentUser;
    } else {
      const d = await fetchJson(`${EXPRESS_BASE}/api/users/${encodeURIComponent(profileId)}/public`, { headers });
      profileUser = d?.user ?? null;
    }
  } catch (ex) {
    if (heroErr) {
      heroErr.textContent = ex?.message || 'Profile not found.';
      heroErr.classList.remove('hidden');
    }
    if (heroName) heroName.textContent = 'Profile not found';
    return;
  }

  const displayName = profileUser?.name || profileUser?.username || 'User';
  const username = profileUser?.username || '';
  const initial = (displayName || 'U')[0]?.toUpperCase?.() || 'U';
  if (heroAvatar) heroAvatar.textContent = initial;
  if (heroName) heroName.textContent = displayName;
  if (heroUsername) heroUsername.textContent = username ? `@${username}` : '';
  if (heroBio) {
    const bio = String(profileUser?.bio || '').trim();
    heroBio.textContent = bio || (isOwn ? 'No bio added.' : '');
    heroBio.classList.toggle('opacity-60', !bio);
  }

  // Actions (edit / friend)
  if (actionsWrap) {
    actionsWrap.innerHTML = '';
    if (isOwn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'bg-gradient-to-br from-primary to-primary-container text-on-primary px-7 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase editorial-shadow hover:opacity-90 active:scale-95 transition-all flex items-center gap-2';
      btn.innerHTML = `<span class="material-symbols-outlined text-sm">edit</span>Edit profile`;
      btn.addEventListener('click', () =>
        openEditProfileModal({
          token,
          user: profileUser,
          onSaved: ({ name, bio }) => {
            if (name) profileUser.name = name;
            profileUser.bio = bio;
            if (heroName && name) heroName.textContent = name;
            if (heroAvatar && name) heroAvatar.textContent = name[0]?.toUpperCase?.() || 'U';
            if (heroBio) {
              const b = String(bio || '').trim();
              heroBio.textContent = b || 'No bio yet. Add one so friends know what you crave.';
              heroBio.classList.toggle('opacity-60', !b);
            }
          },
        })
      );
      actionsWrap.appendChild(btn);
    } else {
      const rel = await fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(profileId)}/friendship-status`, {
        headers,
      }).catch(() => ({ relation: 'none', friendship_id: null }));

      const relation = rel?.relation || 'none';
      const fid = rel?.friendship_id ?? null;

      const mk = (label, icon, tone = 'soft') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          tone === 'primary'
            ? 'bg-primary text-on-primary px-7 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase editorial-shadow hover:opacity-95 transition-opacity flex items-center gap-2'
            : 'bg-surface-container-high text-on-surface px-7 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase editorial-shadow hover:bg-surface-container-highest transition-colors flex items-center gap-2';
        b.innerHTML = `<span class="material-symbols-outlined text-sm">${escapeHtml(icon)}</span>${escapeHtml(label)}`;
        return b;
      };

      if (relation === 'friends') {
        const b = mk('Friends', 'group', 'soft');
        b.disabled = true;
        actionsWrap.appendChild(b);
      } else if (relation === 'pending_sent') {
        const b = mk('Requested', 'schedule', 'soft');
        b.disabled = true;
        actionsWrap.appendChild(b);
      } else if (relation === 'pending_received') {
        const accept = mk('Accept', 'done', 'primary');
        const decline = mk('Decline', 'close', 'soft');
        accept.addEventListener('click', async () => {
          accept.disabled = true;
          try {
            await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(fid)}/accept`, { method: 'POST', headers });
            window.location.reload();
          } finally {
            accept.disabled = false;
          }
        });
        decline.addEventListener('click', async () => {
          decline.disabled = true;
          try {
            await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(fid)}/decline`, { method: 'POST', headers });
            window.location.reload();
          } finally {
            decline.disabled = false;
          }
        });
        actionsWrap.appendChild(accept);
        actionsWrap.appendChild(decline);
      } else {
        const add = mk('Add friend', 'person_add', 'primary');
        add.addEventListener('click', async () => {
          add.disabled = true;
          try {
            await fetchJson(`${FASTAPI_BASE}/api/friends/request/${encodeURIComponent(profileId)}`, { method: 'POST', headers });
            window.location.reload();
          } finally {
            add.disabled = false;
          }
        });
        actionsWrap.appendChild(add);
      }
    }
  }

  // Stats
  try {
    const s = await fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(profileId)}/stats`, { headers });
    statFriends.textContent = String(s?.friend_count ?? 0);
    statTotal.textContent = String(s?.total_visits ?? 0);
    statMonth.textContent = String(s?.month_visits ?? 0);
  } catch {
    statFriends.textContent = '—';
    statTotal.textContent = '—';
    statMonth.textContent = '—';
    if (statsNote) {
      statsNote.textContent = 'Could not load stats.';
      statsNote.classList.remove('hidden');
    }
  }

  // Tabs + search
  let activeTab = 'been';
  setTabsActive(activeTab);

  const searchInput = document.getElementById('profileSearchInput');
  let query = '';
  searchInput?.addEventListener('input', (e) => {
    query = String(e.target.value || '').trim().toLowerCase();
    renderActive();
  });

  document.getElementById('profileTabs')?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-tab]');
    if (!btn) return;
    activeTab = btn.getAttribute('data-tab');
    setTabsActive(activeTab);
    renderActive();
  });

  // Data loads
  let been = [];
  let saved = [];
  let lists = [];
  let reviews = [];

  const loadBeen = async () => {
    been = await fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(profileId)}/visits/recent?limit=1000`, { headers }).catch(
      () => []
    );
    if (!Array.isArray(been)) been = [];
  };

  const loadSaved = async () => {
    if (!isOwn) return;
    const d = await fetchJson(`${FASTAPI_BASE}/api/users/bookmarks`, { headers }).catch(() => ({ bookmarks: [] }));
    saved = Array.isArray(d?.bookmarks) ? d.bookmarks : [];
  };

  const loadLists = async () => {
    if (!isOwn) return;
    const d = await fetchJson(`${FASTAPI_BASE}/api/lists`, { headers }).catch(() => ({ lists: [] }));
    lists = Array.isArray(d?.lists) ? d.lists : [];
  };

  const loadReviews = async () => {
    reviews = await fetchJson(`${FASTAPI_BASE}/api/users/${encodeURIComponent(profileId)}/reviews?limit=20`, { headers }).catch(
      () => []
    );
    if (!Array.isArray(reviews)) reviews = [];
  };

  await Promise.all([loadBeen(), loadSaved(), loadLists(), loadReviews()]);

  // Lock panels if needed
  if (!isOwn) {
    document.getElementById('profileSavedGrid')?.classList.add('hidden');
    document.getElementById('profileSavedLocked')?.classList.remove('hidden');
    document.getElementById('profileListsGrid')?.classList.add('hidden');
    document.getElementById('profileListsLocked')?.classList.remove('hidden');
  }

  function filterList(list, fields) {
    if (!query) return list;
    return list.filter((item) => {
      return fields.some((f) => String(item?.[f] || '').toLowerCase().includes(query));
    });
  }

  function renderActive() {
    if (activeTab === 'been') {
      const grid = document.getElementById('profileBeenGrid');
      const empty = document.getElementById('profileBeenEmpty');
      const list = filterList(been, ['name', 'cuisine', 'area', 'slug']);
      if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        grid.innerHTML = list.map((v) => renderRestaurantTile(v, { showWhen: true })).join('\n');
      }
    }

    if (activeTab === 'saved') {
      if (!isOwn) return;
      const grid = document.getElementById('profileSavedGrid');
      const empty = document.getElementById('profileSavedEmpty');
      const list = filterList(saved, ['name', 'cuisine', 'area', 'restaurant_id']);
      if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        grid.innerHTML = list.map(renderSavedRow).join('\n');
      }
    }

    if (activeTab === 'lists') {
      if (!isOwn) return;
      const grid = document.getElementById('profileListsGrid');
      const empty = document.getElementById('profileListsEmpty');
      const list = filterList(lists, ['title', 'description']);
      if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        grid.innerHTML = list.map(renderListCard).join('\n');
      }
    }

    if (activeTab === 'reviews') {
      const listEl = document.getElementById('profileReviewsList');
      const empty = document.getElementById('profileReviewsEmpty');
      const list = filterList(reviews, ['restaurant_name', 'content', 'cuisine', 'restaurant_area', 'restaurant_id']);
      if (!list.length) {
        listEl.innerHTML = '';
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        listEl.innerHTML = list.map(renderUserReviewCard).join('\n');
      }
    }
  }

  renderActive();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

