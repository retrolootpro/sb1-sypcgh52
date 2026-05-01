/*
  # Add description and genre columns to inventory_items

  1. New Columns
    - `description` (text) - Short description of the item from barcode/UPC lookup
    - `genre` (text) - Game genre from PriceCharting (e.g., Action, RPG, Sports)

  2. Why
    - Users need more metadata for each inventory item
    - Description helps identify items at a glance
    - Genre aids categorization and filtering
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'description'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN description text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'genre'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN genre text DEFAULT '';
  END IF;
END $$;
