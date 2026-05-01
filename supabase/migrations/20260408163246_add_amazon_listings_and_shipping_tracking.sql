/*
  # Add Amazon Listings and Shipping Tracking

  1. New Tables
    - `amazon_listings`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `item_id` (uuid, references inventory_items)
      - `employee_id` (uuid, references employees, nullable)
      - `listing_url` (text, Amazon listing URL)
      - `asin` (text, Amazon Standard Identification Number)
      - `listed_price` (numeric, listing price)
      - `status` (text, draft/active/sold/ended/cancelled)
      - `listed_at` (timestamptz, when listed)
      - `sold_at` (timestamptz, when sold)
      - `created_at` (timestamptz)

  2. Modified Tables
    - `inventory_items`
      - Add `shipping_status` (text, null/pending/shipped)
      - Add `shipped_at` (timestamptz, when shipped)
      - Add `tracking_number` (text, carrier tracking number)
      - Add `shipping_carrier` (text, e.g. USPS, UPS, FedEx)

  3. Security
    - Enable RLS on amazon_listings
    - Add policies matching the ebay_listings pattern
    - Indexes for performance

  4. Notes
    - shipping_status NULL means item is not sold or not yet queued for shipping
    - shipping_status 'pending' means sold and awaiting shipment
    - shipping_status 'shipped' means tracking number assigned and shipped
*/

-- Create amazon_listings table
CREATE TABLE IF NOT EXISTS amazon_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  item_id uuid REFERENCES inventory_items(id) NOT NULL,
  employee_id uuid REFERENCES employees(id),
  listing_url text DEFAULT '',
  asin text DEFAULT '',
  listed_price numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'sold', 'ended', 'cancelled')),
  listed_at timestamptz,
  sold_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE amazon_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Amazon listings"
  ON amazon_listings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Amazon listings"
  ON amazon_listings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Amazon listings"
  ON amazon_listings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own Amazon listings"
  ON amazon_listings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_amazon_listings_employee_id ON amazon_listings(employee_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_item_id ON amazon_listings(item_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_user_id ON amazon_listings(user_id);

-- Add shipping tracking columns to inventory_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'shipping_status'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN shipping_status text CHECK (shipping_status IN ('pending', 'shipped'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'shipped_at'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN shipped_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'tracking_number'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN tracking_number text DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'shipping_carrier'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN shipping_carrier text DEFAULT '';
  END IF;
END $$;
