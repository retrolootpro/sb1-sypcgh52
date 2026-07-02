CREATE TABLE IF NOT EXISTS clover_sync_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  auto_sync_interval_minutes integer NOT NULL DEFAULT 60 CHECK (auto_sync_interval_minutes >= 15),
  last_auto_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clover_sync_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON clover_sync_settings TO authenticated;

DROP POLICY IF EXISTS "Account members can manage Clover sync settings" ON clover_sync_settings;
CREATE POLICY "Account members can manage Clover sync settings"
  ON clover_sync_settings FOR ALL TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));
