/*
  Add 1-5 condition rating to POS customer buy/trade item lines.
*/

ALTER TABLE pos_customer_buy_items
  ADD COLUMN IF NOT EXISTS condition_rating integer NOT NULL DEFAULT 5
  CHECK (condition_rating >= 1 AND condition_rating <= 5);
