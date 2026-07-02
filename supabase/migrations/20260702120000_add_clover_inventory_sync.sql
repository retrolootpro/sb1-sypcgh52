/*
  Add Clover inventory sync metadata.

  Supabase remains the source of truth. Clover IDs/status fields are used only
  to push sellable inventory to Clover and reconcile basic POS quantity events.
*/

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS clover_item_id text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS clover_variant_id text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS clover_synced_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS clover_sync_status text NOT NULL DEFAULT 'pending'
  CHECK (clover_sync_status IN ('pending', 'synced', 'failed'));
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS clover_sync_error text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sync_to_clover boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sku text;

CREATE INDEX IF NOT EXISTS idx_inventory_items_clover_status
  ON inventory_items(user_id, clover_sync_status)
  WHERE sync_to_clover = true;

CREATE INDEX IF NOT EXISTS idx_inventory_items_clover_item_id
  ON inventory_items(clover_item_id)
  WHERE clover_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku
  ON inventory_items(user_id, sku)
  WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS clover_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  clover_item_id text,
  clover_event_id text UNIQUE,
  action text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'synced', 'failed', 'skipped')),
  request_summary jsonb DEFAULT '{}'::jsonb,
  response_summary jsonb DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clover_sync_logs_inventory_item
  ON clover_sync_logs(inventory_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clover_sync_logs_user_created
  ON clover_sync_logs(user_id, created_at DESC);

ALTER TABLE clover_sync_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON clover_sync_logs TO authenticated;

DROP POLICY IF EXISTS "Account members can read Clover sync logs" ON clover_sync_logs;
CREATE POLICY "Account members can read Clover sync logs"
  ON clover_sync_logs FOR SELECT TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));
