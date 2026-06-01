/*
  Extend employee inventory spend into an employee purchase ledger.

  Employee inventory purchases are deducted from payroll instead of added to
  payouts. Shipping and tax are tracked separately so admin can see the true
  amount owed by the employee.
*/

ALTER TABLE employee_inventory_spend
  ADD COLUMN IF NOT EXISTS line_item_amount numeric NOT NULL DEFAULT 0 CHECK (line_item_amount >= 0),
  ADD COLUMN IF NOT EXISTS shipping_amount numeric NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  ADD COLUMN IF NOT EXISTS fulfillment_method text NOT NULL DEFAULT 'pickup' CHECK (fulfillment_method IN ('pickup', 'shipping')),
  ADD COLUMN IF NOT EXISTS purchase_type text NOT NULL DEFAULT 'manual' CHECK (purchase_type IN ('manual', 'inventory_cart'));

UPDATE employee_inventory_spend
SET line_item_amount = amount
WHERE line_item_amount = 0
  AND amount > 0;

CREATE INDEX IF NOT EXISTS idx_employee_inventory_spend_inventory_item
  ON employee_inventory_spend(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

DROP POLICY IF EXISTS "Account admins can manage employee inventory spend" ON employee_inventory_spend;
DROP POLICY IF EXISTS "Employees can read own inventory spend" ON employee_inventory_spend;
DROP POLICY IF EXISTS "Employees can create own inventory spend requests" ON employee_inventory_spend;

CREATE POLICY "Account admins can manage employee inventory spend"
  ON employee_inventory_spend
  FOR ALL
  TO authenticated
  USING (public.is_account_admin(user_id))
  WITH CHECK (
    public.is_account_admin(user_id)
    AND EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
    )
  );

CREATE POLICY "Employees can read own inventory spend"
  ON employee_inventory_spend
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
        AND lower(e.email) = lower(auth.email())
        AND e.is_active = true
    )
  );

CREATE POLICY "Employees can create own inventory spend requests"
  ON employee_inventory_spend
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
        AND lower(e.email) = lower(auth.email())
        AND e.is_active = true
    )
  );
