'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { getActiveEmployees, type Employee } from '@/lib/api-services';
import {
  createTask,
  generateMissingInventoryTasks,
  getTasks,
  updateChecklistItem,
  updateTaskStatus,
  type InventoryTaskSource,
  type Task,
  type TaskStatus,
  type TaskType,
} from '@/lib/task-service';
import { Check, ClipboardList, Clock, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type TaskFilter = 'active' | 'completed' | 'approved' | 'all';

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'scan', label: 'Scan / Sort' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'testing', label: 'Testing' },
  { value: 'photographing', label: 'Photos / Notes' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'listing', label: 'Listing' },
  { value: 'whatnot_pull', label: 'Whatnot Pull' },
  { value: 'packing', label: 'Packing' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'custom', label: 'Custom' },
];

function statusStyle(status: TaskStatus) {
  switch (status) {
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'completed':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'blocked':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'cancelled':
      return 'border-white/10 bg-white/[0.03] text-white/35';
    default:
      return 'border-border/60 bg-secondary/30 text-muted-foreground';
  }
}

function priorityStyle(priority: string) {
  if (priority === 'urgent') return 'border-red-500/30 text-red-300 bg-red-500/10';
  if (priority === 'high') return 'border-amber-500/30 text-amber-300 bg-amber-500/10';
  return 'border-border/50 text-muted-foreground';
}

function TaskCard({
  task,
  employees,
  isAdmin,
  onChanged,
}: {
  task: Task;
  employees: Employee[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [assignee, setAssignee] = useState(task.assigned_employee_id || '__none__');
  const checklist = [...(task.task_checklist_items || [])].sort((a, b) => a.sort_order - b.sort_order);
  const doneCount = checklist.filter((item) => item.is_done).length;
  const allChecklistDone = checklist.length === 0 || doneCount === checklist.length;
  const canComplete = !['completed', 'approved', 'cancelled'].includes(task.status);

  const changeStatus = async (status: TaskStatus) => {
    setSaving(true);
    try {
      await updateTaskStatus(task, status, assignee === '__none__' ? null : assignee);
      toast.success(status === 'approved' ? 'Task approved' : 'Task updated');
      onChanged();
    } catch (error: any) {
      toast.error(error.message || 'Could not update task');
    } finally {
      setSaving(false);
    }
  };

  const handleChecklist = async (itemId: string, done: boolean) => {
    const item = checklist.find((row) => row.id === itemId);
    if (!item) return;
    setSaving(true);
    try {
      await updateChecklistItem(item, done, assignee === '__none__' ? null : assignee);
      onChanged();
    } catch (error: any) {
      toast.error(error.message || 'Could not update checklist');
    } finally {
      setSaving(false);
    }
  };

  const assign = async (employeeId: string) => {
    setAssignee(employeeId);
    setSaving(true);
    try {
      await updateTaskStatus(task, employeeId === '__none__' ? 'open' : 'assigned', employeeId === '__none__' ? null : employeeId);
      onChanged();
    } catch (error: any) {
      toast.error(error.message || 'Could not assign task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-[10px] uppercase ${statusStyle(task.status)}`}>{task.status.replace('_', ' ')}</Badge>
            <Badge variant="outline" className={`text-[10px] uppercase ${priorityStyle(task.priority)}`}>{task.priority}</Badge>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-white/90">{task.title}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            {task.inventory_items ? (
              <Link href={`/inventory/${task.inventory_item_id}`} className="hover:text-primary">
                {task.inventory_items.product_name} · {task.inventory_items.console} · {task.inventory_items.condition}
              </Link>
            ) : task.lots ? (
              <span>Lot: {task.lots.name}</span>
            ) : (
              <span>General work</span>
            )}
          </div>
          {task.description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{task.description}</p>}
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div className="flex items-center justify-end gap-1">
            <Clock className="h-3 w-3" />
            {task.estimated_minutes || 0}m
          </div>
          {task.created_at && <div className="mt-1">{format(new Date(task.created_at), 'MMM d')}</div>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Assigned To</div>
          <Select value={assignee} onValueChange={assign} disabled={saving || task.status === 'approved'}>
            <SelectTrigger className="h-9 bg-secondary/40">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="rounded-lg border border-border/30 bg-secondary/20 p-2 text-[11px] text-muted-foreground">
            Pay: {task.pay_type === 'hourly' ? `$${task.pay_rate}/hr` : task.pay_type === 'piece' ? `$${task.piece_rate}/task` : 'none'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Checklist</div>
            <div className="text-[11px] text-muted-foreground">{doneCount}/{checklist.length}</div>
          </div>
          {checklist.length === 0 ? (
            <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground">
              No checklist items.
            </div>
          ) : (
            <div className="space-y-1.5">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={saving || task.status === 'approved'}
                  onClick={() => handleChecklist(item.id, !item.is_done)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/25 bg-secondary/20 px-3 py-2 text-left text-xs hover:bg-secondary/35 disabled:opacity-60"
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${item.is_done ? 'border-primary bg-primary text-black' : 'border-white/15 text-white/30'}`}>
                    {item.is_done && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className={item.is_done ? 'text-white/70 line-through decoration-white/25' : 'text-muted-foreground'}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {task.status === 'open' || task.status === 'assigned' ? (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saving} onClick={() => changeStatus('in_progress')}>
            Start
          </Button>
        ) : null}
        {canComplete && (
          <Button size="sm" className="h-8 text-xs" disabled={saving || !allChecklistDone} onClick={() => changeStatus('completed')}>
            {saving ? 'Saving...' : allChecklistDone ? 'Complete' : 'Checklist Required'}
          </Button>
        )}
        {isAdmin && task.status === 'completed' && (
          <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => changeStatus('approved')}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { user, accountId, isAdmin } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryTaskSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    task_type: 'custom' as TaskType,
    priority: 'normal' as const,
    assigned_employee_id: '__none__',
    estimated_minutes: '10',
    piece_rate: '',
  });

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    setLoading(true);
    try {
      const taskStatus = filter === 'completed' ? 'completed' : filter === 'approved' ? 'approved' : filter;
      const [taskRows, employeeRows, inventoryRes] = await Promise.all([
        getTasks(taskStatus),
        getActiveEmployees(),
        supabase
          .from('inventory_items')
          .select('id, product_name, console, condition, status, sorted_at, cleaned_at, tested_at, notes_added_at, on_rack_at, listed_ebay_at, listed_amazon_at, listed_whatnot_at, sold_at, lot_id')
          .eq('user_id', accountId)
          .order('created_at', { ascending: false }),
      ]);

      if (inventoryRes.error) throw inventoryRes.error;
      setTasks(taskRows);
      setEmployees(employeeRows);
      setInventoryItems((inventoryRes.data || []) as InventoryTaskSource[]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [accountId, filter, user]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    return {
      active: tasks.filter((task) => ['open', 'assigned', 'in_progress', 'blocked'].includes(task.status)).length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      approved: tasks.filter((task) => task.status === 'approved').length,
    };
  }, [tasks]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const count = await generateMissingInventoryTasks(inventoryItems);
      toast.success(count === 0 ? 'No missing tasks found' : `Created ${count} task${count === 1 ? '' : 's'}`);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not generate tasks');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!draft.title.trim()) {
      toast.error('Task title is required');
      return;
    }
    try {
      await createTask({
        title: draft.title,
        description: draft.description,
        task_type: draft.task_type,
        priority: draft.priority,
        assigned_employee_id: draft.assigned_employee_id === '__none__' ? null : draft.assigned_employee_id,
        estimated_minutes: Number(draft.estimated_minutes) || 0,
        pay_type: draft.piece_rate ? 'piece' : 'none',
        piece_rate: Number(draft.piece_rate) || 0,
      });
      toast.success('Task created');
      setDraft({ title: '', description: '', task_type: 'custom', priority: 'normal', assigned_employee_id: '__none__', estimated_minutes: '10', piece_rate: '' });
      setShowCreate(false);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Could not create task');
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label-caps mb-1">Operations</div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white/90">
              <ClipboardList className="h-5 w-5 text-primary" />
              Tasks
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Assign, work, complete, and approve operational tasks from one queue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={handleGenerate} disabled={generating}>
              {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Generate from Inventory
            </Button>
            <Button size="sm" className="h-9" onClick={() => setShowCreate((open) => !open)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Task
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/40 bg-card p-4">
            <div className="text-xs text-muted-foreground">Active</div>
            <div className="mt-1 text-2xl font-bold">{stats.active}</div>
          </div>
          <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
            <div className="text-xs text-muted-foreground">Awaiting Approval</div>
            <div className="mt-1 text-2xl font-bold text-primary">{stats.completed}</div>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
            <div className="text-xs text-muted-foreground">Approved</div>
            <div className="mt-1 text-2xl font-bold text-emerald-300">{stats.approved}</div>
          </div>
        </div>

        {showCreate && (
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="space-y-1 lg:col-span-2">
                <div className="text-xs text-muted-foreground">Title</div>
                <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Type</div>
                <Select value={draft.task_type} onValueChange={(value) => setDraft({ ...draft, task_type: value as TaskType })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Assign</div>
                <Select value={draft.assigned_employee_id} onValueChange={(value) => setDraft({ ...draft, assigned_employee_id: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 lg:col-span-2">
                <div className="text-xs text-muted-foreground">Description</div>
                <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Minutes</div>
                <Input type="number" value={draft.estimated_minutes} onChange={(event) => setDraft({ ...draft, estimated_minutes: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Piece Rate</div>
                <Input type="number" step="0.01" value={draft.piece_rate} onChange={(event) => setDraft({ ...draft, piece_rate: event.target.value })} className="h-9" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate}>Create Task</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(['active', 'completed', 'approved', 'all'] as TaskFilter[]).map((tab) => (
            <Button
              key={tab}
              variant={filter === tab ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs capitalize"
              onClick={() => setFilter(tab)}
            >
              {tab}
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs text-muted-foreground" onClick={load}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card py-16 text-center">
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
            <h3 className="text-sm font-semibold">No tasks here yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate tasks from inventory or create a custom task.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                employees={employees}
                isAdmin={isAdmin}
                onChanged={load}
              />
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border/30 bg-white/[0.01] p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <UserRound className="h-3.5 w-3.5 text-primary" />
            <span>Tasks support employee assignment, checklist completion, time estimates, piece-rate pay, and admin approval.</span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
