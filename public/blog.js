// Blog / Journal controller
// PORT FROM OLD PROJECT: `Catalog/userentry/blog?` (journal + localStorage comments).

import { getToken, fetchCurrentUser, logout } from './auth.js';
import { getSupabaseClient } from './supabase-client.js';
import { startProgress, finishProgress } from './progress.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// ─── Restaurant link cache (for blog hyperlinking) ────────────────────────────

let _restaurantLinkCache = null;

async function fetchRestaurantsForLinking() {
  if (_restaurantLinkCache !== null) return _restaurantLinkCache;
  try {
    const supabase = getSupabaseClient();
    // Select only 'name' — the restaurants table has no slug column; the slug
    // is computed by the Express server as LOWER(REPLACE(name,' ','-')).
    const { data, error } = await supabase
      .from('restaurants')
      .select('name')
      .limit(500);
    if (error) throw error;
    _restaurantLinkCache = (Array.isArray(data) ? data : [])
      .filter((r) => r?.name)
      .map((r) => {
        const name = String(r.name).trim();
        // Mirror the server's slug formula exactly
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        return { name, slug };
      });
  } catch {
    _restaurantLinkCache = [];
  }
  return _restaurantLinkCache;
}

/**
 * Replaces restaurant name mentions in already-HTML-escaped text with anchor links.
 * Single-pass replacement prevents double-linking.
 * Longer names are matched first to avoid partial matches (e.g. "Café Noir" before "Café").
 */
function linkifyRestaurants(escapedText, restaurants) {
  if (!restaurants || !restaurants.length || !escapedText) return escapedText;

  // Sort longest-first: longer names win over shorter substring matches
  const sorted = [...restaurants].sort((a, b) => b.name.length - a.name.length);

  const nameToLink = new Map();
  const patterns = [];

  for (const { name, slug } of sorted) {
    const esc = escapeHtml(name); // match against already-escaped paragraph content
    const key = esc.toLowerCase();
    if (!esc || nameToLink.has(key)) continue;
    const href = `restaurant?slug=${encodeURIComponent(slug)}`;
    nameToLink.set(key, `<a href="${href}" class="catalog-restaurant-link">${esc}</a>`);
    patterns.push(esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  if (!patterns.length) return escapedText;

  // Single combined regex — sorted longest-first in the alternation so greedy left wins
  const combined = new RegExp(`(?<![\\w>])(${patterns.join('|')})(?![\\w<])`, 'gi');
  return escapedText.replace(combined, (match) => nameToLink.get(match.toLowerCase()) || match);
}

// ─── Login overlay ────────────────────────────────────────────────────────────

function openLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
}

function closeLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.classList.remove('flex');
}

function wireLoginOverlay() {
  document.getElementById('closeLoginOverlay')?.addEventListener('click', closeLoginOverlay);
  document.getElementById('loginOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLoginOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLoginOverlay();
  });
}

// ─── Nav account dropdown ─────────────────────────────────────────────────────

function wireAccountDropdown({ user }) {
  const accountBtn = document.getElementById('navAccountBtn');
  if (!accountBtn) return;
  accountBtn.style.visibility = 'visible';

  if (!user) {
    accountBtn.setAttribute('aria-label', 'Sign in');
    accountBtn.textContent = 'login';
    accountBtn.style.cursor = 'pointer';
    accountBtn.onclick = () => (window.location.href = 'login');
    return;
  }

  const initial = (user?.username || 'U')[0]?.toUpperCase?.() || 'U';
  accountBtn.setAttribute('aria-label', 'Account menu');
  accountBtn.textContent = '';

  const chip = document.createElement('div');
  chip.className =
    'w-10 h-10 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold cursor-pointer';
  chip.textContent = initial;
  accountBtn.appendChild(chip);

  const menu = document.createElement('div');
  menu.id = 'navAccountMenu';
  menu.className = 'hidden fixed z-50 w-72 bg-surface-container-lowest rounded-xl editorial-shadow p-5';
  menu.innerHTML = `
    <div class="flex items-center gap-4 mb-4">
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(initial)}</div>
      <div class="min-w-0">
        <div class="font-label font-bold text-sm truncate">${escapeHtml(user?.username || 'User')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(user?.email || '')}</div>
      </div>
    </div>
    <div class="h-px w-full bg-on-surface/10 my-4"></div>
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile?id=${encodeURIComponent(user?.id ?? '')}">Profile</a>
    <button id="navLogoutBtn" class="w-full text-left font-label text-sm py-2 hover:text-primary transition-colors" type="button">Log out</button>
  `;
  document.body.appendChild(menu);

  function positionMenu() {
    const rect = accountBtn.getBoundingClientRect();
    const width = 288;
    const margin = 16;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 10}px`;
  }

  const toggleMenu = () => {
    const hidden = menu.classList.contains('hidden');
    if (hidden) { positionMenu(); menu.classList.remove('hidden'); }
    else menu.classList.add('hidden');
  };

  accountBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); };
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => menu.classList.add('hidden'));
  window.addEventListener('resize', () => { if (!menu.classList.contains('hidden')) positionMenu(); });
  window.addEventListener('scroll', () => { if (!menu.classList.contains('hidden')) positionMenu(); });
  menu.querySelector('#navLogoutBtn')?.addEventListener('click', () => logout('login'));
}

// ─── Fallback posts ───────────────────────────────────────────────────────────

const FALLBACK_POSTS = [
  {
    slug: 'la-maison-noir',
    tag: 'Featured',
    title: 'La Maison Noir',
    author: 'Karan',
    date: 'Mar 2026',
    readTime: '6 min read',
    heroImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1600&q=80',
    excerpt:
      "La Maison Noir doesn't ask for attention. It rewards it. Hidden from the rush, it feels designed for people who notice the quiet details.",
    body: [
      "La Maison Noir doesn't ask for attention. It rewards it. Hidden from the rush, it feels designed for people who notice the quiet details.",
      'The truffle pasta arrives glossy and restrained. The steak follows, confident and unnecessary to explain.',
      'You linger longer than planned. Conversation stretches. Nothing feels rushed, not even the end.',
    ],
    quote: "What stays with you is not only the food. It's the pace the place forces you into.",
  },
  {
    slug: 'midnight-dining-culture',
    tag: 'Essay',
    title: 'Midnight Dining Culture',
    author: 'Catalog',
    date: 'Mar 2026',
    readTime: '5 min read',
    heroImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80',
    excerpt: "Why some nights feel like the city's real dining room opens after 11pm.",
    body: [
      'After 11pm, menus get simpler and conversations get better.',
      "Late dining isn't about speed; it's about pace, glow, and a little anonymity.",
      'The best places lean into quiet confidence: fewer choices, better execution.',
    ],
    quote: 'The city tastes different when the day stops performing.',
  },
  {
    slug: 'quiet-restaurants-better',
    tag: 'Guide',
    title: 'Why Quiet Restaurants Are Better',
    author: 'Catalog',
    date: 'Mar 2026',
    readTime: '4 min read',
    heroImage: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1600&q=80',
    excerpt: 'A short guide to the places that stop trying so hard—and win.',
    body: [
      'The best rooms feel tuned. Light levels, spacing, pacing—all intentional.',
      'Quiet is not emptiness. It is confidence.',
      'If you can hear your own thoughts, you can taste the food.',
    ],
    quote: 'A good restaurant is a mood you can return to.',
  },
];

// ─── Post normalisation ───────────────────────────────────────────────────────

function normalizePost(row) {
  const slug = row?.slug ? String(row.slug) : '';
  const title = row?.title ? String(row.title) : 'Untitled';
  const tag = row?.tag ? String(row.tag) : 'Blog';
  const excerpt = row?.excerpt ? String(row.excerpt) : '';
  const heroImage = row?.hero_image ? String(row.hero_image) : row?.heroImage ? String(row.heroImage) : '';
  const author = row?.author ? String(row.author) : 'Catalog';

  const created = row?.created_at ? new Date(row.created_at) : null;
  const date =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : row?.date
        ? String(row.date)
        : '';

  const readTime = row?.read_time ? String(row.read_time) : row?.readTime ? String(row.readTime) : '';

  const body = Array.isArray(row?.body)
    ? row.body.map((p) => String(p))
    : typeof row?.body === 'string'
      ? row.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      : typeof row?.content === 'string'
        ? row.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
        : null;

  const quote = row?.quote ? String(row.quote) : '';

  return { slug, title, tag, excerpt, heroImage, author, date, readTime, body, quote, raw: row };
}

// ─── Supabase data fetching ───────────────────────────────────────────────────

async function fetchAllPosts() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('blogs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(24);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const normalized = rows.map(normalizePost).filter((p) => p.slug);
    if (normalized.length) return normalized;
  } catch {
    // fall through to fallback
  }
  return FALLBACK_POSTS.map(normalizePost);
}

async function fetchPostBySlug(slug) {
  if (!slug) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('blogs').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (data) return normalizePost(data);
  } catch {
    // fall through
  }
  return FALLBACK_POSTS.map(normalizePost).find((p) => p.slug === slug) || null;
}

// ─── Card templates ───────────────────────────────────────────────────────────

function indexCardHtml(post) {
  const href = `blog?slug=${encodeURIComponent(post.slug)}`;
  return `
    <a href="${href}" class="group bg-surface-container-lowest rounded-2xl overflow-hidden editorial-shadow hover:-translate-y-0.5 transition-all duration-300 border border-on-surface/5 flex flex-col">
      <div class="aspect-[16/9] overflow-hidden flex-none">
        <img
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          src="${escapeHtml(post.heroImage)}"
          alt="${escapeHtml(post.title)}"
          loading="lazy"
        />
      </div>
      <div class="p-5 flex flex-col flex-1">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="font-label uppercase tracking-widest text-[10px] text-primary">${escapeHtml(post.tag)}</span>
          <span class="font-label text-[10px] opacity-40">${escapeHtml(post.readTime)}</span>
        </div>
        <div class="font-headline italic text-lg leading-snug tracking-tight group-hover:underline underline-offset-4 line-clamp-2">${escapeHtml(post.title)}</div>
        <div class="font-body text-xs opacity-60 leading-relaxed mt-2 line-clamp-2">${escapeHtml(post.excerpt)}</div>
        <div class="mt-4 flex items-center justify-between gap-2">
          <div class="font-label text-[11px] opacity-40">${escapeHtml(post.author)} · ${escapeHtml(post.date)}</div>
          <span class="material-symbols-outlined text-sm opacity-40 group-hover:opacity-80 transition-opacity">arrow_forward</span>
        </div>
      </div>
    </a>
  `;
}

function featuredCardHtml(post) {
  const href = `blog?slug=${encodeURIComponent(post.slug)}`;
  return `
    <a href="${href}" class="group relative block rounded-3xl overflow-hidden editorial-shadow" style="height:520px;">
      <!-- Full-bleed image -->
      <img
        class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
        src="${escapeHtml(post.heroImage)}"
        alt="${escapeHtml(post.title)}"
      />

      <!-- Gradient overlay: transparent top → dark bottom -->
      <div class="absolute inset-0" style="background: linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 35%, rgba(15,10,8,0.82) 75%, rgba(15,10,8,0.95) 100%);"></div>

      <!-- Top-left tag badge -->
      <div class="absolute top-7 left-8">
        <span class="font-label uppercase tracking-[0.2em] text-[10px] font-bold bg-white/15 backdrop-blur-sm text-white border border-white/25 px-4 py-2 rounded-full">${escapeHtml(post.tag)}</span>
      </div>

      <!-- Top-right read time -->
      <div class="absolute top-7 right-8">
        <span class="font-label text-[11px] text-white/60">${escapeHtml(post.readTime)}</span>
      </div>

      <!-- Bottom content -->
      <div class="absolute bottom-0 left-0 right-0 p-8 md:p-12">
        <div class="max-w-3xl">
          <h2 class="font-headline italic text-5xl md:text-6xl lg:text-7xl leading-none tracking-tight text-white mb-4 group-hover:opacity-90 transition-opacity">${escapeHtml(post.title)}</h2>
          <p class="font-body text-[15px] text-white/70 leading-relaxed line-clamp-2 mb-6 max-w-xl">${escapeHtml(post.excerpt)}</p>
          <div class="flex items-center justify-between gap-4">
            <div class="font-label text-sm text-white/50">${escapeHtml(post.author)} · ${escapeHtml(post.date)}</div>
            <div class="inline-flex items-center gap-2 font-label uppercase tracking-widest text-[10px] font-bold text-white/80 group-hover:text-white transition-colors">
              Read <span class="material-symbols-outlined text-sm">arrow_forward</span>
            </div>
          </div>
        </div>
      </div>
    </a>
  `;
}

// ─── Post shell (individual article view) ────────────────────────────────────

function postShellHtml(post, { restaurants = [] } = {}) {
  const body = Array.isArray(post.body) && post.body.length ? post.body : [post.excerpt || ''];
  const paragraphs = body
    .filter((p) => String(p).trim())
    .map((p) => {
      const escaped = escapeHtml(String(p));
      const linked = restaurants.length ? linkifyRestaurants(escaped, restaurants) : escaped;
      return `<p class="font-body text-[15px] md:text-[16px] leading-[1.85] opacity-90">${linked}</p>`;
    })
    .join('');

  const quoteHtml = post.quote
    ? `
      <blockquote class="my-10 pl-8 border-l-2 border-primary/30">
        <span class="font-label uppercase tracking-widest text-[10px] text-primary mb-2 block">Quote</span>
        <div class="font-headline italic text-2xl md:text-3xl leading-snug text-on-surface">${escapeHtml(post.quote)}</div>
      </blockquote>
    `
    : '';

  return `
    <!-- Back link -->
    <a href="blog" class="inline-flex items-center gap-2 font-label uppercase tracking-widest text-xs text-primary hover:opacity-80 transition-opacity mb-10">
      <span class="material-symbols-outlined text-sm">arrow_back</span> Back to the journal
    </a>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">

      <!-- Article -->
      <article class="lg:col-span-8 bg-surface-container-lowest rounded-3xl overflow-hidden editorial-shadow border border-on-surface/5">
        <div class="aspect-[16/7] overflow-hidden">
          <img class="w-full h-full object-cover" src="${escapeHtml(post.heroImage)}" alt="${escapeHtml(post.title)}" />
        </div>
        <div class="p-8 md:p-12">
          <div class="flex items-center gap-4 flex-wrap">
            <span class="font-label uppercase tracking-widest text-[10px] text-primary">${escapeHtml(post.tag)}</span>
            <div class="font-label text-xs opacity-50">${escapeHtml(post.author)} · ${escapeHtml(post.date)}${post.readTime ? ` · ${escapeHtml(post.readTime)}` : ''}</div>
          </div>
          <h1 class="font-headline italic text-4xl md:text-6xl tracking-tight leading-none mt-5 mb-8">${escapeHtml(post.title)}</h1>
          <div class="h-px bg-on-surface/10 mb-8"></div>
          <div class="grid gap-6">
            ${paragraphs}
          </div>
          ${quoteHtml}
        </div>
      </article>

      <!-- Sidebar -->
      <aside class="lg:col-span-4 sticky top-28 space-y-6 hidden lg:block">
        <div class="bg-surface-container-lowest rounded-2xl editorial-shadow border border-on-surface/5 p-7">
          <span class="font-label uppercase tracking-widest text-xs text-primary mb-4 block">Save what you want to try</span>
          <p class="font-body text-sm opacity-75 leading-relaxed">
            When a post mentions a place you like, tap "Save" on the restaurant page to keep it for later.
          </p>
          <div class="h-px bg-on-surface/10 my-6"></div>
          <a class="inline-flex items-center gap-2 font-label text-xs font-bold tracking-widest uppercase text-primary hover:opacity-80 transition-opacity" href="saved">
            Open Saved <span class="material-symbols-outlined text-sm">arrow_forward</span>
          </a>
        </div>

        <div class="bg-surface-container-lowest rounded-2xl editorial-shadow border border-on-surface/5 p-7">
          <span class="font-label uppercase tracking-widest text-xs text-primary mb-4 block">More from the journal</span>
          <div id="relatedPosts" class="space-y-5"></div>
        </div>
      </aside>
    </div>

    <!-- ── Comments / Reviews ────────────────────────────────────────── -->
    <section class="mt-16 bg-surface-container-low rounded-3xl editorial-shadow py-14 px-8 md:px-12" aria-label="Comments">
      <div class="flex items-baseline gap-4 mb-10">
        <h2 class="font-headline italic text-4xl tracking-tight">Comments</h2>
        <div class="h-px flex-grow bg-on-surface/10"></div>
        <div class="font-label text-xs opacity-50" id="commentsCount"></div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-10">

        <!-- Write a comment -->
        <div class="lg:col-span-5">
          <div class="bg-surface-container-lowest rounded-2xl editorial-shadow p-8">
            <p class="font-label uppercase tracking-widest text-xs text-primary mb-4">Write a comment</p>
            <form id="commentForm" class="space-y-4">
              <textarea
                id="commentText"
                class="w-full bg-surface-container-lowest border-none rounded-xl p-4 text-sm font-body focus:ring-1 focus:ring-primary-container outline-none editorial-shadow min-h-[140px] resize-none"
                placeholder="What did this make you think of?"
                rows="5"
              ></textarea>
              <div class="flex items-center justify-between gap-4">
                <div class="font-label text-xs opacity-60" id="commentHint"></div>
                <button
                  class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-7 py-3 rounded-full font-label text-[10px] font-bold tracking-widest uppercase editorial-shadow hover:opacity-90 active:scale-95 transition-all"
                  id="postCommentBtn"
                  type="submit"
                  >Post comment</button
                >
              </div>
              <p class="font-label text-sm text-error hidden" id="commentError"></p>
            </form>
          </div>
        </div>

        <!-- Comments list -->
        <div class="lg:col-span-7">
          <div class="space-y-5" id="commentsList">
            <div class="font-label text-sm opacity-50">Loading comments…</div>
          </div>
          <div class="mt-10 flex justify-center">
            <button
              class="bg-surface-container-lowest text-on-surface px-10 py-4 rounded-full font-label text-[10px] font-bold tracking-widest uppercase editorial-shadow hover:bg-surface transition-colors items-center gap-3 hidden"
              id="loadMoreCommentsBtn"
              type="button"
            >
              Load more
              <span class="material-symbols-outlined text-sm">expand_more</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ─── Comment card template ────────────────────────────────────────────────────

function commentCardHtml({ slug, node, depth, currentUserId, collapsedReplies, likedSet }) {
  const marginLeft = Math.min(depth, 5) * 20;
  const liked = likedSet ? likedSet.has(String(node.id)) : false;
  const likes = Number(node.likeCount ?? 0);
  const likeFill = liked ? 1 : 0;
  const hasChildren = (node.childrenCount || 0) > 0;
  const isCollapsed = collapsedReplies.has(node.id);
  const replyCount = node.childrenCount || 0;
  const toggleLabel = hasChildren
    ? `View ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}`
    : '';
  const isMine = currentUserId && node.userId === currentUserId;

  return `
    <div
      class="bg-surface-container-lowest rounded-xl editorial-shadow p-7"
      data-comment-id="${escapeHtml(node.id)}"
      data-comment-user-id="${escapeHtml(String(node.userId || ''))}"
      style="margin-left:${marginLeft}px"
    >
      <div class="flex items-center justify-between gap-6 mb-3">
        <div class="min-w-0">
          <div class="font-label text-sm font-bold truncate">${escapeHtml(node.name || 'User')}</div>
          <div class="font-label text-xs opacity-60">${escapeHtml(formatDate(node.createdAt))}${node.editedAt ? `<span class="opacity-60"> · edited</span>` : ''}</div>
        </div>
        <div class="flex items-center gap-4 flex-none">
          ${isMine ? `<button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="edit">Edit</button>` : ''}
          ${isMine ? `<button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-error transition-colors" type="button" data-action="delete">Delete</button>` : ''}
        </div>
      </div>

      <div data-comment-content>
        <p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(node.text)}</p>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-5">
        <button class="inline-flex items-center gap-2 font-label text-xs uppercase tracking-widest opacity-70 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="like" data-liked="${liked ? '1' : '0'}">
          <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' ${likeFill},'wght' 400,'GRAD' 0,'opsz' 24">favorite</span>
          <span class="tabular-nums" data-like-count>${likes}</span>
        </button>
        <button class="inline-flex items-center gap-2 font-label text-xs uppercase tracking-widest opacity-70 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="reply-toggle">
          <span class="material-symbols-outlined text-base">chat_bubble</span>
          Reply
        </button>
      </div>

      <div class="mt-4 space-y-3" data-replies-wrap>
        <button class="font-label text-xs uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors ${hasChildren ? '' : 'hidden'}" type="button" data-action="replies-toggle" data-replies-open="0">${escapeHtml(toggleLabel)}</button>
        <div class="space-y-3 hidden" data-replies-list></div>
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
  `;
}

// ─── Comment tree ─────────────────────────────────────────────────────────────

// Build a parent→children map from the flat comments array (same logic as restaurant.js)
function buildChildrenMap(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    const parent = item.parentId == null ? '' : String(item.parentId);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(item);
  });
  map.forEach((arr) => arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  return map;
}

// Recursive reply thread — exact same structure as restaurant.js renderReplyThreadHtml
// but uses `node.text` / `node.name` / `node.userId` from blog's comment schema
function renderReplyThread(items, currentUserId, { parentId = '', depth = 0, childrenMap = null } = {}) {
  const map = childrenMap || buildChildrenMap(items);
  const children = map.get(parentId == null ? '' : String(parentId)) || [];
  if (!children.length) return '';

  const clampDepth = Math.min(Math.max(Number(depth) || 0, 0), 8);
  const indent = clampDepth * 18;

  return children.map((rep) => {
    const id = String(rep?.id ?? '');
    const username = String(rep?.name || 'User');
    const initial = (username || 'U')[0].toUpperCase();
    const when = rep?.createdAt
      ? new Date(rep.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : '';
    const isMine = currentUserId && String(rep?.userId ?? '') === String(currentUserId);

    const childCount = (map.get(id) || []).length;
    const childToggle = childCount > 0
      ? `<button class="font-label text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 hover:text-primary transition-colors" type="button" data-action="child-toggle" data-reply-id="${escapeHtml(id)}" data-open="0">View ${childCount} repl${childCount === 1 ? 'y' : 'ies'}</button>`
      : '';

    const childrenHtml = childCount
      ? `<div class="mt-3 pl-4 border-l border-on-surface/10 hidden" data-reply-children="${escapeHtml(id)}">${renderReplyThread(items, currentUserId, { parentId: id, depth: clampDepth + 1, childrenMap: map })}</div>`
      : '';

    return `
      <div class="space-y-2" data-reply-node="${escapeHtml(id)}">
        <div class="flex gap-3" style="margin-left:${indent}px">
          <div class="w-9 h-9 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-xs font-bold flex-none">${escapeHtml(initial)}</div>
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
            <div class="font-body text-sm text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(rep?.text || '')}</div>
            ${childToggle ? `<div class="mt-3">${childToggle}</div>` : ''}
            ${childrenHtml}
          </div>
        </div>
      </div>
    `.trim();
  }).join('\n');
}

// Top-level comment cards only — replies rendered separately via renderReplyThread
function renderCommentThread({ slug, byParent, currentUserId, collapsedReplies, likedSet }) {
  // Top-level comments are stored under key '' in buildChildrenMap
  const nodes = byParent.get('') || [];
  return nodes.map((node) => {
    const children = byParent.get(String(node.id)) || [];
    const withCount = { ...node, childrenCount: children.length };
    return commentCardHtml({ slug, node: withCount, depth: 0, currentUserId, collapsedReplies, likedSet });
  }).join('');
}

// ─── Comment persistence (Supabase) ──────────────────────────────────────────
// Requires these tables in Supabase:
//
//   blog_comments (
//     id uuid primary key default gen_random_uuid(),
//     post_slug text not null,
//     parent_id uuid references blog_comments(id) on delete cascade,
//     user_id int not null,        -- matches users.id from the Express/PG users table
//     username text not null,
//     text text not null,
//     edited_at timestamptz,
//     created_at timestamptz default now()
//   )
//
//   blog_comment_likes (
//     id uuid primary key default gen_random_uuid(),
//     comment_id uuid not null references blog_comments(id) on delete cascade,
//     user_id int not null,
//     created_at timestamptz default now(),
//     unique (comment_id, user_id)
//   )
//
// Enable RLS and add policies:
//   blog_comments: SELECT public; INSERT/UPDATE/DELETE own rows (user_id = auth.uid() won't work
//     since we use our own JWT — use a service-role policy or open INSERT/DELETE for anon + validate user_id in app).
//   blog_comment_likes: same pattern.
//
// Simplest approach for now: set both tables to public read + public write (restrict by user_id in app code).

async function loadCommentsFromSupabase(slug) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('blog_comments')
      .select('*')
      .eq('post_slug', slug)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data.map(normalizeComment) : [];
  } catch { return []; }
}

function normalizeComment(row) {
  return {
    id: String(row.id ?? ''),
    parentId: row.parent_id ? String(row.parent_id) : null,
    postSlug: row.post_slug ?? '',
    userId: row.user_id != null ? Number(row.user_id) : null,
    name: String(row.username || 'User'),
    text: String(row.text || ''),
    createdAt: row.created_at ?? new Date().toISOString(),
    editedAt: row.edited_at ?? null,
    likeCount: Number(row.like_count ?? 0),
  };
}

async function insertComment(slug, { parentId, userId, username, text }) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('blog_comments')
    .insert({ post_slug: slug, parent_id: parentId || null, user_id: userId, username, text })
    .select()
    .single();
  if (error) throw error;
  return normalizeComment(data);
}

async function updateComment(commentId, text) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('blog_comments')
    .update({ text, edited_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw error;
}

async function deleteComment(commentId) {
  const supabase = getSupabaseClient();
  // Cascade delete handles children via FK
  const { error } = await supabase.from('blog_comments').delete().eq('id', commentId);
  if (error) throw error;
}

async function loadLikedCommentIds(userId) {
  if (!userId) return new Set();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('blog_comment_likes')
      .select('comment_id')
      .eq('user_id', userId);
    if (error) throw error;
    return new Set((data || []).map((r) => String(r.comment_id)));
  } catch { return new Set(); }
}

async function toggleCommentLike(commentId, userId, like) {
  const supabase = getSupabaseClient();
  if (like) {
    const { error } = await supabase
      .from('blog_comment_likes')
      .upsert({ comment_id: commentId, user_id: userId }, { onConflict: 'comment_id,user_id' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('blog_comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId);
    if (error) throw error;
  }
}

// ─── Wire comments UI ─────────────────────────────────────────────────────────

async function wireComments({ slug, post, user }) {
  const root = document.getElementById('blogPostView');
  if (!root) return;

  const commentsList = root.querySelector('#commentsList');
  const commentForm = root.querySelector('#commentForm');
  const commentText = root.querySelector('#commentText');
  const commentHint = root.querySelector('#commentHint');
  const commentCount = root.querySelector('#commentsCount');

  if (!commentsList || !commentForm || !commentText) return;

  // In-memory state (refreshed from Supabase on each mutation)
  let comments = [];
  let likedSet = new Set();
  const currentUserId = user?.id ?? null;

  async function reload() {
    [comments, likedSet] = await Promise.all([
      loadCommentsFromSupabase(slug),
      loadLikedCommentIds(currentUserId),
    ]);
  }

  function updateCount() {
    if (commentCount) {
      const top = comments.filter((c) => !c.parentId).length;
      commentCount.textContent = `${top} comment${top === 1 ? '' : 's'}`;
    }
  }

  function rerender() {
    const topLevel = comments.filter((c) => !c.parentId);
    const byParent = buildChildrenMap(comments);
    commentsList.innerHTML = topLevel.length
      ? renderCommentThread({ slug, byParent, currentUserId, collapsedReplies: new Set(), likedSet })
      : `<div class="font-label text-sm opacity-60">No comments yet. Be the first to post.</div>`;
    updateCount();
  }

  function refreshRepliesList(card, commentId) {
    const list = card.querySelector('[data-replies-list]');
    const toggle = card.querySelector('button[data-action="replies-toggle"]');
    const allReplies = comments.filter((c) => c.parentId != null);
    const directReplies = comments.filter((c) => c.parentId === commentId);

    if (list) {
      list.innerHTML = renderReplyThread(allReplies, currentUserId, { parentId: commentId });
      if (directReplies.length) list.classList.remove('hidden');
    }
    if (toggle) {
      const n = directReplies.length;
      if (n > 0) {
        toggle.classList.remove('hidden');
        toggle.setAttribute('data-replies-open', '1');
        toggle.textContent = 'Hide replies';
      } else {
        toggle.classList.add('hidden');
        toggle.setAttribute('data-replies-open', '0');
      }
    }
  }

  if (commentHint) {
    commentHint.textContent = user
      ? `Commenting as ${user.username || 'User'}.`
      : 'Sign in to comment.';
  }

  // Initial load
  await reload();
  rerender();

  // ── Submit new top-level comment ─────────────────────────────────────────
  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = String(commentText.value || '').trim();
    if (!user) { openLoginOverlay(); return; }
    if (!text) return;
    const submitBtn = commentForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await insertComment(slug, {
        parentId: null,
        userId: user.id,
        username: user.username || user.email || 'User',
        text,
      });
      commentText.value = '';
      await reload();
      rerender();
    } catch (ex) {
      const errEl = commentForm.querySelector('#commentError');
      if (errEl) { errEl.textContent = ex?.message || 'Could not post comment.'; errEl.classList.remove('hidden'); }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ── All delegated clicks ─────────────────────────────────────────────────
  commentsList.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');

    const card = btn.closest('[data-comment-id]');
    const commentId = card?.getAttribute?.('data-comment-id');

    // ── Like ──────────────────────────────────────────────────────────
    if (action === 'like' && commentId) {
      if (!user) { openLoginOverlay(); return; }
      const wasLiked = btn.getAttribute('data-liked') === '1';
      const nextLiked = !wasLiked;
      const countEl = btn.querySelector('[data-like-count]');
      const iconEl = btn.querySelector('.material-symbols-outlined');
      const curCount = parseInt(countEl?.textContent ?? '0', 10) || 0;
      const nextCount = Math.max(0, curCount + (nextLiked ? 1 : -1));
      // Optimistic update
      btn.setAttribute('data-liked', nextLiked ? '1' : '0');
      if (countEl) countEl.textContent = String(nextCount);
      if (iconEl) {
        iconEl.style.fontVariationSettings = `'FILL' ${nextLiked ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;
        iconEl.style.color = nextLiked ? '#690008' : 'inherit';
      }
      try {
        await toggleCommentLike(commentId, currentUserId, nextLiked);
        if (nextLiked) likedSet.add(commentId); else likedSet.delete(commentId);
      } catch {
        // rollback
        btn.setAttribute('data-liked', wasLiked ? '1' : '0');
        if (countEl) countEl.textContent = String(curCount);
        if (iconEl) iconEl.style.fontVariationSettings = `'FILL' ${wasLiked ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`;
      }
      return;
    }

    // ── Delete top-level comment ──────────────────────────────────────
    if (action === 'delete' && commentId) {
      const isMine = String(card.getAttribute('data-comment-user-id') || '') === String(user?.id || '');
      if (!isMine) return;
      if (!confirm('Delete this comment? This cannot be undone.')) return;
      btn.disabled = true;
      try {
        await deleteComment(commentId);
        await reload();
        rerender();
      } catch (ex) {
        alert(ex?.message || 'Could not delete comment.');
        btn.disabled = false;
      }
      return;
    }

    // ── Reply toggle (open reply form on top-level card) ──────────────
    if (action === 'reply-toggle' && commentId) {
      if (!user) { openLoginOverlay(); return; }
      const form = card.querySelector('form[data-reply-form]');
      if (!form) return;
      form.dataset.parentReplyId = '';
      const replyingTo = form.querySelector('[data-replying-to]');
      if (replyingTo) { replyingTo.textContent = ''; replyingTo.classList.add('hidden'); }
      form.classList.toggle('hidden');
      form.querySelector('textarea')?.focus?.();
      return;
    }

    // ── Reply cancel ──────────────────────────────────────────────────
    if (action === 'reply-cancel' && commentId) {
      const form = card.querySelector('form[data-reply-form]');
      const ta = form?.querySelector('textarea');
      if (ta) ta.value = '';
      if (form) { form.dataset.parentReplyId = ''; form.classList.add('hidden'); }
      return;
    }

    // ── Replies toggle (show/hide thread) ─────────────────────────────
    if (action === 'replies-toggle' && commentId) {
      const list = card.querySelector('[data-replies-list]');
      const open = btn.getAttribute('data-replies-open') === '1';
      const directReplies = comments.filter((c) => c.parentId === commentId);
      if (!list) return;
      if (!open) {
        const allReplies = comments.filter((c) => c.parentId != null);
        list.innerHTML = renderReplyThread(allReplies, currentUserId, { parentId: commentId });
      }
      list.classList.toggle('hidden', open);
      const n = directReplies.length;
      btn.setAttribute('data-replies-open', open ? '0' : '1');
      btn.textContent = open ? `View ${n} repl${n === 1 ? 'y' : 'ies'}` : 'Hide replies';
      return;
    }

    // ── Reply to a reply ──────────────────────────────────────────────
    if (action === 'reply-to' && commentId) {
      if (!user) { openLoginOverlay(); return; }
      const targetReplyId = btn.getAttribute('data-reply-id') || '';
      const targetUser = btn.getAttribute('data-reply-username') || 'User';
      const form = card.querySelector('form[data-reply-form]');
      if (!form) return;
      form.dataset.parentReplyId = targetReplyId;
      const replyingTo = form.querySelector('[data-replying-to]');
      if (replyingTo) { replyingTo.textContent = `Replying to ${targetUser}`; replyingTo.classList.remove('hidden'); }
      form.classList.remove('hidden');
      form.querySelector('textarea')?.focus?.();
      refreshRepliesList(card, commentId);
      return;
    }

    // ── Child toggle ──────────────────────────────────────────────────
    if (action === 'child-toggle' && commentId) {
      const replyId = btn.getAttribute('data-reply-id') || '';
      if (!replyId) return;
      const open = btn.getAttribute('data-open') === '1';
      const allReplies = comments.filter((c) => c.parentId != null);
      const map = buildChildrenMap(allReplies);
      const childCount = (map.get(replyId) || []).length;
      const container = card.querySelector(`[data-reply-children="${CSS.escape(replyId)}"]`);
      if (!container) return;
      container.classList.toggle('hidden', open);
      btn.setAttribute('data-open', open ? '0' : '1');
      btn.textContent = open ? `View ${childCount} repl${childCount === 1 ? 'y' : 'ies'}` : 'Hide replies';
      return;
    }

    // ── Delete reply ──────────────────────────────────────────────────
    if (action === 'delete-reply' && commentId) {
      if (!user) return;
      const replyId = btn.getAttribute('data-reply-id') || '';
      if (!replyId) return;
      const rep = comments.find((c) => c.id === replyId);
      if (!rep || String(rep.userId ?? '') !== String(user.id ?? '')) return;
      if (!confirm('Delete this reply? This cannot be undone.')) return;
      btn.disabled = true;
      try {
        await deleteComment(replyId);
        await reload();
        refreshRepliesList(card, commentId);
        updateCount();
      } catch (ex) {
        alert(ex?.message || 'Could not delete reply.');
        btn.disabled = false;
      }
      return;
    }

    // ── Edit top-level comment ────────────────────────────────────────
    if (action === 'edit' && commentId) {
      const isMine = String(card.getAttribute('data-comment-user-id') || '') === String(user?.id || '');
      if (!isMine) return;
      const contentWrap = card.querySelector('[data-comment-content]');
      if (!contentWrap || contentWrap.querySelector('textarea[data-edit-text]')) return;
      const original = contentWrap.querySelector('p')?.textContent ?? '';
      card.dataset.originalCommentContent = original;
      contentWrap.innerHTML = `
        <textarea class="w-full bg-surface-container-lowest border-none rounded-xl p-4 text-sm font-body focus:ring-1 focus:ring-primary-container outline-none editorial-shadow min-h-[140px]" data-edit-text>${escapeHtml(original)}</textarea>
        <div class="mt-3 flex items-center justify-end gap-3">
          <button class="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:bg-surface-container-highest transition-colors" type="button" data-action="edit-cancel">Cancel</button>
          <button class="bg-primary text-on-primary px-6 py-2.5 rounded-full font-label text-[10px] font-bold tracking-widest uppercase hover:opacity-95 transition-opacity" type="button" data-action="edit-save">Save</button>
        </div>
        <p class="font-label text-sm text-error hidden mt-3" data-edit-error></p>
      `.trim();
      contentWrap.querySelector('textarea')?.focus?.();
      return;
    }

    if (action === 'edit-cancel' && commentId) {
      const contentWrap = card.querySelector('[data-comment-content]');
      if (!contentWrap) return;
      const original = card.dataset.originalCommentContent ?? '';
      delete card.dataset.originalCommentContent;
      contentWrap.innerHTML = `<p class="font-body text-on-surface leading-relaxed whitespace-pre-wrap">${escapeHtml(original)}</p>`;
      return;
    }

    if (action === 'edit-save' && commentId) {
      const contentWrap = card.querySelector('[data-comment-content]');
      const ta = contentWrap?.querySelector('textarea[data-edit-text]');
      const err = contentWrap?.querySelector('[data-edit-error]');
      if (!contentWrap || !ta) return;
      const text = String(ta.value || '').trim();
      if (!text) { if (err) { err.textContent = 'Comment cannot be empty.'; err.classList.remove('hidden'); } return; }
      const saveBtn = contentWrap.querySelector('[data-action="edit-save"]');
      if (saveBtn) saveBtn.disabled = true;
      try {
        await updateComment(commentId, text);
        await reload();
        rerender();
        delete card.dataset.originalCommentContent;
      } catch (ex) {
        if (err) { err.textContent = ex?.message || 'Could not save.'; err.classList.remove('hidden'); }
        if (saveBtn) saveBtn.disabled = false;
      }
      return;
    }
  });

  // ── Reply form submit ────────────────────────────────────────────────────
  commentsList.addEventListener('submit', async (e) => {
    const form = e.target?.closest?.('form[data-reply-form]');
    if (!form) return;
    e.preventDefault();
    if (!user) { openLoginOverlay(); return; }
    const card = form.closest('[data-comment-id]');
    const commentId = card?.getAttribute?.('data-comment-id');
    if (!commentId) return;

    const ta = form.querySelector('textarea');
    const err = form.querySelector('[data-reply-error]');
    const submitBtn = form.querySelector('[data-action="reply-submit"]');
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
    const text = String(ta?.value || '').trim();
    if (!text) { if (err) { err.textContent = 'Reply cannot be empty.'; err.classList.remove('hidden'); } return; }

    const parentReplyId = (form.dataset.parentReplyId || '').trim() || null;
    const parentId = parentReplyId || commentId;

    if (submitBtn) submitBtn.disabled = true;
    try {
      await insertComment(slug, {
        parentId,
        userId: user.id,
        username: user.username || user.email || 'User',
        text,
      });
      if (ta) ta.value = '';
      form.dataset.parentReplyId = '';
      form.classList.add('hidden');
      const replyingTo = form.querySelector('[data-replying-to]');
      if (replyingTo) { replyingTo.textContent = ''; replyingTo.classList.add('hidden'); }

      await reload();
      refreshRepliesList(card, commentId);
      updateCount();

      // Expand chain so newly added reply is visible
      if (parentReplyId) {
        const allReplies = comments.filter((c) => c.parentId != null);
        const parentMap = buildChildrenMap(allReplies);
        let cur = parentReplyId;
        while (cur && cur !== commentId) {
          const container = card.querySelector(`[data-reply-children="${CSS.escape(cur)}"]`);
          const toggle = card.querySelector(`button[data-action="child-toggle"][data-reply-id="${CSS.escape(cur)}"]`);
          if (container) container.classList.remove('hidden');
          if (toggle) { toggle.setAttribute('data-open', '1'); toggle.textContent = 'Hide replies'; }
          cur = (parentMap.get(cur) || [])[0]?.parentId || null;
        }
      }
    } catch (ex) {
      if (err) { err.textContent = ex?.message || 'Could not post reply.'; err.classList.remove('hidden'); }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ─── Related posts sidebar ────────────────────────────────────────────────────

function renderRelatedPosts(allPosts, currentSlug) {
  const el = document.getElementById('relatedPosts');
  if (!el) return;
  const related = allPosts.filter((p) => p.slug !== currentSlug).slice(0, 3);
  if (!related.length) { el.closest('[class*="rounded"]')?.classList.add('hidden'); return; }
  el.innerHTML = related
    .map(
      (p) => `
      <a href="blog?slug=${encodeURIComponent(p.slug)}" class="group flex items-start gap-4 hover:opacity-90 transition-opacity">
        <div class="w-16 h-16 rounded-xl overflow-hidden flex-none bg-surface-container-low">
          <img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${escapeHtml(p.heroImage)}" alt="${escapeHtml(p.title)}" loading="lazy" />
        </div>
        <div class="min-w-0">
          <div class="font-label uppercase tracking-widest text-[9px] text-primary mb-1">${escapeHtml(p.tag)}</div>
          <div class="font-headline italic text-base leading-snug tracking-tight group-hover:underline underline-offset-4 line-clamp-2">${escapeHtml(p.title)}</div>
          <div class="font-label text-[11px] opacity-50 mt-1">${escapeHtml(p.author)} · ${escapeHtml(p.date)}</div>
        </div>
      </a>
    `
    )
    .join('');
}

// ─── Filter / search ──────────────────────────────────────────────────────────

function filterPosts(posts, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return posts;
  return posts.filter(
    (p) =>
      p.title.toLowerCase().includes(query) ||
      String(p.tag || '').toLowerCase().includes(query) ||
      String(p.excerpt || '').toLowerCase().includes(query) ||
      String(p.author || '').toLowerCase().includes(query)
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Skeleton helpers ─────────────────────────────────────────────────────────

function renderBlogIndexSkeletons(featuredEl, indexEl) {
  if (featuredEl) {
    featuredEl.innerHTML = `
      <div class="catalog-skeleton skeleton-hero w-full"></div>
    `;
  }
  if (indexEl) {
    indexEl.innerHTML = Array.from({ length: 6 }).map(() => `
      <div class="bg-surface-container-lowest rounded-2xl overflow-hidden editorial-shadow border border-on-surface/5 flex flex-col">
        <div class="catalog-skeleton skeleton-thumb w-full flex-none"></div>
        <div class="p-5 flex flex-col gap-3 flex-1">
          <div class="catalog-skeleton skeleton-line-sm w-20"></div>
          <div class="catalog-skeleton skeleton-line-lg w-3/4"></div>
          <div class="catalog-skeleton skeleton-line w-full"></div>
          <div class="catalog-skeleton skeleton-line w-5/6"></div>
        </div>
      </div>
    `).join('');
  }
}

function renderBlogPostSkeleton(postView) {
  postView.innerHTML = `
    <div class="catalog-skeleton skeleton-line-sm w-24 mb-10"></div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div class="lg:col-span-8 bg-surface-container-lowest rounded-3xl overflow-hidden editorial-shadow">
        <div class="catalog-skeleton skeleton-thumb w-full" style="aspect-ratio:16/7"></div>
        <div class="p-8 md:p-12 space-y-4">
          <div class="catalog-skeleton skeleton-line-sm w-20"></div>
          <div class="catalog-skeleton skeleton-line-2xl w-2/3"></div>
          <div class="h-px bg-on-surface/10"></div>
          <div class="catalog-skeleton skeleton-line w-full"></div>
          <div class="catalog-skeleton skeleton-line w-11/12"></div>
          <div class="catalog-skeleton skeleton-line w-4/5"></div>
          <div class="catalog-skeleton skeleton-line w-full mt-4"></div>
          <div class="catalog-skeleton skeleton-line w-9/12"></div>
        </div>
      </div>
      <div class="lg:col-span-4 space-y-6 hidden lg:block">
        <div class="catalog-skeleton rounded-2xl h-40"></div>
        <div class="catalog-skeleton rounded-2xl h-52"></div>
      </div>
    </div>
  `;
}

async function main() {
  startProgress();
  wireLoginOverlay();

  const token = getToken();
  const user = token ? await fetchCurrentUser({ token, redirectOnFail: null }) : null;
  wireAccountDropdown({ user });

  const indexMain = document.getElementById('blogIndexMain');
  const postMain = document.getElementById('blogPostMain');
  const postView = document.getElementById('blogPostView');
  const featuredEl = document.getElementById('blogFeatured');
  const indexEl = document.getElementById('blogIndex');
  const countEl = document.getElementById('blogCount');
  const searchEl = document.getElementById('blogSearch');
  const topicsEl = document.getElementById('blogTopics');

  if (!indexMain || !postMain || !postView) { finishProgress(); return; }

  const params = new URLSearchParams(window.location.search);
  let slug = params.get('slug');
  // Also support clean /blog/:slug path format
  if (!slug) {
    const match = window.location.pathname.match(/\/blog\/([^/]+)/);
    if (match) slug = decodeURIComponent(match[1]);
  }

  // ── Individual post view ──────────────────────────────────────────────
  if (slug) {
    indexMain.classList.add('hidden');
    postMain.classList.remove('hidden');
    renderBlogPostSkeleton(postView);

    const [post, allPosts, restaurants] = await Promise.all([
      fetchPostBySlug(slug),
      fetchAllPosts(),
      fetchRestaurantsForLinking(),
    ]);
    finishProgress();

    if (!post) {
      postView.innerHTML = `
        <div class="py-32 text-center">
          <p class="font-headline italic text-4xl opacity-30">Post not found.</p>
          <a href="blog" class="inline-flex items-center gap-2 font-label uppercase tracking-widest text-xs text-primary mt-8 hover:opacity-80">
            <span class="material-symbols-outlined text-sm">arrow_back</span> Back to the journal
          </a>
        </div>
      `;
      return;
    }

    postView.innerHTML = postShellHtml(post, { restaurants });
    wireComments({ slug: post.slug, post, user }).catch(() => {});
    renderRelatedPosts(allPosts, post.slug);
    return;
  }

  // ── Index view ────────────────────────────────────────────────────────
  indexMain.classList.remove('hidden');
  postMain.classList.add('hidden');
  renderBlogIndexSkeletons(featuredEl, indexEl);

  const posts = await fetchAllPosts();
  finishProgress();
  let activeTopic = 'all';

  function setActiveTopic(next) {
    activeTopic = next || 'all';
    const btns = Array.from(topicsEl?.querySelectorAll?.('button[data-topic]') || []);
    for (const btn of btns) {
      const t = btn.getAttribute('data-topic') || 'all';
      btn.setAttribute('data-active', t === activeTopic ? '1' : '0');
    }
  }

  function matchesTopic(post) {
    if (!activeTopic || activeTopic === 'all') return true;
    return String(post.tag || '').toLowerCase() === activeTopic.toLowerCase();
  }

  function render(q) {
    const query = String(q || '').trim();
    const filtered = filterPosts(posts, query).filter(matchesTopic);

    if (countEl) {
      countEl.textContent = query
        ? `${filtered.length} result${filtered.length === 1 ? '' : 's'}`
        : `${filtered.length} post${filtered.length === 1 ? '' : 's'}`;
    }

    if (!filtered.length) {
      if (featuredEl) featuredEl.innerHTML = '';
      if (indexEl) indexEl.innerHTML = `<div class="font-label text-sm opacity-50 col-span-full">No posts found.</div>`;
      return;
    }

    if (!query) {
      if (featuredEl) featuredEl.innerHTML = featuredCardHtml(filtered[0]);
      if (indexEl) {
        const rest = filtered.slice(1);
        indexEl.innerHTML =
          rest.map(indexCardHtml).join('') ||
          `<div class="font-label text-sm opacity-50 col-span-full">No more posts yet.</div>`;
      }
      return;
    }

    if (featuredEl) featuredEl.innerHTML = '';
    if (indexEl) indexEl.innerHTML = filtered.map(indexCardHtml).join('');
  }

  setActiveTopic('all');
  render('');

  searchEl?.addEventListener('input', () => render(searchEl.value));

  topicsEl?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-topic]');
    if (!btn) return;
    const topic = btn.getAttribute('data-topic') || 'all';
    setActiveTopic(topic);
    render(searchEl?.value || '');
  });
}

main();
