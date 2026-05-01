/*
  # Add Collections Feature

  ## Overview
  Adds the ability for users to organize inventory items into named collections
  (e.g., "Personal", "Resell", "Lot 1", "Lot 2").

  ## New Tables
  - `collections`
    - `id` (uuid, primary key)
    - `user_id` (uuid, FK to auth.users, cascade delete)
    - `name` (text, the collection name)
    - `created_at` (timestamptz)

  ## Modified Tables
  - `inventory_items`
    - Added `collection_id` (uuid, nullable FK to collections, set null on delete)
    - Added index on `collection_id` for fast filtering

  ## Security
  - RLS enabled on `collections`
  - Policies restrict all operations to the owning authenticated user
  - `inventory_items` update policy already allows users to update their own items
*/

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own collections"
  ON collections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own collections"
  ON collections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own collections"
  ON collections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own collections"
  ON collections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'collection_id'
  ) THEN
    ALTER TABLE inventory_items
      ADD COLUMN collection_id uuid REFERENCES collections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_items_collection_id
  ON inventory_items(collection_id);
