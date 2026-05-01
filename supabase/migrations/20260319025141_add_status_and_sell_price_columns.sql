/*
  # Add status and sell_price columns to inventory_items

  1. Changes
    - Add `status` column to inventory_items table with values 'available', 'sold', 'reserved'
    - Add `sell_price` column to inventory_items table for tracking selling price
    - Set default status to 'available' for existing items
    - Add sold_at timestamp to track when items were sold

  2. Notes
    - Existing items will be marked as 'available' by default
    - Items with sold_by_employee_id will be marked as 'sold'
*/

-- Add status column with check constraint
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'available' 
CHECK (status IN ('available', 'sold', 'reserved'));

-- Add sell_price column
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS sell_price numeric DEFAULT 0;

-- Add sold_at timestamp
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS sold_at timestamptz;

-- Update existing items that have a sold_by_employee_id to be marked as sold
UPDATE inventory_items 
SET status = 'sold' 
WHERE sold_by_employee_id IS NOT NULL AND status = 'available';
