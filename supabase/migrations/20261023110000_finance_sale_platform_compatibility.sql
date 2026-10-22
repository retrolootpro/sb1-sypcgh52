-- Older live databases may predate the Shipping Hub's nullable sale platform.
-- Preserve unknown historical platforms rather than assigning an invented one.
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS sold_via text;
