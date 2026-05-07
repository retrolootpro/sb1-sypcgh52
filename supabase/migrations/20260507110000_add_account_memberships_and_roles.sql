/*
  Add shared account memberships for multi-login access.

  Existing business data remains owned by the original user_id. Invited users
  receive a membership that points at that owner id so they can work in the same
  inventory, finance, prep, show, and shipping data set.
*/

CREATE TABLE IF NOT EXISTS user_account_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_account_memberships_owner
  ON user_account_memberships(account_owner_id);

CREATE INDEX IF NOT EXISTS idx_user_account_memberships_user
  ON user_account_memberships(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_account_memberships_email_active
  ON user_account_memberships(account_owner_id, email)
  WHERE status <> 'revoked';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_account_memberships_user_active
  ON user_account_memberships(account_owner_id, user_id)
  WHERE user_id IS NOT NULL AND status = 'active';

ALTER TABLE user_account_memberships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_account_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT m.account_owner_id
      FROM public.user_account_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
      ORDER BY CASE WHEN m.role = 'admin' THEN 0 ELSE 1 END, m.created_at
      LIMIT 1
    ),
    auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.current_account_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT m.role
      FROM public.user_account_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
      ORDER BY CASE WHEN m.role = 'admin' THEN 0 ELSE 1 END, m.created_at
      LIMIT 1
    ),
    'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT owner_id = public.current_account_owner_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_account_memberships m
      WHERE m.account_owner_id = owner_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_account_admin(owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT owner_id = public.current_account_owner_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_account_memberships m
      WHERE m.account_owner_id = owner_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.current_account_owner_id() FROM public;
REVOKE ALL ON FUNCTION public.current_account_role() FROM public;
REVOKE ALL ON FUNCTION public.is_account_member(uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_account_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_account_owner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_admin(uuid) TO authenticated;

INSERT INTO user_account_memberships (account_owner_id, user_id, email, role, status, accepted_at)
SELECT u.id, u.id, lower(u.email), 'admin', 'active', now()
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Members can read account memberships" ON user_account_memberships;
CREATE POLICY "Members can read account memberships"
  ON user_account_memberships
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR account_owner_id = auth.uid()
    OR lower(email) = lower(auth.jwt() ->> 'email')
    OR public.is_account_admin(account_owner_id)
  );

DROP POLICY IF EXISTS "Admins can invite account members" ON user_account_memberships;
CREATE POLICY "Admins can invite account members"
  ON user_account_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      account_owner_id = auth.uid()
      AND user_id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
    )
    OR public.is_account_admin(account_owner_id)
  );

DROP POLICY IF EXISTS "Admins and invitees can update account memberships" ON user_account_memberships;
CREATE POLICY "Admins and invitees can update account memberships"
  ON user_account_memberships
  FOR UPDATE
  TO authenticated
  USING (
    public.is_account_admin(account_owner_id)
    OR lower(email) = lower(auth.jwt() ->> 'email')
  )
  WITH CHECK (
    public.is_account_admin(account_owner_id)
    OR (
      lower(email) = lower(auth.jwt() ->> 'email')
      AND user_id = auth.uid()
      AND status = 'active'
    )
  );

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_items',
    'show_lists',
    'scan_sessions',
    'scan_queue_items',
    'review_queue',
    'user_api_keys',
    'employees',
    'employee_goals',
    'ebay_listings',
    'collections',
    'amazon_listings',
    'inbound_shipments',
    'platform_connections',
    'platform_orders',
    'financial_transactions',
    'bank_connections',
    'tax_profiles',
    'lots'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Account members can read %1$s" ON %1$I', table_name);
      EXECUTE format('CREATE POLICY "Account members can read %1$s" ON %1$I FOR SELECT TO authenticated USING (public.is_account_member(user_id))', table_name);

      EXECUTE format('DROP POLICY IF EXISTS "Account members can insert %1$s" ON %1$I', table_name);
      EXECUTE format('CREATE POLICY "Account members can insert %1$s" ON %1$I FOR INSERT TO authenticated WITH CHECK (public.is_account_member(user_id))', table_name);

      EXECUTE format('DROP POLICY IF EXISTS "Account members can update %1$s" ON %1$I', table_name);
      EXECUTE format('CREATE POLICY "Account members can update %1$s" ON %1$I FOR UPDATE TO authenticated USING (public.is_account_member(user_id)) WITH CHECK (public.is_account_member(user_id))', table_name);

      EXECUTE format('DROP POLICY IF EXISTS "Account admins can delete %1$s" ON %1$I', table_name);
      EXECUTE format('CREATE POLICY "Account admins can delete %1$s" ON %1$I FOR DELETE TO authenticated USING (public.is_account_admin(user_id))', table_name);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Account members can read pricing data" ON pricing_data;
CREATE POLICY "Account members can read pricing data"
  ON pricing_data
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = pricing_data.item_id
      AND public.is_account_member(i.user_id)
  ));

DROP POLICY IF EXISTS "Account members can write pricing data" ON pricing_data;
CREATE POLICY "Account members can write pricing data"
  ON pricing_data
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = pricing_data.item_id
      AND public.is_account_member(i.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = pricing_data.item_id
      AND public.is_account_member(i.user_id)
  ));

DROP POLICY IF EXISTS "Account members can read ebay comps" ON ebay_comps;
CREATE POLICY "Account members can read ebay comps"
  ON ebay_comps
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = ebay_comps.item_id
      AND public.is_account_member(i.user_id)
  ));

DROP POLICY IF EXISTS "Account members can write ebay comps" ON ebay_comps;
CREATE POLICY "Account members can write ebay comps"
  ON ebay_comps
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = ebay_comps.item_id
      AND public.is_account_member(i.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = ebay_comps.item_id
      AND public.is_account_member(i.user_id)
  ));

DROP POLICY IF EXISTS "Account members can read show items" ON show_items;
CREATE POLICY "Account members can read show items"
  ON show_items
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM show_lists s
    WHERE s.id = show_items.show_list_id
      AND public.is_account_member(s.user_id)
  ));

DROP POLICY IF EXISTS "Account members can write show items" ON show_items;
CREATE POLICY "Account members can write show items"
  ON show_items
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM show_lists s
    WHERE s.id = show_items.show_list_id
      AND public.is_account_member(s.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM show_lists s
    WHERE s.id = show_items.show_list_id
      AND public.is_account_member(s.user_id)
  ));
