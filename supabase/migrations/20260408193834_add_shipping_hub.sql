/*
  # Shipping Hub

  ## Changes

  1. New Columns on `inventory_items`
     - `sold_via` (text) — which platform the item was sold through: 'ebay', 'amazon', 'whatnot', 'show', 'manual'
     - `marketplace_order_id` (text) — external order/reference ID from the marketplace

  2. New Table: `inbound_shipments`
     - Tracks packages the user expects to RECEIVE (purchases, consignments, etc.)
     - Fields: id, user_id, title, source, notes, tracking_number, carrier, expected_date, status (pending/received), received_at, created_at

  3. Security
     - RLS enabled on `inbound_shipments`
     - Users can only see/manage their own inbound shipments
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'sold_via'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN sold_via text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'marketplace_order_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN marketplace_order_id text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inbound_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  tracking_number text,
  carrier text,
  expected_date date,
  status text NOT NULL DEFAULT 'pending',
  received_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inbound_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inbound shipments"
  ON inbound_shipments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inbound shipments"
  ON inbound_shipments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inbound shipments"
  ON inbound_shipments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inbound shipments"
  ON inbound_shipments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inbound_shipments_user_id ON inbound_shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON inbound_shipments(status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sold_via ON inventory_items(sold_via) WHERE sold_via IS NOT NULL;
