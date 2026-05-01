/*
  # Add Inventory Profitability and Metadata Fields

  ## Overview
  Adds comprehensive fields for pricing, profitability, deal scoring, and review workflow to support the enhanced inventory management system.

  ## New Fields Added

  ### Product Metadata
  - `raw_scanned_title` - Original title from UPC/barcode lookup before any normalization
  - `platform_raw` - Original platform string from UPC lookup
  - `platform_normalized` - Normalized platform for PriceCharting matching
  - `category` - Product category from barcode lookup (e.g., "Video Games")

  ### Pricing Data
  - `price_loose` - PriceCharting loose/cart price
  - `price_cib` - PriceCharting complete in box price
  - `price_new` - PriceCharting new/sealed price
  - `price_graded` - PriceCharting graded price
  - `pricing_last_checked_at` - Last time pricing was attempted
  - `pricing_error_code` - Structured error code (CONFIG_ERROR, UPSTREAM_API_ERROR, etc.)

  ### Profitability Calculations
  - `selected_market_value` - Market value based on selected condition
  - `estimated_profit` - Calculated profit (market value - purchase price)
  - `estimated_margin_percent` - Profit margin percentage
  - `deal_score` - Numeric score 0-100 for deal quality
  - `deal_score_label` - Label: Steal, Great, Good, Fair, Risky, Avoid

  ### Review Workflow
  - `needs_review` - Boolean flag indicating if manual review is required
  - `reviewed_at` - Timestamp when item was reviewed
  - `reviewed_by_user_id` - User who reviewed the item

  ## Changes
  1. Add all new columns with appropriate defaults
  2. Create indexes on frequently queried fields
  3. All existing data is preserved
  4. Columns are nullable to support gradual backfill
*/

-- Add product metadata fields
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS raw_scanned_title text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS platform_raw text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS platform_normalized text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category text DEFAULT '';

-- Add pricing data fields
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price_loose numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price_cib numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price_new numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price_graded numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_last_checked_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_error_code text DEFAULT '';

-- Add profitability calculation fields
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS selected_market_value numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS estimated_profit numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS estimated_margin_percent numeric DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deal_score integer DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deal_score_label text DEFAULT '';

-- Add review workflow fields
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT true;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES auth.users(id);

-- Create indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_inventory_items_needs_review ON inventory_items(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_inventory_items_deal_score ON inventory_items(deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_items_pricing_status ON inventory_items(pricing_status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON inventory_items(barcode) WHERE barcode IS NOT NULL AND barcode != '';

-- Add comment explaining the schema
COMMENT ON COLUMN inventory_items.needs_review IS 'True if item requires manual review due to missing data, low confidence, or pricing issues';
COMMENT ON COLUMN inventory_items.deal_score IS 'Calculated deal quality score from 0-100 based on profit margin, market value, and confidence';
COMMENT ON COLUMN inventory_items.selected_market_value IS 'Market value selected based on item condition (loose/cib/new)';
