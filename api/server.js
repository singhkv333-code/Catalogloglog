// api/server.js — Express app exported as a Vercel serverless function.
// Static files are served by Vercel from /public; this handler covers all API/backend routes.

const path = require('path')
const fs = require('fs')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const express = require('express')
const app = express()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('./db')
const { cacheGet, cacheSet, cacheDel, cacheDelPattern, TTL } = require('./cache')
const cors = require('cors')
const nodemailer = require('nodemailer')

const JWT_SECRET = process.env.JWT_SECRET
const SUPABASE_URL = 'https://pjsyvlhwuhdibpahputx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqc3l2bGh3dWhkaWJwYWhwdXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3OTE2OTMsImV4cCI6MjA4NTM2NzY5M30._5uc9ukbShs4kVblc8EpkQYTF6aFTth1vcXEJPQixxw'

app.use(cors())
app.use(express.json())

// ================== SSR HELPERS ==================

function _readHtml(name) {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8') } catch { return null }
}

const _TMPL = {
  restaurant: _readHtml('restaurant.html'),
  blog: _readHtml('blog.html'),
}

function _ea(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }
function _et(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function injectSeoHead(html, { title, description, canonical, image, ogType, jsonLd }) {
  if (!html) return null
  let m = ''
  if (description) m += `\n  <meta name="description" content="${_ea(description)}">`
  if (canonical)   m += `\n  <link rel="canonical" href="${_ea(canonical)}">`
  m += `\n  <meta property="og:title" content="${_ea(title)}">`
  if (description) m += `\n  <meta property="og:description" content="${_ea(description)}">`
  if (image)       m += `\n  <meta property="og:image" content="${_ea(image)}">`
  if (canonical)   m += `\n  <meta property="og:url" content="${_ea(canonical)}">`
  m += `\n  <meta property="og:type" content="${_ea(ogType || 'website')}">`
  m += `\n  <meta name="twitter:card" content="summary_large_image">`
  m += `\n  <meta name="twitter:title" content="${_ea(title)}">`
  if (image)       m += `\n  <meta name="twitter:image" content="${_ea(image)}">`
  if (jsonLd)      m += `\n  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${_et(title)}</title>`)
    .replace('</head>', m + '\n</head>')
}

function buildAreaCuisinePage({ title, description, canonical, h1, subtitle, restaurants, crumbs, jsonLd }) {
  const e = _ea
  const cards = restaurants.length
    ? restaurants.map(r => {
        const slug = r.name.toLowerCase().replace(/\s+/g, '-')
        const img = r.image_url
          ? `<div style="aspect-ratio:16/9;overflow:hidden"><img src="${e(r.image_url)}" alt="${e(r.name)} — ${e(r.cuisine || '')} restaurant in ${e(r.area || '')}, Delhi" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`
          : `<div style="aspect-ratio:16/9;background:#f5ede8"></div>`
        const stars = r.avg_rating > 0 ? ` · ★ ${Number(r.avg_rating).toFixed(1)}` : ''
        return `<a href="/restaurant/${e(slug)}" style="display:block;border-radius:1rem;overflow:hidden;background:#fff;box-shadow:0 4px 20px rgba(29,27,23,.07);text-decoration:none;color:inherit">${img}<div style="padding:1rem"><strong style="display:block;font-family:Newsreader,serif;font-size:1.125rem;font-style:italic;font-weight:600">${e(r.name)}</strong><span style="font-size:.875rem;color:#6b6560;font-family:Manrope,sans-serif">${e(r.cuisine || 'Restaurant')}${stars}</span></div></a>`
      }).join('\n')
    : '<p style="color:#6b6560;font-family:Manrope,sans-serif">No restaurants found.</p>'

  const breadHtml = crumbs.map((b, i) => {
    const last = i === crumbs.length - 1
    return last
      ? `<li style="color:#1d1b17">${e(b.name)}</li>`
      : `<li><a href="${e(b.url)}" style="color:#6b6560;text-decoration:none">${e(b.name)}</a></li><li style="opacity:.4;margin:0 .3rem">›</li>`
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_et(title)}</title>
  <meta name="description" content="${e(description)}">
  <link rel="canonical" href="${e(canonical)}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(canonical)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(title)}">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=Manrope:wght@200..800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/tw.css">
  <link rel="stylesheet" href="/styles.css">
  <style>.glass-nav{backdrop-filter:blur(16px);background-color:rgba(254,249,241,.8)}</style>
</head>
<body style="margin:0;background:#fef9f1;color:#1d1b17;font-family:Manrope,sans-serif">
<nav class="glass-nav" style="position:fixed;top:0;left:0;right:0;z-index:50;border-bottom:1px solid rgba(29,27,23,.06)">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:1.25rem 3rem;max-width:1536px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:3rem">
      <a href="/" style="font-family:Newsreader,serif;font-size:1.875rem;font-style:italic;font-weight:600;color:#1d1b17;text-decoration:none;letter-spacing:-.05em">Catalog</a>
      <div style="display:flex;gap:2rem">
        <a href="/all-restaurants" style="color:#1d1b17;opacity:.7;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;text-decoration:none">EXPLORE</a>
        <a href="/blog" style="color:#1d1b17;opacity:.7;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;text-decoration:none">BLOG</a>
        <a href="/lists" style="color:#1d1b17;opacity:.7;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;text-decoration:none">LISTS</a>
      </div>
    </div>
    <a href="/login" style="font-size:.875rem;padding:.5rem 1.25rem;border-radius:9999px;background:#690008;color:#fff;text-decoration:none">Sign in</a>
  </div>
</nav>
<main style="padding-top:6rem;padding-bottom:4rem;max-width:1536px;margin:0 auto;padding-left:3rem;padding-right:3rem">
  <nav aria-label="Breadcrumb" style="margin-bottom:1.5rem;font-size:.875rem">
    <ol style="list-style:none;display:flex;align-items:center;gap:.25rem;margin:0;padding:0;flex-wrap:wrap">${breadHtml}</ol>
  </nav>
  <h1 style="font-family:Newsreader,serif;font-size:clamp(2.5rem,5vw,3.5rem);font-style:italic;font-weight:600;margin:0 0 .75rem">${e(h1)}</h1>
  <p style="color:#6b6560;margin-bottom:2.5rem">${e(subtitle)}</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1.5rem">
    ${cards}
  </div>
</main>
<footer style="padding:2.5rem 3rem;border-top:1px solid rgba(29,27,23,.08);text-align:center;font-size:.875rem;color:#6b6560">
  <p>© 2026 Catalog · <a href="/about" style="color:inherit">About</a> · <a href="/support" style="color:inherit">Support</a> · <a href="/privacy" style="color:inherit">Privacy</a></p>
</footer>
</body>
</html>`
}

// Add name column if it doesn't exist yet (idempotent migration)
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`).catch(() => {})

// ================== SUPABASE JWT RESOLVER ==================
const crypto = require('crypto')

async function resolveSupabaseUser(token) {
  const cacheKey = `supauser:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  })
  if (!resp.ok) return null
  const supaUser = await resp.json()
  const email = supaUser?.email
  if (!email) return null

  let row = await pool.query('SELECT id, email, username, name FROM users WHERE email = $1', [email])
  if (!row.rows.length) {
    const username = supaUser.user_metadata?.username || email.split('@')[0]
    const name = supaUser.user_metadata?.full_name || username
    row = await pool.query(
      `INSERT INTO users (email, password, username, name, created_at)
       VALUES ($1, '', $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, name = COALESCE(EXCLUDED.name, users.name)
       RETURNING id, email, username, name`,
      [email, username, name]
    )
  }
  const user = row.rows[0]
  if (user) await cacheSet(cacheKey, user, 5 * 60)
  return user
}

// ================== AUTH MIDDLEWARE ==================
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ message: 'No token provided' })
  const token = authHeader.split(' ')[1]

  try {
    const user = await resolveSupabaseUser(token)
    if (user) { req.user = user; return next() }
  } catch { /* fall through */ }

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// Brevo SMTP transporter
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// ================== ME ==================
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, email, username, name, bio FROM users WHERE id=$1', [req.user.id])
    if (!r.rows.length) return res.json({ id: req.user.id, email: req.user.email, username: req.user.username, name: null, bio: null })
    const u = r.rows[0]
    res.json({ id: u.id, email: u.email, username: u.username, name: u.name, bio: u.bio })
  } catch {
    res.json({ id: req.user.id, email: req.user.email, username: req.user.username, bio: null })
  }
})

// ================== KEEPALIVE ==================
app.get('/api/ping', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// ================== SITEMAP ==================

app.get('/sitemap.xml', async (_req, res) => {
  const cacheKey = 'sitemap:xml'
  const cached = await cacheGet(cacheKey)
  if (cached) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(cached)
  }
  try {
    const [rests, blogs, lists, areas, cuisines] = await Promise.all([
      pool.query(`SELECT name, last_updated FROM restaurants WHERE name IS NOT NULL`),
      pool.query(`SELECT slug, created_at FROM blogs WHERE slug IS NOT NULL`),
      pool.query(`SELECT id FROM lists WHERE is_public = true`),
      pool.query(`SELECT DISTINCT area FROM restaurants WHERE area IS NOT NULL AND area != ''`),
      pool.query(`SELECT DISTINCT cuisine FROM restaurants WHERE cuisine IS NOT NULL AND cuisine != ''`),
    ])
    const B = 'https://www.catalogapp.in'
    const today = new Date().toISOString().slice(0, 10)
    const urlTag = (loc, { lastmod, changefreq = 'monthly', priority } = {}) =>
      `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${changefreq}</changefreq>${priority ? `<priority>${priority}</priority>` : ''}</url>`

    const lines = [
      urlTag(`${B}/`,                { changefreq: 'weekly',  priority: '1.0', lastmod: today }),
      urlTag(`${B}/all-restaurants`, { changefreq: 'weekly',  priority: '0.8', lastmod: today }),
      urlTag(`${B}/blog`,            { changefreq: 'weekly',  priority: '0.7', lastmod: today }),
      urlTag(`${B}/about`,           { changefreq: 'monthly', priority: '0.4' }),
      urlTag(`${B}/support`,         { changefreq: 'monthly', priority: '0.4' }),
      ...rests.rows.map(r => urlTag(
        `${B}/restaurant/${encodeURIComponent(r.name.toLowerCase().replace(/\s+/g, '-'))}`,
        { lastmod: r.last_updated ? new Date(r.last_updated).toISOString().slice(0, 10) : today, priority: '0.8' }
      )),
      ...blogs.rows.map(b => urlTag(
        `${B}/blog/${encodeURIComponent(b.slug)}`,
        { lastmod: b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : today, priority: '0.7' }
      )),
      ...lists.rows.map(l => urlTag(`${B}/lists/${l.id}`, { changefreq: 'weekly', priority: '0.5' })),
      ...areas.rows.map(a => urlTag(
        `${B}/restaurants/area/${encodeURIComponent(a.area.toLowerCase().replace(/\s+/g, '-'))}`,
        { changefreq: 'weekly', priority: '0.9' }
      )),
      ...cuisines.rows.map(c => urlTag(
        `${B}/restaurants/cuisine/${encodeURIComponent(c.cuisine.toLowerCase().replace(/\s+/g, '-'))}`,
        { changefreq: 'weekly', priority: '0.9' }
      )),
    ]
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>`
    await cacheSet(cacheKey, xml, 24 * 60 * 60)
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(xml)
  } catch (err) {
    res.status(500).type('text/plain').send(`Sitemap error: ${err.message}`)
  }
})

// ================== BLOG API ==================

app.get('/api/blogs', async (_req, res) => {
  const cacheKey = 'blogs:list'
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT id, title, slug, author, city, read_time, hero_image, tag, created_at
       FROM blogs WHERE slug IS NOT NULL ORDER BY created_at DESC LIMIT 50`
    )
    await cacheSet(cacheKey, r.rows, 30 * 60)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/blogs/:slug', async (req, res) => {
  const { slug } = req.params
  const cacheKey = `blog:slug:${slug}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const [blogR, restR] = await Promise.all([
      pool.query(`SELECT * FROM blogs WHERE slug = $1 LIMIT 1`, [slug]),
      pool.query(
        `SELECT br.restaurant_name, br.area FROM blog_restaurants br
         JOIN blogs b ON b.id = br.blog_id WHERE b.slug = $1`, [slug]
      )
    ])
    if (!blogR.rows.length) return res.status(404).json({ message: 'Not found' })
    const result = { ...blogR.rows[0], restaurants: restR.rows }
    await cacheSet(cacheKey, result, 60 * 60)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ================== HOME DATA ==================
// Single endpoint that replaces 4 separate homepage API calls.
// Public parts (popular + lists) are cached at 5 min to stay within Upstash free-tier limits.
app.get('/api/home-data', optionalAuth, async (req, res) => {
  const uid = req.user ? req.user.id : null
  const publicCacheKey = `home:public`
  const cachedPublic = await cacheGet(publicCacheKey)

  let popular, lists
  if (cachedPublic) {
    popular = cachedPublic.popular
    lists = cachedPublic.lists
  } else {
    const [popularResult, listsResult] = await Promise.all([
      pool.query(
        `SELECT r.id, r.name, r.area, r.cuisine, r.image_url,
                LOWER(REPLACE(r.name,' ','-')) AS slug,
                COALESCE(s.average_rating,0) AS avg_rating,
                COALESCE(s.total_ratings,0)  AS total_ratings
         FROM restaurants r
         LEFT JOIN restaurant_ratings_summary s ON s.restaurant_id = r.id::text
         WHERE r.name IS NOT NULL AND r.image_url IS NOT NULL AND r.image_url != ''
         ORDER BY s.total_ratings DESC NULLS LAST, s.average_rating DESC NULLS LAST, RANDOM()
         LIMIT 12`
      ),
      pool.query(
        `SELECT l.id, l.title, l.description, l.user_id, u.username AS owner_username,
                COUNT(DISTINCT li.id) AS item_count,
                COALESCE(COUNT(DISTINCT ll.id),0) AS likes_count
         FROM lists l JOIN users u ON l.user_id=u.id
         LEFT JOIN list_items li ON li.list_id=l.id
         LEFT JOIN list_likes ll ON ll.list_id=l.id
         WHERE l.is_public=true
         GROUP BY l.id, l.title, l.description, l.user_id, u.username
         ORDER BY likes_count DESC, item_count DESC, MAX(l.created_at) DESC
         LIMIT 10`
      )
    ])
    popular = popularResult.rows
    const previews = await batchListPreviews(listsResult.rows.map(l => l.id))
    lists = listsResult.rows.map(lst => ({
      id: lst.id, title: lst.title, description: lst.description,
      owner_id: lst.user_id, owner_username: lst.owner_username,
      item_count: parseInt(lst.item_count), likes_count: parseInt(lst.likes_count || 0),
      liked_by_user: false, preview_restaurants: previews[lst.id] || []
    }))
    await cacheSet(publicCacheKey, { popular, lists }, 5 * 60)
  }

  let activity = [], recent = [], user = null
  if (uid) {
    const userCacheKey = `home:user:${uid}`
    const cachedUser = await cacheGet(userCacheKey)
    if (cachedUser) {
      activity = cachedUser.activity
      recent = cachedUser.recent
      user = cachedUser.user
    } else {
      const [activityResult, recentResult, userResult] = await Promise.all([
        pool.query(
          `SELECT v.id AS visit_id, v.restaurant_id, v.visited_at,
                  u.id AS friend_id, u.username AS friend_username, u.name AS friend_name,
                  rs.name AS restaurant_name, rs.area AS restaurant_area, rs.cuisine AS restaurant_cuisine, rs.image_url,
                  LOWER(REPLACE(rs.name,' ','-')) AS slug,
                  rat.stars, rev.content AS review_snippet
           FROM visits v JOIN users u ON v.user_id=u.id
           LEFT JOIN restaurants rs ON (rs.id::text = v.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = v.restaurant_id)
           LEFT JOIN ratings rat ON rat.user_id=v.user_id AND rat.restaurant_id=v.restaurant_id
           LEFT JOIN reviews rev ON rev.user_id=v.user_id AND rev.restaurant_id=v.restaurant_id
           WHERE v.user_id IN (
             SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END
             FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'
           )
           ORDER BY v.visited_at DESC LIMIT 3`,
          [uid]
        ),
        pool.query(
          `SELECT v.restaurant_id, LOWER(REPLACE(rs.name,' ','-')) AS slug,
                  rs.name, rs.area, rs.cuisine, rs.image_url, v.visited_at,
                  COALESCE(rat.stars, 0) AS user_rating
           FROM visits v
           LEFT JOIN restaurants rs ON (rs.id::text = v.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = v.restaurant_id)
           LEFT JOIN ratings rat ON rat.restaurant_id=v.restaurant_id AND rat.user_id=$1
           WHERE v.user_id=$1 ORDER BY v.visited_at DESC LIMIT 8`,
          [uid]
        ),
        pool.query('SELECT id, email, username, name, bio FROM users WHERE id=$1', [uid])
      ])
      activity = activityResult.rows.map(a => ({
        ...a, review_snippet: a.review_snippet && a.review_snippet.length > 120
          ? a.review_snippet.slice(0, 120) + '…' : a.review_snippet
      }))
      recent = recentResult.rows
      user = userResult.rows[0] || null
      await cacheSet(userCacheKey, { activity, recent, user }, TTL.HOME_USER)
    }
  }

  res.json({ popular, lists, activity, recent, user })
})

// ================== SIGNUP ==================
app.post('/signup', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' })
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
  try {
    const [existing, hashedPassword] = await Promise.all([
      pool.query('SELECT id FROM users WHERE email = $1', [email]),
      bcrypt.hash(password, 10),
    ])
    if (existing.rows.length > 0) return res.status(400).json({ message: 'User already exists' })
    const otp = Math.floor(1000 + Math.random() * 9000).toString()
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000)
    await pool.query(
      `INSERT INTO users (email, password, otp, otp_expires) VALUES ($1, $2, $3, $4)`,
      [email, hashedPassword, otp, otpExpires]
    )
    const mailOptions = {
      from: 'Catalog <info@catalogapp.in>',
      to: email,
      subject: 'Your Catalog Verification Code',
      html: `<p>Hi there!</p><p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>`,
    }
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(error)
        return res.status(500).json({ message: 'Failed to send OTP email', error: error.message })
      }
      console.log('OTP email sent:', info.response)
      return res.json({ message: 'OTP sent to your email' })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== VERIFY OTP ==================
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' })
  try {
    const result = await pool.query(
      'SELECT id, otp, otp_expires FROM users WHERE email = $1',
      [email]
    )
    if (result.rows.length === 0) return res.status(400).json({ message: 'User not found' })
    const user = result.rows[0]
    if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' })
    if (new Date() > user.otp_expires) return res.status(400).json({ message: 'OTP expired' })
    await pool.query('UPDATE users SET otp = NULL, otp_expires = NULL WHERE id = $1', [user.id])
    res.json({ message: 'Email verified successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== LOGIN ==================
app.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' })

  if (email.trim().toLowerCase() === 'dev@catalog.com' && password === 'devpassword123') {
    try {
      let devUser = await pool.query('SELECT id, username FROM users WHERE email = $1', ['dev@catalog.com'])
      if (devUser.rows.length === 0) {
        const hashedPw = await bcrypt.hash('devpassword123', 10)
        devUser = await pool.query(
          `INSERT INTO users (email, password, username) VALUES ($1, $2, $3) RETURNING id, username`,
          ['dev@catalog.com', hashedPw, 'Dev']
        )
      }
      const user = devUser.rows[0]
      const token = jwt.sign(
        { id: user.id, email: 'dev@catalog.com', username: user.username || 'Dev', is_dev: true },
        JWT_SECRET,
        { expiresIn: '7d' }
      )
      return res.json({ message: 'Dev login successful', token })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ message: 'Server error during dev login' })
    }
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password, username FROM users WHERE email = $1',
      [email]
    )
    if (result.rows.length === 0) return res.status(400).json({ message: 'Invalid email or password' })
    const user = result.rows[0]
    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' })
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({ message: 'Login successful', token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== SET USERNAME ==================
app.post('/set-username', authMiddleware, async (req, res) => {
  const { username } = req.body
  const userId = req.user.id
  if (!username || username.trim().length === 0) return res.status(400).json({ message: 'Username is required' })
  try {
    const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' })
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username])
    if (exists.rows.length > 0) return res.status(400).json({ message: 'Username already taken' })
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId])
    res.json({ message: 'Username set successfully', username })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== PROFILE ==================
app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, username, bio FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' })
    const u = result.rows[0]
    res.json({ user: { id: u.id, email: u.email, username: u.username || 'User', bio: u.bio } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== PUBLIC USER PROFILE ==================
app.get('/api/users/:id/public', async (req, res) => {
  const { id } = req.params
  try {
    const result = await pool.query(
      'SELECT id, username, name, bio FROM users WHERE id = $1',
      [id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' })
    res.json({ user: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== UPDATE PROFILE ==================
app.put('/api/profile', authMiddleware, async (req, res) => {
  const { bio, name } = req.body
  const userId = req.user.id
  try {
    const updates = ['bio = $1']
    const params = [bio?.trim() || null]
    if (name !== undefined) {
      updates.push(`name = $${params.push(name?.trim() || null)}`)
    }
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.push(userId)}`, params)
    res.json({ message: 'Profile updated' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ================== DB TEST ==================
app.get('/db-test', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()')
    res.json(result.rows)
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// ================== RATING SUMMARY HELPER ==================
async function updateRatingSummary(restaurantId) {
  const [stats, reviews] = await Promise.all([
    pool.query(
      `SELECT COALESCE(AVG(stars),0) AS avg_rating, COUNT(*) AS total_ratings FROM ratings WHERE restaurant_id=$1`,
      [restaurantId]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM reviews WHERE restaurant_id=$1`,
      [restaurantId]
    ),
  ])
  const avg = parseFloat(parseFloat(stats.rows[0].avg_rating).toFixed(1))
  const total_ratings = parseInt(stats.rows[0].total_ratings)
  const total_reviews = parseInt(reviews.rows[0].total)
  await pool.query(
    `INSERT INTO restaurant_ratings_summary (restaurant_id, average_rating, total_ratings, total_reviews, last_updated)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (restaurant_id) DO UPDATE SET
       average_rating=$2, total_ratings=$3, total_reviews=$4, last_updated=NOW()`,
    [restaurantId, avg, total_ratings, total_reviews]
  )
  // Invalidate all caches that include rating data for this restaurant
  await Promise.all([
    cacheDel(`ratings:restaurant:${restaurantId}`),
    cacheDelPattern('restaurants:popular:*'),
  ])
  return { average_rating: avg, total_ratings, total_reviews }
}

// ================== SLIM RESTAURANT CACHE ==================
// In-process L1 cache — reused across warm invocations of the same serverless instance.
let _slimCache = null
let _slimCacheAt = 0

async function getSlimRestaurants() {
  const now = Date.now()
  if (_slimCache && now - _slimCacheAt < 5 * 60 * 1000) return _slimCache
  const cached = await cacheGet('restaurants:slim')
  if (cached) { _slimCache = cached; _slimCacheAt = now; return cached }
  const r = await pool.query(
    `SELECT id, name, area, cuisine, image_url, LOWER(REPLACE(name,' ','-')) AS slug
     FROM restaurants WHERE name IS NOT NULL AND image_url IS NOT NULL AND image_url != ''`
  )
  _slimCache = r.rows; _slimCacheAt = now
  await cacheSet('restaurants:slim', r.rows, TTL.RESTAURANTS_SLIM)
  return r.rows
}

// Replaces N separate per-list preview queries with 1 list_items query + slim cache lookup.
// Returns a map of listId → [{ name, image_url, slug }, ...]
async function batchListPreviews(listIds) {
  if (!listIds.length) return {}
  const slim = await getSlimRestaurants()
  const byId = {}, bySlug = {}
  slim.forEach(r => { byId[String(r.id)] = r; bySlug[r.slug] = r })

  const r = await pool.query(
    `SELECT list_id, restaurant_id, position FROM list_items
     WHERE list_id = ANY($1) ORDER BY list_id, position ASC`,
    [listIds]
  )
  const out = {}
  for (const row of r.rows) {
    const rest = byId[row.restaurant_id] || bySlug[row.restaurant_id]
    if (!rest) continue
    if (!out[row.list_id]) out[row.list_id] = []
    if (out[row.list_id].length < 3) {
      out[row.list_id].push({ name: rest.name, image_url: rest.image_url, slug: rest.slug })
    }
  }
  return out
}

// ================== OPTIONAL AUTH ==================
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader) { req.user = null; return next() }
  const token = authHeader.split(' ')[1]

  try {
    const user = await resolveSupabaseUser(token)
    if (user) { req.user = user; return next() }
  } catch { /* fall through */ }

  try { req.user = jwt.verify(token, JWT_SECRET) } catch { req.user = null }
  next()
}

// ============================================================
// RESTAURANTS
// ============================================================

app.get('/restaurants/random', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 6, 20)
  const cacheKey = `restaurants:random:${limit}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT id, name, area, cuisine, image_url, LOWER(REPLACE(name,' ','-')) AS slug
       FROM restaurants WHERE name IS NOT NULL ORDER BY RANDOM() LIMIT $1`,
      [limit]
    )
    await cacheSet(cacheKey, r.rows, TTL.RESTAURANTS_RANDOM)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/restaurants/popular', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 20)
  const cacheKey = `restaurants:popular:${limit}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT r.id, r.name, r.area, r.cuisine, r.image_url,
              LOWER(REPLACE(r.name,' ','-')) AS slug,
              COALESCE(s.average_rating,0) AS avg_rating,
              COALESCE(s.total_ratings,0)  AS total_ratings
       FROM restaurants r
       LEFT JOIN restaurant_ratings_summary s ON s.restaurant_id = r.id::text
       WHERE r.name IS NOT NULL AND r.image_url IS NOT NULL AND r.image_url != ''
       ORDER BY s.total_ratings DESC NULLS LAST, s.average_rating DESC NULLS LAST, RANDOM()
       LIMIT $1`,
      [limit]
    )
    await cacheSet(cacheKey, r.rows, TTL.RESTAURANTS_POPULAR)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/restaurants', async (req, res) => {
  const { search = '', area = '', cuisine = '' } = req.query
  const cacheKey = `restaurants:list:${search.toLowerCase()}:${area.toLowerCase()}:${cuisine.toLowerCase()}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT id, name, area, cuisine, image_url, LOWER(REPLACE(name,' ','-')) AS slug
       FROM restaurants
       WHERE ($1='' OR LOWER(name) LIKE $1 OR LOWER(area) LIKE $1 OR LOWER(cuisine) LIKE $1)
         AND ($2='' OR LOWER(area)=LOWER($2))
         AND ($3='' OR LOWER(cuisine)=LOWER($3))
       ORDER BY name`,
      [`%${search.toLowerCase()}%`, area, cuisine]
    )
    const result = r.rows.map(row => ({ ...row, images: row.image_url ? [row.image_url] : [] }))
    await cacheSet(cacheKey, result, TTL.RESTAURANTS_LIST)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ================== AREA LANDING PAGES ==================

app.get('/restaurants/area/:area', async (req, res) => {
  const areaSlug = req.params.area.toLowerCase()
  const displayArea = areaSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const cacheKey = `page:area:${areaSlug}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.send(cached)
  }
  try {
    const r = await pool.query(
      `SELECT rs.name, rs.area, rs.cuisine, rs.image_url,
              COALESCE(s.average_rating, 0) AS avg_rating
       FROM restaurants rs
       LEFT JOIN restaurant_ratings_summary s ON s.restaurant_id = rs.id::text
       WHERE LOWER(REPLACE(rs.area, ' ', '-')) = $1 OR LOWER(rs.area) = $2
       ORDER BY s.total_ratings DESC NULLS LAST, rs.name ASC`,
      [areaSlug, areaSlug.replace(/-/g, ' ')]
    )
    const canonical = `https://www.catalogapp.in/restaurants/area/${areaSlug}`
    const count = r.rows.length
    const title = `Restaurants in ${displayArea}, Delhi | Catalog`
    const description = `Discover the best restaurants in ${displayArea}, Delhi. ${count}+ options across all cuisines — rated and reviewed by real diners.`
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.catalogapp.in' },
        { '@type': 'ListItem', position: 2, name: 'Restaurants', item: 'https://www.catalogapp.in/all-restaurants' },
        { '@type': 'ListItem', position: 3, name: displayArea, item: canonical },
      ],
    }
    const html = buildAreaCuisinePage({
      title, description, canonical,
      h1: `Restaurants in ${displayArea}`,
      subtitle: `${count} ${count === 1 ? 'restaurant' : 'restaurants'} found`,
      restaurants: r.rows,
      crumbs: [{ name: 'Home', url: '/' }, { name: 'Restaurants', url: '/all-restaurants' }, { name: displayArea }],
      jsonLd,
    })
    await cacheSet(cacheKey, html, TTL.RESTAURANTS_LIST)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(html)
  } catch (err) { res.status(500).send(`<h1>Error: ${err.message}</h1>`) }
})

// ================== CUISINE LANDING PAGES ==================

app.get('/restaurants/cuisine/:cuisine', async (req, res) => {
  const cuisineSlug = req.params.cuisine.toLowerCase()
  const displayCuisine = cuisineSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const cacheKey = `page:cuisine:${cuisineSlug}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.send(cached)
  }
  try {
    const r = await pool.query(
      `SELECT rs.name, rs.area, rs.cuisine, rs.image_url,
              COALESCE(s.average_rating, 0) AS avg_rating
       FROM restaurants rs
       LEFT JOIN restaurant_ratings_summary s ON s.restaurant_id = rs.id::text
       WHERE LOWER(REPLACE(rs.cuisine, ' ', '-')) = $1 OR LOWER(rs.cuisine) = $2
       ORDER BY s.total_ratings DESC NULLS LAST, rs.name ASC`,
      [cuisineSlug, cuisineSlug.replace(/-/g, ' ')]
    )
    const canonical = `https://www.catalogapp.in/restaurants/cuisine/${cuisineSlug}`
    const count = r.rows.length
    const title = `Best ${displayCuisine} Restaurants in Delhi | Catalog`
    const description = `Find the best ${displayCuisine} restaurants in Delhi — ${count}+ options rated by real diners on Catalog.`
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.catalogapp.in' },
        { '@type': 'ListItem', position: 2, name: 'Restaurants', item: 'https://www.catalogapp.in/all-restaurants' },
        { '@type': 'ListItem', position: 3, name: displayCuisine, item: canonical },
      ],
    }
    const html = buildAreaCuisinePage({
      title, description, canonical,
      h1: `${displayCuisine} Restaurants in Delhi`,
      subtitle: `${count} ${count === 1 ? 'restaurant' : 'restaurants'} found`,
      restaurants: r.rows,
      crumbs: [{ name: 'Home', url: '/' }, { name: 'Restaurants', url: '/all-restaurants' }, { name: displayCuisine }],
      jsonLd,
    })
    await cacheSet(cacheKey, html, TTL.RESTAURANTS_LIST)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(html)
  } catch (err) { res.status(500).send(`<h1>Error: ${err.message}</h1>`) }
})

app.get('/restaurants/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase().replace(/\s+/g, '-')
  const cacheKey = `restaurant:slug:${slug}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT id, name, area, cuisine, image_url, images, opening_hours
       FROM restaurants WHERE LOWER(REPLACE(name,' ','-'))=$1 LIMIT 1`,
      [slug]
    )
    if (!r.rows.length) return res.status(404).json({ message: 'Restaurant not found' })
    const row = r.rows[0]
    const dbImages = row.images || []
    row.images = dbImages.length ? dbImages : (row.image_url ? [row.image_url] : [])
    row.slug = slug
    await cacheSet(cacheKey, row, TTL.RESTAURANT_DETAIL)
    res.json(row)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ================== RESTAURANT PAGE SSR ==================

app.get('/restaurant/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase().replace(/\s+/g, '-')
  const cacheKey = `page:restaurant:${slug}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    return res.send(cached)
  }
  try {
    const restR = await pool.query(
      `SELECT id, name, area, cuisine, image_url, images, opening_hours,
              latitude, longitude, formatted_address, phone_number
       FROM restaurants WHERE LOWER(REPLACE(name, ' ', '-')) = $1 LIMIT 1`,
      [slug]
    )
    if (!restR.rows.length) {
      return res.status(404).send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found — Catalog</title></head>' +
        '<body><h1>Restaurant not found</h1><p><a href="/all-restaurants">Browse all restaurants</a></p></body></html>'
      )
    }
    const r = restR.rows[0]
    const [ratingR, reviewR] = await Promise.all([
      pool.query(
        `SELECT average_rating, total_ratings, total_reviews
         FROM restaurant_ratings_summary WHERE restaurant_id = $1`,
        [String(r.id)]
      ),
      pool.query(
        `SELECT rev.content, rev.rating, u.username
         FROM reviews rev LEFT JOIN users u ON rev.user_id = u.id
         WHERE rev.restaurant_id = $1 OR rev.restaurant_id = $2
         ORDER BY rev.created_at DESC LIMIT 3`,
        [String(r.id), slug]
      ),
    ])
    const rating = ratingR.rows[0] || {}
    const avgRating = rating.average_rating ? Number(rating.average_rating).toFixed(1) : null
    const totalRatings = Number(rating.total_ratings) || 0
    const totalReviews = Number(rating.total_reviews) || 0
    const images = Array.isArray(r.images) ? r.images : []
    const image = images.length ? images[0] : (r.image_url || null)
    const title = `${r.name} | ${r.cuisine} Restaurant | ${r.area}, Delhi — Catalog`
    const description = `Visit ${r.name} in ${r.area}, Delhi. ${r.cuisine} cuisine.${avgRating ? ` Rated ${avgRating}/5 by ${totalRatings} diners.` : ''} See reviews, photos and details on Catalog.`
    const canonical = `https://www.catalogapp.in/restaurant/${slug}`
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: r.name,
      url: canonical,
      servesCuisine: r.cuisine,
    }
    if (r.area || r.formatted_address) {
      jsonLd.address = {
        '@type': 'PostalAddress',
        ...(r.formatted_address && { streetAddress: r.formatted_address }),
        addressLocality: r.area,
        addressRegion: 'Delhi',
        addressCountry: 'IN',
      }
    }
    if (r.latitude && r.longitude) jsonLd.geo = { '@type': 'GeoCoordinates', latitude: r.latitude, longitude: r.longitude }
    if (r.phone_number) jsonLd.telephone = r.phone_number
    if (r.opening_hours) jsonLd.openingHours = r.opening_hours
    if (image) jsonLd.image = image
    if (avgRating && totalRatings > 0) {
      jsonLd.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: parseFloat(avgRating),
        reviewCount: totalReviews || totalRatings,
        bestRating: 5,
        worstRating: 1,
      }
    }
    const html = injectSeoHead(_TMPL.restaurant, { title, description, canonical, image, ogType: 'restaurant', jsonLd })
    if (!html) {
      // Template not available — serve minimal SEO page
      const fallback = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_et(title)}</title><meta name="description" content="${_ea(description)}"><link rel="canonical" href="${_ea(canonical)}"><meta property="og:title" content="${_ea(title)}"><meta property="og:description" content="${_ea(description)}"><meta property="og:url" content="${_ea(canonical)}"><meta property="og:type" content="restaurant">${image ? `<meta property="og:image" content="${_ea(image)}">` : ''}<meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><p>Loading…</p><script>window.location.replace('/restaurant?slug=${encodeURIComponent(slug)}')</script></body></html>`
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(fallback)
    }
    await cacheSet(cacheKey, html, TTL.RESTAURANT_DETAIL)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    res.send(html)
  } catch (err) { res.status(500).send(`<h1>Error: ${err.message}</h1>`) }
})

// ============================================================
// REVIEWS
// ============================================================

app.get('/api/reviews/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params
  const limit = parseInt(req.query.limit) || 20
  const offset = parseInt(req.query.offset) || 0
  const cacheKey = `reviews:restaurant:${restaurantId}:${limit}:${offset}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const slugRes = await pool.query(
      `SELECT id, LOWER(REPLACE(name,' ','-')) AS slug FROM restaurants WHERE id::text=$1 LIMIT 1`,
      [restaurantId]
    )
    const idForms = [restaurantId]
    if (slugRes.rows.length) idForms.push(slugRes.rows[0].slug)

    const [r, total] = await Promise.all([
      pool.query(
        `SELECT r.id, r.user_id, r.content, r.rating, r.visit_date,
                r.likes_count, r.is_edited, r.created_at, r.updated_at, u.username
         FROM reviews r LEFT JOIN users u ON r.user_id=u.id
         WHERE r.restaurant_id = ANY($1) ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [idForms, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM reviews WHERE restaurant_id = ANY($1)`, [idForms]),
    ])
    const result = { reviews: r.rows, total: parseInt(total.rows[0].count), limit, offset }
    await cacheSet(cacheKey, result, TTL.REVIEWS_LIST)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/reviews', authMiddleware, async (req, res) => {
  const { restaurant_id, content, rating, visit_date } = req.body
  try {
    const existing = await pool.query(
      `SELECT id FROM reviews WHERE user_id=$1 AND restaurant_id=$2`,
      [req.user.id, restaurant_id]
    )
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a review for this restaurant. Edit your existing review instead.' })
    }
    const r = await pool.query(
      `INSERT INTO reviews (user_id, restaurant_id, content, rating, visit_date, created_at, updated_at, likes_count, is_edited)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),0,FALSE) RETURNING id`,
      [req.user.id, restaurant_id, content, rating || null, visit_date || null]
    )
    await updateRatingSummary(restaurant_id)
    // Invalidate review list cache for this restaurant (all paginations)
    await cacheDelPattern(`reviews:restaurant:${restaurant_id}:*`)
    try {
      const beenEx = await pool.query(
        `SELECT id FROM visits WHERE user_id=$1 AND restaurant_id=$2`,
        [req.user.id, restaurant_id]
      )
      if (!beenEx.rows.length) {
        await pool.query(
          `INSERT INTO visits (user_id, restaurant_id, visited_at, created_at) VALUES ($1,$2,NOW(),NOW())`,
          [req.user.id, restaurant_id]
        )
        console.log(`[SYNC] Auto-added restaurant ${restaurant_id} to been for user ${req.user.id} after review`)
      }
    } catch (syncErr) {
      console.error(`[SYNC] Failed to auto-add been on review creation: ${syncErr.message}`)
    }
    res.json({ success: true, message: 'Review created', review_id: r.rows[0].id })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.put('/api/reviews/:reviewId', authMiddleware, async (req, res) => {
  const { reviewId } = req.params
  const { content, rating, visit_date } = req.body
  try {
    const existing = await pool.query(
      `SELECT id, restaurant_id FROM reviews WHERE id=$1 AND user_id=$2`,
      [reviewId, req.user.id]
    )
    if (!existing.rows.length) return res.status(404).json({ message: 'Review not found or not authorized' })
    const updates = ['is_edited=TRUE', 'updated_at=NOW()']
    const params = [reviewId]
    if (content != null) { updates.push(`content=$${params.push(content)}`)}
    if (rating != null)  { updates.push(`rating=$${params.push(rating)}`)}
    if (visit_date != null) { updates.push(`visit_date=$${params.push(visit_date)}`)}
    await pool.query(`UPDATE reviews SET ${updates.join(',')} WHERE id=$1`, params)
    await updateRatingSummary(existing.rows[0].restaurant_id)
    await cacheDelPattern(`reviews:restaurant:${existing.rows[0].restaurant_id}:*`)
    res.json({ success: true, message: 'Review updated' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/reviews/:reviewId', authMiddleware, async (req, res) => {
  const { reviewId } = req.params
  try {
    const existing = await pool.query(
      `SELECT id, restaurant_id FROM reviews WHERE id=$1 AND user_id=$2`,
      [reviewId, req.user.id]
    )
    if (!existing.rows.length) return res.status(404).json({ message: 'Review not found or not authorized' })
    await pool.query(`DELETE FROM reviews WHERE id=$1`, [reviewId])
    await updateRatingSummary(existing.rows[0].restaurant_id)
    await cacheDelPattern(`reviews:restaurant:${existing.rows[0].restaurant_id}:*`)
    res.json({ success: true, message: 'Review deleted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// REVIEW LIKES
// ============================================================

app.get('/api/reviews/:restaurantId/liked', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(
      `SELECT rl.review_id FROM review_likes rl JOIN reviews rv ON rv.id=rl.review_id
       JOIN restaurants rs ON (rs.id::text = rv.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = rv.restaurant_id)
       WHERE rl.user_id=$1 AND rs.id::text=$2`,
      [req.user.id, restaurantId]
    )
    res.json({ liked_review_ids: r.rows.map(x => x.review_id) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/reviews/:reviewId/like', authMiddleware, async (req, res) => {
  const { reviewId } = req.params
  try {
    const ex = await pool.query(`SELECT id FROM review_likes WHERE user_id=$1 AND review_id=$2`, [req.user.id, reviewId])
    if (!ex.rows.length) {
      await pool.query(`INSERT INTO review_likes (user_id, review_id, created_at) VALUES ($1,$2,NOW())`, [req.user.id, reviewId])
    }
    const cnt = await pool.query(`SELECT COUNT(*) AS cnt FROM review_likes WHERE review_id=$1`, [reviewId])
    const trueCount = parseInt(cnt.rows[0].cnt)
    await pool.query(`UPDATE reviews SET likes_count=$1 WHERE id=$2`, [trueCount, reviewId])
    res.json({ success: true, message: ex.rows.length ? 'Already liked' : 'Review liked' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/reviews/:reviewId/like', authMiddleware, async (req, res) => {
  const { reviewId } = req.params
  try {
    await pool.query(`DELETE FROM review_likes WHERE user_id=$1 AND review_id=$2`, [req.user.id, reviewId])
    const cnt = await pool.query(`SELECT COUNT(*) AS cnt FROM review_likes WHERE review_id=$1`, [reviewId])
    const trueCount = parseInt(cnt.rows[0].cnt)
    await pool.query(`UPDATE reviews SET likes_count=$1 WHERE id=$2`, [trueCount, reviewId])
    res.json({ success: true, message: 'Like removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// REVIEW REPLIES
// ============================================================

app.get('/api/reviews/:reviewId/replies', async (req, res) => {
  const { reviewId } = req.params
  const cacheKey = `replies:review:${reviewId}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT rr.id, rr.review_id, rr.user_id, rr.parent_id, rr.content, rr.created_at, u.username
       FROM review_replies rr LEFT JOIN users u ON u.id=rr.user_id
       WHERE rr.review_id=$1 ORDER BY rr.created_at ASC`,
      [reviewId]
    )
    const result = { replies: r.rows }
    await cacheSet(cacheKey, result, TTL.REPLIES)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/reviews/:reviewId/replies', authMiddleware, async (req, res) => {
  const { reviewId } = req.params
  const { content, parent_id } = req.body
  try {
    const exists = await pool.query(`SELECT id FROM reviews WHERE id=$1`, [reviewId])
    if (!exists.rows.length) return res.status(404).json({ message: 'Review not found' })
    const r = await pool.query(
      `INSERT INTO review_replies (review_id, user_id, parent_id, content, created_at)
       VALUES ($1,$2,$3,$4,NOW()) RETURNING id, review_id, user_id, parent_id, content, created_at`,
      [reviewId, req.user.id, parent_id || null, content]
    )
    await cacheDel(`replies:review:${reviewId}`)
    res.json({ success: true, reply: { ...r.rows[0], username: req.user.username || 'User' } })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/reviews/:reviewId/replies/:replyId', authMiddleware, async (req, res) => {
  const { reviewId, replyId } = req.params
  try {
    const ex = await pool.query(
      `SELECT id FROM review_replies WHERE id=$1 AND review_id=$2 AND user_id=$3`,
      [replyId, reviewId, req.user.id]
    )
    if (!ex.rows.length) return res.status(404).json({ message: 'Reply not found or not authorized' })
    await pool.query(`DELETE FROM review_replies WHERE id=$1 OR parent_id=$1`, [replyId])
    await cacheDel(`replies:review:${reviewId}`)
    res.json({ success: true, message: 'Reply deleted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// RATINGS
// ============================================================

// Bulk ratings — single query replaces N separate /api/ratings/:slug calls from
// the all-restaurants page when sorting by rating.
app.get('/api/ratings/bulk', async (req, res) => {
  const raw = String(req.query.slugs || '').trim()
  if (!raw) return res.json({})
  const slugs = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 100)
  if (!slugs.length) return res.json({})

  const cacheKey = `ratings:bulk:${[...slugs].sort().join(',')}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const r = await pool.query(
      `SELECT LOWER(REPLACE(rs.name,' ','-')) AS slug,
              COALESCE(s.average_rating, 0) AS average_rating,
              COALESCE(s.total_ratings, 0)  AS total_ratings,
              COALESCE(s.total_reviews, 0)  AS total_reviews
       FROM restaurants rs
       LEFT JOIN restaurant_ratings_summary s ON s.restaurant_id = rs.id::text
       WHERE LOWER(REPLACE(rs.name,' ','-')) = ANY($1)`,
      [slugs]
    )
    const result = {}
    r.rows.forEach(row => {
      result[row.slug] = {
        average_rating: Number(row.average_rating),
        total_ratings:  Number(row.total_ratings),
        total_reviews:  Number(row.total_reviews),
      }
    })
    await cacheSet(cacheKey, result, TTL.RATINGS_SUMMARY)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/ratings/:restaurantId/user', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(
      `SELECT stars, created_at, updated_at FROM ratings WHERE user_id=$1 AND restaurant_id=$2`,
      [req.user.id, restaurantId]
    )
    if (!r.rows.length) return res.json({ rated: false })
    res.json({ rated: true, ...r.rows[0] })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/ratings/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params
  const cacheKey = `ratings:restaurant:${restaurantId}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const [dist, summary, allRatings] = await Promise.all([
      pool.query(
        `SELECT stars, COUNT(*) AS count FROM ratings WHERE restaurant_id=$1 GROUP BY stars ORDER BY stars DESC`,
        [restaurantId]
      ),
      pool.query(
        `SELECT average_rating, total_ratings, total_reviews FROM restaurant_ratings_summary WHERE restaurant_id=$1`,
        [restaurantId]
      ),
      pool.query(
        `SELECT id, stars, price_range FROM ratings WHERE restaurant_id=$1`,
        [restaurantId]
      ),
    ])
    const distMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    dist.rows.forEach(r => { distMap[r.stars] = parseInt(r.count) })
    const priced = allRatings.rows.filter(r => r.price_range)
    const avg_price = priced.length ? Math.round(priced.reduce((s, r) => s + r.price_range, 0) / priced.length) : null
    const s = summary.rows[0] || { average_rating: 0, total_ratings: 0, total_reviews: 0 }
    const result = { ...s, distribution: distMap, ratings: allRatings.rows, average_price_range: avg_price }
    await cacheSet(cacheKey, result, TTL.RATINGS_SUMMARY)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/ratings', authMiddleware, async (req, res) => {
  const { restaurant_id, stars, price_range } = req.body
  try {
    const ex = await pool.query(`SELECT id FROM ratings WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurant_id])
    if (ex.rows.length) {
      await pool.query(`UPDATE ratings SET stars=$1, price_range=$2, updated_at=NOW() WHERE id=$3`, [stars, price_range || null, ex.rows[0].id])
    } else {
      await pool.query(
        `INSERT INTO ratings (user_id, restaurant_id, stars, price_range, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW())`,
        [req.user.id, restaurant_id, stars, price_range || null]
      )
    }
    const summary = await updateRatingSummary(restaurant_id)
    res.json({ success: true, ...summary })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/ratings/:restaurantId', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    await pool.query(`DELETE FROM ratings WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    const summary = await updateRatingSummary(restaurantId)
    res.json({ success: true, ...summary })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// BOOKMARKS (WISHLIST)
// ============================================================

app.get('/api/users/bookmarks', authMiddleware, async (req, res) => {
  const cacheKey = `bookmarks:user:${req.user.id}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT w.id, w.restaurant_id, w.added_at, rs.name, rs.area, rs.cuisine, rs.image_url,
              LOWER(REPLACE(rs.name,' ','-')) AS slug
       FROM wishlist w LEFT JOIN restaurants rs ON rs.id::text = w.restaurant_id
       WHERE w.user_id=$1 ORDER BY w.added_at DESC`,
      [req.user.id]
    )
    const bookmarks = r.rows.map(b => ({ ...b, images: b.image_url ? [b.image_url] : [] }))
    const result = { bookmarks, total: bookmarks.length }
    await cacheSet(cacheKey, result, TTL.BOOKMARKS_USER)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/bookmarks/:restaurantId/check', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(`SELECT id FROM wishlist WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    res.json({ bookmarked: r.rows.length > 0 })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/bookmarks/:restaurantId', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    await pool.query(
      `INSERT INTO wishlist (user_id, restaurant_id, added_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING`,
      [req.user.id, restaurantId]
    )
    await cacheDel(`bookmarks:user:${req.user.id}`)
    res.json({ success: true, message: 'Bookmark added' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/bookmarks/:restaurantId', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(`DELETE FROM wishlist WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    if (r.rowCount === 0) return res.status(404).json({ message: 'Bookmark not found' })
    await cacheDel(`bookmarks:user:${req.user.id}`)
    res.json({ success: true, message: 'Bookmark removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// VISITS (BEEN HERE)
// ============================================================

app.get('/api/visits/:restaurantId/check', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(`SELECT id, visited_at FROM visits WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    if (!r.rows.length) return res.json({ visited: false })
    res.json({ visited: true, visited_at: r.rows[0].visited_at })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/visits/:restaurantId', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const ex = await pool.query(`SELECT id FROM visits WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    if (ex.rows.length) return res.json({ success: true, message: 'Already marked as visited' })
    await pool.query(
      `INSERT INTO visits (user_id, restaurant_id, visited_at, created_at) VALUES ($1,$2,NOW(),NOW())`,
      [req.user.id, restaurantId]
    )
    await Promise.all([
      cacheDelPattern(`visits:user:${req.user.id}:*`),
      cacheDel(`home:user:${req.user.id}`),
    ])
    res.json({ success: true, message: 'Visit recorded' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/visits/:restaurantId', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    await pool.query(`DELETE FROM visits WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
    await Promise.all([
      cacheDelPattern(`visits:user:${req.user.id}:*`),
      cacheDel(`home:user:${req.user.id}`),
    ])
    console.log(`[SYNC] Removed been for restaurant ${restaurantId} user ${req.user.id}`)
    try {
      const revRows = await pool.query(
        `SELECT id FROM reviews WHERE user_id=$1 AND restaurant_id=$2`,
        [req.user.id, restaurantId]
      )
      if (revRows.rows.length > 0) {
        for (const row of revRows.rows) {
          await pool.query(`DELETE FROM reviews WHERE id=$1`, [row.id])
        }
        console.log(`[SYNC] Deleted ${revRows.rows.length} review(s) for restaurant ${restaurantId} user ${req.user.id} on been removal`)
      }
      await pool.query(`DELETE FROM ratings WHERE user_id=$1 AND restaurant_id=$2`, [req.user.id, restaurantId])
      await updateRatingSummary(restaurantId)
    } catch (syncErr) {
      console.error(`[SYNC] Failed to delete review/rating on been removal: ${syncErr.message}`)
    }
    res.json({ success: true, message: 'Visit removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// LISTS
// ============================================================

app.get('/api/public-lists', optionalAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 3
  const search = (req.query.search || '').trim()
  const uid = req.user ? req.user.id : null
  // Cache per uid so liked_by_user is always correct; invalidated on like/unlike writes
  const cacheKey = `lists:public:${search.toLowerCase()}:${limit}:${uid || 'anon'}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT l.id, l.title, l.description, l.user_id, u.username AS owner_username,
              COUNT(DISTINCT li.id) AS item_count,
              COALESCE(COUNT(DISTINCT ll.id),0) AS likes_count,
              CASE WHEN $1::int IS NULL THEN false
                   ELSE EXISTS(SELECT 1 FROM list_likes ll2 WHERE ll2.list_id=l.id AND ll2.user_id=$1) END AS liked_by_user
       FROM lists l JOIN users u ON l.user_id=u.id
       LEFT JOIN list_items li ON li.list_id=l.id
       LEFT JOIN list_likes ll ON ll.list_id=l.id
       WHERE l.is_public=true AND ($2='' OR LOWER(l.title) LIKE $3)
       GROUP BY l.id, l.title, l.description, l.user_id, u.username
       ORDER BY likes_count DESC, item_count DESC, MAX(l.created_at) DESC
       LIMIT $4`,
      [uid, search, `%${search.toLowerCase()}%`, limit]
    )
    const previews = await batchListPreviews(r.rows.map(l => l.id))
    const lists = r.rows.map(lst => ({
      id: lst.id, title: lst.title, description: lst.description,
      owner_id: lst.user_id, owner_username: lst.owner_username,
      item_count: parseInt(lst.item_count), likes_count: parseInt(lst.likes_count || 0),
      liked_by_user: Boolean(lst.liked_by_user), preview_restaurants: previews[lst.id] || []
    }))
    const result = { lists }
    await cacheSet(cacheKey, result, TTL.LISTS_PUBLIC)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/lists/public', optionalAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 3
  const search = (req.query.search || '').trim()
  const uid = req.user ? req.user.id : null
  const cacheKey = `lists:public:${search.toLowerCase()}:${limit}:${uid || 'anon'}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT l.id, l.title, l.description, l.user_id, u.username AS owner_username,
              COUNT(DISTINCT li.id) AS item_count,
              COALESCE(COUNT(DISTINCT ll.id),0) AS likes_count,
              CASE WHEN $1::int IS NULL THEN false
                   ELSE EXISTS(SELECT 1 FROM list_likes ll2 WHERE ll2.list_id=l.id AND ll2.user_id=$1) END AS liked_by_user
       FROM lists l JOIN users u ON l.user_id=u.id
       LEFT JOIN list_items li ON li.list_id=l.id
       LEFT JOIN list_likes ll ON ll.list_id=l.id
       WHERE l.is_public=true AND ($2='' OR LOWER(l.title) LIKE $3)
       GROUP BY l.id, l.title, l.description, l.user_id, u.username
       ORDER BY likes_count DESC, item_count DESC, MAX(l.created_at) DESC
       LIMIT $4`,
      [uid, search, `%${search.toLowerCase()}%`, limit]
    )
    const previews = await batchListPreviews(r.rows.map(l => l.id))
    const lists = r.rows.map(lst => ({
      id: lst.id, title: lst.title, description: lst.description,
      owner_id: lst.user_id, owner_username: lst.owner_username,
      item_count: parseInt(lst.item_count), likes_count: parseInt(lst.likes_count || 0),
      liked_by_user: Boolean(lst.liked_by_user), preview_restaurants: previews[lst.id] || []
    }))
    const result = { lists }
    await cacheSet(cacheKey, result, TTL.LISTS_PUBLIC)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/lists', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id, l.title, l.description, l.is_public, l.created_at, l.updated_at,
              COUNT(DISTINCT li.id) AS item_count,
              COALESCE(COUNT(DISTINCT ll.id),0) AS likes_count,
              EXISTS(SELECT 1 FROM list_likes ll2 WHERE ll2.list_id=l.id AND ll2.user_id=$1) AS liked_by_user
       FROM lists l LEFT JOIN list_items li ON l.id=li.list_id LEFT JOIN list_likes ll ON l.id=ll.list_id
       WHERE l.user_id=$1 GROUP BY l.id ORDER BY l.updated_at DESC`,
      [req.user.id]
    )
    const previews = await batchListPreviews(r.rows.map(l => l.id))
    const lists = r.rows.map(lst => ({
      ...lst, cover_images: (previews[lst.id] || []).map(p => p.image_url)
    }))
    res.json({ lists })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/lists', authMiddleware, async (req, res) => {
  const { title, description, is_public } = req.body
  try {
    const r = await pool.query(
      `INSERT INTO lists (user_id, title, description, is_public, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id, title, description, is_public, created_at`,
      [req.user.id, title, description || null, is_public || false]
    )
    res.json({ success: true, list: r.rows[0] })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/lists/:listId/public', optionalAuth, async (req, res) => {
  const { listId } = req.params
  const uid = req.user ? req.user.id : null
  const cacheKey = `list:public:${listId}:${uid || 'anon'}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT l.id, l.title, l.description, l.user_id, u.username AS owner_username,
              COUNT(DISTINCT li.id) AS item_count, COALESCE(COUNT(DISTINCT ll.id),0) AS likes_count,
              CASE WHEN $2::int IS NULL THEN false
                   ELSE EXISTS(SELECT 1 FROM list_likes ll2 WHERE ll2.list_id=l.id AND ll2.user_id=$2) END AS liked_by_user
       FROM lists l JOIN users u ON l.user_id=u.id
       LEFT JOIN list_items li ON li.list_id=l.id LEFT JOIN list_likes ll ON ll.list_id=l.id
       WHERE l.id=$1 AND l.is_public=true GROUP BY l.id, l.title, l.description, l.user_id, u.username`,
      [listId, uid]
    )
    if (!r.rows.length) return res.status(404).json({ message: 'List not found or not public' })
    const lst = r.rows[0]
    const items = await pool.query(
      `SELECT li.restaurant_id AS slug, li.notes, li.position FROM list_items li WHERE li.list_id=$1 ORDER BY li.position, li.added_at`,
      [listId]
    )
    const restaurants = (await Promise.all(items.rows.map(async item => {
      const rest = await pool.query(
        `SELECT name, area, cuisine, image_url, LOWER(REPLACE(name,' ','-')) AS slug FROM restaurants WHERE id::text=$1 LIMIT 1`,
        [item.slug]
      )
      return rest.rows.length ? { ...rest.rows[0], notes: item.notes } : null
    }))).filter(Boolean)
    const result = {
      list: { id: lst.id, title: lst.title, description: lst.description, item_count: parseInt(lst.item_count),
              owner_id: lst.user_id, owner_username: lst.owner_username,
              likes_count: parseInt(lst.likes_count || 0), liked_by_user: Boolean(lst.liked_by_user) },
      restaurants
    }
    await cacheSet(cacheKey, result, TTL.LIST_DETAIL)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/lists/:listId', optionalAuth, async (req, res) => {
  const { listId } = req.params
  try {
    const r = await pool.query(
      `SELECT l.*, u.username AS owner_username FROM lists l JOIN users u ON l.user_id=u.id WHERE l.id=$1`,
      [listId]
    )
    if (!r.rows.length) return res.status(404).json({ message: 'List not found' })
    const lst = r.rows[0]
    if (!lst.is_public && (!req.user || Number(req.user.id) !== Number(lst.user_id))) {
      return res.status(403).json({ message: 'This list is private' })
    }
    const items = await pool.query(
      `SELECT li.id, li.restaurant_id, li.position, li.notes, li.added_at, rs.name, rs.area, rs.cuisine, rs.image_url,
              LOWER(REPLACE(rs.name,' ','-')) AS slug
       FROM list_items li LEFT JOIN restaurants rs ON (
         rs.id::text = li.restaurant_id
         OR LOWER(REPLACE(rs.name,' ','-')) = LOWER(li.restaurant_id)
         OR LOWER(REPLACE(rs.name,' ','-')) = LOWER(REPLACE(li.restaurant_id,'-',' '))
       )
       WHERE li.list_id=$1 ORDER BY li.position ASC`,
      [listId]
    )
    const resolvedItems = await Promise.all(items.rows.map(async (item) => {
      if (item.name) return item
      try {
        const fallback = await pool.query(
          `SELECT name, area, cuisine, image_url, LOWER(REPLACE(name,' ','-')) AS slug
           FROM restaurants WHERE LOWER(REPLACE(REGEXP_REPLACE(name,'[^a-z0-9]','-','gi'),' ','-')) = LOWER(REGEXP_REPLACE($1,'[^a-z0-9]','-','gi')) LIMIT 1`,
          [item.restaurant_id]
        )
        if (fallback.rows.length) return { ...item, ...fallback.rows[0] }
      } catch { /* ignore */ }
      return item
    }))
    res.json({ ...lst, items: resolvedItems.map(i => ({ ...i, images: i.image_url ? [i.image_url] : [] })),
               is_owner: req.user && Number(req.user.id) === Number(lst.user_id) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.put('/api/lists/:listId', authMiddleware, async (req, res) => {
  const { listId } = req.params
  const { title, description, is_public } = req.body
  try {
    const ex = await pool.query(`SELECT id FROM lists WHERE id=$1 AND user_id=$2`, [listId, req.user.id])
    if (!ex.rows.length) return res.status(404).json({ message: 'List not found or not authorized' })
    const updates = ['updated_at=NOW()']
    const params = [listId]
    if (title != null)       { updates.push(`title=$${params.push(title)}`) }
    if (description != null) { updates.push(`description=$${params.push(description)}`) }
    if (is_public != null)   { updates.push(`is_public=$${params.push(is_public)}`) }
    await pool.query(`UPDATE lists SET ${updates.join(',')} WHERE id=$1`, params)
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, message: 'List updated' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/lists/:listId', authMiddleware, async (req, res) => {
  const { listId } = req.params
  try {
    const r = await pool.query(`DELETE FROM lists WHERE id=$1 AND user_id=$2`, [listId, req.user.id])
    if (r.rowCount === 0) return res.status(404).json({ message: 'List not found or not authorized' })
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, message: 'List deleted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/lists/:listId/items/by-restaurant/:restaurantId', authMiddleware, async (req, res) => {
  const { listId, restaurantId } = req.params
  try {
    const r = await pool.query(
      `DELETE FROM list_items WHERE restaurant_id=$1 AND list_id=$2
       AND EXISTS(SELECT 1 FROM lists WHERE id=$2 AND user_id=$3)`,
      [restaurantId, listId, req.user.id]
    )
    if (r.rowCount === 0) return res.status(404).json({ message: 'Item not found or not authorized' })
    await pool.query(`UPDATE lists SET updated_at=NOW() WHERE id=$1`, [listId])
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, message: 'Item removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/lists/:listId/items', authMiddleware, async (req, res) => {
  const { listId } = req.params
  const { restaurant_id, notes } = req.body
  try {
    const lst = await pool.query(`SELECT id FROM lists WHERE id=$1 AND user_id=$2`, [listId, req.user.id])
    if (!lst.rows.length) return res.status(404).json({ message: 'List not found or not authorized' })
    const pos = await pool.query(`SELECT COALESCE(MAX(position),-1)+1 AS next_pos FROM list_items WHERE list_id=$1`, [listId])
    const r = await pool.query(
      `INSERT INTO list_items (list_id, restaurant_id, position, notes, added_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING id`,
      [listId, restaurant_id, pos.rows[0].next_pos, notes || null]
    )
    await pool.query(`UPDATE lists SET updated_at=NOW() WHERE id=$1`, [listId])
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, item_id: r.rows[0].id })
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'Restaurant already in list' })
    res.status(500).json({ message: err.message })
  }
})

app.delete('/api/lists/:listId/items/:itemId', authMiddleware, async (req, res) => {
  const { listId, itemId } = req.params
  try {
    const r = await pool.query(
      `DELETE FROM list_items WHERE id=$1 AND list_id=$2 AND EXISTS(SELECT 1 FROM lists WHERE id=$2 AND user_id=$3)`,
      [itemId, listId, req.user.id]
    )
    if (r.rowCount === 0) return res.status(404).json({ message: 'Item not found or not authorized' })
    await pool.query(`UPDATE lists SET updated_at=NOW() WHERE id=$1`, [listId])
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, message: 'Item removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.put('/api/lists/:listId/reorder', authMiddleware, async (req, res) => {
  const { listId } = req.params
  const { item_ids } = req.body
  try {
    const lst = await pool.query(`SELECT id FROM lists WHERE id=$1 AND user_id=$2`, [listId, req.user.id])
    if (!lst.rows.length) return res.status(404).json({ message: 'List not found or not authorized' })
    await Promise.all(item_ids.map((id, pos) =>
      pool.query(`UPDATE list_items SET position=$1 WHERE id=$2 AND list_id=$3`, [pos, id, listId])
    ))
    await pool.query(`UPDATE lists SET updated_at=NOW() WHERE id=$1`, [listId])
    res.json({ success: true, message: 'Items reordered' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/lists/:listId/like', authMiddleware, async (req, res) => {
  const { listId } = req.params
  try {
    const lst = await pool.query(`SELECT id, is_public FROM lists WHERE id=$1`, [listId])
    if (!lst.rows.length) return res.status(404).json({ message: 'List not found' })
    if (!lst.rows[0].is_public) return res.status(403).json({ message: 'Only public lists can be liked' })
    await pool.query(`INSERT INTO list_likes (user_id, list_id, created_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING`, [req.user.id, listId])
    const cnt = await pool.query(`SELECT COUNT(*) AS cnt FROM list_likes WHERE list_id=$1`, [listId])
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, liked: true, likes_count: parseInt(cnt.rows[0].cnt) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/lists/:listId/like', authMiddleware, async (req, res) => {
  const { listId } = req.params
  try {
    await pool.query(`DELETE FROM list_likes WHERE user_id=$1 AND list_id=$2`, [req.user.id, listId])
    const cnt = await pool.query(`SELECT COUNT(*) AS cnt FROM list_likes WHERE list_id=$1`, [listId])
    await Promise.all([
      cacheDelPattern(`list:public:${listId}:*`),
      cacheDelPattern('lists:public:*'),
    ])
    res.json({ success: true, liked: false, likes_count: parseInt(cnt.rows[0].cnt) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/restaurants/:restaurantId/in-lists', authMiddleware, async (req, res) => {
  const { restaurantId } = req.params
  try {
    const r = await pool.query(
      `SELECT l.id, l.title,
              EXISTS(SELECT 1 FROM list_items li WHERE li.list_id=l.id AND li.restaurant_id=$1) AS contains_restaurant
       FROM lists l WHERE l.user_id=$2 ORDER BY l.title`,
      [restaurantId, req.user.id]
    )
    res.json({ lists: r.rows })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/restaurants/:slug/friends-rating', authMiddleware, async (req, res) => {
  const slug = req.params.slug.toLowerCase()
  try {
    const restRes = await pool.query(
      `SELECT id FROM restaurants WHERE LOWER(REPLACE(name,' ','-'))=$1 LIMIT 1`, [slug]
    )
    if (!restRes.rows.length) return res.json({ friends: [], avg_rating: null, count: 0 })
    const restaurantId = restRes.rows[0].id.toString()
    const r = await pool.query(
      `SELECT u.id, u.username, rat.stars
       FROM ratings rat
       JOIN users u ON rat.user_id = u.id
       WHERE rat.restaurant_id = $1
         AND rat.user_id IN (
           SELECT CASE WHEN requester_id=$2 THEN addressee_id ELSE requester_id END
           FROM friendships WHERE (requester_id=$2 OR addressee_id=$2) AND status='accepted'
         )
       ORDER BY u.username`,
      [restaurantId, req.user.id]
    )
    const friends = r.rows
    const avg = friends.length
      ? parseFloat((friends.reduce((s, f) => s + f.stars, 0) / friends.length).toFixed(1))
      : null
    res.json({ friends, avg_rating: avg, count: friends.length })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/restaurants/:slug/friends-been', authMiddleware, async (req, res) => {
  const slug = req.params.slug.toLowerCase()
  try {
    const restRes = await pool.query(
      `SELECT id FROM restaurants WHERE LOWER(REPLACE(name,' ','-'))=$1 LIMIT 1`, [slug]
    )
    if (!restRes.rows.length) return res.json({ friends: [] })
    const restaurantId = restRes.rows[0].id.toString()
    const r = await pool.query(
      `SELECT DISTINCT u.id, u.username FROM visits v JOIN users u ON v.user_id=u.id
       WHERE v.restaurant_id=$1
         AND v.user_id IN (
           SELECT CASE WHEN requester_id=$2 THEN addressee_id ELSE requester_id END
           FROM friendships WHERE (requester_id=$2 OR addressee_id=$2) AND status='accepted'
         )
       ORDER BY u.username`,
      [restaurantId, req.user.id]
    )
    res.json({ friends: r.rows })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ============================================================
// USERS / FRIENDS
// ============================================================

app.get('/api/users/search', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').trim()
  if (q.length < 2) return res.json({ users: [] })
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.name, f.id AS friendship_id, f.status AS friendship_status, f.requester_id
       FROM users u LEFT JOIN friendships f ON (
         (f.requester_id=$1 AND f.addressee_id=u.id) OR (f.addressee_id=$1 AND f.requester_id=u.id)
       )
       WHERE (LOWER(u.username) LIKE $2 OR LOWER(u.name) LIKE $2) AND u.id!=$1 AND u.username IS NOT NULL
       ORDER BY u.username LIMIT 10`,
      [req.user.id, `%${q.toLowerCase()}%`]
    )
    const users = r.rows.map(u => {
      let rel = 'none'
      if (u.friendship_status === 'accepted') rel = 'friends'
      else if (u.friendship_status === 'pending' && u.requester_id === req.user.id) rel = 'pending_sent'
      else if (u.friendship_status === 'pending') rel = 'pending_received'
      return { id: u.id, username: u.username, name: u.name, friendship_id: u.friendship_id, relation: rel }
    })
    res.json({ users })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/friends/requests', authMiddleware, async (req, res) => {
  const cacheKey = `friends:requests:${req.user.id}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT f.id AS friendship_id, f.created_at, u.id AS requester_id, u.username AS requester_username, u.name AS requester_name, u.bio AS requester_bio
       FROM friendships f JOIN users u ON u.id=f.requester_id
       WHERE f.addressee_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`,
      [req.user.id]
    )
    const result = { requests: r.rows }
    await cacheSet(cacheKey, result, TTL.FRIENDS_REQUESTS)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/friends/activity', authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 20
  const cacheKey = `friends:activity:${req.user.id}:${limit}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT v.id AS visit_id, v.restaurant_id, v.visited_at,
              u.id AS friend_id, u.username AS friend_username, u.name AS friend_name,
              rs.name AS restaurant_name, rs.area AS restaurant_area, rs.cuisine AS restaurant_cuisine, rs.image_url,
              LOWER(REPLACE(rs.name,' ','-')) AS slug,
              rat.stars, rev.content AS review_snippet
       FROM visits v JOIN users u ON v.user_id=u.id
       LEFT JOIN restaurants rs ON (rs.id::text = v.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = v.restaurant_id)
       LEFT JOIN ratings rat ON rat.user_id=v.user_id AND rat.restaurant_id=v.restaurant_id
       LEFT JOIN reviews rev ON rev.user_id=v.user_id AND rev.restaurant_id=v.restaurant_id
       WHERE v.user_id IN (
         SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END
         FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'
       )
       ORDER BY v.visited_at DESC LIMIT $2`,
      [req.user.id, limit]
    )
    const activity = r.rows.map(a => ({
      ...a, review_snippet: a.review_snippet && a.review_snippet.length > 120
        ? a.review_snippet.slice(0, 120) + '…' : a.review_snippet
    }))
    const result = { activity }
    await cacheSet(cacheKey, result, TTL.FRIENDS_ACTIVITY)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/friends', authMiddleware, async (req, res) => {
  const cacheKey = `friends:list:${req.user.id}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT f.id AS friendship_id, f.created_at AS friends_since,
              CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END AS friend_id,
              u.username, u.name
       FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id=$1 OR f.addressee_id=$1) AND f.status='accepted' ORDER BY u.username`,
      [req.user.id]
    )
    const result = { friends: r.rows }
    await cacheSet(cacheKey, result, TTL.FRIENDS_LIST)
    res.json(result)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/friends/request/:addresseeId', authMiddleware, async (req, res) => {
  const addresseeId = parseInt(req.params.addresseeId)
  if (req.user.id === addresseeId) return res.status(400).json({ message: 'Cannot friend yourself' })
  try {
    const target = await pool.query(`SELECT id FROM users WHERE id=$1`, [addresseeId])
    if (!target.rows.length) return res.status(404).json({ message: 'User not found' })
    const ex = await pool.query(
      `SELECT id, status FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,
      [req.user.id, addresseeId]
    )
    if (ex.rows.length) {
      if (ex.rows[0].status === 'accepted') return res.status(400).json({ message: 'Already friends' })
      if (ex.rows[0].status === 'pending')  return res.status(400).json({ message: 'Request already pending' })
    }
    const r = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES ($1,$2,'pending',NOW(),NOW()) RETURNING id`,
      [req.user.id, addresseeId]
    )
    await cacheDel(`friends:requests:${addresseeId}`)
    res.json({ success: true, message: 'Friend request sent', friendship_id: r.rows[0].id })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/friends/:friendshipId/accept', authMiddleware, async (req, res) => {
  const { friendshipId } = req.params
  try {
    const fRow = await pool.query(
      `UPDATE friendships SET status='accepted', updated_at=NOW()
       WHERE id=$1 AND addressee_id=$2 AND status='pending'
       RETURNING requester_id, addressee_id`,
      [friendshipId, req.user.id]
    )
    if (!fRow.rowCount) return res.status(404).json({ message: 'Request not found or not authorized' })
    const { requester_id, addressee_id } = fRow.rows[0]
    await Promise.all([
      cacheDel(`friends:list:${requester_id}`),
      cacheDel(`friends:list:${addressee_id}`),
      cacheDel(`friends:requests:${addressee_id}`),
    ])
    res.json({ success: true, message: 'Friend request accepted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.post('/api/friends/:friendshipId/decline', authMiddleware, async (req, res) => {
  const { friendshipId } = req.params
  try {
    const r = await pool.query(
      `UPDATE friendships SET status='declined', updated_at=NOW() WHERE id=$1 AND addressee_id=$2 AND status='pending'`,
      [friendshipId, req.user.id]
    )
    if (r.rowCount === 0) return res.status(404).json({ message: 'Request not found or not authorized' })
    await cacheDel(`friends:requests:${req.user.id}`)
    res.json({ success: true, message: 'Request declined' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.delete('/api/friends/:friendshipId', authMiddleware, async (req, res) => {
  const { friendshipId } = req.params
  try {
    const fRow = await pool.query(
      `DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2)
       RETURNING requester_id, addressee_id`,
      [friendshipId, req.user.id]
    )
    if (!fRow.rowCount) return res.status(404).json({ message: 'Friendship not found or not authorized' })
    const { requester_id, addressee_id } = fRow.rows[0]
    await Promise.all([
      cacheDel(`friends:list:${requester_id}`),
      cacheDel(`friends:list:${addressee_id}`),
    ])
    res.json({ success: true, message: 'Friend removed' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/users/:userId/friendship-status', authMiddleware, async (req, res) => {
  const userId = parseInt(req.params.userId)
  if (req.user.id === userId) return res.json({ relation: 'self' })
  try {
    const r = await pool.query(
      `SELECT id, requester_id, addressee_id, status FROM friendships
       WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1) LIMIT 1`,
      [req.user.id, userId]
    )
    if (!r.rows.length) return res.json({ relation: 'none', friendship_id: null })
    const row = r.rows[0]
    if (row.status === 'accepted') return res.json({ relation: 'friends', friendship_id: row.id })
    if (row.status === 'pending') {
      return res.json({ relation: row.requester_id === req.user.id ? 'pending_sent' : 'pending_received', friendship_id: row.id })
    }
    res.json({ relation: 'none', friendship_id: null })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/users/:userId/stats', authMiddleware, async (req, res) => {
  const { userId } = req.params
  try {
    const today = new Date(); today.setDate(1)
    const [friends, visits, monthVisits] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS cnt FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'`,
        [userId]
      ),
      pool.query(`SELECT COUNT(*) AS cnt FROM visits WHERE user_id=$1`, [userId]),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM visits WHERE user_id=$1 AND visited_at>=$2`,
        [userId, today.toISOString().split('T')[0]]
      ),
    ])
    res.json({
      friend_count: parseInt(friends.rows[0].cnt),
      total_visits: parseInt(visits.rows[0].cnt),
      month_visits: parseInt(monthVisits.rows[0].cnt)
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/users/:userId/visits/recent', authMiddleware, async (req, res) => {
  const { userId } = req.params
  const limit = Math.min(parseInt(req.query.limit) || 5, 1000)
  const cacheKey = `visits:user:${userId}:${limit}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)
  try {
    const r = await pool.query(
      `SELECT v.restaurant_id, LOWER(REPLACE(rs.name,' ','-')) AS slug,
              rs.name, rs.area, rs.cuisine, rs.image_url, v.visited_at,
              COALESCE(rat.stars, 0) AS user_rating
       FROM visits v
       LEFT JOIN restaurants rs ON (rs.id::text = v.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = v.restaurant_id)
       LEFT JOIN ratings rat ON rat.restaurant_id=v.restaurant_id AND rat.user_id=$1
       WHERE v.user_id=$1 ORDER BY v.visited_at DESC LIMIT $2`,
      [userId, limit]
    )
    await cacheSet(cacheKey, r.rows, TTL.VISITS_USER)
    res.json(r.rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

app.get('/api/users/:userId/reviews', authMiddleware, async (req, res) => {
  const { userId } = req.params
  const limit = Math.min(parseInt(req.query.limit) || 5, 20)
  try {
    const r = await pool.query(
      `SELECT rev.id, rev.restaurant_id, rev.content, rev.rating, rev.visit_date, rev.created_at, rev.likes_count,
              rs.name AS restaurant_name, rs.area AS restaurant_area, rs.cuisine,
              LOWER(REPLACE(rs.name,' ','-')) AS slug
       FROM reviews rev LEFT JOIN restaurants rs ON (rs.id::text = rev.restaurant_id OR LOWER(REPLACE(rs.name,' ','-')) = rev.restaurant_id)
       WHERE rev.user_id=$1 ORDER BY rev.created_at DESC LIMIT $2`,
      [userId, limit]
    )
    res.json(r.rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ================== BLOG PAGE SSR ==================

app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params
  const cacheKey = `page:blog:${slug}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    return res.send(cached)
  }
  try {
    const blogR = await pool.query(
      `SELECT id, title, slug, author, hero_image, content, created_at FROM blogs WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    if (!blogR.rows.length) return res.redirect('/blog')
    const post = blogR.rows[0]
    const title = `${post.title} — Catalog Journal`
    const raw = String(post.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const description = raw.slice(0, 155) || `Read "${post.title}" on Catalog Journal.`
    const canonical = `https://www.catalogapp.in/blog/${slug}`
    const image = post.hero_image || null
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      author: { '@type': 'Person', name: post.author || 'Catalog' },
      datePublished: post.created_at,
      publisher: { '@type': 'Organization', name: 'Catalog', url: 'https://www.catalogapp.in' },
      ...(image && { image }),
    }
    const html = injectSeoHead(_TMPL.blog, { title, description, canonical, image, ogType: 'article', jsonLd })
    if (!html) return res.redirect('/blog')
    await cacheSet(cacheKey, html, 60 * 60)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    res.send(html)
  } catch { res.redirect('/blog') }
})

// Export for Vercel — do NOT call app.listen()
module.exports = app
