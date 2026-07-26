-- Pixel & Page storefront integration
-- Keeps RetroLootPro inventory as the source of truth and exposes only sanitized published products.

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

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_storefront_slug_unique
  ON public.inventory_items(user_id, storefront_slug)
  WHERE storefront_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  user_id uuid PRIMARY KEY,
  public_slug text NOT NULL UNIQUE DEFAULT 'pixel-and-page',
  store_name text NOT NULL DEFAULT 'Pixel & Page',
  tagline text NOT NULL DEFAULT 'Every Story Has a Save Point',
  announcement text NOT NULL DEFAULT 'New inventory drops every week',
  pickup_name text NOT NULL DEFAULT 'Pixel & Page at Daytona Flea Market',
  pickup_details text NOT NULL DEFAULT 'Friday–Sunday. Pickup instructions are provided after checkout.',
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

DROP POLICY IF EXISTS "Account members manage storefront settings" ON public.storefront_settings;
CREATE POLICY "Account members manage storefront settings"
  ON public.storefront_settings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.inventory_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('quantity_changed','price_changed','published','unpublished','sold')),
  quantity integer,
  price numeric(12,2),
  source_channel text NOT NULL DEFAULT 'retrolootpro',
  target_channels text[] NOT NULL DEFAULT ARRAY['storefront','clover','ebay','whatnot']::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','partial','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS inventory_sync_events_pending_idx
  ON public.inventory_sync_events(status, created_at)
  WHERE status IN ('pending','partial','failed');

ALTER TABLE public.inventory_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members read sync events" ON public.inventory_sync_events;
CREATE POLICY "Account members read sync events"
  ON public.inventory_sync_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.storefront_slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(value, 'item')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.prepare_storefront_inventory_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
BEGIN
  IF NEW.storefront_slug IS NULL OR NEW.storefront_slug = '' THEN
    base_slug := public.storefront_slugify(NEW.product_name);
    NEW.storefront_slug := base_slug || '-' || left(NEW.id::text, 8);
  END IF;

  IF NEW.storefront_enabled AND (coalesce(NEW.quantity, 0) <= 0 OR coalesce(NEW.status, 'available') IN ('sold','archived','deleted')) THEN
    NEW.storefront_enabled := false;
  END IF;

  IF NEW.storefront_price IS NULL OR NEW.storefront_price <= 0 THEN
    NEW.storefront_price := NULLIF(coalesce(NEW.selected_market_value, NEW.price_cib, NEW.price_loose, NEW.price_new, 0), 0);
  END IF;

  NEW.storefront_updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_storefront_inventory_item_trigger ON public.inventory_items;
CREATE TRIGGER prepare_storefront_inventory_item_trigger
BEFORE INSERT OR UPDATE OF product_name, quantity, status, storefront_enabled, storefront_price, storefront_slug
ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.prepare_storefront_inventory_item();

CREATE OR REPLACE FUNCTION public.enqueue_inventory_sync_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kind text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    kind := CASE WHEN NEW.quantity <= 0 THEN 'sold' ELSE 'quantity_changed' END;
  ELSIF TG_OP = 'UPDATE' AND NEW.storefront_price IS DISTINCT FROM OLD.storefront_price THEN
    kind := 'price_changed';
  ELSIF TG_OP = 'UPDATE' AND NEW.storefront_enabled IS DISTINCT FROM OLD.storefront_enabled THEN
    kind := CASE WHEN NEW.storefront_enabled THEN 'published' ELSE 'unpublished' END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_sync_events (
    user_id, inventory_item_id, event_type, quantity, price, source_channel, payload
  ) VALUES (
    NEW.user_id,
    NEW.id,
    kind,
    NEW.quantity,
    NEW.storefront_price,
    'retrolootpro',
    jsonb_build_object(
      'product_name', NEW.product_name,
      'barcode', NEW.barcode,
      'storefront_enabled', NEW.storefront_enabled,
      'status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_inventory_sync_event_trigger ON public.inventory_items;
CREATE TRIGGER enqueue_inventory_sync_event_trigger
AFTER UPDATE OF quantity, storefront_price, storefront_enabled
ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_inventory_sync_event();

CREATE OR REPLACE FUNCTION public.get_storefront_profile(requested_slug text DEFAULT 'pixel-and-page')
RETURNS TABLE (
  public_slug text,
  store_name text,
  tagline text,
  announcement text,
  pickup_name text,
  pickup_details text,
  support_email text,
  phone text,
  logo_path text,
  primary_color text,
  accent_color text,
  secondary_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.public_slug, s.store_name, s.tagline, s.announcement, s.pickup_name,
         s.pickup_details, s.support_email, s.phone, s.logo_path,
         s.primary_color, s.accent_color, s.secondary_color
  FROM public.storefront_settings s
  WHERE s.public_slug = requested_slug AND s.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_storefront_products(requested_slug text DEFAULT 'pixel-and-page')
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  category text,
  platform text,
  condition text,
  price numeric,
  compare_at_price numeric,
  quantity integer,
  featured boolean,
  description text,
  image_url text,
  thumbnail_url text,
  brand text,
  barcode text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.storefront_slug,
    i.product_name,
    coalesce(i.storefront_category, i.category, i.item_type, 'Other'),
    i.console,
    i.condition,
    i.storefront_price,
    i.storefront_compare_at_price,
    i.quantity,
    i.storefront_featured,
    coalesce(i.storefront_description, i.description, i.notes),
    i.image_url,
    i.thumbnail_url,
    i.brand,
    i.barcode,
    i.created_at
  FROM public.inventory_items i
  JOIN public.storefront_settings s ON s.user_id = i.user_id
  WHERE s.public_slug = requested_slug
    AND s.is_active = true
    AND i.storefront_enabled = true
    AND i.storefront_price IS NOT NULL
    AND i.storefront_price > 0
    AND coalesce(i.quantity, 0) > 0
    AND coalesce(i.status, 'available') NOT IN ('sold','archived','deleted')
  ORDER BY i.storefront_featured DESC, i.storefront_sort_order ASC, i.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_profile(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_products(text) TO anon, authenticated;

-- Publish in-stock, rack-ready inventory during initial rollout when a usable price exists.
UPDATE public.inventory_items
SET
  storefront_enabled = true,
  storefront_price = NULLIF(coalesce(selected_market_value, price_cib, price_loose, price_new, 0), 0),
  storefront_category = coalesce(category, item_type),
  storefront_updated_at = now()
WHERE coalesce(quantity, 0) > 0
  AND coalesce(status, 'available') NOT IN ('sold','archived','deleted')
  AND on_rack_at IS NOT NULL
  AND NULLIF(coalesce(selected_market_value, price_cib, price_loose, price_new, 0), 0) IS NOT NULL;
