/*
  # Canonical Pricing Fields

  ## Summary
  Extends the pricing system with per-condition source tracking, diagnostics,
  and stored PriceCharting product IDs for deterministic re-matching.

  ## Changes

  ### market_price_cache
  - `pc_product_id` (text) — resolved PriceCharting product ID; stored so future
    refreshes skip the expensive title-search step
  - `pc_product_name` (text) — matched PriceCharting product name
  - `source_loose/cib/new/graded` (text) — which source provided each price:
    'pricecharting_api' | 'ebay_web' | 'none'
  - `last_refresh_status` (text) — 'success' | 'partial' | 'failed'
  - `warnings` (jsonb) — array of diagnostic warning strings

  ### inventory_items
  - `pc_source_product_id` (text) — PC product ID pinned to this item;
    populated on first scan or first successful refresh
  - `pricing_diagnostics` (jsonb) — snapshot of last refresh diagnostics

  ## Notes
  1. All columns are additive (IF NOT EXISTS) — safe on repeat runs.
  2. Existing data is preserved; new columns default to safe values.
  3. The pc_source_product_id enables fast subsequent lookups without re-searching.
*/

-- ── market_price_cache additions ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'pc_product_id'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN pc_product_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'pc_product_name'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN pc_product_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'source_loose'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN source_loose text DEFAULT 'none';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'source_cib'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN source_cib text DEFAULT 'none';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'source_new'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN source_new text DEFAULT 'none';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'source_graded'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN source_graded text DEFAULT 'none';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'last_refresh_status'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN last_refresh_status text DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_price_cache' AND column_name = 'warnings'
  ) THEN
    ALTER TABLE market_price_cache ADD COLUMN warnings jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- ── inventory_items additions ─────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pc_source_product_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pc_source_product_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_diagnostics'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_diagnostics jsonb;
  END IF;
END $$;

-- Index for fast PC product ID lookups on the cache
CREATE INDEX IF NOT EXISTS idx_market_price_cache_pc_product_id
  ON market_price_cache (pc_product_id)
  WHERE pc_product_id IS NOT NULL;
