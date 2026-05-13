/*
  # Resale Planning Systems

  Adds first-class tables for dispute evidence, inventory bundles, buy/do-not-buy
  rules, and pre-buy lot analysis. These are intentionally separate from the
  existing prep, finance, and show tables so each workflow can grow without
  overloading inventory_items.
*/

CREATE TABLE IF NOT EXISTS dispute_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'manual' CHECK (platform IN ('ebay', 'whatnot', 'amazon', 'facebook', 'local', 'manual', 'other')),
  order_reference text DEFAULT '',
  buyer_name text DEFAULT '',
  tracking_number text DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'evidence_gathering', 'response_sent', 'resolved_won', 'resolved_lost', 'refunded', 'closed')),
  reason text NOT NULL DEFAULT 'other' CHECK (reason IN ('shipping_damage', 'as_is_untested', 'buyer_remorse', 'item_as_described', 'missing_item', 'region_compatibility', 'not_working', 'other')),
  claim_amount numeric DEFAULT 0 CHECK (claim_amount >= 0),
  refund_amount numeric DEFAULT 0 CHECK (refund_amount >= 0),
  opened_at timestamptz DEFAULT now(),
  response_due_at timestamptz,
  resolved_at timestamptz,
  listing_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  condition_notes text DEFAULT '',
  testing_status text DEFAULT '',
  packing_notes text DEFAULT '',
  buyer_messages text DEFAULT '',
  dispute_notes text DEFAULT '',
  response_template text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispute_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_case_id uuid NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('listing_photo', 'condition_note', 'testing_proof', 'packing_photo', 'tracking', 'buyer_message', 'receipt', 'other')),
  title text NOT NULL DEFAULT '',
  url text DEFAULT '',
  text_value text DEFAULT '',
  captured_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  strategy text NOT NULL DEFAULT 'manual' CHECK (strategy IN ('manual', 'platform', 'franchise', 'category', 'slow_movers', 'import', 'accessories', 'books_manga', 'clearance')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'listed', 'sold', 'disbanded')),
  best_channel text DEFAULT 'Whatnot Auction',
  cost_basis numeric DEFAULT 0 CHECK (cost_basis >= 0),
  market_value numeric DEFAULT 0 CHECK (market_value >= 0),
  recommended_ask numeric DEFAULT 0 CHECK (recommended_ask >= 0),
  floor_price numeric DEFAULT 0 CHECK (floor_price >= 0),
  emergency_floor_price numeric DEFAULT 0 CHECK (emergency_floor_price >= 0),
  expected_profit numeric DEFAULT 0,
  notes text DEFAULT '',
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle_id uuid NOT NULL REFERENCES inventory_bundles(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  allocated_cost numeric DEFAULT 0 CHECK (allocated_cost >= 0),
  market_value_at_add numeric DEFAULT 0 CHECK (market_value_at_add >= 0),
  added_at timestamptz DEFAULT now(),
  UNIQUE (bundle_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS buy_list_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type text NOT NULL DEFAULT 'item' CHECK (subject_type IN ('item', 'platform', 'category', 'franchise', 'supplier', 'source')),
  subject text NOT NULL,
  recommendation text NOT NULL DEFAULT 'watch' CHECK (recommendation IN ('buy_under', 'bundle_only', 'avoid', 'hold', 'watch')),
  max_buy_price numeric DEFAULT 0 CHECK (max_buy_price >= 0),
  target_margin_percent numeric DEFAULT 0,
  reason text DEFAULT '',
  evidence_summary text DEFAULT '',
  total_bought integer DEFAULT 0 CHECK (total_bought >= 0),
  total_sold integer DEFAULT 0 CHECK (total_sold >= 0),
  total_spent numeric DEFAULT 0 CHECK (total_spent >= 0),
  total_sales numeric DEFAULT 0 CHECK (total_sales >= 0),
  defect_count integer DEFAULT 0 CHECK (defect_count >= 0),
  return_count integer DEFAULT 0 CHECK (return_count >= 0),
  average_days_to_sell numeric DEFAULT 0,
  last_reviewed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prebuy_lot_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text DEFAULT '',
  supplier text DEFAULT '',
  asking_price numeric DEFAULT 0 CHECK (asking_price >= 0),
  estimated_shipping numeric DEFAULT 0 CHECK (estimated_shipping >= 0),
  estimated_fees numeric DEFAULT 0 CHECK (estimated_fees >= 0),
  total_estimated_cost numeric DEFAULT 0 CHECK (total_estimated_cost >= 0),
  estimated_resale_value numeric DEFAULT 0 CHECK (estimated_resale_value >= 0),
  recommended_max_buy_price numeric DEFAULT 0 CHECK (recommended_max_buy_price >= 0),
  expected_profit numeric DEFAULT 0,
  worst_case_liquidation_value numeric DEFAULT 0 CHECK (worst_case_liquidation_value >= 0),
  decision text NOT NULL DEFAULT 'needs_review' CHECK (decision IN ('good_buy', 'risky_buy', 'pass', 'needs_review')),
  risk_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'purchased', 'passed', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prebuy_lot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES prebuy_lot_analyses(id) ON DELETE CASCADE,
  title text NOT NULL,
  platform text DEFAULT '',
  category text DEFAULT '',
  condition text DEFAULT '',
  estimated_market_value numeric DEFAULT 0 CHECK (estimated_market_value >= 0),
  estimated_sell_price numeric DEFAULT 0 CHECK (estimated_sell_price >= 0),
  estimated_shipping numeric DEFAULT 0 CHECK (estimated_shipping >= 0),
  risk_level text NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('low', 'normal', 'high', 'avoid')),
  item_role text NOT NULL DEFAULT 'normal' CHECK (item_role IN ('best_item', 'normal', 'slow_mover', 'risky', 'avoid')),
  notes text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='bundle_id') THEN
    ALTER TABLE inventory_items ADD COLUMN bundle_id uuid REFERENCES inventory_bundles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_user_status ON dispute_cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_item ON dispute_cases(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_case ON dispute_evidence_items(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_inventory_bundles_user_status ON inventory_bundles(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_items_inventory_item ON bundle_items(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_buy_list_rules_user_subject ON buy_list_rules(user_id, subject_type, subject);
CREATE INDEX IF NOT EXISTS idx_prebuy_lot_analyses_user_status ON prebuy_lot_analyses(user_id, status);
CREATE INDEX IF NOT EXISTS idx_prebuy_lot_items_analysis ON prebuy_lot_items(analysis_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_inventory_items_bundle_id ON inventory_items(bundle_id);

ALTER TABLE dispute_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_list_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE prebuy_lot_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE prebuy_lot_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_dispute_cases_updated_at ON dispute_cases;
CREATE TRIGGER update_dispute_cases_updated_at BEFORE UPDATE ON dispute_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_bundles_updated_at ON inventory_bundles;
CREATE TRIGGER update_inventory_bundles_updated_at BEFORE UPDATE ON inventory_bundles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_buy_list_rules_updated_at ON buy_list_rules;
CREATE TRIGGER update_buy_list_rules_updated_at BEFORE UPDATE ON buy_list_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_prebuy_lot_analyses_updated_at ON prebuy_lot_analyses;
CREATE TRIGGER update_prebuy_lot_analyses_updated_at BEFORE UPDATE ON prebuy_lot_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_prebuy_lot_items_updated_at ON prebuy_lot_items;
CREATE TRIGGER update_prebuy_lot_items_updated_at BEFORE UPDATE ON prebuy_lot_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dispute_cases',
    'dispute_evidence_items',
    'inventory_bundles',
    'bundle_items',
    'buy_list_rules',
    'prebuy_lot_analyses',
    'prebuy_lot_items'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Account members can read %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Account members can insert %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Account members can update %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Account admins can delete %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can read own %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own %1$s" ON %1$I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own %1$s" ON %1$I', table_name);

    IF to_regproc('public.is_account_member') IS NOT NULL THEN
      EXECUTE format('CREATE POLICY "Account members can read %1$s" ON %1$I FOR SELECT TO authenticated USING (public.is_account_member(user_id))', table_name);
      EXECUTE format('CREATE POLICY "Account members can insert %1$s" ON %1$I FOR INSERT TO authenticated WITH CHECK (public.is_account_member(user_id))', table_name);
      EXECUTE format('CREATE POLICY "Account members can update %1$s" ON %1$I FOR UPDATE TO authenticated USING (public.is_account_member(user_id)) WITH CHECK (public.is_account_member(user_id))', table_name);
      EXECUTE format('CREATE POLICY "Account admins can delete %1$s" ON %1$I FOR DELETE TO authenticated USING (public.is_account_admin(user_id))', table_name);
    ELSE
      EXECUTE format('CREATE POLICY "Users can read own %1$s" ON %1$I FOR SELECT TO authenticated USING (auth.uid() = user_id)', table_name);
      EXECUTE format('CREATE POLICY "Users can insert own %1$s" ON %1$I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', table_name);
      EXECUTE format('CREATE POLICY "Users can update own %1$s" ON %1$I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', table_name);
      EXECUTE format('CREATE POLICY "Users can delete own %1$s" ON %1$I FOR DELETE TO authenticated USING (auth.uid() = user_id)', table_name);
    END IF;
  END LOOP;
END $$;
