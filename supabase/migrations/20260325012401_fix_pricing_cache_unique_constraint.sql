/*
  # Fix pricing_cache unique constraint

  1. Changes
    - Drop the functional unique index on pricing_cache (uses lower() which breaks supabase-js upsert)
    - Add a regular unique constraint on (product_name, platform) instead
    - Data will be stored lowercased by the application layer

  2. Why
    - supabase-js `upsert({ onConflict: 'product_name,platform' })` does not work with functional indexes
    - This caused all pricing cache writes to silently fail
*/

DROP INDEX IF EXISTS pricing_cache_lookup_idx;

ALTER TABLE pricing_cache
  ADD CONSTRAINT pricing_cache_product_platform_unique UNIQUE (product_name, platform);
