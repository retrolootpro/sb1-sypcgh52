-- Eligibility metadata only; no changes to prices, stock, orders or finance.
ALTER TABLE public.inventory_items
  ADD COLUMN storefront_shipping_promotion text NOT NULL DEFAULT 'eligible'
  CHECK (storefront_shipping_promotion IN ('eligible','free','excluded'));
