/*
  # Add Pricing Status Tracking

  ## Changes
  
  1. New Columns
    - `pricing_status` (text) - Tracks the status of pricing lookup: 'pending', 'found', 'missing', 'error', 'no_api_key'
    - `pricing_attempted_at` (timestamptz) - When pricing lookup was last attempted
    - `pricing_error_message` (text) - Error message if pricing lookup failed
    - `pricing_confidence` (integer) - Confidence score of the pricing match (0-100)
    - `pricing_matched_title` (text) - The actual title that was matched in PriceCharting
    - `pricing_matched_platform` (text) - The actual platform that was matched in PriceCharting
  
  2. Purpose
    - Track whether pricing was successfully fetched, not found, or failed
    - Store pricing lookup metadata for debugging and retry logic
    - Allow items to be created even when pricing fails
    - Provide visibility into pricing data quality

  ## Notes
  - Items can now be saved without pricing data
  - The pricing_status field helps identify items that need price refreshes
  - Confidence scores help validate pricing matches
*/

-- Add pricing status tracking columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_status'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_status text DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_attempted_at'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_attempted_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_error_message'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_error_message text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_confidence'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_confidence integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_matched_title'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_matched_title text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'pricing_matched_platform'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN pricing_matched_platform text;
  END IF;
END $$;

-- Add index for pricing_status for efficient querying
CREATE INDEX IF NOT EXISTS idx_inventory_items_pricing_status
ON inventory_items(pricing_status)
WHERE pricing_status IS NOT NULL;

-- Add comment explaining pricing_status values
COMMENT ON COLUMN inventory_items.pricing_status IS 'Status of pricing lookup: pending, found, missing, error, no_api_key';
