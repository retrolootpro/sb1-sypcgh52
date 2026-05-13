/*
  # Harden Operations Planning Indexes

  Adds covering indexes for the new operations/planning foreign keys and pins
  the updated_at trigger helper search_path for Supabase advisor hygiene.
*/

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_shipment_id ON tasks(shipment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_show_list_id ON tasks(show_list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by_user_id ON tasks(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_by_employee_id ON tasks(completed_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_approved_by_user_id ON tasks(approved_by_user_id);
CREATE INDEX IF NOT EXISTS idx_task_checklist_user_id ON task_checklist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_task_checklist_completed_by_employee_id ON task_checklist_items(completed_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_user_id ON task_activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_actor_user_id ON task_activity_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_actor_employee_id ON task_activity_events(actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_user_id ON dispute_evidence_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_bundles_created_by_user_id ON inventory_bundles(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_bundle_items_user_id ON bundle_items(user_id);
CREATE INDEX IF NOT EXISTS idx_prebuy_lot_items_user_id ON prebuy_lot_items(user_id);
