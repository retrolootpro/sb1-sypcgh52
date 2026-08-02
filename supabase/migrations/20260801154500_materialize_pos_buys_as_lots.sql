/*
  Materialize completed POS customer buys into lots and inventory.

  POS buys already preserve the tender and buy-line audit trail. These links make
  the buy intake durable in the normal RetroLoot inventory and lot workflow.
*/

ALTER TABLE pos_customer_buys
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES lots(id) ON DELETE SET NULL;

ALTER TABLE pos_customer_buy_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_customer_buys_lot_id
  ON pos_customer_buys(lot_id);

CREATE INDEX IF NOT EXISTS idx_pos_customer_buy_items_inventory_item
  ON pos_customer_buy_items(inventory_item_id);

DROP POLICY IF EXISTS "Users can view own lots" ON lots;
DROP POLICY IF EXISTS "Users can insert own lots" ON lots;
DROP POLICY IF EXISTS "Users can update own lots" ON lots;
DROP POLICY IF EXISTS "Users can delete own lots" ON lots;
DROP POLICY IF EXISTS "Account members can view lots" ON lots;
DROP POLICY IF EXISTS "Account members can insert lots" ON lots;
DROP POLICY IF EXISTS "Account members can update lots" ON lots;
DROP POLICY IF EXISTS "Account members can delete lots" ON lots;

CREATE POLICY "Account members can view lots"
  ON lots FOR SELECT
  TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

CREATE POLICY "Account members can insert lots"
  ON lots FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

CREATE POLICY "Account members can update lots"
  ON lots FOR UPDATE
  TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id))
  WITH CHECK (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

CREATE POLICY "Account members can delete lots"
  ON lots FOR DELETE
  TO authenticated
  USING (user_id = public.current_account_owner_id() AND public.is_account_member(user_id));

-- Backfill completed POS buys that were recorded before this link existed.
WITH target_buys AS (
  SELECT
    buy.*,
    COALESCE(NULLIF(trim(customer.name), ''), 'POS buy ' || buy.buy_number) AS lot_name,
    COALESCE(
      NULLIF((COALESCE(buy.cash_paid, 0) + COALESCE(buy.trade_credit_issued, 0)), 0),
      COALESCE(buy.offer_amount, 0)
    ) AS total_buy_paid
  FROM pos_customer_buys buy
  LEFT JOIN pos_customers customer
    ON customer.id = buy.customer_id
   AND customer.user_id = buy.user_id
  WHERE buy.status = 'completed'
    AND buy.lot_id IS NULL
),
lot_rows AS (
  SELECT
    gen_random_uuid() AS new_lot_id,
    target_buys.*
  FROM target_buys
),
inserted_lots AS (
  INSERT INTO lots (
    id,
    user_id,
    name,
    source,
    notes,
    received_at,
    total_paid,
    allocation_status,
    cost_allocated_at,
    updated_at
  )
  SELECT
    lot_rows.new_lot_id,
    lot_rows.user_id,
    lot_rows.lot_name,
    'POS trade-in',
    trim(concat_ws(E'\n', 'Created automatically from POS buy ' || lot_rows.buy_number || '.', NULLIF(lot_rows.notes, ''))),
    COALESCE(lot_rows.bought_at, now()),
    lot_rows.total_buy_paid,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pos_customer_buy_items item
        WHERE item.buy_id = lot_rows.id
          AND item.user_id = lot_rows.user_id
      ) THEN 'allocated'
      ELSE 'pending'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pos_customer_buy_items item
        WHERE item.buy_id = lot_rows.id
          AND item.user_id = lot_rows.user_id
      ) THEN now()
      ELSE NULL
    END,
    now()
  FROM lot_rows
  RETURNING id
),
updated_buys AS (
  UPDATE pos_customer_buys buy
  SET lot_id = lot_rows.new_lot_id,
      updated_at = now()
  FROM lot_rows
  WHERE buy.id = lot_rows.id
    AND buy.user_id = lot_rows.user_id
  RETURNING buy.id AS buy_id, buy.user_id, buy.lot_id, buy.buy_number, buy.item_summary, buy.offer_amount
),
buy_item_rows AS (
  SELECT
    item.id AS buy_item_id,
    item.user_id,
    item.buy_id,
    updated_buys.lot_id,
    updated_buys.buy_number,
    item.title,
    item.platform,
    item.condition,
    item.quantity,
    item.market_value,
    item.accepted_offer,
    item.pricing_source,
    item.pricing_notes,
    row_number() OVER (PARTITION BY item.buy_id ORDER BY item.created_at, item.id) AS row_number
  FROM pos_customer_buy_items item
  JOIN updated_buys
    ON updated_buys.buy_id = item.buy_id
   AND updated_buys.user_id = item.user_id
  WHERE item.inventory_item_id IS NULL
),
manual_summary_rows AS (
  SELECT
    NULL::uuid AS buy_item_id,
    updated_buys.user_id,
    updated_buys.buy_id,
    updated_buys.lot_id,
    updated_buys.buy_number,
    updated_buys.item_summary AS title,
    'Unknown' AS platform,
    'Loose' AS condition,
    1 AS quantity,
    0::numeric AS market_value,
    COALESCE(updated_buys.offer_amount, 0) AS accepted_offer,
    'POS manual summary' AS pricing_source,
    '' AS pricing_notes,
    1 AS row_number
  FROM updated_buys
  WHERE NOT EXISTS (
    SELECT 1 FROM pos_customer_buy_items item
    WHERE item.buy_id = updated_buys.buy_id
      AND item.user_id = updated_buys.user_id
  )
),
inventory_source_rows AS (
  SELECT * FROM buy_item_rows
  UNION ALL
  SELECT * FROM manual_summary_rows
),
inventory_rows AS (
  SELECT
    gen_random_uuid() AS inventory_item_id,
    inventory_source_rows.*
  FROM inventory_source_rows
  WHERE trim(COALESCE(title, '')) <> ''
),
inserted_inventory AS (
  INSERT INTO inventory_items (
    id,
    user_id,
    product_name,
    console,
    condition,
    purchase_price,
    quantity,
    notes,
    lot_id,
    status,
    sell_price,
    selected_market_value,
    price_loose,
    price_cib,
    price_new,
    sku,
    pricing_status,
    pricing_source,
    lot_market_value_at_allocation,
    lot_allocation_ratio,
    purchase_price_override,
    clover_sync_status
  )
  SELECT
    ir.inventory_item_id,
    ir.user_id,
    trim(ir.title),
    COALESCE(NULLIF(trim(ir.platform), ''), 'Unknown'),
    CASE
      WHEN lower(COALESCE(ir.condition, '')) LIKE '%cib%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%complete%' THEN 'CIB'
      WHEN lower(COALESCE(ir.condition, '')) LIKE '%new%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%sealed%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%graded%' THEN 'New'
      ELSE 'Loose'
    END,
    round((COALESCE(ir.accepted_offer, 0) / greatest(COALESCE(ir.quantity, 1), 1))::numeric, 2),
    greatest(COALESCE(ir.quantity, 1), 1),
    trim(concat_ws(' | ', NULLIF(ir.pricing_notes, ''), 'POS buy ' || ir.buy_number)),
    ir.lot_id,
    'available',
    NULLIF(COALESCE(ir.market_value, 0), 0),
    NULLIF(COALESCE(ir.market_value, 0), 0),
    CASE
      WHEN lower(COALESCE(ir.condition, '')) NOT LIKE '%cib%'
       AND lower(COALESCE(ir.condition, '')) NOT LIKE '%complete%'
       AND lower(COALESCE(ir.condition, '')) NOT LIKE '%new%'
       AND lower(COALESCE(ir.condition, '')) NOT LIKE '%sealed%'
       AND lower(COALESCE(ir.condition, '')) NOT LIKE '%graded%'
      THEN NULLIF(COALESCE(ir.market_value, 0), 0)
      ELSE NULL
    END,
    CASE
      WHEN lower(COALESCE(ir.condition, '')) LIKE '%cib%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%complete%' THEN NULLIF(COALESCE(ir.market_value, 0), 0)
      ELSE NULL
    END,
    CASE
      WHEN lower(COALESCE(ir.condition, '')) LIKE '%new%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%sealed%'
        OR lower(COALESCE(ir.condition, '')) LIKE '%graded%' THEN NULLIF(COALESCE(ir.market_value, 0), 0)
      ELSE NULL
    END,
    'POS-' || regexp_replace(upper(COALESCE(ir.buy_number, 'BUY')), '[^A-Z0-9]', '', 'g') || '-' || lpad(ir.row_number::text, 2, '0'),
    CASE WHEN COALESCE(ir.market_value, 0) > 0 THEN 'found' ELSE 'pending' END,
    COALESCE(NULLIF(trim(ir.pricing_source), ''), 'POS trade-in'),
    COALESCE(ir.market_value, 0),
    CASE
      WHEN COALESCE(ir.market_value, 0) > 0 AND COALESCE(ir.accepted_offer, 0) > 0
      THEN COALESCE(ir.accepted_offer, 0) / COALESCE(ir.market_value, 0)
      ELSE 0
    END,
    false,
    'pending'
  FROM inventory_rows ir
  RETURNING id
)
UPDATE pos_customer_buy_items item
SET inventory_item_id = ir.inventory_item_id
FROM inventory_rows ir
WHERE item.id = ir.buy_item_id
  AND item.user_id = ir.user_id;
