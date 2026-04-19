// Friends page (new design, revamped)
// PORT FROM OLD PROJECT: FastAPI friends + user search endpoints.
// Endpoints used:
// - GET  /api/friends
// - GET  /api/friends/requests
// - POST /api/friends/request/{addressee_id}
// - POST /api/friends/{friendship_id}/accept
// - POST /api/friends/{friendship_id}/decline
// - DELETE /api/friends/{friendship_id}
// - GET  /api/friends/activity?limit=...
// - GET  /api/users/search?q=...

import { requireAuth, getToken, logout } from './auth.js';
import { FASTAPI_BASE } from './config.js';

function cloudinaryResize(url, width = 400) {
  const str = String(url || '').trim();
  if (!str || !str.includes('res.cloudinary.com') || !str.includes('/image/upload/')) return str;
  return str.replace('/image/upload/', `/image/upload/w_${width * 2 > 1200 ? 1200 : width * 2},c_limit,q_auto:best,f_auto/`);
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

function timeAgo(value) {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const s = Math.max(0, Math.floor(diff / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 60) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function setTabActive(tab) {
  const friends = document.getElementById('tabFriends');
  const req = document.getElementById('tabRequests');
  const mk = (btn, on) => {
    if (!btn) return;
    btn.className = on
      ? 'bg-primary text-on-primary px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase transition-colors'
      : 'bg-surface-container-high text-on-surface px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors';
  };
  mk(friends, tab === 'friends');
  mk(req, tab === 'requests');
}

function renderPersonRow({
  title,
  subtitle,
  rightHtml = '',
  href = '#',
  initial = 'U',
  accent = false,
  dataAttrs = {},
} = {}) {
  const attrs = Object.entries(dataAttrs)
    .map(([k, v]) => `data-${escapeHtml(k)}="${escapeHtml(String(v))}"`)
    .join(' ');

  return `
    <div class="bg-surface-container-lowest rounded-xl p-5 editorial-shadow flex items-center justify-between gap-4" ${attrs}>
      <a class="flex items-center gap-4 min-w-0 flex-1" href="${escapeHtml(href)}">
        <div class="w-11 h-11 rounded-full flex items-center justify-center font-label text-sm font-bold flex-none ${
          accent ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface'
        }">${escapeHtml(initial)}</div>
        <div class="min-w-0">
          <div class="font-label text-sm font-bold truncate">${escapeHtml(title || 'User')}</div>
          ${subtitle ? `<div class="font-label text-xs opacity-60 truncate">${escapeHtml(subtitle)}</div>` : ''}
        </div>
      </a>
      <div class="flex items-center gap-2 flex-none">
        ${rightHtml || ''}
      </div>
    </div>
  `.trim();
}

function relationBadge(rel) {
  if (rel === 'friends')
    return `<span class="font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-surface-container-high text-on-surface">Friends</span>`;
  if (rel === 'pending_sent')
    return `<span class="font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-secondary-container text-on-surface">Pending</span>`;
  return '';
}

function actionButton({ label, action, tone = 'primary', icon = null } = {}) {
  const base =
    'px-4 py-2 rounded-full font-label text-[10px] font-bold tracking-widest uppercase transition-colors inline-flex items-center gap-2';
  const styles =
    tone === 'primary'
      ? 'bg-primary text-on-primary hover:opacity-95'
      : tone === 'soft'
        ? 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
        : 'bg-rose-100 text-rose-900 hover:bg-rose-200';
  return `
    <button class="${base} ${styles}" type="button" data-action="${escapeHtml(action || '')}">
      ${icon ? `<span class="material-symbols-outlined text-sm">${escapeHtml(icon)}</span>` : ''}
      ${escapeHtml(label || 'Action')}
    </button>
  `.trim();
}

function renderActivityCard(a) {
  const friendName = a?.friend_name || a?.friend_username || 'Friend';
  const friendId = a?.friend_id ?? '';
  const restSlug = a?.restaurant_id || '';
  const restName = a?.restaurant_name || restSlug || 'Restaurant';
  const meta = [a?.restaurant_cuisine, a?.restaurant_area].filter(Boolean).join(' • ');
  const imgUrl = cloudinaryResize(a?.image_url || '', 400);
  const stars = Number(a?.stars ?? 0) || 0;
  const starsText = stars ? '★'.repeat(Math.round(stars)) + '☆'.repeat(5 - Math.round(stars)) : '';

  const friendHref = `profile?id=${encodeURIComponent(friendId)}`;
  const restHref = `restaurant?slug=${encodeURIComponent(restSlug)}`;

  return `
    <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-7">
      <div class="flex items-center justify-between gap-6 mb-5">
        <a class="flex items-center gap-4 min-w-0" href="${escapeHtml(friendHref)}">
          <div class="w-11 h-11 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold flex-none">${escapeHtml(
            (friendName || 'F')[0]?.toUpperCase?.() || 'F'
          )}</div>
          <div class="min-w-0">
            <div class="font-label text-sm font-bold truncate hover:text-primary transition-colors">${escapeHtml(
              friendName
            )}</div>
            <div class="font-label text-xs opacity-60">${escapeHtml(timeAgo(a?.visited_at))}</div>
          </div>
        </a>
        ${starsText ? `<div class="font-label text-xs text-primary tracking-widest">${escapeHtml(starsText)}</div>` : ''}
      </div>

      <a class="flex items-center gap-4 group" href="${escapeHtml(restHref)}">
        <div class="w-20 h-20 rounded-xl overflow-hidden bg-surface-container-low flex-none">
          ${
            imgUrl
              ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="${escapeHtml(
                  restName
                )}" src="${escapeHtml(imgUrl)}" loading="lazy" />`
              : `<div class="w-full h-full flex items-center justify-center font-headline italic text-4xl opacity-20">${escapeHtml(
                  (restName || 'R')[0]?.toUpperCase?.() || 'R'
                )}</div>`
          }
        </div>
        <div class="min-w-0">
          <div class="font-headline italic text-2xl truncate group-hover:text-primary transition-colors">${escapeHtml(
            restName
          )}</div>
          <div class="font-label text-sm opacity-60 truncate">${escapeHtml(meta)}</div>
        </div>
      </a>

      ${
        a?.review_snippet
          ? `<p class="font-body text-on-surface mt-5 leading-relaxed italic">“${escapeHtml(a.review_snippet)}”</p>`
          : ''
      }
    </div>
  `.trim();
}

function debounce(fn, delay = 250) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

async function init() {
  const user = await requireAuth({ redirectTo: 'login' });
  if (!user) return;
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;
  const headers = { Authorization: `Bearer ${token}` };

  const peopleList = document.getElementById('peopleList');
  const peopleEmpty = document.getElementById('peopleEmpty');
  const peopleError = document.getElementById('peopleError');
  const requestsBadge = document.getElementById('requestsBadge');

  const discoverList = document.getElementById('discoverList');
  const discoverCount = document.getElementById('discoverCount');
  const searchInput = document.getElementById('friendSearchInput');
  const searchHint = document.getElementById('searchHint');

  const activityList = document.getElementById('activityList');
  const activityEmpty = document.getElementById('activityEmpty');
  const activityError = document.getElementById('activityError');
  const refreshActivityBtn = document.getElementById('refreshActivityBtn');

  let activeTab = 'friends';
  setTabActive(activeTab);

  let friends = [];
  let requests = [];
  let lastSearch = [];

  async function refreshPeople() {
    peopleError?.classList.add('hidden');
    try {
      const [f, r] = await Promise.all([
        fetchJson(`${FASTAPI_BASE}/api/friends`, { headers }),
        fetchJson(`${FASTAPI_BASE}/api/friends/requests`, { headers }),
      ]);
      friends = Array.isArray(f?.friends) ? f.friends : [];
      requests = Array.isArray(r?.requests) ? r.requests : [];
    } catch (ex) {
      if (peopleError) {
        peopleError.textContent = ex?.message || 'Could not load friends.';
        peopleError.classList.remove('hidden');
      }
      friends = [];
      requests = [];
    }

    if (requestsBadge) {
      if (requests.length > 0) {
        requestsBadge.textContent = String(requests.length);
        requestsBadge.classList.remove('hidden');
      } else {
        requestsBadge.classList.add('hidden');
      }
    }

    renderPeopleList();
  }

  function renderPeopleList() {
    if (!peopleList) return;
    peopleEmpty?.classList.add('hidden');

    const list = activeTab === 'requests' ? requests : friends;
    if (!list.length) {
      peopleList.innerHTML = '';
      peopleEmpty.textContent = activeTab === 'requests' ? 'No pending requests.' : 'No friends yet — start by searching above.';
      peopleEmpty?.classList.remove('hidden');
      return;
    }

    if (activeTab === 'friends') {
      peopleList.innerHTML = list
        .map((f) => {
          const friendId = f?.friend_id ?? '';
          const friendHref = `profile?id=${encodeURIComponent(friendId)}`;
          const right = actionButton({ label: 'Remove', action: 'friend-remove', tone: 'soft', icon: 'person_remove' });
          const friendDisplayName = f?.name || f?.username || 'Friend';
          const friendHandle = f?.username ? `@${f.username}` : '';
          const friendSince = f?.friends_since ? `Friends since ${timeAgo(f.friends_since)}` : '';
          return renderPersonRow({
            title: friendDisplayName,
            subtitle: [friendHandle, friendSince].filter(Boolean).join(' · '),
            href: friendHref,
            initial: (friendDisplayName || 'F')[0]?.toUpperCase?.() || 'F',
            rightHtml: right,
            dataAttrs: { friendship_id: f?.friendship_id ?? '' },
          });
        })
        .join('\n');
      return;
    }

    peopleList.innerHTML = list
      .map((r) => {
        const right = `
          ${actionButton({ label: 'Accept', action: 'req-accept', tone: 'primary', icon: 'done' })}
          ${actionButton({ label: 'Decline', action: 'req-decline', tone: 'soft', icon: 'close' })}
        `.trim();
        const reqDisplayName = r?.requester_name || r?.requester_username || 'User';
        const reqHandle = r?.requester_username ? `@${r.requester_username}` : '';
        const reqBio = r?.requester_bio || '';
        const reqSubtitle = [reqHandle, reqBio].filter(Boolean).join(' · ') || (r?.created_at ? timeAgo(r.created_at) : '');
        return renderPersonRow({
          title: reqDisplayName,
          subtitle: reqSubtitle,
          href: `profile?id=${encodeURIComponent(r?.requester_id ?? '')}`,
          initial: (reqDisplayName || 'U')[0]?.toUpperCase?.() || 'U',
          rightHtml: right,
          accent: true,
          dataAttrs: { friendship_id: r?.friendship_id ?? '' },
        });
      })
      .join('\n');
  }

  async function refreshActivity() {
    activityError?.classList.add('hidden');
    activityEmpty?.classList.add('hidden');
    if (activityList) {
      activityList.innerHTML = `
        <div class="bg-surface-container-lowest rounded-xl p-6 editorial-shadow">
          <div class="h-5 w-1/2 rounded bg-surface-container-low"></div>
          <div class="h-4 w-2/3 rounded bg-surface-container-low mt-3"></div>
          <div class="h-20 w-full rounded bg-surface-container-low mt-6"></div>
        </div>
      `.trim();
    }

    try {
      const d = await fetchJson(`${FASTAPI_BASE}/api/friends/activity?limit=40`, { headers });
      const list = Array.isArray(d?.activity) ? d.activity : [];
      if (!list.length) {
        activityList.innerHTML = '';
        activityEmpty?.classList.remove('hidden');
        return;
      }
      activityList.innerHTML = list.map(renderActivityCard).join('\n');
    } catch (ex) {
      if (activityList) activityList.innerHTML = '';
      if (activityError) {
        activityError.textContent = ex?.message || 'Could not load activity.';
        activityError.classList.remove('hidden');
      }
    }
  }

  async function runSearch(q) {
    const query = String(q || '').trim();
    if (!discoverList) return;
    discoverCount.textContent = '—';

    if (query.length < 2) {
      lastSearch = [];
      discoverList.innerHTML = `<div class="font-label text-sm opacity-60">Start typing above to find people.</div>`;
      if (searchHint) searchHint.textContent = 'Type at least 2 characters.';
      return;
    }

    if (searchHint) searchHint.textContent = 'Searching...';
    discoverList.innerHTML = `
      <div class="bg-surface-container-low rounded-xl p-5">
        <div class="h-4 w-2/3 rounded bg-surface-container-high"></div>
        <div class="h-4 w-1/2 rounded bg-surface-container-high mt-3"></div>
      </div>
    `.trim();

    try {
      const d = await fetchJson(`${FASTAPI_BASE}/api/users/search?q=${encodeURIComponent(query)}`, { headers });
      const users = Array.isArray(d?.users) ? d.users : [];
      lastSearch = users;
      discoverCount.textContent = `${users.length} found`;
      if (searchHint) searchHint.textContent = users.length ? 'Tap to connect.' : 'No matches.';

      if (!users.length) {
        discoverList.innerHTML = `<div class="font-label text-sm opacity-60">No matches.</div>`;
        return;
      }

      discoverList.innerHTML = users
        .map((u) => {
          const rel = u?.relation || 'none';
          const rightParts = [];
          if (rel === 'none') rightParts.push(actionButton({ label: 'Add', action: 'add', tone: 'primary', icon: 'person_add' }));
          if (rel === 'pending_received') {
            rightParts.push(actionButton({ label: 'Accept', action: 'req-accept', tone: 'primary', icon: 'done' }));
            rightParts.push(actionButton({ label: 'Decline', action: 'req-decline', tone: 'soft', icon: 'close' }));
          }
          if (rel === 'pending_sent') rightParts.push(relationBadge('pending_sent'));
          if (rel === 'friends') rightParts.push(relationBadge('friends'));

          const searchDisplayName = u?.name || u?.username || 'User';
          const subtitle = rel === 'pending_received'
            ? 'Sent you a request'
            : (u?.username ? `@${u.username}` : '');
          return renderPersonRow({
            title: searchDisplayName,
            subtitle,
            href: `profile?id=${encodeURIComponent(u?.id ?? '')}`,
            initial: (searchDisplayName || 'U')[0]?.toUpperCase?.() || 'U',
            rightHtml: rightParts.join(' '),
            dataAttrs: { user_id: u?.id ?? '', friendship_id: u?.friendship_id ?? '' },
          });
        })
        .join('\n');
    } catch (ex) {
      lastSearch = [];
      discoverList.innerHTML = `<div class="font-label text-sm text-error">${escapeHtml(
        ex?.message || 'Search failed.'
      )}</div>`;
      if (searchHint) searchHint.textContent = 'Search failed.';
    }
  }

  document.getElementById('tabFriends')?.addEventListener('click', () => {
    activeTab = 'friends';
    setTabActive(activeTab);
    renderPeopleList();
  });
  document.getElementById('tabRequests')?.addEventListener('click', () => {
    activeTab = 'requests';
    setTabActive(activeTab);
    renderPeopleList();
  });

  peopleList?.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;
    const row = btn.closest?.('[data-friendship_id]');
    const friendshipId = row?.getAttribute?.('data-friendship_id') || '';
    if (!friendshipId) return;

    const action = btn.getAttribute('data-action');
    btn.disabled = true;
    try {
      if (action === 'req-accept') await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(friendshipId)}/accept`, { method: 'POST', headers });
      if (action === 'req-decline') await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(friendshipId)}/decline`, { method: 'POST', headers });
      if (action === 'friend-remove') await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(friendshipId)}`, { method: 'DELETE', headers });
      await refreshPeople();
      await refreshActivity();
    } catch (ex) {
      if (peopleError) {
        peopleError.textContent = ex?.message || 'Action failed.';
        peopleError.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  });

  discoverList?.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;
    const row = btn.closest?.('[data-user_id]');
    if (!row) return;

    const userId = row.getAttribute('data-user_id') || '';
    const friendshipId = row.getAttribute('data-friendship_id') || '';
    if (!userId && !friendshipId) return;

    const action = btn.getAttribute('data-action');
    btn.disabled = true;
    try {
      if (action === 'add') await fetchJson(`${FASTAPI_BASE}/api/friends/request/${encodeURIComponent(userId)}`, { method: 'POST', headers });
      if (action === 'req-accept') await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(friendshipId)}/accept`, { method: 'POST', headers });
      if (action === 'req-decline') await fetchJson(`${FASTAPI_BASE}/api/friends/${encodeURIComponent(friendshipId)}/decline`, { method: 'POST', headers });
      await refreshPeople();
      await runSearch(searchInput?.value || '');
      await refreshActivity();
    } finally {
      btn.disabled = false;
    }
  });

  const debouncedSearch = debounce((v) => runSearch(v), 250);
  searchInput?.addEventListener('input', (e) => debouncedSearch(e.target.value || ''));

  refreshActivityBtn?.addEventListener('click', async () => {
    refreshActivityBtn.disabled = true;
    try {
      await refreshActivity();
    } finally {
      refreshActivityBtn.disabled = false;
    }
  });

  await refreshPeople();
  await Promise.all([refreshActivity(), runSearch(searchInput?.value || '')]);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

