/*
  # RetroLoot Pro Database Schema

  ## Overview
  Complete database schema for RetroLoot Pro - a premium inventory and deal analysis platform for video game resellers.

  ## Tables Created

  1. **inventory_items**
     - Core inventory management table
     - Stores product details, pricing, condition, and metadata
     - Links to user via user_id
     - Fields: id, user_id, product_name, console, condition, purchase_price, quantity, notes, image_url, barcode, created_at, updated_at

  2. **pricing_data**
     - Stores PriceCharting API results
     - Tracks loose, CIB, and new prices
     - Timestamp for cache management
     - Fields: id, item_id, loose_price, cib_price, new_price, fetched_at

  3. **ebay_comps**
     - Stores eBay sold comparables
     - Tracks individual sold listings
     - Used for trend analysis
     - Fields: id, item_id, sold_price, sold_date, listing_title, fetched_at

  4. **show_lists**
     - Whatnot show preparation
     - Groups items for live shows
     - Fields: id, user_id, name, show_date, created_at

  5. **show_items**
     - Junction table for show lists
     - Links inventory items to shows
     - Stores show-specific data (start price, category)
     - Fields: id, show_list_id, item_id, start_price, category

  ## Security
  - RLS enabled on all tables
  - Policies restrict access to authenticated users
  - Users can only access their own data
  - Show lists and items protected by ownership checks

  ## Notes
  - All prices stored as numeric(10,2)
  - Timestamps use timestamptz for timezone support
  - Indexes on foreign keys for performance
  - ON DELETE CASCADE for data integrity
*/

-- Create inventory_items table
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  console text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('Loose', 'CIB', 'New')),
  purchase_price numeric(10,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  notes text DEFAULT '',
  image_url text DEFAULT '',
  barcode text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create pricing_data table
CREATE TABLE IF NOT EXISTS pricing_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  loose_price numeric(10,2) DEFAULT 0,
  cib_price numeric(10,2) DEFAULT 0,
  new_price numeric(10,2) DEFAULT 0,
  fetched_at timestamptz DEFAULT now()
);

-- Create ebay_comps table
CREATE TABLE IF NOT EXISTS ebay_comps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  sold_price numeric(10,2) NOT NULL,
  sold_date timestamptz NOT NULL,
  listing_title text NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

-- Create show_lists table
CREATE TABLE IF NOT EXISTS show_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  show_date timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create show_items junction table
CREATE TABLE IF NOT EXISTS show_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_list_id uuid NOT NULL REFERENCES show_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  start_price numeric(10,2) NOT NULL,
  category text NOT NULL DEFAULT '$5 Start'
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_user_id ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_pricing_data_item_id ON pricing_data(item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_comps_item_id ON ebay_comps(item_id);
CREATE INDEX IF NOT EXISTS idx_show_lists_user_id ON show_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_show_items_show_list_id ON show_items(show_list_id);
CREATE INDEX IF NOT EXISTS idx_show_items_item_id ON show_items(item_id);

-- Enable Row Level Security
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inventory_items
CREATE POLICY "Users can view own inventory items"
  ON inventory_items FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory items"
  ON inventory_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory items"
  ON inventory_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory items"
  ON inventory_items FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for pricing_data
CREATE POLICY "Users can view pricing data for own items"
  ON pricing_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = pricing_data.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert pricing data for own items"
  ON pricing_data FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = pricing_data.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update pricing data for own items"
  ON pricing_data FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = pricing_data.item_id
      AND inventory_items.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = pricing_data.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete pricing data for own items"
  ON pricing_data FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = pricing_data.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

-- RLS Policies for ebay_comps
CREATE POLICY "Users can view ebay comps for own items"
  ON ebay_comps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = ebay_comps.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert ebay comps for own items"
  ON ebay_comps FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = ebay_comps.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete ebay comps for own items"
  ON ebay_comps FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items
      WHERE inventory_items.id = ebay_comps.item_id
      AND inventory_items.user_id = auth.uid()
    )
  );

-- RLS Policies for show_lists
CREATE POLICY "Users can view own show lists"
  ON show_lists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own show lists"
  ON show_lists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own show lists"
  ON show_lists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own show lists"
  ON show_lists FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for show_items
CREATE POLICY "Users can view show items for own shows"
  ON show_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM show_lists
      WHERE show_lists.id = show_items.show_list_id
      AND show_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert show items for own shows"
  ON show_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM show_lists
      WHERE show_lists.id = show_items.show_list_id
      AND show_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update show items for own shows"
  ON show_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM show_lists
      WHERE show_lists.id = show_items.show_list_id
      AND show_lists.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM show_lists
      WHERE show_lists.id = show_items.show_list_id
      AND show_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete show items for own shows"
  ON show_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM show_lists
      WHERE show_lists.id = show_items.show_list_id
      AND show_lists.user_id = auth.uid()
    )
  );