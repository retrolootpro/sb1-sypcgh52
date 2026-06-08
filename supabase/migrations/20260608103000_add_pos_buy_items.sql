/*
  Track individual items inside POS customer buys/trades.
*/

CREATE TABLE IF NOT EXISTS pos_customer_buy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  buy_id uuid REFERENCES pos_customer_buys(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  platform text DEFAULT '',
  condition text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  pricecharting_value numeric NOT NULL DEFAULT 0 CHECK (pricecharting_value >= 0),
  gamestop_value numeric NOT NULL DEFAULT 0 CHECK (gamestop_value >= 0),
  market_value numeric NOT NULL DEFAULT 0 CHECK (market_value >= 0),
  recommended_cash_offer numeric NOT NULL DEFAULT 0 CHECK (recommended_cash_offer >= 0),
  recommended_trade_offer numeric NOT NULL DEFAULT 0 CHECK (recommended_trade_offer >= 0),
  accepted_offer numeric NOT NULL DEFAULT 0 CHECK (accepted_offer >= 0),
  pricing_source text DEFAULT '',
  pricing_notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_customer_buy_items_buy
  ON pos_customer_buy_items(buy_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_buy_items_user_created
  ON pos_customer_buy_items(user_id, created_at DESC);

ALTER TABLE pos_customer_buy_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON pos_customer_buy_items TO authenticated;

DROP POLICY IF EXISTS "Account members can manage POS buy items" ON pos_customer_buy_items;
CREATE POLICY "Account members can manage POS buy items"
  ON pos_customer_buy_items FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));
