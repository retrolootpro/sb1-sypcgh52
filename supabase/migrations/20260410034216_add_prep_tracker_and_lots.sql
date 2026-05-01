/*
  # Prep Tracker & Lots

  ## Summary
  Adds a full item preparation pipeline and lot management system to RetroLoot Pro.
  Tracks each inventory item through a 6-stage prep lifecycle (Received → Sorted →
  Cleaned → Tested → Noted → On Rack) and records when items are listed on each
  selling platform (eBay, Amazon, Whatnot).

  ## New Tables

  ### `lots`
  Groups of items received together in a single purchase or batch:
  - `name` — descriptive name (e.g. "Estate Sale Batch - April 10")
  - `source` — where the lot came from (estate sale, flea market, etc.)
  - `notes` — any notes about the batch
  - `received_at` — when the lot arrived

  ## Changes to `inventory_items`

  ### Prep Lifecycle Timestamps (null = not yet done)
  - `sorted_at` — item identified and categorized
  - `cleaned_at` — item physically cleaned
  - `tested_at` — item tested and working status confirmed
  - `notes_added_at` — condition notes and photos documented
  - `on_rack_at` — item placed on rack / ready for sale

  ### Listing Timestamps
  - `listed_ebay_at` — when listed on eBay
  - `listed_amazon_at` — when listed on Amazon
  - `listed_whatnot_at` — when curated for a Whatnot show

  ### Lot Reference
  - `lot_id` — optional FK to lots table for batch grouping

  ## Security
  - RLS enabled on lots table
  - Standard owner-only policies applied

  ## Notes
  1. `created_at` on inventory_items serves as the "received" timestamp
  2. All prep timestamps are nullable — null means not yet completed
  3. Items with `on_rack_at` filled AND no listing timestamps are "ready to list"
  4. Listing columns track when the listing was created, not when the item sold
*/

-- ─── lots ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  source text DEFAULT '',
  notes text DEFAULT '',
  received_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lots"
  ON lots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lots"
  ON lots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lots"
  ON lots FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own lots"
  ON lots FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── inventory_items: prep lifecycle columns ─────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='lot_id') THEN
    ALTER TABLE inventory_items ADD COLUMN lot_id uuid REFERENCES lots(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='sorted_at') THEN
    ALTER TABLE inventory_items ADD COLUMN sorted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='cleaned_at') THEN
    ALTER TABLE inventory_items ADD COLUMN cleaned_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='tested_at') THEN
    ALTER TABLE inventory_items ADD COLUMN tested_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='notes_added_at') THEN
    ALTER TABLE inventory_items ADD COLUMN notes_added_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='on_rack_at') THEN
    ALTER TABLE inventory_items ADD COLUMN on_rack_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='listed_ebay_at') THEN
    ALTER TABLE inventory_items ADD COLUMN listed_ebay_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='listed_amazon_at') THEN
    ALTER TABLE inventory_items ADD COLUMN listed_amazon_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='listed_whatnot_at') THEN
    ALTER TABLE inventory_items ADD COLUMN listed_whatnot_at timestamptz;
  END IF;
END $$;

-- ─── index for lot queries ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_items_lot_id ON inventory_items(lot_id);
