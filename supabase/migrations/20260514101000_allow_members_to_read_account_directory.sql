/*
  Let active account members read their account directory.

  This supports shared expense entry where a team member can assign an expense
  to the correct invited user without granting admin permissions.
*/

DROP POLICY IF EXISTS "Members can read account memberships" ON user_account_memberships;
CREATE POLICY "Members can read account memberships"
  ON user_account_memberships
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR account_owner_id = auth.uid()
    OR lower(email) = lower(auth.jwt() ->> 'email')
    OR public.is_account_member(account_owner_id)
  );
