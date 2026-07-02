/*
  Keep inventory SKU aligned with the saved UPC / barcode when one exists.

  Clover exports and syncs work best when SKU and Product Code point to the
  same scanned identifier for sellable media inventory.
*/

UPDATE inventory_items
SET
  sku = NULLIF(BTRIM(barcode), ''),
  updated_at = now()
WHERE NULLIF(BTRIM(barcode), '') IS NOT NULL
  AND COALESCE(BTRIM(sku), '') IS DISTINCT FROM BTRIM(barcode);
