-- Allow the account owner and active team members to manage storefront settings.

DROP POLICY IF EXISTS "Account members manage storefront settings" ON public.storefront_settings;
CREATE POLICY "Account members manage storefront settings"
  ON public.storefront_settings
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_account_memberships membership
      WHERE membership.account_owner_id = storefront_settings.user_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_account_memberships membership
      WHERE membership.account_owner_id = storefront_settings.user_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Account members read sync events" ON public.inventory_sync_events;
CREATE POLICY "Account members read sync events"
  ON public.inventory_sync_events
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_account_memberships membership
      WHERE membership.account_owner_id = inventory_sync_events.user_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'active'
    )
  );

-- Create the default Pixel & Page storefront for the existing owner account.
INSERT INTO public.storefront_settings (
  user_id,
  public_slug,
  store_name,
  tagline,
  announcement,
  pickup_name,
  pickup_details,
  logo_path
)
SELECT DISTINCT
  inventory.user_id,
  'pixel-and-page',
  'Pixel & Page',
  'Every Story Has a Save Point',
  'New inventory drops every week',
  'Pixel & Page at Daytona Flea Market',
  'Friday–Sunday. Pickup instructions are provided after checkout.',
  '/pixel-page-logo.svg'
FROM public.inventory_items inventory
WHERE NOT EXISTS (
  SELECT 1 FROM public.storefront_settings settings WHERE settings.user_id = inventory.user_id
)
ORDER BY inventory.user_id
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;
