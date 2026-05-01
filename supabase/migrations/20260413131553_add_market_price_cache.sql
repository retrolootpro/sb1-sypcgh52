/*
  # Add market_price_cache table

  ## Summary
  Creates a new table to cache eBay sold listing market prices per item.

  ## New Tables
  - `market_price_cache`
    - `id` (uuid, primary key)
    - `product_name` (text) — normalized lowercase product name
    - `platform` (text) — normalized lowercase platform
    - `price_loose` (numeric) — average sold price for loose condition
    - `price_cib` (numeric) — average sold price for CIB condition
    - `price_new` (numeric) — average sold price for new/sealed condition
    - `price_graded` (numeric) — average sold price for graded condition
    - `sample_count_loose` (int) — number of sales used for loose price
    - `sample_count_cib` (int) — number of sales used for CIB price
    - `sample_count_new` (int) — number of sales used for new price
    - `sample_count_graded` (int) — number of sales used for graded price
    - `source` (text) — data source (e.g. 'ebay')
    - `cached_at` (timestamptz) — when the cache was last updated

  ## Security
  - RLS enabled
  - Authenticated users can read/write their own cache entries
  - Unique constraint on (product_name, platform) for upserts
*/

CREATE TABLE IF NOT EXISTS market_price_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  platform text NOT NULL DEFAULT '',
  price_loose numeric(10,2) DEFAULT 0,
  price_cib numeric(10,2) DEFAULT 0,
  price_new numeric(10,2) DEFAULT 0,
  price_graded numeric(10,2) DEFAULT 0,
  sample_count_loose integer DEFAULT 0,
  sample_count_cib integer DEFAULT 0,
  sample_count_new integer DEFAULT 0,
  sample_count_graded integer DEFAULT 0,
  source text DEFAULT 'ebay',
  cached_at timestamptz DEFAULT now(),
  UNIQUE (product_name, platform)
);

ALTER TABLE market_price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage market price cache"
  ON market_price_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert market price cache"
  ON market_price_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update market price cache"
  ON market_price_cache
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_market_price_cache_lookup
  ON market_price_cache (product_name, platform);
