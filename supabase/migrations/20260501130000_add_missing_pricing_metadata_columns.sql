/*
  # Add missing inventory pricing metadata columns

  These columns are written by the scanner and deal scanner save flows. Some
  production databases created from the compact bootstrap schema may be missing
  them even though the application expects them.
*/

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_source text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_attempted_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_error_message text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_confidence integer;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_matched_title text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_matched_platform text;

COMMENT ON COLUMN inventory_items.pricing_source IS 'Pricing source used for the latest pricing result';
COMMENT ON COLUMN inventory_items.pricing_attempted_at IS 'Timestamp of the latest pricing lookup attempt';
COMMENT ON COLUMN inventory_items.pricing_error_message IS 'Human-readable pricing lookup error, if any';
COMMENT ON COLUMN inventory_items.pricing_confidence IS 'Pricing match confidence from 0-100';
COMMENT ON COLUMN inventory_items.pricing_matched_title IS 'Matched title returned by the pricing provider';
COMMENT ON COLUMN inventory_items.pricing_matched_platform IS 'Matched platform returned by the pricing provider';
