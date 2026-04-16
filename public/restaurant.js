// Restaurant detail controller (new design)
// PORT FROM OLD PROJECT: FastAPI endpoints for restaurants/ratings/reviews/visits/bookmarks + list membership.

import { requireAuth, getToken, logout } from './auth.js';
import { FASTAPI_BASE } from './config.js';
import { startProgress, finishProgress } from './progress.js';

// Used by `restaurant.html` to detect whether the module script loaded at all.
window.__CATALOG_RESTAURANT_SCRIPT_LOADED__ = true;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(value) {
  const v = String(value ?? '');
  // eslint-disable-next-line no-undef
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(v);
  return v.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.detail || data?.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
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

function getSlug() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('slug') || '').trim();
}

function setBtnActive(btn, active, { activeLabel, inactiveLabel } = {}) {
  if (!btn) return;
  btn.dataset.active = active ? '1' : '0';
  btn.classList.toggle('bg-primary', !!active);
  btn.classList.toggle('text-on-primary', !!active);
  btn.classList.toggle('bg-surface-container-lowest', !active);
  btn.classList.toggle('text-on-surface', !active);
  const label = active ? activeLabel : inactiveLabel;
  if (label) btn.lastChild.textContent = ` ${label}`;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}


// Replies are stored in the database — repliesCache holds the last-fetched array per reviewId.
const repliesCache = new Map();

async function fetchReplies(reviewId, { headers } = {}) {
  try {
    const d = await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}/replies`, { headers });
    const list = Array.isArray(d?.replies) ? d.replies : [];
    repliesCache.set(String(reviewId), list);
    return list;
  } catch {
    return repliesCache.get(String(reviewId)) || [];
  }
}

function getCachedReplies(reviewId) {
  return repliesCache.get(String(reviewId)) || [];
}

function buildReplyChildrenMap(replies) {
  const map = new Map();
  (replies || []).forEach((r) => {
    const parent = r?.parent_id == null ? '' : String(r.parent_id);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(r);
  });

  map.forEach((arr) => {
    arr.sort((a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0));
  });

  return map;
}

function renderReplyThreadHtml(replies, { parentId = '', depth = 0, childrenMap = null, currentUserId = null } = {}) {
  const map = childrenMap || buildReplyChildrenMap(replies || []);
  const children = map.get(parentId == null ? '' : String(parentId)) || [];
  if (!children.length) return '';

  const clampDepth = Math.min(Math.max(Number(depth) || 0, 0), 8);
  const indent = clampDepth * 18;

  return children
    .map((rep) => {
      const id = String(rep?.id ?? '');
      const username = String(rep?.username || 'User');
      const initial = (username || 'U')[0]?.toUpperCase?.() || 'U';
      const when = rep?.created_at
        ? new Date(rep.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : '';
      const isMine = currentUserId != null && String(rep?.user_id ?? '') === String(currentUserId);

      const childCount = (map.get(id) || []).length;
      const childToggle =
        childCount > 0
          ? `
            <button class="font-label text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="child-toggle" data-reply-id="${escapeHtml(
              id
            )}" data-open="0">View ${childCount} repl${childCount === 1 ? 'y' : 'ies'}</button>
          `.trim()
          : '';

      const childrenHtml = childCount
        ? `
          <div class="mt-3 pl-4 border-l border-on-surface/10 hidden" data-reply-children="${escapeHtml(id)}">
            ${renderReplyThreadHtml(replies, { parentId: id, depth: clampDepth + 1, childrenMap: map, currentUserId })}
          </div>
        `.trim()
        : '';

      return `
        <div class="space-y-2" data-reply-node="${escapeHtml(id)}">
          <div class="flex gap-3" style="margin-left:${indent}px">
            <div class="w-9 h-9 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-xs font-bold flex-none">${escapeHtml(
              initial
            )}</div>
            <div class="min-w-0 flex-1 bg-surface-container-low rounded-xl p-4">
              <div class="flex items-start justify-between gap-4 mb-1">
                <div class="min-w-0">
                  <div class="font-label text-xs font-bold truncate">${escapeHtml(username)}</div>
                  <div class="font-label text-[10px] uppercase tracking-widest opacity-60">${escapeHtml(when)}</div>
                </div>
                <div class="flex items-center gap-3 flex-none">
                  <button class="font-label text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="reply-to" data-reply-id="${escapeHtml(id)}" data-reply-username="${escapeHtml(username)}">Reply</button>
                  ${isMine ? `<button class="font-label text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-error transition-colors" type="button" data-action="delete-reply" data-reply-id="${escapeHtml(id)}">Delete</button>` : ''}
                </div>
              </div>
              <div class="font-body text-sm text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(
                rep?.content || ''
              )}</div>
              ${childToggle ? `<div class="mt-3">${childToggle}</div>` : ''}
              ${childrenHtml}
            </div>
          </div>
        </div>
      `.trim();
    })
    .join('\n');
}

function updateRatingBreakdown(dist, totalRatings) {
  const root = document.getElementById('ratingBreakdown');
  if (!root) return;

  const total = Number(totalRatings ?? 0) || 0;
  const safeDist = dist && typeof dist === 'object' ? dist : {};

  const targetWidths = new Map();
  for (let stars = 5; stars >= 1; stars--) {
    const count = Number(safeDist[stars] ?? safeDist[String(stars)] ?? 0) || 0;
    const pct = total > 0 ? (count / total) * 100 : 0;

    const countEl = root.querySelector(`[data-star-count="${stars}"]`);
    const fillEl = root.querySelector(`[data-star-fill="${stars}"]`);
    if (countEl) countEl.textContent = String(count);
    if (fillEl) {
      fillEl.style.width = '0%';
      fillEl.style.transition = 'width 600ms ease';
      fillEl.style.transitionDelay = `${(5 - stars) * 70}ms`;
      targetWidths.set(fillEl, `${pct.toFixed(1)}%`);
    }
  }

  requestAnimationFrame(() => {
    targetWidths.forEach((w, el) => {
      el.style.width = w;
    });
  });
}

function renderStars(container, currentStars, onSelect) {
  container.innerHTML = '';
  let selectedStars = currentStars;
  const buttons = [];

  function applyStarVisual(starEl, filled) {
    if (!starEl) return;
    starEl.style.setProperty(
      'font-variation-settings',
      `"FILL" ${filled ? 1 : 0}, "wght" 400, "GRAD" 0, "opsz" 24`
    );
    // Inline color so this doesn't depend on Tailwind JIT picking up JS-only classes.
    starEl.style.color = filled ? '#690008' : 'rgba(88, 65, 63, 0.5)';
  }

  function apply(stars, { animate = false } = {}) {
    for (let i = 1; i <= 5; i++) {
      const b = buttons[i - 1];
      if (!b) continue;
      const filled = i <= stars;
      applyStarVisual(b, filled);

      if (animate && filled) {
        b.classList.remove('star-pop');
        // eslint-disable-next-line no-unused-expressions
        b.offsetWidth;
        b.classList.add('star-pop');
      }
    }
  }

  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className =
      'catalog-star material-symbols-outlined text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container rounded';
    applyStarVisual(b, i <= currentStars);
    b.textContent = 'star';
    b.addEventListener('mouseenter', () => apply(i));
    b.addEventListener('focus', () => apply(i));
    b.addEventListener('mouseleave', () => apply(selectedStars));
    b.addEventListener('blur', () => apply(selectedStars));
    b.addEventListener('click', () => {
      selectedStars = i;
      apply(i, { animate: true });
      onSelect(i);
    });
    b.addEventListener('animationend', () => b.classList.remove('star-pop'));
    container.appendChild(b);
    buttons.push(b);
  }

  apply(selectedStars);
}

function openPhotoLightbox({ src, alt }) {
  const existing = document.getElementById('photoLightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'photoLightbox';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center p-6';

  overlay.innerHTML = `
    <div class="w-full max-w-5xl bg-surface-container-lowest rounded-xl editorial-shadow overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 bg-surface-container-low border-b border-on-surface/10">
        <div class="font-label text-xs uppercase tracking-widest opacity-60">Photo</div>
        <button type="button" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" id="closePhotoLightbox" aria-label="Close">close</button>
      </div>
      <div class="p-4">
        <div class="rounded-xl overflow-hidden bg-surface-container-low">
          <img class="w-full h-[70vh] object-contain bg-black/5" src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" />
        </div>
      </div>
    </div>
  `.trim();

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#closePhotoLightbox')?.addEventListener('click', close);
  document.body.appendChild(overlay);
}

function openPhotoGalleryModal({ photos, title }) {
  const existing = document.getElementById('photoGalleryModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'photoGalleryModal';
  overlay.className =
    'fixed inset-0 z-50 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center p-6';

  const items = (photos || [])
    .map((src) => {
      return `
        <button type="button" class="group relative aspect-[4/3] rounded-xl overflow-hidden bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container" data-photo-src="${escapeHtml(
          src
        )}">
          <img class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" src="${escapeHtml(
            src
          )}" alt="${escapeHtml(title || 'Photo')}" loading="lazy" />
        </button>
      `.trim();
    })
    .join('\n');

  overlay.innerHTML = `
    <div class="w-full max-w-5xl bg-surface-container-lowest rounded-xl editorial-shadow overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 bg-surface-container-low border-b border-on-surface/10">
        <div class="min-w-0">
          <div class="font-label text-xs uppercase tracking-widest opacity-60">Photos</div>
          <div class="font-headline italic text-2xl truncate">${escapeHtml(title || 'Restaurant')}</div>
        </div>
        <button type="button" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" id="closePhotoGallery" aria-label="Close">close</button>
      </div>
      <div class="p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-h-[70vh] overflow-auto pr-1">
          ${items}
        </div>
      </div>
    </div>
  `.trim();

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#closePhotoGallery')?.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-photo-src]');
    if (!btn) return;
    const src = btn.getAttribute('data-photo-src');
    if (!src) return;
    close();
    openPhotoLightbox({ src, alt: title || '' });
  });

  document.body.appendChild(overlay);
}

// ─── Hours parsing & display ──────────────────────────────────────────────────

const DAYS_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAYS_ABBR  = ['sun','mon','tue','wed','thu','fri','sat'];

function parseTime12(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ampm = String(m[3]).toUpperCase();
  if (h === 12) h = 0;
  if (ampm === 'PM') h += 12;
  return h * 60 + min;
}

/** Normalise e.g. "9am", "9:30am", "9:30 AM" → "9:30 AM" */
function formatTime12(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/i);
  if (!m) return String(value || '').trim();
  const h = Number(m[1]);
  const min = m[2] ? `:${m[2].padStart(2,'0')}` : '';
  return `${h}${min} ${String(m[3]).toUpperCase()}`;
}

/** Parse "HH:MM" 24h → minutes */
function parseTime24(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Convert 24h "HH:MM" → "H:MM AM/PM" */
function time24To12(value) {
  const mins = parseTime24(value);
  if (mins == null) return value;
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hDisplay = h % 12 === 0 ? 12 : h % 12;
  return `${hDisplay}${m ? `:${String(m).padStart(2,'0')}` : ''} ${suffix}`;
}

function dayNameToIndex(name) {
  const n = String(name || '').trim().toLowerCase().slice(0, 3);
  const i = DAYS_ABBR.indexOf(n);
  return i >= 0 ? i : -1;
}

/**
 * Parse an opening_hours string into a per-day map: { 0: "12:00 PM – 10:00 PM", … } (0=Sun).
 * Handles several common formats without strict validation.
 */
function parseOpeningHours(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s.length < 3) return null;

  const result = {}; // dayIndex → time-range string or 'Closed'

  // Normalise dashes to en-dash for consistency
  const normalised = s
    .replace(/–|—|‒/g, '–')
    .replace(/\r?\n/g, ', ');

  // ── Format 1: "Daily: HH:MM – HH:MM" or "All week HH:MM – HH:MM" ────────
  const dailyMatch = normalised.match(
    /(?:daily|all\s+week|everyday|every\s+day)[:\s]+(.+)/i
  );
  if (dailyMatch) {
    const range = parseTimeRange(dailyMatch[1]);
    if (range) {
      for (let d = 0; d < 7; d++) result[d] = range;
      return result;
    }
  }

  // ── Format 2: comma-separated segments "Mon–Fri: 9 AM – 10 PM, Sat–Sun: Closed" ─
  const segments = normalised.split(/,\s*/);
  let parsedAny = false;

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // "DayA–DayB: range" or "DayA,DayB: range" or "DayA: range"
    const segMatch = trimmed.match(
      /^([A-Za-z]+(?:\s*[–\-,]\s*[A-Za-z]+)?)\s*[:\s]\s*(.+)$/
    );
    if (!segMatch) continue;

    const [, dayPart, rangePart] = segMatch;
    const range = /closed/i.test(rangePart) ? 'Closed' : parseTimeRange(rangePart);
    if (!range) continue;

    // Day range "Mon–Fri"
    const dayRangeMatch = dayPart.match(/^([A-Za-z]+)\s*[–\-]\s*([A-Za-z]+)$/);
    if (dayRangeMatch) {
      const from = dayNameToIndex(dayRangeMatch[1]);
      const to   = dayNameToIndex(dayRangeMatch[2]);
      if (from >= 0 && to >= 0) {
        // Handle wrap-around (Fri–Sun)
        let d = from;
        while (true) {
          result[d] = range;
          if (d === to) break;
          d = (d + 1) % 7;
        }
        parsedAny = true;
      }
      continue;
    }

    // Single day or comma-separated days "Mon,Wed,Fri"
    const dayNames = dayPart.split(/[,&]\s*/);
    for (const dn of dayNames) {
      const idx = dayNameToIndex(dn.trim());
      if (idx >= 0) { result[idx] = range; parsedAny = true; }
    }
  }

  if (parsedAny) return result;

  // ── Format 3: plain time range "9 AM – 10 PM" (applies to all days) ─────
  const simpleRange = parseTimeRange(normalised);
  if (simpleRange && !/[A-Za-z]{2,}/.test(normalised.replace(/am|pm/gi, ''))) {
    for (let d = 0; d < 7; d++) result[d] = simpleRange;
    return result;
  }

  return null; // couldn't parse — caller will fall back to raw text
}

/** Extract a time range string from "9 AM – 10 PM", "9am-10pm", "09:00–22:00" etc. */
function parseTimeRange(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // 12-hour: "9 AM – 10 PM" or "9am–10pm"
  const match12 = s.match(
    /(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))\s*[–\-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i
  );
  if (match12) {
    return `${formatTime12(match12[1])} – ${formatTime12(match12[2])}`;
  }

  // 24-hour: "09:00–22:00"
  const match24 = s.match(/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/);
  if (match24) {
    return `${time24To12(match24[1])} – ${time24To12(match24[2])}`;
  }

  return null;
}

/**
 * Determine open/closed for a given day time-range string and current time.
 */
function computeOpenStatus(hoursText, now = new Date()) {
  const t = String(hoursText || '').trim();
  if (!t || /closed/i.test(t)) return { isOpen: false, label: 'Closed' };

  const parts = t.split('–').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { isOpen: null, label: null };

  const openM  = parseTime12(parts[0]);
  const closeM = parseTime12(parts[1]);
  if (openM == null || closeM == null) return { isOpen: null, label: null };

  const mins = now.getHours() * 60 + now.getMinutes();
  const overnight = closeM < openM;
  const isOpen = overnight
    ? (mins >= openM || mins < closeM)
    : (mins >= openM && mins < closeM);
  return { isOpen, label: isOpen ? 'Open now' : 'Closed' };
}

/**
 * Render the hours card with a structured weekly grid.
 * Highlights today, shows open/closed status chip.
 */
function renderHoursCard({ hoursRows, hoursPill, hoursNote, openingHours }) {
  const now = new Date();
  const todayIdx = now.getDay(); // 0=Sun … 6=Sat

  if (!hoursRows) return;

  if (!openingHours) {
    hoursRows.innerHTML = `<div class="font-body text-sm opacity-50">Hours not available.</div>`;
    if (hoursPill) hoursPill.classList.add('hidden');
    return;
  }

  const parsed = parseOpeningHours(openingHours);

  // ── Structured weekly display ──────────────────────────────────────────
  if (parsed && Object.keys(parsed).length > 0) {
    // Determine today's open/closed status
    const todayRange = parsed[todayIdx];
    const todayStatus = computeOpenStatus(todayRange || '');

    // Show status pill
    if (hoursPill) {
      if (todayStatus.isOpen === true) {
        hoursPill.textContent = 'Open now';
        hoursPill.className = hoursPill.className.replace(/\bhidden\b/g, '').trim();
        hoursPill.style.cssText = '';
        hoursPill.classList.remove('hidden');
        hoursPill.setAttribute('class',
          'font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full hours-status-open');
      } else if (todayStatus.isOpen === false) {
        hoursPill.textContent = todayRange === 'Closed' ? 'Closed today' : 'Closed now';
        hoursPill.setAttribute('class',
          'font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full hours-status-closed');
        hoursPill.classList.remove('hidden');
      } else {
        hoursPill.classList.add('hidden');
      }
    }

    // Build weekly rows — display Mon→Sun order (Mon first)
    const dayOrder = [1,2,3,4,5,6,0]; // Mon…Sat, Sun
    hoursRows.innerHTML = dayOrder.map((di) => {
      const isToday  = di === todayIdx;
      const dayName  = DAYS_FULL[di];
      const dayShort = DAYS_SHORT[di];
      const range    = parsed[di];
      const isClosed = !range || range === 'Closed';
      const timeText = isClosed ? 'Closed' : range;

      return `
        <div class="hours-day-row${isToday ? ' is-today' : ''}">
          <span class="hours-day-name" title="${escapeHtml(dayName)}">${escapeHtml(dayShort)}</span>
          <span class="hours-day-time${isClosed ? ' hours-closed-text' : ''}">${escapeHtml(timeText)}</span>
          ${isToday && todayStatus.isOpen !== null
            ? `<span class="${todayStatus.isOpen ? 'hours-status-open' : 'hours-status-closed'}">${todayStatus.isOpen ? 'Open' : 'Closed'}</span>`
            : '<span></span>'}
        </div>
      `.trim();
    }).join('');

    if (hoursNote) hoursNote.classList.add('hidden');
    return;
  }

  // ── Fallback: render raw text but clean it up ──────────────────────────
  const cleaned = openingHours
    .replace(/\r?\n/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Still try to show open/closed from the raw string
  const rawStatus = computeOpenStatus(openingHours);
  if (hoursPill) {
    if (rawStatus.isOpen === true) {
      hoursPill.textContent = 'Open now';
      hoursPill.setAttribute('class',
        'font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full hours-status-open');
      hoursPill.classList.remove('hidden');
    } else if (rawStatus.isOpen === false) {
      hoursPill.textContent = 'Closed now';
      hoursPill.setAttribute('class',
        'font-label text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full hours-status-closed');
      hoursPill.classList.remove('hidden');
    } else {
      hoursPill.classList.add('hidden');
    }
  }

  hoursRows.innerHTML = `<div class="font-body text-sm text-on-surface-variant leading-relaxed">${escapeHtml(cleaned)}</div>`;
  if (hoursNote) hoursNote.classList.add('hidden');
}

function friendsBeenSummaryText(friends) {
  const names = friends.map((f) => f.username).filter(Boolean);
  if (names.length === 1) return `${names[0]} has been here`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have been here`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others have been here`;
}

async function hydrateFriendsRating({ token, slug }) {
  const wrap = document.getElementById('friendsRatingWrap');
  const btn = document.getElementById('friendsRatingBtn');
  const pop = document.getElementById('friendsRatingPopover');
  const listEl = document.getElementById('friendsRatingList');
  if (!wrap || !token) return;

  let friends = [];
  try {
    const d = await fetchJson(`${FASTAPI_BASE}/api/restaurants/${encodeURIComponent(slug)}/friends-rating`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    friends = Array.isArray(d?.friends) ? d.friends : [];
    if (!friends.length) return;

    wrap.classList.remove('hidden');

    const avgEl = document.getElementById('friendsRatingAvg');
    const starsEl = document.getElementById('friendsRatingStars');
    const textEl = document.getElementById('friendsRatingText');
    const avatarsEl = document.getElementById('friendsRatingAvatars');

    if (avgEl) avgEl.textContent = d.avg_rating.toFixed(1);

    if (starsEl) {
      const rounded = Math.round(d.avg_rating);
      starsEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<span class="material-symbols-outlined text-[13px]" style="font-variation-settings:'FILL' ${i < rounded ? 1 : 0},'wght' 400,'GRAD' 0,'opsz' 24;color:${i < rounded ? '#690008' : 'rgba(88,65,63,0.35)'}">star</span>`
      ).join('');
    }

    if (textEl) {
      const count = friends.length;
      textEl.textContent = `${count} friend${count === 1 ? '' : 's'} rated this`;
    }

    if (avatarsEl) {
      avatarsEl.innerHTML = friends.slice(0, 5).map((f) => {
        const init = String(f.username || 'U')[0]?.toUpperCase?.() || 'U';
        return `<div class="w-7 h-7 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-[11px] font-bold" title="${escapeHtml(f.username)}">${escapeHtml(init)}</div>`;
      }).join('');
    }

    // Render the popover friend list
    if (listEl) {
      listEl.innerHTML = friends.map((f) => {
        const init = String(f.username || 'U')[0]?.toUpperCase?.() || 'U';
        const starCount = Math.max(0, Math.min(5, Math.round(Number(f.stars) || 0)));
        const starsHtml = Array.from({ length: 5 }, (_, i) =>
          `<span class="material-symbols-outlined text-[13px]" style="font-variation-settings:'FILL' ${i < starCount ? 1 : 0},'wght' 400,'GRAD' 0,'opsz' 24;color:${i < starCount ? '#690008' : 'rgba(88,65,63,0.35)'}">star</span>`
        ).join('');
        return `
          <a class="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low transition-colors" href="profile.html?id=${encodeURIComponent(String(f.id))}">
            <div class="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-xs font-bold flex-none border border-on-surface/10">${escapeHtml(init)}</div>
            <div class="font-label text-sm font-bold flex-1 truncate">${escapeHtml(String(f.username))}</div>
            <div class="flex items-center gap-0.5 flex-none">${starsHtml}</div>
          </a>
        `.trim();
      }).join('');
    }
  } catch {
    // silently skip if not logged in or no friends
    return;
  }

  // Popover toggle — mirrors friendsBeenHere pattern
  if (!btn || !pop) return;

  function closeRatingPop() { pop.classList.add('hidden'); }
  function toggleRatingPop() { pop.classList.toggle('hidden'); }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRatingPop();
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeRatingPop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRatingPop(); });
}

async function hydrateFriendsBeenHere({ token, slug }) {
  const wrap = document.getElementById('friendsBeenWrap');
  const btn = document.getElementById('friendsBeenBtn');
  const avatarsEl = document.getElementById('friendsBeenAvatars');
  const textEl = document.getElementById('friendsBeenText');
  const pop = document.getElementById('friendsBeenPopover');
  const listEl = document.getElementById('friendsBeenList');
  if (!wrap || !btn || !avatarsEl || !textEl || !pop || !listEl) return;
  if (!token) return;

  let friends = [];
  try {
    const payload = await fetchJson(`${FASTAPI_BASE}/api/restaurants/${encodeURIComponent(slug)}/friends-been`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    friends = Array.isArray(payload?.friends) ? payload.friends : [];
  } catch {
    friends = [];
  }

  if (!friends.length) {
    wrap.classList.add('hidden');
    pop.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  textEl.textContent = friendsBeenSummaryText(friends);

  avatarsEl.innerHTML = '';
  friends.slice(0, 3).forEach((f) => {
    const initial = String(f.username || 'U')[0]?.toUpperCase?.() || 'U';
    const chip = document.createElement('a');
    chip.href = `profile.html?id=${encodeURIComponent(String(f.id))}`;
    chip.className =
      'w-7 h-7 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-[11px] font-bold border-2 border-surface-container-lowest';
    chip.textContent = initial;
    avatarsEl.appendChild(chip);
  });

  listEl.innerHTML = friends
    .map((f) => {
      const initial = String(f.username || 'U')[0]?.toUpperCase?.() || 'U';
      return `
        <a class="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low transition-colors" href="profile.html?id=${encodeURIComponent(
          String(f.id)
        )}">
          <div class="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-xs font-bold border border-on-surface/10">${escapeHtml(
            initial
          )}</div>
          <div class="font-label text-sm font-bold">${escapeHtml(String(f.username))}</div>
        </a>
      `.trim();
    })
    .join('');

  function close() {
    pop.classList.add('hidden');
  }
  function toggle() {
    pop.classList.toggle('hidden');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

async function init() {
  startProgress();
  window.__CATALOG_RESTAURANT_INIT_STARTED__ = true;
  const user = await requireAuth({ redirectTo: 'login.html' });
  if (!user) { finishProgress(); return; }
  ensureAccountDropdown({ user });

  const token = getToken();
  if (!token) return;

  const slug = getSlug();
  if (!slug) {
    document.getElementById('restaurantName').textContent = 'Restaurant not found';
    return;
  }

  // Skeletons for hero + rating while restaurant data loads
  const nameEl = document.getElementById('restaurantName');
  const metaEl = document.getElementById('restaurantMeta');
  const avgEl = document.getElementById('ratingAvg');
  const countEl = document.getElementById('ratingCount');
  [nameEl, metaEl, avgEl, countEl].forEach((el) => {
    if (!el) return;
    el.classList.add('catalog-skeleton', 'rounded');
  });
  if (nameEl) {
    nameEl.textContent = '';
    nameEl.style.display = 'inline-block';
    nameEl.style.minWidth = '280px';
    nameEl.style.minHeight = '64px';
  }
  if (metaEl) {
    metaEl.textContent = '';
    metaEl.style.display = 'block';
    metaEl.style.maxWidth = '520px';
    metaEl.style.minHeight = '18px';
  }
  if (avgEl) {
    avgEl.textContent = '';
    avgEl.style.display = 'inline-block';
    avgEl.style.minWidth = '88px';
    avgEl.style.minHeight = '52px';
  }
  if (countEl) {
    countEl.textContent = '';
    countEl.style.display = 'block';
    countEl.style.minWidth = '120px';
    countEl.style.minHeight = '14px';
  }

  // Load restaurant details
  let restaurant;
  try {
    restaurant = await fetchJson(`${FASTAPI_BASE}/restaurants/${encodeURIComponent(slug)}`);
  } catch (ex) {
    // Ensure skeleton styles don’t hide the error state.
    [nameEl, metaEl, avgEl, countEl].forEach((el) => {
      if (!el) return;
      el.classList.remove('catalog-skeleton', 'rounded');
      el.style.minWidth = '';
      el.style.minHeight = '';
      el.style.maxWidth = '';
      el.style.display = '';
    });

    const msg = ex?.message || 'Failed to load restaurant.';
    const statusHint =
      /404/.test(msg) || /not found/i.test(msg) ? 'Restaurant not found' : 'Failed to load restaurant';

    document.getElementById('restaurantName').textContent = statusHint;
    const meta = document.getElementById('restaurantMeta');
    if (meta) meta.textContent = msg;
    return;
  }

  finishProgress();

  // Use the integer primary key for all operational API calls (visits, bookmarks,
  // ratings, reviews, list membership) so that chain restaurants (same name,
  // different branches) are tracked independently.
  const restaurantId = String(restaurant.id);

  document.title = `${restaurant?.name || 'Restaurant'} — Catalog`;
  document.getElementById('restaurantName').textContent = restaurant?.name || 'Restaurant';
  document.getElementById('restaurantMeta').textContent =
    [restaurant?.cuisine, restaurant?.area].filter(Boolean).join(' • ') || '';

  // Remove hero/rating skeletons now that we have data
  [nameEl, metaEl, avgEl, countEl].forEach((el) => {
    if (!el) return;
    el.classList.remove('catalog-skeleton', 'rounded');
    el.style.minWidth = '';
    el.style.minHeight = '';
    el.style.maxWidth = '';
    el.style.display = '';
  });

  hydrateFriendsBeenHere({ token, slug });
  hydrateFriendsRating({ token, slug });

  const img = document.getElementById('restaurantHeroImg');
  const imgWrap = document.getElementById('restaurantHeroImgWrap');
  const heroUrl = restaurant?.images?.[0] || restaurant?.image_url || '';
  if (img && heroUrl) {
    img.src = heroUrl;
    img.alt = restaurant?.name || '';
    img.onerror = () => {
      if (imgWrap) imgWrap.innerHTML = `<div class="w-full h-full flex items-center justify-center font-headline italic text-5xl opacity-30">${escapeHtml(
        (restaurant?.name || 'R')[0]?.toUpperCase?.() || 'R'
      )}</div>`;
    };
  }

  // Photos
  const photosSection = document.getElementById('photosSection');
  const photosGrid = document.getElementById('photosGrid');
  const photosEmpty = document.getElementById('photosEmpty');
  const photos = Array.isArray(restaurant?.images) ? restaurant.images.filter(Boolean) : [];
  if (!photos.length && restaurant?.image_url) {
    photos.push(restaurant.image_url);
  }
  if (photos.length <= 1) {
    // TODO: add multi-photo support to restaurants table
  }

  if (!photos.length) {
    if (photosGrid) photosGrid.innerHTML = '';
    photosEmpty?.classList.remove('hidden');
    photosSection?.classList.add('hidden');
  } else {
    photosEmpty?.classList.add('hidden');
    if (photosGrid) {
      const maxVisible = Math.min(photos.length, 3);
      photosGrid.innerHTML = '';
      for (let i = 0; i < maxVisible; i++) {
        const url = photos[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'group relative aspect-[4/3] rounded-xl overflow-hidden bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container';
        btn.innerHTML = `
          <img class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" src="${escapeHtml(
            url
          )}" alt="${escapeHtml(restaurant?.name || 'Restaurant')}" loading="lazy" />
        `.trim();
        btn.addEventListener('click', () => openPhotoLightbox({ src: url, alt: restaurant?.name || '' }));
        photosGrid.appendChild(btn);
      }

      if (photos.length > 3) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className =
          'group relative aspect-[4/3] rounded-xl overflow-hidden bg-surface-container-high flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container';
        more.innerHTML = `
          <div class="text-center">
            <div class="w-12 h-12 rounded-full bg-surface-container-lowest text-on-surface flex items-center justify-center mx-auto editorial-shadow">
              <span class="material-symbols-outlined">add</span>
            </div>
            <div class="font-label text-xs uppercase tracking-widest opacity-70 mt-3">+${escapeHtml(
              String(photos.length - 3)
            )} more</div>
          </div>
        `.trim();
        more.addEventListener('click', () => openPhotoGalleryModal({ photos, title: restaurant?.name || '' }));
        photosGrid.appendChild(more);
      }
    }
  }

  // Hours — sourced from `opening_hours` column in Supabase
  renderHoursCard({
    hoursRows:    document.getElementById('hoursRows'),
    hoursPill:    document.getElementById('hoursStatusPill'),
    hoursNote:    document.getElementById('hoursNote'),
    openingHours: restaurant?.opening_hours ?? null,
  });

  const headers = { Authorization: `Bearer ${token}` };

  // Fetch which reviews the user has already liked from the DB (source of truth).
  // Falls back to empty map so the page still loads if the endpoint fails.
  const likedMap = new Map();
  try {
    const likedData = await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(restaurantId)}/liked`, { headers });
    (likedData?.liked_review_ids || []).forEach((id) => likedMap.set(String(id), true));
  } catch {
    // non-fatal — liked state just won't be pre-filled
  }

  // Been / Save status
  const beenBtn = document.getElementById('beenBtn');
  const savedBtn = document.getElementById('savedBtn');

  async function refreshBeen() {
    try {
      const d = await fetchJson(`${FASTAPI_BASE}/api/visits/${encodeURIComponent(restaurantId)}/check`, { headers });
      setBtnActive(beenBtn, !!d?.visited, { activeLabel: 'Been', inactiveLabel: 'Been' });
    } catch {
      setBtnActive(beenBtn, false, { activeLabel: 'Been', inactiveLabel: 'Been' });
    }
  }

  async function refreshSaved() {
    try {
      const d = await fetchJson(`${FASTAPI_BASE}/api/bookmarks/${encodeURIComponent(restaurantId)}/check`, { headers });
      setBtnActive(savedBtn, !!d?.bookmarked, { activeLabel: 'Saved', inactiveLabel: 'Save' });
    } catch {
      setBtnActive(savedBtn, false, { activeLabel: 'Saved', inactiveLabel: 'Save' });
    }
  }

  beenBtn?.addEventListener('click', async () => {
    const active = beenBtn.dataset.active === '1';
    // Optimistic update — respond instantly, sync after
    setBtnActive(beenBtn, !active, { activeLabel: 'Been', inactiveLabel: 'Been' });
    beenBtn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/visits/${encodeURIComponent(restaurantId)}`, {
        method: active ? 'DELETE' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      // When un-beening the server also deletes rating/review; refresh local state
      if (active) {
        currentUserStars = 0;
        await Promise.all([refreshRatings(), loadReviews({ reset: true })]);
      }
    } catch {
      // Revert on failure
      setBtnActive(beenBtn, active, { activeLabel: 'Been', inactiveLabel: 'Been' });
    }
    await refreshBeen();
    beenBtn.disabled = false;
  });

  savedBtn?.addEventListener('click', async () => {
    const active = savedBtn.dataset.active === '1';
    // Optimistic update — respond instantly, sync after
    setBtnActive(savedBtn, !active, { activeLabel: 'Saved', inactiveLabel: 'Save' });
    savedBtn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/bookmarks/${encodeURIComponent(restaurantId)}`, {
        method: active ? 'DELETE' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch {
      // Revert on failure
      setBtnActive(savedBtn, active, { activeLabel: 'Saved', inactiveLabel: 'Save' });
    }
    await refreshSaved();
    savedBtn.disabled = false;
  });

  await Promise.all([refreshBeen(), refreshSaved()]);

  // Ratings
  const ratingAvg = document.getElementById('ratingAvg');
  const ratingCount = document.getElementById('ratingCount');
  const yourStars = document.getElementById('yourRatingStars');

  let currentUserStars = 0;

  async function refreshRatings() {
    let dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRatings = 0;
    try {
      const s = await fetchJson(`${FASTAPI_BASE}/api/ratings/${encodeURIComponent(restaurantId)}`);
      const avg = Number(s?.average_rating ?? 0);
      const total = Number(s?.total_ratings ?? 0);
      totalRatings = total;
      if (s?.distribution && typeof s.distribution === 'object') dist = s.distribution;
      ratingAvg.textContent = total > 0 ? avg.toFixed(1) : '—';
      ratingCount.textContent = total > 0 ? `${total} rating${total === 1 ? '' : 's'}` : 'No ratings yet';
    } catch {
      ratingAvg.textContent = '—';
      ratingCount.textContent = 'No ratings yet';
    }

    updateRatingBreakdown(dist, totalRatings);

    try {
      const u = await fetchJson(`${FASTAPI_BASE}/api/ratings/${encodeURIComponent(restaurantId)}/user`, { headers });
      currentUserStars = u?.rated ? Number(u?.stars ?? 0) : 0;
    } catch {
      currentUserStars = 0;
    }

    renderStars(yourStars, currentUserStars, async (stars) => {
      try {
        await fetchJson(`${FASTAPI_BASE}/api/ratings`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: { restaurant_id: restaurantId, stars },
        });
        currentUserStars = stars;
        // Auto-mark as Been when a rating is given
        if (beenBtn?.dataset.active !== '1') {
          try {
            await fetchJson(`${FASTAPI_BASE}/api/visits/${encodeURIComponent(restaurantId)}`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
            });
          } catch {}
          await refreshBeen();
        }
      } catch {}
      await refreshRatings();
    });
  }

  await refreshRatings();

  // Reviews
  const reviewsList = document.getElementById('reviewsList');
  const loadMoreBtn = document.getElementById('loadMoreReviewsBtn');
  const reviewForm = document.getElementById('reviewForm');
  const reviewText = document.getElementById('reviewText');
  const reviewError = document.getElementById('reviewError');
  const reviewHint = document.getElementById('reviewHint');
  if (reviewHint) {
    reviewHint.textContent = `Reviewing as ${user?.username || 'User'}.`;
  }

  let offset = 0;
  const limit = 10;
  let total = 0;

  function renderReviewCardSkeleton() {
    return `
      <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-7" aria-hidden="true">
        <div class="flex items-center justify-between gap-6 mb-4">
          <div class="min-w-0 flex-1">
            <div class="h-4 w-32 rounded catalog-skeleton"></div>
            <div class="h-3 w-24 rounded catalog-skeleton mt-3"></div>
          </div>
          <div class="flex items-center gap-3 flex-none">
            <div class="h-4 w-24 rounded catalog-skeleton"></div>
            <div class="h-4 w-10 rounded catalog-skeleton"></div>
          </div>
        </div>
        <div class="space-y-3">
          <div class="h-4 w-full rounded catalog-skeleton"></div>
          <div class="h-4 w-11/12 rounded catalog-skeleton"></div>
          <div class="h-4 w-2/3 rounded catalog-skeleton"></div>
        </div>
        <div class="mt-6 flex items-center gap-5">
          <div class="h-4 w-24 rounded catalog-skeleton"></div>
          <div class="h-4 w-20 rounded catalog-skeleton"></div>
        </div>
      </div>
    `.trim();
  }

  function renderReviewsSkeleton(count = 3) {
    const n = Math.max(2, Math.min(6, Number(count || 3)));
    return new Array(n).fill(0).map(() => renderReviewCardSkeleton()).join('\n');
  }

  function renderReviewCard(r) {
    const stars = r?.rating ? Number(r.rating) : null;
    const starsText = stars ? '★'.repeat(Math.round(stars)) + '☆'.repeat(5 - Math.round(stars)) : '';
    const when = r?.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';

    const reviewId = String(r?.id ?? '');
    const reviewUserId = String(r?.user_id ?? '');
    const isMine = (reviewUserId && reviewUserId === String(user?.id ?? ''))
      || (!!user?.username && String(r?.username ?? '') === String(user?.username ?? ''));
    const isEdited = !!r?.is_edited;

    const liked = likedMap.get(reviewId) === true;
    const likeFill = liked ? 1 : 0;
    const likeCount = Number(r?.likes_count ?? 0) || 0;

    const replies = reviewId ? getCachedReplies(reviewId) : [];
    const replyCount = replies.length;
    const replyToggleText = replyCount ? `View ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}` : '';

    return `
      <div class="bg-surface-container-lowest rounded-xl editorial-shadow p-7" data-review-id="${escapeHtml(
        reviewId
      )}" data-review-user-id="${escapeHtml(String(r?.user_id ?? ''))}">
        <div class="flex items-center justify-between gap-6 mb-3">
          <div class="min-w-0">
            <div class="font-label text-sm font-bold truncate">${escapeHtml(r?.username || 'User')}</div>
            <div class="font-label text-xs opacity-60">
              ${r?.username ? `<span class="mr-2">@${escapeHtml(r.username)}</span>` : ''}${escapeHtml(when)}${isEdited ? ` · edited` : ''}
            </div>
          </div>
          <div class="flex items-center gap-4 flex-none">
            ${starsText ? `<div class="font-label text-sm text-primary">${escapeHtml(starsText)}</div>` : ''}
            ${
              isMine
                ? `<button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="edit">Edit</button>
                   <button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-error transition-colors" type="button" data-action="delete">Delete</button>`
                : ''
            }
          </div>
        </div>
        <div data-review-content>
          <p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(r?.content || '')}</p>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-5">
          <button class="inline-flex items-center gap-2 font-label text-xs uppercase tracking-widest opacity-70 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="like" data-liked="${
            liked ? '1' : '0'
          }">
            <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' ${likeFill}, 'wght' 400, 'GRAD' 0, 'opsz' 24">favorite</span>
            <span class="tabular-nums" data-like-count>${escapeHtml(String(likeCount))}</span>
          </button>
          <button class="inline-flex items-center gap-2 font-label text-xs uppercase tracking-widest opacity-70 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="reply-toggle">
            <span class="material-symbols-outlined text-base">chat_bubble</span>
            Reply
          </button>
        </div>

        <div class="mt-4 space-y-3" data-replies-wrap>
          <button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors ${
            replyCount ? '' : 'hidden'
          }" type="button" data-action="replies-toggle" data-replies-open="0">${escapeHtml(replyToggleText)}</button>
          <div class="space-y-3 hidden" data-replies-list>
            ${replyCount ? renderReplyThreadHtml(replies, { currentUserId: user?.id ?? null }) : ''}
          </div>
          <form class="hidden space-y-3" data-reply-form>
            <div class="hidden font-label text-[10px] uppercase tracking-widest opacity-60" data-replying-to></div>
            <textarea class="w-full bg-surface-container-lowest border-none rounded-xl p-4 text-sm font-body focus:ring-1 focus:ring-primary-container outline-none editorial-shadow min-h-[96px]" placeholder="Write a reply…" required></textarea>
            <div class="flex items-center justify-end gap-3">
              <button class="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" type="button" data-action="reply-cancel">Cancel</button>
              <button class="bg-primary text-on-primary px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:opacity-95 transition-opacity" type="submit" data-action="reply-submit">Post</button>
            </div>
            <p class="font-label text-sm text-error hidden" data-reply-error></p>
          </form>
        </div>
      </div>
    `.trim();
  }

  function setReviewsCount(n) {
    const el = document.getElementById('reviewsCount');
    if (el) el.textContent = `${n} review${n === 1 ? '' : 's'}`;
  }

  async function loadReviews({ reset = false } = {}) {
    if (reset) {
      offset = 0;
      reviewsList.innerHTML = renderReviewsSkeleton(3);
      loadMoreBtn.classList.add('hidden');
    }
    let d;
    try {
      d = await fetchJson(
        `${FASTAPI_BASE}/api/reviews/${encodeURIComponent(restaurantId)}?limit=${limit}&offset=${offset}`
      );
    } catch {
      if (reset) {
        reviewsList.innerHTML = `<div class="font-label text-sm opacity-60">No reviews yet. Be the first.</div>`;
        loadMoreBtn.classList.add('hidden');
      }
      return;
    }
    const items = Array.isArray(d?.reviews) ? d.reviews : [];
    total = Number(d?.total ?? items.length);
    setReviewsCount(total);

    if (reset && !items.length) {
      reviewsList.innerHTML = `<div class="font-label text-sm opacity-60">No reviews yet. Be the first.</div>`;
      loadMoreBtn.classList.add('hidden');
      return;
    }

    // Pre-fetch replies for each review so counts are correct when cards render
    await Promise.all(items.map((r) => fetchReplies(r.id, { headers })));

    if (reset) {
      reviewsList.innerHTML = items.map(renderReviewCard).join('\n');
    } else {
      reviewsList.insertAdjacentHTML('beforeend', items.map(renderReviewCard).join('\n'));
    }
    offset += items.length;

    if (offset < total) loadMoreBtn.classList.remove('hidden');
    else loadMoreBtn.classList.add('hidden');
  }

  await loadReviews({ reset: true });

  reviewsList?.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;

    const card = btn.closest?.('[data-review-id]');
    if (!card) return;

    const reviewId = card.getAttribute('data-review-id');
    if (!reviewId) return;

    const action = btn.getAttribute('data-action');

    const tokenNow = getToken();
    if (!tokenNow) {
      window.location.replace('login.html');
      return;
    }
    const headersNow = { Authorization: `Bearer ${tokenNow}` };

    if (action === 'like') {
      const wasLiked = btn.getAttribute('data-liked') === '1';
      const nextLiked = !wasLiked;

      const countEl = btn.querySelector('[data-like-count]');
      const iconEl = btn.querySelector('.material-symbols-outlined');
      const curCount = Number(countEl?.textContent ?? 0) || 0;
      const nextCount = Math.max(0, curCount + (nextLiked ? 1 : -1));

      // Optimistic UI
      btn.setAttribute('data-liked', nextLiked ? '1' : '0');
      if (countEl) countEl.textContent = String(nextCount);
      if (iconEl) iconEl.style.fontVariationSettings = `'FILL' ${nextLiked ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;

      likedMap.set(reviewId, nextLiked);

      try {
        await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}/like`, {
          method: nextLiked ? 'POST' : 'DELETE',
          headers: nextLiked ? { ...headersNow, 'Content-Type': 'application/json' } : headersNow,
        });
      } catch {
        // rollback
        btn.setAttribute('data-liked', wasLiked ? '1' : '0');
        if (countEl) countEl.textContent = String(curCount);
        if (iconEl) iconEl.style.fontVariationSettings = `'FILL' ${wasLiked ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;
        likedMap.set(reviewId, wasLiked);
      }
      return;
    }

    if (action === 'reply-toggle') {
      const form = card.querySelector('form[data-reply-form]');
      const err = form?.querySelector('[data-reply-error]');
      const replyingTo = form?.querySelector('[data-replying-to]');
      if (err) {
        err.textContent = '';
        err.classList.add('hidden');
      }
      if (form) {
        form.dataset.parentReplyId = '';
      }
      if (replyingTo) {
        replyingTo.textContent = '';
        replyingTo.classList.add('hidden');
      }
      form?.classList.toggle('hidden');
      form?.querySelector('textarea')?.focus?.();
      return;
    }

    if (action === 'reply-to') {
      const targetReplyId = btn.getAttribute('data-reply-id') || '';
      const targetUser = btn.getAttribute('data-reply-username') || 'User';
      if (!targetReplyId) return;

      const listToggle = card.querySelector('button[data-action="replies-toggle"]');
      const list = card.querySelector('[data-replies-list]');
      const replies = await fetchReplies(reviewId, { headers: headersNow });
      const count = replies.length;

      if (listToggle && list) {
        // Ensure the thread is visible.
        listToggle.classList.remove('hidden');
        listToggle.setAttribute('data-replies-open', '1');
        listToggle.textContent = 'Hide replies';
        list.innerHTML = renderReplyThreadHtml(replies, { currentUserId: user?.id ?? null });
        list.classList.remove('hidden');
      }

      const form = card.querySelector('form[data-reply-form]');
      const err = form?.querySelector('[data-reply-error]');
      const replyingTo = form?.querySelector('[data-replying-to]');
      if (err) {
        err.textContent = '';
        err.classList.add('hidden');
      }
      if (form) {
        form.dataset.parentReplyId = targetReplyId;
        form.classList.remove('hidden');
      }
      if (replyingTo) {
        replyingTo.textContent = `Replying to ${targetUser}`;
        replyingTo.classList.remove('hidden');
      }
      form?.querySelector('textarea')?.focus?.();
      return;
    }

    if (action === 'reply-cancel') {
      const form = card.querySelector('form[data-reply-form]');
      const ta = form?.querySelector('textarea');
      const err = form?.querySelector('[data-reply-error]');
      const replyingTo = form?.querySelector('[data-replying-to]');
      if (ta) ta.value = '';
      if (err) {
        err.textContent = '';
        err.classList.add('hidden');
      }
      if (form) form.dataset.parentReplyId = '';
      if (replyingTo) {
        replyingTo.textContent = '';
        replyingTo.classList.add('hidden');
      }
      form?.classList.add('hidden');
      return;
    }

    if (action === 'replies-toggle') {
      const list = card.querySelector('[data-replies-list]');
      const open = btn.getAttribute('data-replies-open') === '1';
      // Fetch fresh from DB when opening
      const replies = open ? getCachedReplies(reviewId) : await fetchReplies(reviewId, { headers: headersNow });
      const count = replies.length;

      if (!list) return;
      if (!open) list.innerHTML = renderReplyThreadHtml(replies, { currentUserId: user?.id ?? null });

      list.classList.toggle('hidden', open);
      btn.setAttribute('data-replies-open', open ? '0' : '1');
      btn.textContent = open ? `View ${count} repl${count === 1 ? 'y' : 'ies'}` : 'Hide replies';
      return;
    }

    if (action === 'child-toggle') {
      const replyId = btn.getAttribute('data-reply-id') || '';
      if (!replyId) return;
      const open = btn.getAttribute('data-open') === '1';

      const replies = getCachedReplies(reviewId);
      const map = buildReplyChildrenMap(replies);
      const childCount = (map.get(replyId) || []).length;

      const container = card.querySelector(`[data-reply-children="${cssEscape(replyId)}"]`);
      if (!container) return;

      container.classList.toggle('hidden', open);
      btn.setAttribute('data-open', open ? '0' : '1');
      btn.textContent = open ? `View ${childCount} repl${childCount === 1 ? 'y' : 'ies'}` : 'Hide replies';
      return;
    }

    if (action === 'delete-reply') {
      const replyId = btn.getAttribute('data-reply-id') || '';
      if (!replyId) return;
      if (!confirm('Delete this reply? This cannot be undone.')) return;
      btn.disabled = true;
      try {
        await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}/replies/${encodeURIComponent(replyId)}`, {
          method: 'DELETE',
          headers: headersNow,
        });
        // Re-fetch and re-render replies
        const replies = await fetchReplies(reviewId, { headers: headersNow });
        const list = card.querySelector('[data-replies-list]');
        const toggle = card.querySelector('button[data-action="replies-toggle"]');
        if (list) list.innerHTML = renderReplyThreadHtml(replies, { currentUserId: user?.id ?? null });
        if (toggle) {
          if (replies.length) {
            toggle.classList.remove('hidden');
            toggle.textContent = toggle.getAttribute('data-replies-open') === '1' ? 'Hide replies' : `View ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`;
          } else {
            toggle.classList.add('hidden');
            if (list) list.classList.add('hidden');
          }
        }
      } catch (ex) {
        alert(ex?.message || 'Could not delete reply.');
        btn.disabled = false;
      }
      return;
    }

    if (action === 'delete') {
      const isMine = String(card.getAttribute('data-review-user-id') || '') === String(user?.id || '');
      if (!isMine) return;
      if (!confirm('Delete your review? This cannot be undone.')) return;
      btn.disabled = true;
      try {
        await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}`, {
          method: 'DELETE',
          headers: headersNow,
        });
        card.remove();
        total = Math.max(0, total - 1);
        offset = Math.max(0, offset - 1);
        setReviewsCount(total);
        if (!reviewsList.querySelector('[data-review-id]')) {
          reviewsList.innerHTML = `<div class="font-label text-sm opacity-60">No reviews yet. Be the first.</div>`;
        }
      } catch (ex) {
        alert(ex?.message || 'Could not delete review.');
        btn.disabled = false;
      }
      return;
    }

    if (action === 'edit') {
      const isMine = String(card.getAttribute('data-review-user-id') || '') === String(user?.id || '');
      if (!isMine) return;

      const contentWrap = card.querySelector('[data-review-content]');
      if (!contentWrap) return;
      if (contentWrap.querySelector('textarea[data-edit-text]')) return;

      const existingP = contentWrap.querySelector('p');
      const original = existingP?.textContent ?? '';
      card.dataset.originalReviewContent = original;

      contentWrap.innerHTML = `
        <textarea class="w-full bg-surface-container-lowest border-none rounded-xl p-4 text-sm font-body focus:ring-1 focus:ring-primary-container outline-none editorial-shadow min-h-[140px]" data-edit-text>${escapeHtml(
          original
        )}</textarea>
        <div class="mt-3 flex items-center justify-end gap-3">
          <button class="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" type="button" data-action="edit-cancel">Cancel</button>
          <button class="bg-primary text-on-primary px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:opacity-95 transition-opacity" type="button" data-action="edit-save">Save</button>
        </div>
        <p class="font-label text-sm text-error hidden mt-3" data-edit-error></p>
      `.trim();
      contentWrap.querySelector('textarea')?.focus?.();
      return;
    }

    if (action === 'edit-cancel') {
      const contentWrap = card.querySelector('[data-review-content]');
      const ta = contentWrap?.querySelector('textarea[data-edit-text]');
      if (!contentWrap || !ta) return;
      const original = card.dataset.originalReviewContent ?? '';
      delete card.dataset.originalReviewContent;
      contentWrap.innerHTML = `<p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(
        original
      )}</p>`;
      return;
    }

    if (action === 'edit-save') {
      const contentWrap = card.querySelector('[data-review-content]');
      const ta = contentWrap?.querySelector('textarea[data-edit-text]');
      const err = contentWrap?.querySelector('[data-edit-error]');
      if (!contentWrap || !ta) return;

      if (err) {
        err.textContent = '';
        err.classList.add('hidden');
      }

      const next = (ta.value || '').trim();
      if (!next) {
        if (err) {
          err.textContent = 'Review cannot be empty.';
          err.classList.remove('hidden');
        }
        return;
      }

      btn.disabled = true;
      try {
        await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}`, {
          method: 'PUT',
          headers: { ...headersNow, 'Content-Type': 'application/json' },
          body: { content: next },
        });

        contentWrap.innerHTML = `<p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(
          next
        )}</p>`;
        delete card.dataset.originalReviewContent;

        const metaLine = card.querySelector('.font-label.text-xs.opacity-60');
        if (metaLine && !String(metaLine.innerHTML || '').includes('edited')) {
          metaLine.innerHTML = `${escapeHtml(metaLine.textContent || '')}<span class="opacity-60"> · edited</span>`;
        }
      } catch (ex) {
        if (err) {
          err.textContent = ex?.message || 'Could not update review.';
          err.classList.remove('hidden');
        }
      } finally {
        btn.disabled = false;
      }
      return;
    }
  });

  reviewsList?.addEventListener('submit', async (e) => {
    const form = e.target?.closest?.('form[data-reply-form]');
    if (!form) return;
    e.preventDefault();

    const card = form.closest?.('[data-review-id]');
    const reviewId = card?.getAttribute?.('data-review-id');
    if (!reviewId) return;

    const ta = form.querySelector('textarea');
    const err = form.querySelector('[data-reply-error]');
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }

    const content = (ta?.value || '').trim();
    if (!content) {
      if (err) {
        err.textContent = 'Reply cannot be empty.';
        err.classList.remove('hidden');
      }
      return;
    }

    const submitBtn = form.querySelector('[data-action="reply-submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const parentId = (form.dataset.parentReplyId || '').trim() || null;
    const token = getToken();
    const headersWithAuth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      await fetchJson(`${FASTAPI_BASE}/api/reviews/${encodeURIComponent(reviewId)}/replies`, {
        method: 'POST',
        headers: headersWithAuth,
        body: JSON.stringify({ content, parent_id: parentId ? Number(parentId) : null }),
      });
    } catch (ex) {
      if (err) {
        err.textContent = ex?.message || 'Could not post reply.';
        err.classList.remove('hidden');
      }
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    if (ta) ta.value = '';
    form.classList.add('hidden');
    form.dataset.parentReplyId = '';
    const replyingTo = form.querySelector('[data-replying-to]');
    if (replyingTo) {
      replyingTo.textContent = '';
      replyingTo.classList.add('hidden');
    }
    if (submitBtn) submitBtn.disabled = false;

    // Re-fetch and re-render the replies list
    const replies = await fetchReplies(reviewId, { headers: { Authorization: `Bearer ${token}` } });
    const toggle = card.querySelector('button[data-action="replies-toggle"]');
    const list = card.querySelector('[data-replies-list]');
    if (toggle) {
      toggle.classList.remove('hidden');
      toggle.setAttribute('data-replies-open', '1');
      toggle.textContent = 'Hide replies';
    }
    if (list) {
      list.innerHTML = renderReplyThreadHtml(replies, { currentUserId: user?.id ?? null });
      list.classList.remove('hidden');
    }

    // If we replied to a reply, expand the chain so it remains visible.
    if (parentId && card) {
      const parentById = new Map(replies.map((r) => [String(r?.id ?? ''), r?.parent_id ?? null]));
      let cur = parentId;
      while (cur) {
        const container = card.querySelector(`[data-reply-children="${cssEscape(cur)}"]`);
        const replyBtn = card.querySelector(`button[data-action="child-toggle"][data-reply-id="${cssEscape(cur)}"]`);
        if (container) container.classList.remove('hidden');
        if (replyBtn) {
          replyBtn.setAttribute('data-open', '1');
          replyBtn.textContent = 'Hide replies';
        }
        cur = parentById.get(cur) || null;
      }
    }
  });

  loadMoreBtn?.addEventListener('click', async () => {
    loadMoreBtn.disabled = true;
    try {
      await loadReviews({ reset: false });
    } finally {
      loadMoreBtn.disabled = false;
    }
  });

  reviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reviewError) {
      reviewError.textContent = '';
      reviewError.classList.add('hidden');
    }
    const content = reviewText?.value?.trim() || '';
    if (!content) return;

    const btn = document.getElementById('postReviewBtn');
    if (btn) btn.disabled = true;
    try {
      await fetchJson(`${FASTAPI_BASE}/api/reviews`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: { restaurant_id: restaurantId, content, rating: currentUserStars || null },
      });
      reviewText.value = '';
      await Promise.all([refreshRatings(), loadReviews({ reset: true })]);
      setReviewsCount(total);
    } catch (ex) {
      if (reviewError) {
        reviewError.textContent = ex?.message || 'Could not post review.';
        reviewError.classList.remove('hidden');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Add to list modal
  const addToListBtn = document.getElementById('addToListBtn');

  function openAddToListModal(lists) {
    if (document.getElementById('addToListModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'addToListModal';
    overlay.className =
      'fixed inset-0 z-50 bg-on-surface/30 backdrop-blur-sm flex items-center justify-center p-6';

    const items = (lists || []).map((l) => {
      const checked = !!l?.contains_restaurant;
      return `
        <label class="flex items-center justify-between gap-4 bg-surface-container-low p-4 rounded-xl">
          <div class="min-w-0">
            <div class="font-label text-sm font-bold truncate">${escapeHtml(l?.title || 'List')}</div>
          </div>
          <input type="checkbox" class="rounded" data-list-id="${escapeHtml(String(l?.id ?? ''))}" ${
            checked ? 'checked' : ''
          } />
        </label>
      `.trim();
    });

    overlay.innerHTML = `
      <div class="w-full max-w-xl bg-surface-container-lowest rounded-xl editorial-shadow p-8">
        <div class="flex items-start justify-between gap-6 mb-6">
          <div>
            <p class="font-label uppercase tracking-widest text-xs text-primary mb-2">Lists</p>
            <h2 class="font-headline text-3xl italic">Add to list</h2>
          </div>
          <button type="button" id="closeAddToList" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close">close</button>
        </div>
        <form id="addToListForm" class="space-y-4">
          <div class="space-y-3 max-h-96 overflow-auto pr-1">${items.join('\n')}</div>
          <p class="font-label text-sm text-error hidden" id="addToListError"></p>
          <div class="flex gap-3 justify-end pt-2">
            <button type="button" class="bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" id="cancelAddToList">Cancel</button>
            <button type="submit" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-full font-label text-xs font-bold tracking-widest uppercase hover:opacity-90 active:scale-95 transition-all editorial-shadow" id="saveAddToList">Save</button>
          </div>
        </form>
      </div>
    `.trim();

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#closeAddToList')?.addEventListener('click', close);
    overlay.querySelector('#cancelAddToList')?.addEventListener('click', close);

    overlay.querySelector('#addToListForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = overlay.querySelector('#addToListError');
      if (err) {
        err.textContent = '';
        err.classList.add('hidden');
      }

      const checks = Array.from(overlay.querySelectorAll('input[type="checkbox"][data-list-id]'));
      const desired = new Map(checks.map((c) => [c.getAttribute('data-list-id'), !!c.checked]));
      const current = new Map((lists || []).map((l) => [String(l?.id ?? ''), !!l?.contains_restaurant]));

      const ops = [];
      desired.forEach((want, listId) => {
        const has = current.get(listId) || false;
        if (want && !has) {
          ops.push(
            fetchJson(`${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/items`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: { restaurant_id: restaurantId, notes: null },
            })
          );
        }
        if (!want && has) {
          ops.push(
            fetchJson(
              `${FASTAPI_BASE}/api/lists/${encodeURIComponent(listId)}/items/by-restaurant/${encodeURIComponent(restaurantId)}`,
              {
                method: 'DELETE',
                headers,
              }
            )
          );
        }
      });

      const btn = overlay.querySelector('#saveAddToList');
      if (btn) btn.disabled = true;
      try {
        await Promise.all(ops);
        close();
      } catch (ex) {
        if (err) {
          err.textContent = ex?.message || 'Failed to update lists.';
          err.classList.remove('hidden');
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  addToListBtn?.addEventListener('click', async () => {
    addToListBtn.disabled = true;
    try {
      const d = await fetchJson(`${FASTAPI_BASE}/api/restaurants/${encodeURIComponent(restaurantId)}/in-lists`, {
        headers,
      });
      const lists = Array.isArray(d?.lists) ? d.lists : [];
      openAddToListModal(lists);
    } catch {
      // ignore for now
    } finally {
      addToListBtn.disabled = false;
    }
  });

  window.__CATALOG_RESTAURANT_INIT_DONE__ = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
