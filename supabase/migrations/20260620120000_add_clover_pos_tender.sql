ALTER TABLE pos_sales
  DROP CONSTRAINT IF EXISTS pos_sales_payment_method_check;

ALTER TABLE pos_sales
  ADD CONSTRAINT pos_sales_payment_method_check
  CHECK (payment_method IN ('cash', 'clover_card', 'external_card', 'square', 'stripe', 'trade_credit', 'split', 'other'));
