/*
  Add iPad POS support for sales, customer rewards/credit, and customer buys.

  Card processing is recorded as an external tender for now. This keeps the app
  out of card-data handling while supporting Square/Stripe/manual card totals.
*/

CREATE TABLE IF NOT EXISTS pos_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  email text DEFAULT '',
  phone text DEFAULT '',
  rewards_number text DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  credit_balance numeric NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  lifetime_spend numeric NOT NULL DEFAULT 0 CHECK (lifetime_spend >= 0),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES pos_customers(id) ON DELETE SET NULL,
  sale_number text NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  subtotal numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  tax_amount numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'external_card', 'square', 'stripe', 'trade_credit', 'split', 'other')),
  trade_credit_used numeric NOT NULL DEFAULT 0 CHECK (trade_credit_used >= 0),
  cash_received numeric NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  processor_reference text DEFAULT '',
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'voided', 'refunded')),
  notes text DEFAULT '',
  sold_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sale_id uuid REFERENCES pos_sales(id) ON DELETE CASCADE NOT NULL,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  platform text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total numeric NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  item_source text NOT NULL DEFAULT 'manual' CHECK (item_source IN ('inventory', 'manual')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_customer_buys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES pos_customers(id) ON DELETE SET NULL,
  buy_number text NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  item_summary text NOT NULL,
  offer_amount numeric NOT NULL DEFAULT 0 CHECK (offer_amount >= 0),
  payout_type text NOT NULL DEFAULT 'cash' CHECK (payout_type IN ('cash', 'trade_credit', 'mixed')),
  cash_paid numeric NOT NULL DEFAULT 0 CHECK (cash_paid >= 0),
  trade_credit_issued numeric NOT NULL DEFAULT 0 CHECK (trade_credit_issued >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('quoted', 'completed', 'declined', 'voided')),
  notes text DEFAULT '',
  bought_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_customer_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES pos_customers(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('issued', 'redeemed', 'adjustment')),
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('sale', 'buy', 'manual')),
  source_id uuid,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_customers_user_search
  ON pos_customers(user_id, name, phone, email);
CREATE INDEX IF NOT EXISTS idx_pos_sales_user_sold_at
  ON pos_sales(user_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale
  ON pos_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_buys_user_bought_at
  ON pos_customer_buys(user_id, bought_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_credit_ledger_customer
  ON pos_customer_credit_ledger(customer_id, created_at DESC);

ALTER TABLE pos_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_customer_buys ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_customer_credit_ledger ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON pos_customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_sale_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_customer_buys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_customer_credit_ledger TO authenticated;

DROP POLICY IF EXISTS "Account members can manage POS customers" ON pos_customers;
CREATE POLICY "Account members can manage POS customers"
  ON pos_customers FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can manage POS sales" ON pos_sales;
CREATE POLICY "Account members can manage POS sales"
  ON pos_sales FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can manage POS sale items" ON pos_sale_items;
CREATE POLICY "Account members can manage POS sale items"
  ON pos_sale_items FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can manage POS buys" ON pos_customer_buys;
CREATE POLICY "Account members can manage POS buys"
  ON pos_customer_buys FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can manage POS credit ledger" ON pos_customer_credit_ledger;
CREATE POLICY "Account members can manage POS credit ledger"
  ON pos_customer_credit_ledger FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP TRIGGER IF EXISTS update_pos_customers_updated_at ON pos_customers;
CREATE TRIGGER update_pos_customers_updated_at
  BEFORE UPDATE ON pos_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pos_sales_updated_at ON pos_sales;
CREATE TRIGGER update_pos_sales_updated_at
  BEFORE UPDATE ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pos_customer_buys_updated_at ON pos_customer_buys;
CREATE TRIGGER update_pos_customer_buys_updated_at
  BEFORE UPDATE ON pos_customer_buys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
