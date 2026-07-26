-- Ensure the public Pixel & Page catalog is connected to the active RetroLootPro account
-- and returns all active, priced inventory instead of requiring manual publication first.

DO $$
DECLARE
  store_owner uuid;
BEGIN
  SELECT i.user_id
    INTO store_owner
  FROM public.inventory_items i
  WHERE coalesce(i.quantity, 0) > 0
    AND coalesce(i.status, 'available') NOT IN ('sold', 'archived', 'deleted')
  GROUP BY i.user_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF store_owner IS NOT NULL THEN
    INSERT INTO public.storefront_settings (
      user_id,
      public_slug,
      store_name,
      tagline,
      announcement,
      pickup_name,
      pickup_details,
      logo_path,
      is_active,
      updated_at
    ) VALUES (
      store_owner,
      'pixel-and-page',
      'Pixel & Page',
      'Every Story Has a Save Point',
      'Fresh inventory added every week',
      'Pixel & Page at Daytona Flea Market',
      'Friday-Sunday. Pickup instructions are provided after checkout.',
      '/pixel-page-logo.svg',
      true,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      public_slug = EXCLUDED.public_slug,
      store_name = EXCLUDED.store_name,
      tagline = EXCLUDED.tagline,
      is_active = true,
      updated_at = now();
  END IF;
END $$;

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
  WITH selected_store AS (
    SELECT s.user_id
    FROM public.storefront_settings s
    WHERE s.public_slug = requested_slug
      AND s.is_active = true
    LIMIT 1
  ), catalog AS (
    SELECT
      i.*,
      NULLIF(
        coalesce(
          i.storefront_price,
          i.selected_market_value,
          CASE
            WHEN lower(coalesce(i.condition, '')) LIKE '%new%' THEN i.price_new
            WHEN lower(coalesce(i.condition, '')) LIKE '%complete%'
              OR lower(coalesce(i.condition, '')) LIKE '%cib%' THEN i.price_cib
            ELSE i.price_loose
          END,
          i.price_cib,
          i.price_loose,
          i.price_new,
          0
        ),
        0
      ) AS public_price
    FROM public.inventory_items i
    JOIN selected_store s ON s.user_id = i.user_id
    WHERE coalesce(i.quantity, 0) > 0
      AND coalesce(i.status, 'available') NOT IN ('sold', 'archived', 'deleted')
  )
  SELECT
    c.id,
    coalesce(nullif(c.storefront_slug, ''), public.storefront_slugify(c.product_name) || '-' || left(c.id::text, 8)),
    c.product_name,
    coalesce(c.storefront_category, c.category, c.item_type, 'Other'),
    coalesce(c.console, ''),
    coalesce(c.condition, 'Available'),
    c.public_price,
    c.storefront_compare_at_price,
    c.quantity,
    c.storefront_featured,
    coalesce(c.storefront_description, c.description, c.notes),
    c.image_url,
    c.thumbnail_url,
    c.brand,
    c.barcode,
    c.created_at
  FROM catalog c
  WHERE c.public_price IS NOT NULL
  ORDER BY c.storefront_featured DESC, c.storefront_sort_order ASC, c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_storefront_products(text) TO anon, authenticated;
