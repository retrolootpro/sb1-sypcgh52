/*
  # Shipment to Lot Costing

  Shipments are the intake record. Once received, the shipment creates a lot
  with a required total paid amount. Items scanned into that lot can then have
  cost of goods allocated by each item's share of current market value.
*/

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='shipment_id') THEN
    ALTER TABLE lots ADD COLUMN shipment_id uuid REFERENCES inbound_shipments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='total_paid') THEN
    ALTER TABLE lots ADD COLUMN total_paid numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='total_market_value') THEN
    ALTER TABLE lots ADD COLUMN total_market_value numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='allocation_ratio') THEN
    ALTER TABLE lots ADD COLUMN allocation_ratio numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='allocation_method') THEN
    ALTER TABLE lots ADD COLUMN allocation_method text DEFAULT 'market_weighted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='allocation_status') THEN
    ALTER TABLE lots ADD COLUMN allocation_status text DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lots' AND column_name='cost_allocated_at') THEN
    ALTER TABLE lots ADD COLUMN cost_allocated_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inbound_shipments' AND column_name='lot_id') THEN
    ALTER TABLE inbound_shipments ADD COLUMN lot_id uuid REFERENCES lots(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inbound_shipments' AND column_name='total_paid') THEN
    ALTER TABLE inbound_shipments ADD COLUMN total_paid numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='lot_market_value_at_allocation') THEN
    ALTER TABLE inventory_items ADD COLUMN lot_market_value_at_allocation numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='lot_allocation_ratio') THEN
    ALTER TABLE inventory_items ADD COLUMN lot_allocation_ratio numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='purchase_price_override') THEN
    ALTER TABLE inventory_items ADD COLUMN purchase_price_override boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='cost_allocated_at') THEN
    ALTER TABLE inventory_items ADD COLUMN cost_allocated_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lots_shipment_id ON lots(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_lot_id ON inbound_shipments(lot_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_user_id ON inbound_shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON inbound_shipments(status);

DO $$
BEGIN
  IF to_regproc('public.is_account_member') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Account members can read inbound_shipments" ON inbound_shipments;
    CREATE POLICY "Account members can read inbound_shipments"
      ON inbound_shipments FOR SELECT TO authenticated
      USING (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can insert inbound_shipments" ON inbound_shipments;
    CREATE POLICY "Account members can insert inbound_shipments"
      ON inbound_shipments FOR INSERT TO authenticated
      WITH CHECK (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can update inbound_shipments" ON inbound_shipments;
    CREATE POLICY "Account members can update inbound_shipments"
      ON inbound_shipments FOR UPDATE TO authenticated
      USING (public.is_account_member(user_id))
      WITH CHECK (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account admins can delete inbound_shipments" ON inbound_shipments;
    CREATE POLICY "Account admins can delete inbound_shipments"
      ON inbound_shipments FOR DELETE TO authenticated
      USING (public.is_account_admin(user_id));
  ELSE
    DROP POLICY IF EXISTS "Users can view own inbound shipments" ON inbound_shipments;
    CREATE POLICY "Users can view own inbound shipments"
      ON inbound_shipments FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can insert own inbound shipments" ON inbound_shipments;
    CREATE POLICY "Users can insert own inbound shipments"
      ON inbound_shipments FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can update own inbound shipments" ON inbound_shipments;
    CREATE POLICY "Users can update own inbound shipments"
      ON inbound_shipments FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can delete own inbound shipments" ON inbound_shipments;
    CREATE POLICY "Users can delete own inbound shipments"
      ON inbound_shipments FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
