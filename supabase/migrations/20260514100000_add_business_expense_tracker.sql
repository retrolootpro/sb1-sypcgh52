/*
  Add account-aware business expense tracking.

  Expenses are separate from the bank transaction ledger so the business can
  track tax-prep details such as who incurred the cost, business purpose,
  receipt location, Schedule C-style category, and review status.
*/

CREATE TABLE IF NOT EXISTS business_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  incurred_by_email text,
  incurred_by_name text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  merchant text,
  description text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  irs_category text NOT NULL DEFAULT 'Other',
  business_purpose text,
  payment_method text,
  receipt_url text,
  source_transaction_id uuid REFERENCES financial_transactions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready', 'reviewed', 'disallowed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS business_expenses_user_date
  ON business_expenses(user_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS business_expenses_user_category
  ON business_expenses(user_id, irs_category);

CREATE INDEX IF NOT EXISTS business_expenses_user_person
  ON business_expenses(user_id, incurred_by_email);

DROP POLICY IF EXISTS "Account members can read business_expenses" ON business_expenses;
CREATE POLICY "Account members can read business_expenses"
  ON business_expenses
  FOR SELECT
  TO authenticated
  USING (public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can insert business_expenses" ON business_expenses;
CREATE POLICY "Account members can insert business_expenses"
  ON business_expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account members can update business_expenses" ON business_expenses;
CREATE POLICY "Account members can update business_expenses"
  ON business_expenses
  FOR UPDATE
  TO authenticated
  USING (public.is_account_member(user_id))
  WITH CHECK (public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account admins can delete business_expenses" ON business_expenses;
CREATE POLICY "Account admins can delete business_expenses"
  ON business_expenses
  FOR DELETE
  TO authenticated
  USING (public.is_account_admin(user_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON business_expenses TO authenticated;
