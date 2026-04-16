// api/cache.js — Cache utility helpers for Upstash Redis
//
// @upstash/redis automatically serialises objects to JSON on set and
// deserialises them back on get — no manual JSON.stringify/parse needed.
//
// Every function silently falls back on error so the app keeps working
// if Redis is unreachable.

const redis = require('./redis')

/**
 * Return cached value or null.
 */
async function cacheGet(key) {
  try {
    return await redis.get(key)
  } catch (err) {
    console.error('[Cache] get error:', err.message)
    return null
  }
}

/**
 * Store value with a TTL in seconds.
 */
async function cacheSet(key, value, ttlSeconds) {
  try {
    await redis.set(key, value, { ex: ttlSeconds })
  } catch (err) {
    console.error('[Cache] set error:', err.message)
  }
}

/**
 * Delete one or more exact keys.
 */
async function cacheDel(...keys) {
  try {
    const flat = keys.flat().filter(Boolean)
    if (flat.length > 0) await redis.del(...flat)
  } catch (err) {
    console.error('[Cache] del error:', err.message)
  }
}

/**
 * Delete all keys matching a glob pattern (e.g. "reviews:restaurant:5:*").
 * Uses SCAN to avoid blocking and handles large key sets safely.
 */
async function cacheDelPattern(pattern) {
  try {
    let cursor = 0
    const toDelete = []
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 })
      cursor = Number(next)
      toDelete.push(...keys)
    } while (cursor !== 0)
    if (toDelete.length > 0) {
      await redis.del(...toDelete)
      console.log(`[Cache] invalidated ${toDelete.length} key(s) matching "${pattern}"`)
    }
  } catch (err) {
    console.error('[Cache] delPattern error:', err.message)
  }
}

// ── TTL constants (seconds) ────────────────────────────────────────────────
const TTL = {
  RESTAURANTS_POPULAR:  5 * 60,   // 5 min  — expensive JOIN + sort, changes on rating updates
  RESTAURANTS_RANDOM:   60,        // 60 s   — random data, short TTL is fine
  RESTAURANTS_LIST:     3 * 60,   // 3 min  — search results, rarely stale
  RESTAURANT_DETAIL:    10 * 60,  // 10 min — static-ish restaurant data
  REVIEWS_LIST:         2 * 60,   // 2 min  — new reviews appear frequently
  RATINGS_SUMMARY:      3 * 60,   // 3 min  — invalidated on every rating write anyway
  LISTS_PUBLIC:         2 * 60,   // 2 min  — likes/item counts change
  LIST_DETAIL:          5 * 60,   // 5 min  — individual list page
  REPLIES:              3 * 60,   // 3 min  — replies are infrequent
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPattern, TTL }
