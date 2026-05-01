/*
  # Add Missing Inventory Metadata Fields

  ## Overview
  Adds remaining metadata fields to support comprehensive UPC scanning and inventory tracking.

  ## New Fields Added

  ### Product Normalization
  - `normalized_title` - Normalized version of product name for matching and deduplication
  - `brand` - Product brand/manufacturer (e.g., "Nintendo", "Sony")

  ### Pricing Metadata
  - `pricing_source` - Source of pricing data (e.g., "PriceCharting", "manual")
  - `source_lookup_payload_summary` - Summary of barcode lookup payload for debugging

  ## Changes
  1. Add all new columns with appropriate defaults
  2. All existing data is preserved
  3. Columns are nullable to support gradual backfill
*/

-- Add product normalization fields
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS normalized_title text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS brand text DEFAULT '';

-- Add pricing source metadata
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_source text DEFAULT 'PriceCharting';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS source_lookup_payload_summary text DEFAULT '';

-- Add index on normalized_title for searching and deduplication
CREATE INDEX IF NOT EXISTS idx_inventory_items_normalized_title ON inventory_items(normalized_title) WHERE normalized_title IS NOT NULL AND normalized_title != '';

-- Add comments
COMMENT ON COLUMN inventory_items.normalized_title IS 'Normalized version of product name (lowercase, no special chars) for matching';
COMMENT ON COLUMN inventory_items.brand IS 'Product brand or manufacturer';
COMMENT ON COLUMN inventory_items.pricing_source IS 'Source of pricing data: PriceCharting, manual, eBay, etc.';
COMMENT ON COLUMN inventory_items.source_lookup_payload_summary IS 'JSON summary of barcode lookup response for debugging';
