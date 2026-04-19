You are a senior full-stack engineer doing a combined SEO + performance overhaul
on catalogapp.in — an Express.js + Supabase restaurant discovery app on Vercel.

The site is extremely slow (8-10s to interactive after login) and has zero SEO
presence. Fix both completely. This is the full spec.

================================================================
STEP 0 — READ THE CODEBASE FIRST, TOUCH NOTHING YET
================================================================

Before writing a single line:

1. Run: find . -type f -name "*.js" | grep -v node_modules | head -60
2. Run: find . -type f -name "*.ejs" -o -name "*.pug" -o -name "*.hbs" | grep -v node_modules
3. cat package.json
4. Read every route file completely
5. Read every template/view file completely
6. Find where supabase client is initialised
7. Find where auth/session is checked
8. Find the main JS bundle(s) served to the browser
9. Run: du -sh public/js/* 2>/dev/null || find . -name "*.bundle.js" | grep -v node_modules

Map out every route and what data it fetches. Identify every sequential
await chain. Identify every client-side fetch call. Do not skip this step.

================================================================
PART A — PERFORMANCE FIXES (do these first — they make the biggest
difference to user experience)
================================================================

--- A1: FIX THE QUERY WATERFALL (biggest speed win) ---

The site has sequential database calls where every await blocks the next.
Convert ALL of them to Promise.all() throughout the entire codebase.

Pattern to find and fix everywhere:

  // BEFORE — slow, sequential
  const restaurant = await supabase.from('restaurants')...
  const ratings = await supabase.from('restaurant_ratings_summary')...
  const reviews = await supabase.from('reviews')...
  const user = await getUser()

  // AFTER — fast, parallel
  const [restaurantRes, ratingsRes, reviewsRes, userRes] = await Promise.all([
    supabase.from('restaurants').select('name,area,cuisine,slug,image_url,cloudinary_images,opening_hours,latitude,longitude,formatted_address,phone_number').eq('slug', slug).single(),
    supabase.from('restaurant_ratings_summary').select('average_rating,total_ratings,total_reviews').eq('restaurant_id', slug).single(),
    supabase.from('reviews').select('id,content,rating,visit_date,created_at,user_id').eq('restaurant_id', slug).order('created_at', {ascending:false}).limit(5),
    getSessionUser(req)
  ])

Apply this to EVERY route. The auth check and data fetches must ALWAYS
run in parallel — never let auth block data fetching.

--- A2: SELECT ONLY WHAT YOU NEED (stop fetching all columns) ---

Your restaurants table has 20 columns. Most pages only need 6-8 of them.
Find every supabase query doing .select('*') and replace with specific columns.

Homepage needs: id, name, slug, cuisine, area, image_url, cloudinary_images
Restaurant page needs: name, area, cuisine, slug, image_url, cloudinary_images, opening_hours, latitude, longitude, formatted_address, phone_number
All-restaurants list needs: id, name, slug, cuisine, area, image_url
Search needs: id, name, slug, cuisine, area

Never fetch: normalized_name, normalized_area, dedupe_key, confidence_score,
zomato_url, images (jsonb), last_updated — on list/card views.

--- A3: ADD DATABASE INDEXES (makes queries 10-100x faster) ---

Connect to the Supabase project (pjsyvlhwuhdibpahputx) and run these SQL
migrations. Create the file supabase/migrations/[timestamp]_add_seo_indexes.sql:

-- Critical indexes for query speed
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_slug
  ON restaurants(slug);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_area
  ON restaurants(area);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_cuisine
  ON restaurants(cuisine);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_area_cuisine
  ON restaurants(area, cuisine);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_restaurant_id
  ON reviews(restaurant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_restaurant_created
  ON reviews(restaurant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ratings_user_restaurant
  ON ratings(user_id, restaurant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_user_id
  ON visits(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wishlist_user_id
  ON wishlist(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_requester
  ON friendships(requester_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_addressee
  ON friendships(addressee_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_list_items_list_id
  ON list_items(list_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read);

Apply using: npx supabase db push
Or run directly in Supabase SQL editor if CLI is not configured.

--- A4: ADD SERVER-SIDE RESPONSE CACHING ---

Restaurants don't change every second. Cache server responses so repeat
visitors and Google don't hit Supabase on every request.

Create /utils/cache.js:

const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data, ttlSeconds = 300) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

function invalidateCache(key) {
  cache.delete(key);
}

module.exports = { getCached, setCached, invalidateCache };

Use it in every route that fetches public restaurant data:

const { getCached, setCached } = require('../utils/cache');

app.get('/restaurant/:slug', async (req, res) => {
  const cacheKey = `restaurant:${req.params.slug}`;
  let restaurant = getCached(cacheKey);

  if (!restaurant) {
    const { data } = await supabase.from('restaurants')
      .select('name,area,cuisine,...').eq('slug', req.params.slug).single();
    restaurant = data;
    setCached(cacheKey, restaurant, 300); // cache 5 minutes
  }

  // auth and user-specific data (visited, saved, rated) still fetched fresh
  const [ratings, reviews, userSession] = await Promise.all([...]);
  res.render('restaurant', { restaurant, ratings, reviews, userSession });
});

Cache TTLs to use:
- Individual restaurant: 300s (5 min)
- All-restaurants list: 120s (2 min)
- Homepage popular/curated: 180s (3 min)
- Blog posts: 600s (10 min)
- NEVER cache: user-specific data (visits, wishlist, ratings, friends)

--- A5: ADD HTTP CACHING HEADERS ---

Add these headers on Express responses for static/public content:

// In your main app.js or a middleware file
app.use('/public', express.static('public', {
  maxAge: '7d',        // browser caches CSS/JS/images for 7 days
  etag: true,
  lastModified: true
}));

// On restaurant pages (public content, changes infrequently)
res.set({
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
  'Vary': 'Accept-Encoding'
});

// On user-specific pages (been, saved, friends)
res.set('Cache-Control', 'private, no-cache');

--- A6: ADD SKELETON LOADERS for remaining client-side sections ---

For any section that still loads client-side (e.g. friend activity on
homepage), show skeleton placeholders immediately instead of blank space.

Add to your main CSS file:

.skeleton-box {
  background: var(--skeleton-base, #e0e0e0);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.skeleton-box::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.4) 50%,
    transparent 100%
  );
  animation: skeleton-shimmer 1.4s infinite;
}

@keyframes skeleton-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Specific skeleton shapes */
.skeleton-card { width: 100%; height: 200px; }
.skeleton-text-lg { width: 60%; height: 20px; margin-bottom: 8px; }
.skeleton-text-sm { width: 40%; height: 14px; }
.skeleton-avatar { width: 40px; height: 40px; border-radius: 50%; }

In templates, replace empty containers with skeleton markup:
<div class="skeleton-box skeleton-card"></div>
Then replace with real content once JS loads.

--- A7: DEFER NON-CRITICAL JAVASCRIPT ---

Find every <script> tag in your base layout template.
- Scripts needed for interactivity (buttons, nav): keep as-is or add defer
- Scripts for analytics, social widgets, non-critical features: add defer or move to bottom of body

Change:
  <script src="/js/app.js"></script>
To:
  <script src="/js/app.js" defer></script>

This alone can reduce Time to Interactive by 2-4 seconds.

Also split any inline <script> blocks that run on DOMContentLoaded —
these block rendering. Move them to external deferred files.

--- A8: OPTIMISE IMAGES ---

In every template where restaurant images are shown:

1. Add loading="lazy" to ALL images except the first/hero image:
   <img src="..." alt="..." loading="lazy">

2. Add explicit width and height to prevent layout shift:
   <img src="..." alt="..." width="400" height="300" loading="lazy">

3. For Cloudinary images, use Cloudinary's URL transformation to serve
   correctly sized images. If image URL contains cloudinary.com, append
   transformation params:
   
   // In a template helper or utility function
   function cloudinaryOptimise(url, width = 400) {
     if (!url || !url.includes('cloudinary.com')) return url;
     return url.replace('/upload/', `/upload/w_${width},q_auto,f_auto/`);
   }

   This serves WebP automatically, compresses, and resizes — massive
   reduction in page weight.

================================================================
PART B — SEO FIXES
================================================================

--- B1: FIX URL STRUCTURE FIRST ---

Restaurant URLs currently use query params (/restaurant?slug=adige-dosa-house).
Change to clean path URLs (/restaurant/adige-dosa-house).

Find the route: app.get('/restaurant', ...) using req.query.slug
Change to: app.get('/restaurant/:slug', ...) using req.params.slug

Add 301 redirect for old URLs:
app.get('/restaurant', (req, res) => {
  if (req.query.slug) {
    return res.redirect(301, `/restaurant/${req.query.slug}`);
  }
  res.redirect('/all-restaurants');
});

Update every internal link in every template file.

--- B2: SERVER-SIDE RENDER ALL PAGES ---

The restaurant page currently sends <title>Loading…</title>.
That is what Google has indexed for all 2,470 restaurants.

For every route below, ensure ALL data is fetched server-side BEFORE
res.render() is called and injected into the template. The initial HTML
that hits the browser must contain real content, not "Loading…".

Pages to SSR:
- / (homepage)
- /restaurant/:slug
- /all-restaurants
- /blog
- /blog/:slug
- /lists (public lists)

--- B3: ADD META TAGS TO EVERY PAGE ---

Create /utils/seo.js:

function buildMeta({ title, description, image, url, type = 'website' }) {
  const defaultImage = 'https://www.catalogapp.in/og-default.jpg';
  const defaultDesc = 'Discover, log and share the best restaurants in Delhi. Your personal food diary and dining network.';

  return {
    title: title || 'Catalog — Discover Restaurants in Delhi',
    description: (description || defaultDesc).slice(0, 160),
    image: image || defaultImage,
    url: url || 'https://www.catalogapp.in',
    type
  };
}

module.exports = { buildMeta };

In every res.render() call, pass meta:

const { buildMeta } = require('../utils/seo');

// Restaurant page
res.render('restaurant', {
  restaurant,
  meta: buildMeta({
    title: `${restaurant.name} | ${restaurant.cuisine} | ${restaurant.area}, Delhi — Catalog`,
    description: `${restaurant.name} in ${restaurant.area}, Delhi. ${restaurant.cuisine} cuisine. ${avgRating ? `Rated ${avgRating}/5 by ${totalRatings} diners.` : ''} See photos and reviews on Catalog.`,
    image: restaurant.cloudinary_images?.[0] || restaurant.image_url,
    url: `https://www.catalogapp.in/restaurant/${restaurant.slug}`,
    type: 'restaurant'
  })
});

// All-restaurants
res.render('all-restaurants', {
  restaurants,
  meta: buildMeta({
    title: 'All Restaurants in Delhi | Discover & Rate Dining — Catalog',
    description: 'Explore 2,000+ restaurants across Delhi. Filter by cuisine, area and rating. Discover your next favourite meal on Catalog.',
    url: 'https://www.catalogapp.in/all-restaurants'
  })
});

// Homepage
res.render('index', {
  popular, lists, blogs,
  meta: buildMeta({
    title: 'Catalog — Discover & Remember the Best Restaurants in Delhi',
    description: 'Your personal food diary and restaurant discovery network. Log where you eaten, save where you want to go, and follow friends with great taste.',
    url: 'https://www.catalogapp.in'
  })
});

// Blog post
res.render('blog-post', {
  blog,
  meta: buildMeta({
    title: `${blog.title} — Catalog Journal`,
    description: blog.content?.replace(/<[^>]*>/g, '').slice(0, 155),
    image: blog.hero_image,
    url: `https://www.catalogapp.in/blog/${blog.slug}`
  })
});

In the base layout template, replace the static <head> meta section with:

<title><%= meta.title %></title>
<meta name="description" content="<%= meta.description %>">
<link rel="canonical" href="<%= meta.url %>">

<!-- Open Graph -->
<meta property="og:title" content="<%= meta.title %>">
<meta property="og:description" content="<%= meta.description %>">
<meta property="og:image" content="<%= meta.image %>">
<meta property="og:url" content="<%= meta.url %>">
<meta property="og:type" content="<%= meta.type %>">
<meta property="og:site_name" content="Catalog">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<%= meta.title %>">
<meta name="twitter:description" content="<%= meta.description %>">
<meta name="twitter:image" content="<%= meta.image %>">

(Adjust template syntax to match your engine — EJS uses <%=, Pug uses #{}, Handlebars uses {{}})

--- B4: ADD JSON-LD STRUCTURED DATA ---

On each restaurant page, inject this in <head> using server-side data:

<script type="application/ld+json">
<%- JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": restaurant.name,
  ...(restaurant.formatted_address && {
    "address": {
      "@type": "PostalAddress",
      "streetAddress": restaurant.formatted_address,
      "addressLocality": restaurant.area,
      "addressRegion": "Delhi",
      "addressCountry": "IN"
    }
  }),
  ...(restaurant.latitude && {
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": restaurant.latitude,
      "longitude": restaurant.longitude
    }
  }),
  ...(restaurant.phone_number && { "telephone": restaurant.phone_number }),
  ...(restaurant.cuisine && { "servesCuisine": restaurant.cuisine }),
  ...(restaurant.opening_hours && { "openingHours": restaurant.opening_hours }),
  "image": restaurant.cloudinary_images?.[0] || restaurant.image_url,
  "url": `https://www.catalogapp.in/restaurant/${restaurant.slug}`,
  ...(avgRating && {
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": Math.round(avgRating * 10) / 10,
      "reviewCount": totalReviews,
      "bestRating": 5,
      "worstRating": 1
    }
  })
}) %>
</script>

--- B5: CREATE /public/robots.txt ---

User-agent: *
Allow: /
Allow: /restaurant/
Allow: /all-restaurants
Allow: /blog
Allow: /about
Allow: /lists
Disallow: /login
Disallow: /signup
Disallow: /been
Disallow: /saved
Disallow: /friends
Disallow: /notifications
Disallow: /settings
Disallow: /api/
Disallow: /restaurant$

Sitemap: https://www.catalogapp.in/sitemap.xml

--- B6: CREATE /sitemap.xml ROUTE ---

app.get('/sitemap.xml', async (req, res) => {
  const cacheKey = 'sitemap';
  let xml = getCached(cacheKey);

  if (!xml) {
    const [restaurantsRes, blogsRes] = await Promise.all([
      supabase.from('restaurants')
        .select('slug, last_updated')
        .not('slug', 'is', null)
        .limit(5000),
      supabase.from('blogs')
        .select('slug, created_at')
        .not('slug', 'is', null)
    ]);

    const staticPages = ['', '/all-restaurants', '/blog', '/about', '/support'];

    const staticUrls = staticPages.map(path => `
  <url>
    <loc>https://www.catalogapp.in${path}</loc>
    <changefreq>weekly</changefreq>
    <priority>${path === '' ? '1.0' : '0.8'}</priority>
  </url>`).join('');

    const restaurantUrls = (restaurantsRes.data || []).map(r => `
  <url>
    <loc>https://www.catalogapp.in/restaurant/${r.slug}</loc>
    <lastmod>${r.last_updated ? new Date(r.last_updated).toISOString().split('T')[0] : '2026-01-01'}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const blogUrls = (blogsRes.data || []).map(b => `
  <url>
    <loc>https://www.catalogapp.in/blog/${b.slug}</loc>
    <lastmod>${new Date(b.created_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');

    xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}${restaurantUrls}${blogUrls}
</urlset>`;

    setCached(cacheKey, xml, 86400); // cache 24 hours
  }

  res.header('Content-Type', 'application/xml');
  res.header('Cache-Control', 'public, max-age=86400');
  res.send(xml);
});

--- B7: ADD IMAGE ALT TEXT EVERYWHERE ---

Find every <img> tag across all templates. Replace empty or missing alt:

Restaurant cards: alt="<%= restaurant.name %> — <%= restaurant.cuisine %> restaurant in <%= restaurant.area %>, Delhi"
Blog images: alt="<%= blog.title %> — Catalog"
Hero/logo: alt="Catalog — Restaurant discovery in Delhi"

--- B8: CREATE AREA + CUISINE LANDING PAGES ---

These are high-value SEO pages. New routes:

app.get('/restaurants/area/:area', async (req, res) => {
  const area = req.params.area.replace(/-/g, ' ');
  const cacheKey = `area:${area}`;
  let restaurants = getCached(cacheKey);

  if (!restaurants) {
    const { data } = await supabase.from('restaurants')
      .select('name,slug,cuisine,area,image_url,cloudinary_images')
      .ilike('area', area)
      .limit(50);
    restaurants = data;
    setCached(cacheKey, restaurants, 600);
  }

  const displayArea = area.split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  res.render('area-page', {
    restaurants,
    areaName: displayArea,
    meta: buildMeta({
      title: `Restaurants in ${displayArea}, Delhi — Catalog`,
      description: `Discover the best restaurants in ${displayArea}, Delhi. ${restaurants?.length || 0}+ options across all cuisines, rated and reviewed by real diners.`,
      url: `https://www.catalogapp.in/restaurants/area/${req.params.area}`
    })
  });
});

app.get('/restaurants/cuisine/:cuisine', async (req, res) => {
  const cuisine = req.params.cuisine.replace(/-/g, ' ');
  const cacheKey = `cuisine:${cuisine}`;
  let restaurants = getCached(cacheKey);

  if (!restaurants) {
    const { data } = await supabase.from('restaurants')
      .select('name,slug,cuisine,area,image_url,cloudinary_images')
      .ilike('cuisine', cuisine)
      .limit(50);
    restaurants = data;
    setCached(cacheKey, restaurants, 600);
  }

  const displayCuisine = cuisine.split(' ').map(w =>
    w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  res.render('cuisine-page', {
    restaurants,
    cuisineName: displayCuisine,
    meta: buildMeta({
      title: `Best ${displayCuisine} Restaurants in Delhi — Catalog`,
      description: `Find the best ${displayCuisine} restaurants in Delhi. ${restaurants?.length || 0}+ options rated by real diners on Catalog.`,
      url: `https://www.catalogapp.in/restaurants/cuisine/${req.params.cuisine}`
    })
  });
});

================================================================
PART C — FINAL ANALYSIS & REPORT
================================================================

After implementing everything above, do a full read of:

1. Every route file
2. Every template file
3. The main JS bundle served to the browser

Then report EXACTLY:

PERFORMANCE REPORT:
- [ ] List every sequential await chain you found and fixed
- [ ] JS bundle size before → after (in KB)
- [ ] Number of .select('*') queries replaced with specific columns
- [ ] List of indexes created
- [ ] Estimated load time before → after for /restaurant/:slug

SEO REPORT:
- [ ] Confirm robots.txt created at /public/robots.txt
- [ ] Confirm sitemap route returns valid XML
- [ ] List every page now SSR'd
- [ ] Confirm all pages have unique <title> and <meta description>
- [ ] Confirm JSON-LD present on restaurant pages
- [ ] List any remaining CSR pages and why they weren't converted

ADDITIONAL ISSUES FOUND:
- List any bugs, security issues, or performance problems discovered
  during the codebase analysis that weren't in this spec

FILES MODIFIED:
- List every file changed with a one-line summary of what changed