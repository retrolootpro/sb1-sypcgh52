/*
  Refine employee purchase approval and allowance accounting.

  The employee allowance uses item/company cost only. Shipping and tax are
  pass-through employee charges shown in the total due, but they do not consume
  the monthly allowance.
*/

ALTER TABLE employee_inventory_spend
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1);

ALTER TABLE employee_inventory_spend
  DROP CONSTRAINT IF EXISTS employee_inventory_spend_status_check;

ALTER TABLE employee_inventory_spend
  ADD CONSTRAINT employee_inventory_spend_status_check
  CHECK (status IN ('pending_admin', 'pending_employee', 'pending', 'approved', 'reimbursed', 'rejected'));

UPDATE employee_inventory_spend
SET amount = line_item_amount
WHERE line_item_amount > 0
  AND amount <> line_item_amount;

DROP POLICY IF EXISTS "Employees can create own inventory spend requests" ON employee_inventory_spend;
DROP POLICY IF EXISTS "Employees can approve own reviewed purchases" ON employee_inventory_spend;

CREATE POLICY "Employees can create own inventory spend requests"
  ON employee_inventory_spend
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status IN ('pending_admin', 'pending')
    AND EXISTS (
      SELECT 1
      FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
        AND lower(e.email) = lower(auth.email())
        AND e.is_active = true
    )
  );

CREATE POLICY "Employees can approve own reviewed purchases"
  ON employee_inventory_spend
  FOR UPDATE
  TO authenticated
  USING (
    status = 'pending_employee'
    AND EXISTS (
      SELECT 1
      FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
        AND lower(e.email) = lower(auth.email())
        AND e.is_active = true
    )
  )
  WITH CHECK (
    status IN ('approved', 'rejected')
    AND EXISTS (
      SELECT 1
      FROM employees e
      WHERE e.id = employee_inventory_spend.employee_id
        AND e.user_id = employee_inventory_spend.user_id
        AND lower(e.email) = lower(auth.email())
        AND e.is_active = true
    )
  );
