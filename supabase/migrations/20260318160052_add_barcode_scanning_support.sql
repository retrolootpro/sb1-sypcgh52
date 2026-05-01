/*
  # Add Barcode Scanning Support

  ## Overview
  Extends RetroLoot Pro with comprehensive barcode scanning capabilities for video game inventory intake.

  ## Changes to Existing Tables

  ### inventory_items
  Adds new columns for barcode scanning metadata:
  - normalized_title: Cleaned version of product name for matching
  - item_type: Category (game, console, accessory, unknown)
  - brand: Manufacturer/publisher
  - region: Geographic region (US, EU, JP, etc.)
  - variant: Special edition or variant info
  - source_upc_provider: Which UPC lookup service provided data
  - source_metadata_provider: Which metadata service provided game data
  - source_image_provider: Which service provided the image
  - confidence_score: Match confidence (0-100)
  - raw_lookup_payload: JSON of original lookup response
  - scan_created_at: When item was first scanned
  - pricing_source_notes: Notes about pricing data source
  - thumbnail_url: Small preview image

  ## New Tables

  ### scan_sessions
  Tracks barcode scanning sessions for batch processing
  - id, user_id, session_name, scan_mode, started_at, completed_at
  - status: active, paused, completed, cancelled

  ### scan_queue_items
  Individual scanned items in processing queue
  - id, session_id, barcode, status, scanned_at
  - lookup_result: JSON of lookup response
  - created_item_id: Link to created inventory item

  ### review_queue
  Items requiring manual review due to low confidence
  - id, user_id, barcode, detected_title, item_type
  - candidate_matches: JSON array of possible matches
  - confidence_score, ranking_reason
  - status: pending, approved, rejected, custom_created

  ### barcode_lookup_cache
  Cache for barcode lookups to reduce API calls
  - barcode (primary), lookup_data, provider, cached_at
  - expires_at for cache invalidation

  ## Security
  - RLS enabled on all new tables
  - Users can only access their own scan sessions and review items
  - Cache table has relaxed policies for shared lookups
*/

-- Extend inventory_items table
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS normalized_title text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'unknown' CHECK (item_type IN ('game', 'console', 'accessory', 'unknown'));
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS brand text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS region text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS variant text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS source_upc_provider text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS source_metadata_provider text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS source_image_provider text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS confidence_score integer DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS raw_lookup_payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS scan_created_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_source_notes text DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS thumbnail_url text DEFAULT '';

-- Create scan_sessions table
CREATE TABLE IF NOT EXISTS scan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name text NOT NULL,
  scan_mode text NOT NULL CHECK (scan_mode IN ('single', 'continuous')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create scan_queue_items table
CREATE TABLE IF NOT EXISTS scan_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES scan_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'needs_review')),
  scanned_at timestamptz DEFAULT now(),
  lookup_result jsonb DEFAULT '{}'::jsonb,
  created_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  error_message text DEFAULT '',
  processed_at timestamptz
);

-- Create review_queue table
CREATE TABLE IF NOT EXISTS review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_queue_item_id uuid REFERENCES scan_queue_items(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  detected_title text NOT NULL,
  item_type text DEFAULT 'unknown',
  brand text DEFAULT '',
  detected_image_url text DEFAULT '',
  candidate_matches jsonb DEFAULT '[]'::jsonb,
  confidence_score integer DEFAULT 0,
  ranking_reason text DEFAULT '',
  raw_lookup_data jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'custom_created')),
  created_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

-- Create barcode_lookup_cache table
CREATE TABLE IF NOT EXISTS barcode_lookup_cache (
  barcode text PRIMARY KEY,
  lookup_data jsonb NOT NULL,
  provider text NOT NULL,
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_scan_sessions_user_id ON scan_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_queue_items_session_id ON scan_queue_items(session_id);
CREATE INDEX IF NOT EXISTS idx_scan_queue_items_user_id ON scan_queue_items(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_queue_items_barcode ON scan_queue_items(barcode);
CREATE INDEX IF NOT EXISTS idx_review_queue_user_id ON review_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_barcode_lookup_cache_expires ON barcode_lookup_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON inventory_items(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_items_item_type ON inventory_items(item_type);

-- Enable Row Level Security
ALTER TABLE scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE barcode_lookup_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scan_sessions
CREATE POLICY "Users can view own scan sessions"
  ON scan_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own scan sessions"
  ON scan_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan sessions"
  ON scan_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scan sessions"
  ON scan_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for scan_queue_items
CREATE POLICY "Users can view own scan queue items"
  ON scan_queue_items FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own scan queue items"
  ON scan_queue_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan queue items"
  ON scan_queue_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scan queue items"
  ON scan_queue_items FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for review_queue
CREATE POLICY "Users can view own review queue items"
  ON review_queue FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own review queue items"
  ON review_queue FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own review queue items"
  ON review_queue FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own review queue items"
  ON review_queue FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for barcode_lookup_cache (shared read, authenticated write)
CREATE POLICY "Anyone can read unexpired cache"
  ON barcode_lookup_cache FOR SELECT
  TO authenticated
  USING (expires_at > now());

CREATE POLICY "Authenticated users can insert cache"
  ON barcode_lookup_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update cache"
  ON barcode_lookup_cache FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);