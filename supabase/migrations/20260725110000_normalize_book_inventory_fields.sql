/*
  Normalize book and media inventory away from game-specific fields.

  Books still use the required condition column as an internal placeholder,
  but region, PriceCharting condition tiers, and deal score fields should not
  be treated as book metadata.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'inventory_items'
      AND constraint_name = 'inventory_items_item_type_check'
  ) THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_item_type_check;
  END IF;
END $$;

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_item_type_check
  CHECK (
    item_type IN (
      'game',
      'console',
      'accessory',
      'unknown',
      'book',
      'manga',
      'comic',
      'graphic_novel',
      'strategy_guide',
      'media'
    )
  );

UPDATE inventory_items
SET
  condition = 'Loose',
  region = NULL,
  genre = NULL,
  category = COALESCE(NULLIF(category, ''), 'Books & Media'),
  item_type = CASE
    WHEN lower(COALESCE(console, '')) LIKE '%manga%' THEN 'manga'
    WHEN lower(COALESCE(console, '')) LIKE '%comic%' THEN 'comic'
    WHEN lower(COALESCE(console, '')) LIKE '%graphic novel%' THEN 'graphic_novel'
    WHEN lower(COALESCE(console, '')) LIKE '%strategy guide%' THEN 'strategy_guide'
    WHEN lower(COALESCE(item_type, '')) IN ('book', 'manga', 'comic', 'graphic_novel', 'strategy_guide', 'media') THEN item_type
    ELSE 'book'
  END,
  price_loose = NULL,
  price_cib = NULL,
  price_new = NULL,
  price_graded = NULL,
  deal_score = 0,
  deal_score_label = '',
  pricing_confidence = NULL,
  pricing_matched_title = NULL,
  pricing_matched_platform = NULL,
  pc_source_product_id = NULL,
  pricing_diagnostics = NULL,
  pricing_error_message = NULL,
  pricing_error_code = NULL,
  pricing_attempted_at = NULL,
  pricing_last_checked_at = NULL,
  pricing_status = 'manual',
  pricing_source = 'Manual / book metadata',
  updated_at = now()
WHERE
  lower(COALESCE(console, '')) IN ('book', 'manga', 'comic', 'graphic novel', 'strategy guide')
  OR lower(COALESCE(category, '')) LIKE '%book%'
  OR lower(COALESCE(category, '')) LIKE '%manga%'
  OR lower(COALESCE(category, '')) LIKE '%comic%'
  OR lower(COALESCE(category, '')) LIKE '%graphic novel%'
  OR lower(COALESCE(category, '')) LIKE '%strategy guide%'
  OR lower(COALESCE(category, '')) LIKE '%books & media%'
  OR lower(COALESCE(item_type, '')) IN ('book', 'manga', 'comic', 'graphic_novel', 'strategy_guide', 'media')
  OR book_isbn10 IS NOT NULL
  OR book_isbn13 IS NOT NULL
  OR book_authors IS NOT NULL
  OR book_publisher IS NOT NULL;
