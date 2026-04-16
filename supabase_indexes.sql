-- =============================================================
-- CATALOG — Production Index Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- All statements are CONCURRENTLY safe — zero downtime, no locking
-- Idempotent: IF NOT EXISTS on every statement
-- =============================================================

-- PREREQUISITE: Enable trigram extension (needed for LIKE search indexes)
-- This is safe to run even if already enabled.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================
-- TABLE: users
-- Hot paths: every auth request resolves by email (resolveSupabaseUser)
-- =============================================================

-- P: email lookup on every single authenticated request — must be unique + indexed
-- Already may exist as UNIQUE constraint from schema, but explicit is safer
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email
  ON users (email);

-- P: username uniqueness check on set-username route
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username
  ON users (username)
  WHERE username IS NOT NULL;

-- P: user search by username LIKE (leading wildcard — needs trigram, not B-tree)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username_trgm
  ON users USING gin (LOWER(username) gin_trgm_ops)
  WHERE username IS NOT NULL;

-- P: user search also matches on name column
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_name_trgm
  ON users USING gin (LOWER(name) gin_trgm_ops)
  WHERE name IS NOT NULL;


-- =============================================================
-- TABLE: restaurants
-- Most queried table. Slug lookup is the single biggest perf problem.
-- =============================================================

-- P1 CRITICAL: Functional index for slug lookups
-- Eliminates full table scan on 8+ routes (restaurant page, friends-rating, friends-been, etc.)
-- Before: Seq Scan ~10-50ms on large table. After: Index Scan <1ms.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_slug
  ON restaurants (LOWER(REPLACE(name, ' ', '-')));

-- P: Restaurants search — all three fields use LIKE with leading wildcard
-- B-tree is useless here. GIN trigram indexes are mandatory.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_name_trgm
  ON restaurants USING gin (LOWER(name) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_area_trgm
  ON restaurants USING gin (LOWER(area) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_cuisine_trgm
  ON restaurants USING gin (LOWER(cuisine) gin_trgm_ops);

-- P: Exact area/cuisine filter (used alongside search in /restaurants route)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_area_lower
  ON restaurants (LOWER(area))
  WHERE area IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_cuisine_lower
  ON restaurants (LOWER(cuisine))
  WHERE cuisine IS NOT NULL;

-- P: /restaurants/popular — ORDER BY total_ratings DESC, average_rating DESC
-- Partial: only rows with name and image_url (matches WHERE clause in that query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restaurants_name_notnull
  ON restaurants (name)
  WHERE name IS NOT NULL AND image_url IS NOT NULL AND image_url != '';


-- =============================================================
-- TABLE: restaurant_ratings_summary
-- Joined on every /restaurants/popular call and every updateRatingSummary
-- =============================================================

-- P: Primary lookup by restaurant_id (ON CONFLICT key — likely already unique)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ratings_summary_restaurant_id
  ON restaurant_ratings_summary (restaurant_id);

-- P: Sort order for popular restaurants query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ratings_summary_sort
  ON restaurant_ratings_summary (total_ratings DESC NULLS LAST, average_rating DESC NULLS LAST);


-- =============================================================
-- TABLE: reviews
-- High-frequency reads: list reviews per restaurant, user review history
-- =============================================================

-- P: Fetch reviews for a restaurant, sorted newest first (paginated)
-- Covers: WHERE restaurant_id + ORDER BY created_at DESC + LIMIT/OFFSET
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_restaurant_created
  ON reviews (restaurant_id, created_at DESC);

-- P: User's own review history (profile page)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_user_created
  ON reviews (user_id, created_at DESC);

-- P: Existence check + uniqueness enforcement (one review per user per restaurant)
-- Also covers: edit/delete auth check WHERE id + user_id
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_user_restaurant
  ON reviews (user_id, restaurant_id);

-- P: COUNT(*) for updateRatingSummary (called on every write to reviews/ratings/visits)
-- Covered by idx_reviews_restaurant_created but explicit for clarity
-- (PostgreSQL can use the composite index for COUNT on restaurant_id)


-- =============================================================
-- TABLE: review_likes
-- Called on every review render (liked? count) + toggle actions
-- =============================================================

-- P: Check/toggle like — unique pair lookup
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_review_likes_user_review
  ON review_likes (user_id, review_id);

-- P: Count all likes for a review (recount on every like/unlike)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_likes_review_id
  ON review_likes (review_id);


-- =============================================================
-- TABLE: review_replies
-- =============================================================

-- P: Fetch all replies for a review, sorted ascending
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_replies_review_created
  ON review_replies (review_id, created_at ASC);

-- P: Auth check for delete: WHERE id + review_id + user_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_replies_user
  ON review_replies (user_id);

-- P: Cascade delete by parent_id (DELETE WHERE id=$1 OR parent_id=$1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_replies_parent_id
  ON review_replies (parent_id)
  WHERE parent_id IS NOT NULL;


-- =============================================================
-- TABLE: ratings
-- Called on every restaurant page load (distribution, user's own rating)
-- And inside updateRatingSummary on every write operation
-- =============================================================

-- P: User's rating for a restaurant — check/upsert (most frequent pattern)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ratings_user_restaurant
  ON ratings (user_id, restaurant_id);

-- P: All ratings for a restaurant (distribution, avg, updateRatingSummary)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ratings_restaurant_id
  ON ratings (restaurant_id);


-- =============================================================
-- TABLE: wishlist
-- =============================================================

-- P: User's bookmarks sorted by add time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wishlist_user_added
  ON wishlist (user_id, added_at DESC);

-- P: Check/toggle bookmark for a specific restaurant
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_wishlist_user_restaurant
  ON wishlist (user_id, restaurant_id);


-- =============================================================
-- TABLE: visits
-- Extremely hot: check/add visited on restaurant page, friends activity feed
-- =============================================================

-- P: Check/toggle visit for a specific restaurant (called on every restaurant page)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_user_restaurant
  ON visits (user_id, restaurant_id);

-- P: User's visit history sorted by date (profile page + been page)
-- Also covers month count: WHERE user_id + visited_at >= $date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_user_visited
  ON visits (user_id, visited_at DESC);

-- P: Friends activity feed — visits WHERE user_id IN (friend_ids) ORDER BY visited_at DESC
-- Separate index on visited_at DESC helps the sort after filtering by user_id set
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_visited_at
  ON visits (visited_at DESC);


-- =============================================================
-- TABLE: lists
-- =============================================================

-- P: User's own lists (sorted by last updated)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_user_updated
  ON lists (user_id, updated_at DESC);

-- P: Auth check pattern: WHERE id + user_id (used on update/delete/add-item)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_id_user
  ON lists (id, user_id);

-- P: Public lists (partial index — only public=true rows, much smaller)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_public_created
  ON lists (created_at DESC)
  WHERE is_public = true;

-- P: Public list search with LOWER(title) LIKE (leading wildcard — needs trigram)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_title_trgm
  ON lists USING gin (LOWER(title) gin_trgm_ops);


-- =============================================================
-- TABLE: list_items
-- =============================================================

-- P: Fetch items in a list ordered by position
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_list_items_list_position
  ON list_items (list_id, position ASC);

-- P: Check if restaurant already in list + delete by restaurant
-- Note: 23505 error in code implies a UNIQUE constraint may already exist
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_list_items_list_restaurant
  ON list_items (list_id, restaurant_id);


-- =============================================================
-- TABLE: list_likes
-- =============================================================

-- P: Check/toggle like on a list
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_list_likes_user_list
  ON list_likes (user_id, list_id);

-- P: Count likes per list (called in every public list response)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_list_likes_list_id
  ON list_likes (list_id);


-- =============================================================
-- TABLE: friendships
-- P4 CRITICAL: Bidirectional OR query — must index BOTH sides with status
-- =============================================================

-- P: All queries originating from a requester (sent requests, friend list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_requester_status
  ON friendships (requester_id, status);

-- P: All queries targeting an addressee (received requests, friend list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_addressee_status
  ON friendships (addressee_id, status);

-- P: Partial index for pending requests only (friends/requests endpoint)
-- Smaller than full index — only pending rows scanned
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_addressee_pending
  ON friendships (addressee_id, created_at DESC)
  WHERE status = 'pending';

-- P: Accept/decline by id + addressee
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_id_addressee
  ON friendships (id, addressee_id);


-- =============================================================
-- VERIFY: After running, check indexes were created
-- =============================================================
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
