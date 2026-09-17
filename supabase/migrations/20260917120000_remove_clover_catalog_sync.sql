/*
  Remove the retired Clover catalog integration.

  RetroLootPro remains the inventory and POS source of truth. Clover is retained
  only as a card-present payment tender, which uses pos_sales.payment_method and
  does not require catalog sync tables or inventory metadata.
*/

DROP TABLE IF EXISTS clover_sync_settings CASCADE;
DROP TABLE IF EXISTS clover_sync_logs CASCADE;

DROP INDEX IF EXISTS idx_inventory_items_clover_status;
DROP INDEX IF EXISTS idx_inventory_items_clover_item_id;

ALTER TABLE inventory_items
  DROP COLUMN IF EXISTS clover_item_id,
  DROP COLUMN IF EXISTS clover_variant_id,
  DROP COLUMN IF EXISTS clover_synced_at,
  DROP COLUMN IF EXISTS clover_sync_status,
  DROP COLUMN IF EXISTS clover_sync_error,
  DROP COLUMN IF EXISTS sync_to_clover;

UPDATE inventory_sync_queue
SET target_channels = array_remove(target_channels, 'clover')
WHERE target_channels @> ARRAY['clover']::text[];

ALTER TABLE inventory_sync_queue
  ALTER COLUMN target_channels
  SET DEFAULT ARRAY['storefront', 'ebay', 'whatnot']::text[];
