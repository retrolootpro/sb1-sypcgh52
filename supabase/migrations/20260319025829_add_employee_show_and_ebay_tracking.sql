/*
  # Add Employee Tracking for Shows and eBay Listings

  1. Changes to show_lists table
    - Add `managed_by_employee_id` column to track which employee is managing the show
    - Add `status` column to track show status (draft, active, completed)
    
  2. New Tables
    - `ebay_listings` table to track eBay uploads by employees
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `item_id` (uuid, references inventory_items)
      - `employee_id` (uuid, references employees)
      - `listing_url` (text, eBay listing URL)
      - `listing_id` (text, eBay listing ID)
      - `listed_price` (numeric, listing price)
      - `status` (text, draft/active/sold/ended)
      - `listed_at` (timestamptz, when it was listed)
      - `sold_at` (timestamptz, when it sold on eBay)
      - `created_at` (timestamptz)
      
  3. Security
    - Enable RLS on new tables
    - Add policies for authenticated users to manage their own data
*/

-- Add employee tracking to show_lists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'show_lists' AND column_name = 'managed_by_employee_id'
  ) THEN
    ALTER TABLE show_lists ADD COLUMN managed_by_employee_id uuid REFERENCES employees(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'show_lists' AND column_name = 'status'
  ) THEN
    ALTER TABLE show_lists ADD COLUMN status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled'));
  END IF;
END $$;

-- Create ebay_listings table
CREATE TABLE IF NOT EXISTS ebay_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  item_id uuid REFERENCES inventory_items(id) NOT NULL,
  employee_id uuid REFERENCES employees(id),
  listing_url text DEFAULT '',
  listing_id text DEFAULT '',
  listed_price numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'sold', 'ended', 'cancelled')),
  listed_at timestamptz,
  sold_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on ebay_listings
ALTER TABLE ebay_listings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ebay_listings
CREATE POLICY "Users can view own eBay listings"
  ON ebay_listings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own eBay listings"
  ON ebay_listings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own eBay listings"
  ON ebay_listings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own eBay listings"
  ON ebay_listings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_ebay_listings_employee_id ON ebay_listings(employee_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_item_id ON ebay_listings(item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_user_id ON ebay_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_show_lists_managed_by_employee_id ON show_lists(managed_by_employee_id);
