/*
  # Task Assignment System

  Creates a first-class work queue for RetroLootPro. Tasks can attach to
  inventory items, lots, inbound shipments, and shows. Each task can be assigned
  to an employee, tracked through completion, paid by time or piece-rate, and
  approved by an admin.
*/

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  task_type text NOT NULL CHECK (task_type IN (
    'scan',
    'cleaning',
    'testing',
    'photographing',
    'pricing',
    'listing',
    'whatnot_pull',
    'packing',
    'shipping',
    'follow_up',
    'custom'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'blocked', 'completed', 'approved', 'cancelled')),
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES lots(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES inbound_shipments(id) ON DELETE SET NULL,
  show_list_id uuid REFERENCES show_lists(id) ON DELETE SET NULL,
  assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  estimated_minutes integer DEFAULT 0 CHECK (estimated_minutes >= 0),
  actual_minutes integer DEFAULT 0 CHECK (actual_minutes >= 0),
  pay_type text NOT NULL DEFAULT 'none' CHECK (pay_type IN ('none', 'hourly', 'piece')),
  pay_rate numeric DEFAULT 0 CHECK (pay_rate >= 0),
  piece_rate numeric DEFAULT 0 CHECK (piece_rate >= 0),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  sort_order integer DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT task_must_attach_to_work CHECK (
    inventory_item_id IS NOT NULL
    OR lot_id IS NOT NULL
    OR shipment_id IS NOT NULL
    OR show_list_id IS NOT NULL
    OR task_type = 'custom'
  )
);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_done boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'created',
    'assigned',
    'started',
    'blocked',
    'checklist_updated',
    'completed',
    'approved',
    'cancelled',
    'comment'
  )),
  message text DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_employee ON tasks(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_inventory_item ON tasks(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lot ON tasks(lot_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist_items(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity_events(task_id, created_at DESC);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_checklist_items_updated_at ON task_checklist_items;
CREATE TRIGGER update_task_checklist_items_updated_at
  BEFORE UPDATE ON task_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF to_regproc('public.is_account_member') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Account members can read tasks" ON tasks;
    CREATE POLICY "Account members can read tasks"
      ON tasks FOR SELECT TO authenticated
      USING (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can insert tasks" ON tasks;
    CREATE POLICY "Account members can insert tasks"
      ON tasks FOR INSERT TO authenticated
      WITH CHECK (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can update tasks" ON tasks;
    CREATE POLICY "Account members can update tasks"
      ON tasks FOR UPDATE TO authenticated
      USING (public.is_account_member(user_id))
      WITH CHECK (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account admins can delete tasks" ON tasks;
    CREATE POLICY "Account admins can delete tasks"
      ON tasks FOR DELETE TO authenticated
      USING (public.is_account_admin(user_id));

    DROP POLICY IF EXISTS "Account members can read task_checklist_items" ON task_checklist_items;
    CREATE POLICY "Account members can read task_checklist_items"
      ON task_checklist_items FOR SELECT TO authenticated
      USING (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can insert task_checklist_items" ON task_checklist_items;
    CREATE POLICY "Account members can insert task_checklist_items"
      ON task_checklist_items FOR INSERT TO authenticated
      WITH CHECK (
        public.is_account_member(user_id)
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_checklist_items.task_id
            AND public.is_account_member(tasks.user_id)
        )
      );

    DROP POLICY IF EXISTS "Account members can update task_checklist_items" ON task_checklist_items;
    CREATE POLICY "Account members can update task_checklist_items"
      ON task_checklist_items FOR UPDATE TO authenticated
      USING (public.is_account_member(user_id))
      WITH CHECK (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account admins can delete task_checklist_items" ON task_checklist_items;
    CREATE POLICY "Account admins can delete task_checklist_items"
      ON task_checklist_items FOR DELETE TO authenticated
      USING (public.is_account_admin(user_id));

    DROP POLICY IF EXISTS "Account members can read task_activity_events" ON task_activity_events;
    CREATE POLICY "Account members can read task_activity_events"
      ON task_activity_events FOR SELECT TO authenticated
      USING (public.is_account_member(user_id));

    DROP POLICY IF EXISTS "Account members can insert task_activity_events" ON task_activity_events;
    CREATE POLICY "Account members can insert task_activity_events"
      ON task_activity_events FOR INSERT TO authenticated
      WITH CHECK (
        public.is_account_member(user_id)
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_activity_events.task_id
            AND public.is_account_member(tasks.user_id)
        )
      );
  ELSE
    DROP POLICY IF EXISTS "Users can view own tasks" ON tasks;
    CREATE POLICY "Users can view own tasks"
      ON tasks FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can insert own tasks" ON tasks;
    CREATE POLICY "Users can insert own tasks"
      ON tasks FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;
    CREATE POLICY "Users can update own tasks"
      ON tasks FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;
    CREATE POLICY "Users can delete own tasks"
      ON tasks FOR DELETE TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can view own task checklist" ON task_checklist_items;
    CREATE POLICY "Users can view own task checklist"
      ON task_checklist_items FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can manage own task checklist" ON task_checklist_items;
    CREATE POLICY "Users can manage own task checklist"
      ON task_checklist_items FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can view own task activity" ON task_activity_events;
    CREATE POLICY "Users can view own task activity"
      ON task_activity_events FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can insert own task activity" ON task_activity_events;
    CREATE POLICY "Users can insert own task activity"
      ON task_activity_events FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_account_memberships') IS NOT NULL THEN
    -- Keep the multi-account policy refresh migration's table list current.
    NULL;
  END IF;
END $$;
