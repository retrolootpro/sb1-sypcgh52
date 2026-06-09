/*
  Add account-level POS sales tax settings.

  The POS register reads this rate but cannot change it at checkout. Admins can
  set a fallback rate or store a ZIP-based rate looked up from a tax provider.
*/

CREATE TABLE IF NOT EXISTS pos_tax_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  default_tax_rate numeric NOT NULL DEFAULT 0 CHECK (default_tax_rate >= 0 AND default_tax_rate <= 1),
  tax_zip text DEFAULT '',
  tax_source text DEFAULT 'manual',
  tax_lookup_provider text DEFAULT '',
  tax_lookup_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS tax_zip text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_source text DEFAULT '';

ALTER TABLE pos_tax_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON pos_tax_settings TO authenticated;

DROP POLICY IF EXISTS "Account members can read POS tax settings" ON pos_tax_settings;
CREATE POLICY "Account members can read POS tax settings"
  ON pos_tax_settings FOR SELECT TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

DROP POLICY IF EXISTS "Account admins can insert POS tax settings" ON pos_tax_settings;
CREATE POLICY "Account admins can insert POS tax settings"
  ON pos_tax_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_account_admin(user_id));

DROP POLICY IF EXISTS "Account admins can update POS tax settings" ON pos_tax_settings;
CREATE POLICY "Account admins can update POS tax settings"
  ON pos_tax_settings FOR UPDATE TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (public.is_account_admin(user_id));

DROP TRIGGER IF EXISTS update_pos_tax_settings_updated_at ON pos_tax_settings;
CREATE TRIGGER update_pos_tax_settings_updated_at
  BEFORE UPDATE ON pos_tax_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
