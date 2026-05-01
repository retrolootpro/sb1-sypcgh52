/*
  # Add Platform Integrations

  ## Overview
  Adds support for eBay OAuth integration and synced marketplace orders.

  ## New Tables

  ### platform_connections
  Stores OAuth credentials and token state for connected marketplace accounts (eBay, Amazon).
  - `platform` — identifier: 'ebay' | 'amazon'
  - `access_token` — current OAuth access token
  - `refresh_token` — long-lived refresh token
  - `token_expires_at` — when the access token expires
  - `account_name` — seller username from the marketplace
  - `is_active` — whether the connection is currently active

  ### platform_orders
  Stores orders synced from connected marketplaces. These are orders awaiting fulfillment
  that were pulled via the marketplace API (e.g., eBay Fulfillment API).
  - `platform` — source marketplace
  - `platform_order_id` — the order ID from the marketplace
  - `buyer_username` — buyer's account name
  - `item_title` — listing title
  - `item_sku` — optional SKU
  - `quantity` — units sold
  - `sale_price` — final sale price
  - `shipping_cost` — shipping cost charged to buyer
  - `shipping_address` — JSON blob of shipping address
  - `order_status` — status from marketplace (awaiting_shipment, shipped, etc.)
  - `shipping_status` — local shipping status (pending, shipped)
  - `tracking_number` / `shipping_carrier` / `shipped_at` — fulfillment data

  ## Security
  - RLS enabled on both tables
  - Users can only access their own records
*/

CREATE TABLE IF NOT EXISTS platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  account_name text,
  is_active boolean DEFAULT false,
  connected_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, platform)
);

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own platform connections"
  ON platform_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own platform connections"
  ON platform_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own platform connections"
  ON platform_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own platform connections"
  ON platform_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS platform_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_order_id text NOT NULL,
  buyer_username text,
  item_title text NOT NULL,
  item_sku text,
  quantity integer DEFAULT 1,
  sale_price numeric(10,2),
  shipping_cost numeric(10,2),
  shipping_address jsonb,
  order_status text DEFAULT 'awaiting_shipment',
  shipping_status text DEFAULT 'pending',
  tracking_number text,
  shipping_carrier text,
  shipped_at timestamptz,
  order_created_at timestamptz,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, platform, platform_order_id)
);

ALTER TABLE platform_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own platform orders"
  ON platform_orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own platform orders"
  ON platform_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own platform orders"
  ON platform_orders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own platform orders"
  ON platform_orders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
