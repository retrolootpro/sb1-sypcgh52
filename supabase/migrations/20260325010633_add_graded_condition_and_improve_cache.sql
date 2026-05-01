/*
  # Add Graded condition and improve caching

  1. Changes
    - Add 'Graded' to the condition check constraint on inventory_items
    - Add pricing_cache table for caching PriceCharting lookups by product name + platform
    - Add pricecharting_id column to inventory_items for direct API lookups

  2. New Tables
    - `pricing_cache`
      - `id` (uuid, primary key)
      - `product_name` (text) - normalized search key
      - `platform` (text) - normalized platform
      - `pricecharting_id` (text) - PriceCharting product ID
      - `matched_title` (text) - the title PriceCharting matched
      - `matched_platform` (text) - the platform PriceCharting matched
      - `price_loose` (numeric) - loose price in dollars
      - `price_cib` (numeric) - CIB price in dollars
      - `price_new` (numeric) - new price in dollars
      - `price_graded` (numeric) - graded price in dollars
      - `genre` (text)
      - `release_date` (text)
      - `cached_at` (timestamptz) - when this was cached
      - `expires_at` (timestamptz) - when cache expires (24h default)

  3. Security
    - Enable RLS on pricing_cache
    - Public read access for pricing_cache (shared cache across users)
    - Service role write access via edge functions
*/

DO $$
BEGIN
  ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_condition_check;
  ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_condition_check
    CHECK (condition = ANY (ARRAY['Loose'::text, 'CIB'::text, 'New'::text, 'Graded'::text]));
END $$;

CREATE TABLE IF NOT EXISTS pricing_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  platform text NOT NULL DEFAULT '',
  pricecharting_id text DEFAULT '',
  matched_title text DEFAULT '',
  matched_platform text DEFAULT '',
  price_loose numeric DEFAULT 0,
  price_cib numeric DEFAULT 0,
  price_new numeric DEFAULT 0,
  price_graded numeric DEFAULT 0,
  genre text DEFAULT '',
  release_date text DEFAULT '',
  confidence integer DEFAULT 0,
  strategy text DEFAULT '',
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS pricing_cache_lookup_idx
  ON pricing_cache (lower(product_name), lower(platform));

ALTER TABLE pricing_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pricing cache"
  ON pricing_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert pricing cache"
  ON pricing_cache FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update pricing cache"
  ON pricing_cache FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
