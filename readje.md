You are a senior SEO engineer working on an Express.js web app called Catalog (catalogapp.in) — a restaurant discovery and social dining platform hosted on Vercel. The app uses Supabase as its database. Your job is to implement a comprehensive SEO overhaul.

## Context about the database (Supabase project: pjsyvlhwuhdibpahputx, region: ap-south-1)

Key tables and columns you'll use:
- `restaurants` (2,470 rows): id, name, area, cuisine, slug, image_url, cloudinary_images[], opening_hours, latitude, longitude, formatted_address, place_id, phone_number, last_updated
- `restaurant_ratings_summary`: restaurant_id, average_rating, total_ratings, total_reviews
- `reviews`: id, user_id, restaurant_id, content, rating, visit_date
- `blogs`: id, title, slug, author, city, read_time, hero_image, content, tag, created_at
- `blog_restaurants`: blog_id, restaurant_name, area
- `lists`: id, user_id, title, description, is_public
- `delhi_areas`: area (text)

## Step 0 — Understand the codebase first

Before writing any code:
1. Read the entire project structure (ls, cat package.json, look at all route files, middleware, view templates)
2. Identify the templating engine (EJS, Pug, Handlebars, or plain HTML)
3. Identify how Supabase is initialised (find the supabaseClient or equivalent)
4. Identify the existing routes for /restaurant/:slug, /all-restaurants, /blog, /blog/:slug, /lists
5. Note how the current <head> section is structured in the base layout template
6. Read all existing route handlers fully before modifying anything

---

## Task 1 — Create /public/robots.txt

Create the file at the correct public static folder location. Content:
User-agent: *
Allow: /
Disallow: /login
Disallow: /signup
Disallow: /been
Disallow: /saved
Disallow: /friends
Disallow: /notifications
Disallow: /settings
Disallow: /api/
Sitemap: https://www.catalogapp.in/sitemap.xml

---

## Task 2 — Create a dynamic /sitemap.xml route

Add a route in Express (before any catch-all) that:
1. Fetches all restaurants from Supabase: SELECT slug, last_updated, name, area, cuisine FROM restaurants WHERE slug IS NOT NULL
2. Fetches all blog slugs: SELECT slug, created_at FROM blogs
3. Fetches all public lists: SELECT id, title, updated_at FROM lists WHERE is_public = true
4. Generates a valid XML sitemap with:
   - Static pages: /, /all-restaurants, /blog, /about, /support — with changefreq "weekly"
   - Restaurant pages: /restaurant/{slug} — priority 0.8, changefreq "monthly", lastmod from last_updated
   - Blog pages: /blog/{slug} — priority 0.7, changefreq "monthly"
   - List pages: /lists/{id} — priority 0.5
   - Area pages: /restaurants/area/{area-slug} — priority 0.9 (these are high-value)
   - Cuisine pages: /restaurants/cuisine/{cuisine-slug} — priority 0.9
5. Set Content-Type to application/xml
6. Cache the response for 24 hours using Cache-Control header
7. Keep it efficient — batch the Supabase query, don't do N+1 queries

---

## Task 3 — Server-Side Render (SSR) the restaurant detail page

This is the most critical fix. Find the route for /restaurant/:slug (or equivalent). Currently it likely renders an empty shell and fetches data client-side via JS fetch calls.

Modify it to:
1. Fetch restaurant data server-side from Supabase before rendering
2. Also fetch the rating summary from restaurant_ratings_summary for this restaurant
3. Also fetch the top 3 reviews from reviews table for this restaurant
4. Pass all data into the template render call
5. The template must output this data in the initial HTML (not via JS fetch)

In the template for the restaurant page, ensure the following are in the <head> — using the actual restaurant data:

```html
<title>{restaurant.name} | {restaurant.cuisine} Restaurant | {restaurant.area}, Delhi — Catalog</title>
<meta name="description" content="Visit {restaurant.name} in {restaurant.area}, Delhi. {restaurant.cuisine} cuisine. Rated {avgRating}/5 by {totalRatings} diners. See reviews, photos and details on Catalog.">
<link rel="canonical" href="https://www.catalogapp.in/restaurant/{restaurant.slug}">

<!-- Open Graph -->
<meta property="og:title" content="{restaurant.name} — {restaurant.cuisine} | {restaurant.area}">
<meta property="og:description" content="{restaurant.cuisine} restaurant in {restaurant.area}, Delhi. Rated {avgRating}/5 on Catalog.">
<meta property="og:image" content="{restaurant.image_url or first cloudinary image}">
<meta property="og:url" content="https://www.catalogapp.in/restaurant/{restaurant.slug}">
<meta property="og:type" content="restaurant">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{restaurant.name} | Catalog">
<meta name="twitter:image" content="{restaurant.image_url}">

<!-- JSON-LD Structured Data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "{restaurant.name}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{restaurant.formatted_address}",
    "addressLocality": "{restaurant.area}",
    "addressRegion": "Delhi",
    "addressCountry": "IN"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": {restaurant.latitude},
    "longitude": {restaurant.longitude}
  },
  "telephone": "{restaurant.phone_number}",
  "servesCuisine": "{restaurant.cuisine}",
  "openingHours": "{restaurant.opening_hours}",
  "image": "{restaurant.image_url}",
  "url": "https://www.catalogapp.in/restaurant/{restaurant.slug}",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": {avgRating},
    "reviewCount": {totalReviews},
    "bestRating": 5,
    "worstRating": 1
  }
}
</script>
```

Make the JSON-LD generation safe — if a field is null, omit that key entirely rather than outputting null.

---

## Task 4 — SSR the /all-restaurants page

Modify the route to:
1. Fetch the first 50 restaurants server-side (name, slug, cuisine, area, image_url)
2. Render them in the initial HTML
3. For pagination, use proper URL params: /all-restaurants?page=2&cuisine=north-indian&area=hauz-khas
4. Add <link rel="next"> and <link rel="prev"> tags in <head> for paginated pages
5. Title: "All Restaurants in Delhi | Discover & Rate Dining — Catalog"
6. Meta description: "Explore 2,000+ restaurants across Delhi. Filter by cuisine, neighbourhood and rating. Discover your next favourite meal on Catalog."

---

## Task 5 — SSR the Blog pages

For /blog (listing page):
1. Fetch all blog posts server-side (title, slug, author, tag, read_time, hero_image, created_at)
2. Title: "The Journal | Food Stories & Restaurant Guides — Catalog"
3. Meta description: "Food essays, curated restaurant guides and dining stories from Delhi and beyond."

For /blog/:slug (individual post):
1. Fetch blog content server-side
2. Also fetch associated restaurants from blog_restaurants for this blog_id (use JOIN or two queries)
3. Title: "{blog.title} — Catalog Journal"
4. Meta description: first 155 characters of blog content, stripped of HTML tags
5. Add Article structured data:
```json
{
  "@type": "Article",
  "@context": "https://schema.org",
  "headline": "{blog.title}",
  "author": {"@type": "Person", "name": "{blog.author}"},
  "datePublished": "{blog.created_at}",
  "image": "{blog.hero_image}",
  "publisher": {
    "@type": "Organization",
    "name": "Catalog",
    "url": "https://www.catalogapp.in"
  }
}
```

---

## Task 6 — Create new Area and Cuisine landing pages

These are the highest-value SEO pages. Create two new route groups:

**A) /restaurants/area/:area** — e.g. /restaurants/area/hauz-khas
1. Fetch all restaurants WHERE area ILIKE the param (normalise: replace hyphens with spaces)
2. Server-side render with title: "Restaurants in {Area Name}, Delhi | Catalog"
3. Meta: "Discover the best restaurants in {Area}, Delhi. {count}+ options across all cuisines — rated and reviewed by real diners."
4. Add BreadcrumbList structured data

**B) /restaurants/cuisine/:cuisine** — e.g. /restaurants/cuisine/north-indian
1. Fetch all restaurants WHERE cuisine ILIKE the param
2. Title: "Best {Cuisine} Restaurants in Delhi | Catalog"
3. Meta: "Find the best {Cuisine} restaurants in Delhi — {count}+ options rated by real diners on Catalog."

For both, generate a link in the navigation or footer to the most popular areas. Query the delhi_areas table for the list of valid areas.

---

## Task 7 — Fix the homepage /

The homepage currently renders empty on crawl. Ensure:
1. "Popular Right Now" restaurants are fetched server-side (top 6 by rating from restaurant_ratings_summary JOIN restaurants)
2. Curated lists are fetched server-side
3. Blog posts are fetched server-side
4. Homepage title: "Catalog — Discover & Remember the Best Restaurants in Delhi"
5. Homepage meta description: "Your personal food diary and restaurant discovery network. Log where you've eaten, save where you want to go, and follow friends with great taste."
6. Add WebSite structured data with SearchAction for the search box

---

## Task 8 — Add a shared SEO head helper

Create a utility function/helper (e.g. /utils/seo.js or /helpers/meta.js) that:
1. Accepts { title, description, image, url, type, structuredData } as params
2. Returns a complete <head> meta block string (or template partial)
3. Has sensible defaults (fallback title = "Catalog — Restaurant Discovery", fallback OG image = the Catalog logo)
4. Is used by all routes so meta is never missing

---

## Task 9 — Image alt text

Find all places in templates where <img> tags are rendered for restaurants. Ensure every image has:
```html
alt="{restaurant.name} — {restaurant.cuisine} restaurant in {restaurant.area}, Delhi"
```
For blog images: alt="{blog.title} — Catalog Journal"

---

## Task 10 — Analyse the full codebase for additional SEO issues

After completing the above, do a full read of:
- All route files
- All template/view files  
- package.json and any config files
- middleware files
- Any existing SEO-related code

Then report back with:
1. Any additional issues found (e.g. missing 404 handling, redirect chains, HTTP/HTTPS issues, trailing slash inconsistencies, slow DB queries that hurt Core Web Vitals)
2. Any pages that are being incorrectly blocked or exposed
3. Any template rendering errors that would cause partial page loads
4. Recommendations for next steps beyond what's been implemented

Be explicit about every file you modified and every line you changed. If a route file doesn't exist yet for a feature (e.g. area pages), create it and wire it up in the main app.js/server.js/index.js.