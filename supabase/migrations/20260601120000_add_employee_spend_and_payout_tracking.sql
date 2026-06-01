/*
  Add admin payroll controls for employee inventory spend, work logs, and weekly payouts.

  Employees can purchase inventory at company cost up to a monthly allowance.
  Admins can track hourly show moderation, fixed/additional funds, eBay commission,
  and payout batches without changing the existing employee KPI system.
*/

CREATE TABLE IF NOT EXISTS employee_inventory_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  spend_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount >= 0),
  allowance_month date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  vendor text DEFAULT '',
  item_summary text NOT NULL,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'reimbursed', 'rejected')),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_work_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  work_type text NOT NULL DEFAULT 'whatnot_moderation'
    CHECK (work_type IN ('whatnot_moderation', 'ebay_listing_commission', 'inventory_buying', 'shipping', 'prep', 'other')),
  description text NOT NULL,
  show_id uuid REFERENCES show_lists(id) ON DELETE SET NULL,
  ebay_listing_id uuid REFERENCES ebay_listings(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  minutes_worked integer NOT NULL DEFAULT 0 CHECK (minutes_worked >= 0 AND minutes_worked % 15 = 0),
  hourly_rate numeric NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  sale_amount numeric NOT NULL DEFAULT 0 CHECK (sale_amount >= 0),
  commission_rate numeric NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  additional_amount numeric NOT NULL DEFAULT 0 CHECK (additional_amount >= 0),
  payout_status text NOT NULL DEFAULT 'unpaid' CHECK (payout_status IN ('unpaid', 'approved', 'paid', 'void')),
  payout_id uuid,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  work_total numeric NOT NULL DEFAULT 0 CHECK (work_total >= 0),
  spend_total numeric NOT NULL DEFAULT 0 CHECK (spend_total >= 0),
  total_amount numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT employee_payout_valid_period CHECK (period_end >= period_start)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'employee_work_logs'
      AND constraint_name = 'employee_work_logs_payout_id_fkey'
  ) THEN
    ALTER TABLE employee_work_logs
      ADD CONSTRAINT employee_work_logs_payout_id_fkey
      FOREIGN KEY (payout_id) REFERENCES employee_payouts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_inventory_spend_user_date
  ON employee_inventory_spend(user_id, spend_date DESC);

CREATE INDEX IF NOT EXISTS idx_employee_inventory_spend_employee_month
  ON employee_inventory_spend(employee_id, allowance_month);

CREATE INDEX IF NOT EXISTS idx_employee_work_logs_user_date
  ON employee_work_logs(user_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_employee_work_logs_employee_status
  ON employee_work_logs(employee_id, payout_status);

CREATE INDEX IF NOT EXISTS idx_employee_payouts_user_period
  ON employee_payouts(user_id, period_start DESC, period_end DESC);

ALTER TABLE employee_inventory_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account admins can manage employee inventory spend" ON employee_inventory_spend;
CREATE POLICY "Account admins can manage employee inventory spend"
  ON employee_inventory_spend
  FOR ALL
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (
    public.is_account_admin(user_id)
    AND EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
    )
  );

DROP POLICY IF EXISTS "Account admins can manage employee work logs" ON employee_work_logs;
CREATE POLICY "Account admins can manage employee work logs"
  ON employee_work_logs
  FOR ALL
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (
    public.is_account_admin(user_id)
    AND EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_work_logs.employee_id
        AND e.user_id = employee_work_logs.user_id
    )
  );

DROP POLICY IF EXISTS "Account admins can manage employee payouts" ON employee_payouts;
CREATE POLICY "Account admins can manage employee payouts"
  ON employee_payouts
  FOR ALL
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (
    public.is_account_admin(user_id)
    AND EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_payouts.employee_id
        AND e.user_id = employee_payouts.user_id
    )
  );

DROP TRIGGER IF EXISTS update_employee_inventory_spend_updated_at ON employee_inventory_spend;
CREATE TRIGGER update_employee_inventory_spend_updated_at
  BEFORE UPDATE ON employee_inventory_spend
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_work_logs_updated_at ON employee_work_logs;
CREATE TRIGGER update_employee_work_logs_updated_at
  BEFORE UPDATE ON employee_work_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_payouts_updated_at ON employee_payouts;
CREATE TRIGGER update_employee_payouts_updated_at
  BEFORE UPDATE ON employee_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
