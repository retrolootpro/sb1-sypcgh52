CREATE TABLE IF NOT EXISTS owner_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lender_name text NOT NULL DEFAULT 'Owner',
  loan_date date NOT NULL DEFAULT CURRENT_DATE,
  original_amount numeric(12,2) NOT NULL CHECK (original_amount >= 0),
  purpose text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'forgiven')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES owner_loans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_id uuid REFERENCES financial_transactions(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_loans_user_date ON owner_loans(user_id, loan_date DESC);
CREATE INDEX IF NOT EXISTS idx_owner_loan_payments_user_loan ON owner_loan_payments(user_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_owner_loan_payments_transaction ON owner_loan_payments(transaction_id);

ALTER TABLE owner_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_loan_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner loans are account visible" ON owner_loans;
CREATE POLICY "Owner loans are account visible"
  ON owner_loans
  FOR ALL
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_account_memberships m
      WHERE m.account_owner_id = owner_loans.user_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_account_memberships m
      WHERE m.account_owner_id = owner_loans.user_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Owner loan payments are account visible" ON owner_loan_payments;
CREATE POLICY "Owner loan payments are account visible"
  ON owner_loan_payments
  FOR ALL
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_account_memberships m
      WHERE m.account_owner_id = owner_loan_payments.user_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_account_memberships m
      WHERE m.account_owner_id = owner_loan_payments.user_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );
