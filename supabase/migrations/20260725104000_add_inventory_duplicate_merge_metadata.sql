/*
  Track inventory rows that were merged into another row during duplicate
  cleanup. The kept row owns the active quantity; merged rows remain available
  for audit/history but are hidden from active inventory by status.
*/

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS merged_into_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merge_quantity integer;

CREATE INDEX IF NOT EXISTS idx_inventory_items_merged_into
  ON inventory_items(merged_into_item_id)
  WHERE merged_into_item_id IS NOT NULL;
