-- Add storefront metadata without changing existing stock, prices, or publication flags.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS storefront_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storefront_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS storefront_compare_at_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS storefront_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storefront_description text,
  ADD COLUMN IF NOT EXISTS storefront_slug text,
  ADD COLUMN IF NOT EXISTS storefront_category text,
  ADD COLUMN IF NOT EXISTS storefront_sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  user_id uuid PRIMARY KEY,
  public_slug text NOT NULL UNIQUE DEFAULT 'pixel-and-page',
  store_name text NOT NULL DEFAULT 'Pixel & Page',
  tagline text NOT NULL DEFAULT 'Every Story Has a Save Point',
  announcement text NOT NULL DEFAULT 'Online only - Shipping to your door',
  pickup_name text NOT NULL DEFAULT '',
  pickup_details text NOT NULL DEFAULT '',
  support_email text,
  phone text,
  logo_path text NOT NULL DEFAULT '/pixel-page-logo.svg',
  primary_color text NOT NULL DEFAULT '#12394A',
  accent_color text NOT NULL DEFAULT '#2FA9A1',
  secondary_color text NOT NULL DEFAULT '#D86632',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storefront_settings TO authenticated;
GRANT ALL ON public.storefront_settings TO service_role;

DROP POLICY IF EXISTS "Account members manage storefront settings" ON public.storefront_settings;
CREATE POLICY "Account members manage storefront settings"
  ON public.storefront_settings FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
