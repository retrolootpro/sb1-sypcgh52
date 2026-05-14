/*
  Lock API key rows down to account admins.

  Marketplace/API keys are secrets. Employees should be able to use app
  features through server routes, but should not be able to read raw keys.
*/

DROP POLICY IF EXISTS "Users can read own API keys" ON user_api_keys;
DROP POLICY IF EXISTS "Users can insert own API keys" ON user_api_keys;
DROP POLICY IF EXISTS "Users can update own API keys" ON user_api_keys;
DROP POLICY IF EXISTS "Users can delete own API keys" ON user_api_keys;
DROP POLICY IF EXISTS "Account members can read user_api_keys" ON user_api_keys;
DROP POLICY IF EXISTS "Account members can insert user_api_keys" ON user_api_keys;
DROP POLICY IF EXISTS "Account members can update user_api_keys" ON user_api_keys;
DROP POLICY IF EXISTS "Account admins can delete user_api_keys" ON user_api_keys;

CREATE POLICY "Account admins can read user_api_keys"
  ON user_api_keys
  FOR SELECT
  TO authenticated
  USING (public.is_account_admin(user_id));

CREATE POLICY "Account admins can insert user_api_keys"
  ON user_api_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_account_admin(user_id));

CREATE POLICY "Account admins can update user_api_keys"
  ON user_api_keys
  FOR UPDATE
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (public.is_account_admin(user_id));

CREATE POLICY "Account admins can delete user_api_keys"
  ON user_api_keys
  FOR DELETE
  TO authenticated
  USING (public.is_account_admin(user_id));
