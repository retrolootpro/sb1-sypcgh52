/*
  Add lightweight archive metadata for sold inventory items.

  Existing inventory metadata stays on the inventory_items row. Marking an item
  sold moves it out of active inventory by status and records when it entered
  the archive.
*/

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS last_sold_price numeric;

CREATE INDEX IF NOT EXISTS idx_inventory_items_user_status_archived
  ON inventory_items(user_id, status, archived_at DESC);
