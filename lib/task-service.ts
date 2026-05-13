import { supabase } from './supabase';
import { getActiveAccountId } from './account';

export type TaskType =
  | 'scan'
  | 'cleaning'
  | 'testing'
  | 'photographing'
  | 'pricing'
  | 'listing'
  | 'whatnot_pull'
  | 'packing'
  | 'shipping'
  | 'follow_up'
  | 'custom';

export type TaskStatus = 'open' | 'assigned' | 'in_progress' | 'blocked' | 'completed' | 'approved' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskPayType = 'none' | 'hourly' | 'piece';

export type TaskChecklistItem = {
  id: string;
  task_id: string;
  user_id: string;
  label: string;
  is_required: boolean;
  is_done: boolean;
  completed_at: string | null;
  completed_by_employee_id: string | null;
  sort_order: number;
};

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  inventory_item_id: string | null;
  lot_id: string | null;
  shipment_id: string | null;
  show_list_id: string | null;
  assigned_employee_id: string | null;
  created_by_user_id: string | null;
  completed_by_employee_id: string | null;
  approved_by_user_id: string | null;
  estimated_minutes: number;
  actual_minutes: number;
  pay_type: TaskPayType;
  pay_rate: number;
  piece_rate: number;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  inventory_items?: {
    product_name: string;
    console: string;
    condition: string;
    status: string | null;
  } | null;
  lots?: { name: string } | null;
  employees?: { name: string; email?: string | null } | null;
  task_checklist_items?: TaskChecklistItem[];
};

export type InventoryTaskSource = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  status: string | null;
  sorted_at: string | null;
  cleaned_at: string | null;
  tested_at: string | null;
  notes_added_at: string | null;
  on_rack_at: string | null;
  listed_ebay_at: string | null;
  listed_amazon_at: string | null;
  listed_whatnot_at: string | null;
  sold_at: string | null;
  lot_id: string | null;
};

export type TaskDraft = {
  title: string;
  description?: string;
  task_type: TaskType;
  priority?: TaskPriority;
  inventory_item_id?: string | null;
  lot_id?: string | null;
  shipment_id?: string | null;
  show_list_id?: string | null;
  assigned_employee_id?: string | null;
  estimated_minutes?: number;
  pay_type?: TaskPayType;
  pay_rate?: number;
  piece_rate?: number;
  due_at?: string | null;
  checklist?: string[];
};

const TASK_CHECKLISTS: Record<TaskType, string[]> = {
  scan: ['Scan UPC or enter title manually', 'Confirm platform/category', 'Confirm condition', 'Attach to lot if applicable'],
  cleaning: ['Remove stickers/residue', 'Clean case/cart/disc/book cover', 'Check for damage', 'Update notes if condition changed'],
  testing: ['Boot or open item check', 'Verify gameplay/readability', 'Record defects or as-is status', 'Add testing note'],
  photographing: ['Front photo', 'Back photo', 'Condition detail photo', 'Proof/testing photo if applicable'],
  pricing: ['Refresh market price', 'Review condition-specific price', 'Set ask/floor plan', 'Flag low-confidence pricing'],
  listing: ['Generate title/description', 'Confirm photos', 'Set price/floor', 'Publish or save draft'],
  whatnot_pull: ['Pull item from storage', 'Set run order', 'Set start/floor/BIN', 'Add show notes'],
  packing: ['Confirm sold platform/order', 'Pack safely', 'Photograph package', 'Record weight/dimensions'],
  shipping: ['Buy/print label', 'Add tracking number', 'Mark shipped', 'Store receipt/insurance'],
  follow_up: ['Check delivery or buyer status', 'Resolve open messages', 'Record outcome'],
  custom: ['Complete assigned work', 'Add notes if needed'],
};

function eventMessage(status: TaskStatus) {
  switch (status) {
    case 'open': return 'Task reopened';
    case 'assigned': return 'Task assigned';
    case 'in_progress': return 'Task started';
    case 'blocked': return 'Task blocked';
    case 'completed': return 'Task completed';
    case 'approved': return 'Task approved';
    case 'cancelled': return 'Task cancelled';
    default: return 'Task updated';
  }
}

function statusToEventType(status: TaskStatus) {
  if (status === 'open') return 'comment';
  if (status === 'in_progress') return 'started';
  return status;
}

async function getSessionContext() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);
  return { session, accountId };
}

export function defaultChecklistForTaskType(taskType: TaskType) {
  return TASK_CHECKLISTS[taskType] || TASK_CHECKLISTS.custom;
}

export function getSuggestedTaskDrafts(item: InventoryTaskSource): TaskDraft[] {
  const sold = item.status === 'sold' || Boolean(item.sold_at);
  const listed = Boolean(item.listed_ebay_at || item.listed_amazon_at || item.listed_whatnot_at);
  const base = {
    inventory_item_id: item.id,
    lot_id: item.lot_id,
  };

  if (sold) {
    return [
      {
        ...base,
        title: `Pack and ship ${item.product_name}`,
        task_type: 'shipping',
        priority: 'high',
        estimated_minutes: 12,
      },
      {
        ...base,
        title: `Follow up on ${item.product_name}`,
        task_type: 'follow_up',
        priority: 'normal',
        estimated_minutes: 5,
      },
    ];
  }

  if (!item.sorted_at) return [{ ...base, title: `Sort ${item.product_name}`, task_type: 'scan', estimated_minutes: 4 }];
  if (!item.cleaned_at) return [{ ...base, title: `Clean ${item.product_name}`, task_type: 'cleaning', estimated_minutes: 8 }];
  if (!item.tested_at) return [{ ...base, title: `Test ${item.product_name}`, task_type: 'testing', estimated_minutes: 10 }];
  if (!item.notes_added_at) return [{ ...base, title: `Photograph and note ${item.product_name}`, task_type: 'photographing', estimated_minutes: 8 }];
  if (!item.on_rack_at) return [{ ...base, title: `Price and rack ${item.product_name}`, task_type: 'pricing', estimated_minutes: 5 }];
  if (!listed) return [{ ...base, title: `List ${item.product_name}`, task_type: 'listing', priority: 'high', estimated_minutes: 12 }];

  return [{ ...base, title: `Monitor ${item.product_name}`, task_type: 'follow_up', estimated_minutes: 5 }];
}

export async function getTasks(status?: TaskStatus | 'active' | 'all'): Promise<Task[]> {
  const { accountId } = await getSessionContext();
  let query = supabase
    .from('tasks')
    .select(`
      *,
      inventory_items ( product_name, console, condition, status ),
      lots ( name ),
      employees ( name, email ),
      task_checklist_items ( id, task_id, user_id, label, is_required, is_done, completed_at, completed_by_employee_id, sort_order )
    `)
    .eq('user_id', accountId)
    .order('priority', { ascending: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (status && status !== 'all') {
    if (status === 'active') {
      query = query.in('status', ['open', 'assigned', 'in_progress', 'blocked']);
    } else {
      query = query.eq('status', status);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Task[];
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const { session, accountId } = await getSessionContext();
  const { checklist, ...taskFields } = draft;

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      ...taskFields,
      title: draft.title.trim(),
      description: draft.description?.trim() || '',
      priority: draft.priority || 'normal',
      estimated_minutes: draft.estimated_minutes || 0,
      pay_type: draft.pay_type || 'none',
      pay_rate: draft.pay_rate || 0,
      piece_rate: draft.piece_rate || 0,
      user_id: accountId,
      created_by_user_id: session.user.id,
      status: draft.assigned_employee_id ? 'assigned' : 'open',
    })
    .select('*')
    .single();

  if (error) throw error;

  const checklistLabels = checklist && checklist.length > 0 ? checklist : defaultChecklistForTaskType(draft.task_type);
  if (checklistLabels.length > 0) {
    const { error: checklistError } = await supabase.from('task_checklist_items').insert(
      checklistLabels.map((label, index) => ({
        task_id: task.id,
        user_id: accountId,
        label,
        sort_order: index,
      }))
    );
    if (checklistError) throw checklistError;
  }

  await supabase.from('task_activity_events').insert({
    task_id: task.id,
    user_id: accountId,
    actor_user_id: session.user.id,
    event_type: 'created',
    message: 'Task created',
  });

  return task as Task;
}

export async function updateTaskStatus(task: Task, status: TaskStatus, employeeId?: string | null): Promise<void> {
  const { session, accountId } = await getSessionContext();
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status };

  if (status === 'assigned' && employeeId !== undefined) updates.assigned_employee_id = employeeId;
  if (status === 'in_progress' && !task.started_at) updates.started_at = now;
  if (status === 'completed') {
    updates.completed_at = now;
    if (employeeId) updates.completed_by_employee_id = employeeId;
  }
  if (status === 'approved') {
    updates.approved_at = now;
    updates.approved_by_user_id = session.user.id;
  }
  if (status === 'cancelled') updates.cancelled_at = now;

  const { error } = await supabase.from('tasks').update(updates).eq('id', task.id);
  if (error) throw error;

  await supabase.from('task_activity_events').insert({
    task_id: task.id,
    user_id: accountId,
    actor_user_id: session.user.id,
    actor_employee_id: employeeId || null,
    event_type: statusToEventType(status),
    message: eventMessage(status),
  });
}

export async function updateChecklistItem(item: TaskChecklistItem, isDone: boolean, employeeId?: string | null): Promise<void> {
  const { accountId } = await getSessionContext();
  const { error } = await supabase
    .from('task_checklist_items')
    .update({
      is_done: isDone,
      completed_at: isDone ? new Date().toISOString() : null,
      completed_by_employee_id: isDone ? employeeId || null : null,
    })
    .eq('id', item.id);

  if (error) throw error;

  await supabase.from('task_activity_events').insert({
    task_id: item.task_id,
    user_id: accountId,
    actor_employee_id: employeeId || null,
    event_type: 'checklist_updated',
    message: `${isDone ? 'Completed' : 'Reopened'} checklist item: ${item.label}`,
  });
}

export async function generateMissingInventoryTasks(items: InventoryTaskSource[]): Promise<number> {
  const { accountId } = await getSessionContext();
  const { data: existing, error } = await supabase
    .from('tasks')
    .select('inventory_item_id, task_type, status')
    .eq('user_id', accountId)
    .in('status', ['open', 'assigned', 'in_progress', 'blocked']);

  if (error) throw error;

  const existingKeys = new Set((existing || []).map((task) => `${task.inventory_item_id}:${task.task_type}`));
  const drafts = items.flatMap(getSuggestedTaskDrafts).filter((draft) => {
    if (!draft.inventory_item_id) return true;
    return !existingKeys.has(`${draft.inventory_item_id}:${draft.task_type}`);
  });

  for (const draft of drafts) {
    await createTask(draft);
  }

  return drafts.length;
}
