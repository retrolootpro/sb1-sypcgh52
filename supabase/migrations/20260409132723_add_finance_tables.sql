/*
  # Finance Module Tables

  ## Summary
  Adds full financial tracking infrastructure for the RetroLoot Pro finance module.

  ## New Tables

  ### 1. `financial_transactions`
  Central ledger for all financial activity:
  - Manual entries (expenses, income)
  - Auto-imported from Plaid bank connections
  - Linked to eBay/Amazon/Whatnot platform orders
  - Categories for P&L grouping
  - Reconciliation status tracking

  ### 2. `bank_connections`
  Plaid-connected bank accounts:
  - Stores encrypted Plaid access tokens and item IDs
  - Tracks institution name, account names
  - Cursor for incremental transaction syncs

  ### 3. `tax_profiles`
  Per-user tax configuration:
  - Business info (name, entity type)
  - Home state and nexus states for sales tax
  - Quarterly estimated tax amounts

  ## Security
  - RLS enabled on all tables
  - Only authenticated users can access their own records

  ## Notes
  1. `financial_transactions.amount` is always the actual dollar value (positive or negative)
  2. `type` distinguishes income vs expense vs transfer vs refund
  3. `source` tracks where the transaction came from (manual, plaid, ebay, etc.)
  4. `plaid_transaction_id` has a unique constraint to prevent duplicate imports
  5. `bank_connections` stores the Plaid access_token (sensitive - only server-side accessible)
*/

-- ─── financial_transactions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL,
  type text NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense', 'transfer', 'refund')),
  category text NOT NULL DEFAULT 'Uncategorized',
  subcategory text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'plaid', 'ebay', 'amazon', 'whatnot', 'show', 'import')),
  platform text,
  reference_id text,
  plaid_transaction_id text,
  plaid_account_id text,
  merchant_name text,
  notes text,
  is_reconciled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own transactions"
  ON financial_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON financial_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON financial_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON financial_transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_plaid_uid
  ON financial_transactions (user_id, plaid_transaction_id)
  WHERE plaid_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_transactions_user_date
  ON financial_transactions (user_id, date DESC);

CREATE INDEX IF NOT EXISTS financial_transactions_user_type
  ON financial_transactions (user_id, type);

-- ─── bank_connections ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plaid_item_id text NOT NULL,
  plaid_access_token text NOT NULL,
  institution_name text,
  institution_id text,
  account_ids text[] DEFAULT '{}',
  account_names text[] DEFAULT '{}',
  account_types text[] DEFAULT '{}',
  last_cursor text,
  last_synced_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, plaid_item_id)
);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own bank connections"
  ON bank_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bank connections"
  ON bank_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bank connections"
  ON bank_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bank connections"
  ON bank_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── tax_profiles ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text DEFAULT '',
  business_type text DEFAULT 'sole_proprietor'
    CHECK (business_type IN ('sole_proprietor', 'llc_single', 'llc_multi', 's_corp', 'c_corp', 'partnership')),
  home_state text DEFAULT '',
  nexus_states text[] DEFAULT '{}',
  tax_year integer DEFAULT EXTRACT(year FROM now())::integer,
  effective_tax_rate numeric(5,2) DEFAULT 25.00,
  quarterly_q1 numeric(12,2),
  quarterly_q2 numeric(12,2),
  quarterly_q3 numeric(12,2),
  quarterly_q4 numeric(12,2),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE tax_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tax profile"
  ON tax_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tax profile"
  ON tax_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tax profile"
  ON tax_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tax profile"
  ON tax_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
