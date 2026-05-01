/*
  # Employee Tracking and KPI Management

  1. New Tables
    - `employees`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `name` (text, employee name)
      - `email` (text, employee email)
      - `phone` (text, optional phone number)
      - `is_active` (boolean, whether employee is currently active)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `employee_goals`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, foreign key to employees)
      - `user_id` (uuid, owner of the employee/goal)
      - `goal_type` (text, type: 'items_scanned', 'revenue', 'items_sold')
      - `target_value` (numeric, the goal target)
      - `period` (text, 'daily', 'weekly', 'monthly')
      - `start_date` (date, when this goal period starts)
      - `end_date` (date, when this goal period ends)
      - `created_at` (timestamptz)

  2. Changes
    - Add `employee_id` to `inventory_items` table to track who added each item
    - Add `sold_by_employee_id` to `inventory_items` table to track who sold each item

  3. Security
    - Enable RLS on all new tables
    - Users can manage their own employees
    - Users can manage their own employee goals
*/

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create employee_goals table
CREATE TABLE IF NOT EXISTS employee_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_type text NOT NULL CHECK (goal_type IN ('items_scanned', 'revenue', 'items_sold')),
  target_value numeric NOT NULL CHECK (target_value > 0),
  period text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Add employee tracking to inventory_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'added_by_employee_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN added_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'sold_by_employee_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN sold_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_employee_goals_employee_id ON employee_goals(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_goals_dates ON employee_goals(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_inventory_items_added_by ON inventory_items(added_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sold_by ON inventory_items(sold_by_employee_id);

-- Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_goals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for employees table
CREATE POLICY "Users can view their own employees"
  ON employees FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own employees"
  ON employees FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for employee_goals table
CREATE POLICY "Users can view their own employee goals"
  ON employee_goals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own employee goals"
  ON employee_goals FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = employee_goals.employee_id
      AND employees.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own employee goals"
  ON employee_goals FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own employee goals"
  ON employee_goals FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_employees_updated_at ON employees;
CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();