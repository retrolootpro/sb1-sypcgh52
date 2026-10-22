-- Preview-stage migration. Apply only after approval and a verified backup.
-- Preserve every existing membership and business record; change access rules only.
DO $$
DECLARE owner_id uuid;
BEGIN
  SELECT user_id INTO STRICT owner_id FROM public.storefront_settings
    WHERE public_slug = 'pixel-and-page' AND is_active = true;
  IF NOT EXISTS (SELECT 1 FROM public.user_account_memberships
    WHERE account_owner_id = owner_id AND user_id = owner_id AND status = 'active' AND role = 'admin') THEN
    RAISE EXCEPTION 'The configured Pixel & Page owner must have an active admin membership before this migration';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.business_account_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT user_id FROM public.storefront_settings WHERE public_slug = 'pixel-and-page' AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_account_owner_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT m.account_owner_id FROM public.user_account_memberships m
    WHERE m.account_owner_id = public.business_account_id() AND m.user_id = auth.uid() AND m.status = 'active'
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_account_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT m.role FROM public.user_account_memberships m
    WHERE m.account_owner_id = public.business_account_id() AND m.user_id = auth.uid() AND m.status = 'active'
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT coalesce(owner_id = public.current_account_owner_id(), false);
$$;

CREATE OR REPLACE FUNCTION public.is_account_admin(owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT public.is_account_member(owner_id) AND public.current_account_role() = 'admin';
$$;

REVOKE ALL ON FUNCTION public.business_account_id() FROM public;
GRANT EXECUTE ON FUNCTION public.business_account_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_account_owner_id() FROM public;
REVOKE ALL ON FUNCTION public.current_account_role() FROM public;
REVOKE ALL ON FUNCTION public.is_account_member(uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_account_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_account_owner_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_account_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_admin(uuid) TO authenticated, service_role;

-- Restrictive policies also apply when an older permissive owner-only policy exists.
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY "Pixel Page active team required" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_account_owner_id() IS NOT NULL) WITH CHECK (public.current_account_owner_id() IS NOT NULL)', target.relname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Admins can invite account members" ON public.user_account_memberships;
DROP POLICY IF EXISTS "Admins and invitees can update account memberships" ON public.user_account_memberships;
CREATE POLICY "Pixel Page admins manage memberships" ON public.user_account_memberships
  FOR ALL TO authenticated USING (public.is_account_admin(account_owner_id))
  WITH CHECK (public.is_account_admin(account_owner_id));

-- Invite acceptance is performed by the authenticated server endpoint, never by
-- an invitee-controlled role/account update through the browser database client.
