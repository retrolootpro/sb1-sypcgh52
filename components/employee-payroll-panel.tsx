'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  calculateWorkLogAmount,
  createEmployeeInventorySpend,
  createEmployeePayout,
  createEmployeeWorkLog,
  getActiveEmployees,
  getEmployeePayrollSummaries,
  markEmployeePayoutPaid,
  type Employee,
  type EmployeeInventorySpend,
  type EmployeePayrollSummary,
  type EmployeeWorkLog,
} from '@/lib/api-services';
import { AlertTriangle, Banknote, BriefcaseBusiness, CalendarDays, DollarSign, ReceiptText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const today = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
};
const weekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  now.setDate(now.getDate() + mondayOffset);
  return now.toISOString().split('T')[0];
};
const weekEnd = () => {
  const start = new Date(`${weekStart()}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
};

export function EmployeePayrollPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<EmployeePayrollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(monthStart());
  const [periodStart, setPeriodStart] = useState(weekStart());
  const [periodEnd, setPeriodEnd] = useState(weekEnd());

  const [spendForm, setSpendForm] = useState<{
    amount: string;
    spend_date: string;
    vendor: string;
    item_summary: string;
    status: EmployeeInventorySpend['status'];
    notes: string;
  }>({
    amount: '',
    spend_date: today(),
    vendor: '',
    item_summary: '',
    status: 'approved' as const,
    notes: '',
  });

  const [workForm, setWorkForm] = useState<{
    work_date: string;
    work_type: EmployeeWorkLog['work_type'];
    description: string;
    minutes_worked: string;
    hourly_rate: string;
    sale_amount: string;
    commission_rate: string;
    additional_amount: string;
    notes: string;
  }>({
    work_date: today(),
    work_type: 'whatnot_moderation' as const,
    description: '',
    minutes_worked: '60',
    hourly_rate: '12',
    sale_amount: '',
    commission_rate: '0',
    additional_amount: '',
    notes: '',
  });

  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployeeId) || summaries[0];
  const selectedEmployee = selectedSummary?.employee || employees[0];
  const projectedWorkAmount = calculateWorkLogAmount({
    minutes_worked: Number(workForm.minutes_worked || 0),
    hourly_rate: Number(workForm.hourly_rate || 0),
    sale_amount: Number(workForm.sale_amount || 0),
    commission_rate: Number(workForm.commission_rate || 0),
    additional_amount: Number(workForm.additional_amount || 0),
  });

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, summary) => {
        acc.monthSpend += summary.monthSpend;
        acc.unpaidWork += summary.unpaidWorkTotal;
        acc.unpaidSpend += summary.unpaidSpendTotal;
        acc.weekPayout += summary.weeklyPayoutTotal;
        return acc;
      },
      { monthSpend: 0, unpaidWork: 0, unpaidSpend: 0, weekPayout: 0 }
    );
  }, [summaries]);

  const load = async () => {
    setLoading(true);
    try {
      const employeeData = await getActiveEmployees();
      setEmployees(employeeData);
      try {
        const summaryData = await getEmployeePayrollSummaries({ month: selectedMonth, weekStart: periodStart, weekEnd: periodEnd });
        setSummaries(summaryData);
      } catch (summaryError: any) {
        if (summaryError?.message?.includes('employee_inventory_spend') || summaryError?.message?.includes('employee_work_logs') || summaryError?.message?.includes('employee_payouts')) {
          setSummaries(employeeData.map((employee) => ({
            employee,
            monthSpend: 0,
            remainingAllowance: 500,
            unpaidWorkTotal: 0,
            unpaidSpendTotal: 0,
            weeklyPayoutTotal: 0,
            taxWatchMonthlyPayout: 0,
            workLogs: [],
            spend: [],
            payouts: [],
          })));
          toast.warning('Payroll tables are not ready yet. You can preview the panel, but saving will work after the database migration is applied.');
        } else {
          throw summaryError;
        }
      }
      if (!selectedEmployeeId && employeeData[0]) setSelectedEmployeeId(employeeData[0].id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load payroll data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, periodStart, periodEnd]);

  const requireEmployee = () => {
    const employeeId = selectedEmployee?.id;
    if (!employeeId) {
      toast.error('Add an active employee first');
      return null;
    }
    return employeeId;
  };

  const handleSpendSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const employeeId = requireEmployee();
    if (!employeeId) return;
    if (!spendForm.item_summary.trim()) return toast.error('Enter what was purchased');

    setSaving(true);
    try {
      await createEmployeeInventorySpend({
        employee_id: employeeId,
        amount: Number(spendForm.amount || 0),
        spend_date: spendForm.spend_date,
        allowance_month: selectedMonth,
        vendor: spendForm.vendor.trim(),
        item_summary: spendForm.item_summary.trim(),
        inventory_item_id: null,
        status: spendForm.status,
        notes: spendForm.notes.trim(),
      });
      toast.success('Employee spend recorded');
      setSpendForm({ amount: '', spend_date: today(), vendor: '', item_summary: '', status: 'approved', notes: '' });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save employee spend');
    } finally {
      setSaving(false);
    }
  };

  const handleWorkSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const employeeId = requireEmployee();
    if (!employeeId) return;
    if (!workForm.description.trim()) return toast.error('Enter a work description');

    setSaving(true);
    try {
      await createEmployeeWorkLog({
        employee_id: employeeId,
        work_date: workForm.work_date,
        work_type: workForm.work_type,
        description: workForm.description.trim(),
        show_id: null,
        ebay_listing_id: null,
        inventory_item_id: null,
        minutes_worked: Number(workForm.minutes_worked || 0),
        hourly_rate: Number(workForm.hourly_rate || 0),
        sale_amount: Number(workForm.sale_amount || 0),
        commission_rate: Number(workForm.commission_rate || 0),
        additional_amount: Number(workForm.additional_amount || 0),
        payout_status: 'unpaid',
        payout_id: null,
        notes: workForm.notes.trim(),
      });
      toast.success('Work log recorded');
      setWorkForm({
        work_date: today(),
        work_type: 'whatnot_moderation',
        description: '',
        minutes_worked: '60',
        hourly_rate: '12',
        sale_amount: '',
        commission_rate: '0',
        additional_amount: '',
        notes: '',
      });
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save work log');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePayout = async () => {
    const employeeId = requireEmployee();
    if (!employeeId || !selectedSummary) return;
    const workTotal = selectedSummary.unpaidWorkTotal;
    const spendTotal = selectedSummary.unpaidSpendTotal;
    const total = workTotal + spendTotal;
    if (total <= 0) return toast.error('No unpaid work or approved spend to pay out');

    setSaving(true);
    try {
      await createEmployeePayout({
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        work_total: workTotal,
        spend_total: spendTotal,
        total_amount: total,
        status: 'approved',
        paid_at: null,
        notes: 'Weekly payout generated from unpaid work and approved inventory spend.',
      });
      toast.success('Weekly payout created');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create payout');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (payoutId: string) => {
    setSaving(true);
    try {
      await markEmployeePayoutPaid(payoutId);
      toast.success('Payout marked paid');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to mark payout paid');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="rounded-2xl border border-border/40 bg-card p-5 text-xs text-muted-foreground">Loading payroll controls...</div>;
  }

  if (employees.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card p-5">
        <div className="text-sm font-semibold">Payroll</div>
        <p className="mt-1 text-xs text-muted-foreground">Add an active employee before tracking inventory spend, work logs, or weekly payouts.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/95 p-5 shadow-sm space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-base">Admin Payroll & Spend</h2>
            <Badge variant="outline" className="text-[10px] uppercase">Admin only</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Track employee inventory purchasing allowance, Whatnot moderation time, eBay commission, additional funds, and weekly payouts.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ReceiptText} label="Monthly employee spend" value={money(totals.monthSpend)} />
        <SummaryCard icon={BriefcaseBusiness} label="Unpaid work" value={money(totals.unpaidWork)} />
        <SummaryCard icon={DollarSign} label="Approved spend owed" value={money(totals.unpaidSpend)} />
        <SummaryCard icon={CalendarDays} label="Payouts this week" value={money(totals.weekPayout)} />
      </div>

      <div className="rounded-xl border border-border/40 bg-background/35 p-4">
        <div className="mb-4">
          <div className="text-sm font-semibold">Review Window</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the employee, allowance month, and payout week before adding spend or work.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={selectedEmployee?.id || ''} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Allowance month</Label>
            <Input type="date" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Week start</Label>
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label>Week end</Label>
              <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="h-9" />
            </div>
          </div>
        </div>
      </div>

      {selectedSummary && (
        <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-base font-semibold">{selectedSummary.employee.name}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {money(selectedSummary.monthSpend)} used of $500 monthly buying allowance. {money(selectedSummary.remainingAllowance)} remaining.
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[440px]">
              <MiniMetric label="Unpaid work" value={money(selectedSummary.unpaidWorkTotal)} />
              <MiniMetric label="Spend owed" value={money(selectedSummary.unpaidSpendTotal)} />
              <MiniMetric
                label="Month payouts"
                value={money(selectedSummary.taxWatchMonthlyPayout)}
                warning={selectedSummary.taxWatchMonthlyPayout >= 1000}
              />
            </div>
          </div>
          {selectedSummary.monthSpend > 500 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This employee is over the $500 company-cost inventory purchasing allowance for this month.
            </div>
          )}
          {selectedSummary.taxWatchMonthlyPayout >= 1000 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm leading-6 text-red-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This employee is at or above $1,000 in monthly payouts. Review tax/compliance handling before continuing.
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="spend" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-background/40 p-1 text-xs sm:grid-cols-3">
          <TabsTrigger value="spend" className="h-10 text-xs">Inventory Spend</TabsTrigger>
          <TabsTrigger value="work" className="h-10 text-xs">Work & Commission</TabsTrigger>
          <TabsTrigger value="payouts" className="h-10 text-xs">Weekly Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="spend" className="mt-0">
          <PanelSection
            title="Add Inventory Spend"
            description="Use this when an employee buys inventory at company cost or needs reimbursement approval."
          >
            <form onSubmit={handleSpendSubmit} className="grid gap-4 lg:grid-cols-5">
              <FormField label="Date"><Input type="date" value={spendForm.spend_date} onChange={(event) => setSpendForm({ ...spendForm, spend_date: event.target.value })} /></FormField>
              <FormField label="Amount"><Input type="number" min="0" step="0.01" value={spendForm.amount} onChange={(event) => setSpendForm({ ...spendForm, amount: event.target.value })} placeholder="0.00" /></FormField>
              <FormField label="Vendor"><Input value={spendForm.vendor} onChange={(event) => setSpendForm({ ...spendForm, vendor: event.target.value })} placeholder="Yard sale, GameStop..." /></FormField>
              <FormField label="Status">
                <Select value={spendForm.status} onValueChange={(value: 'pending' | 'approved' | 'reimbursed' | 'rejected') => setSpendForm({ ...spendForm, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="reimbursed">Reimbursed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <div className="lg:col-span-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                <FormField label="Items purchased"><Input value={spendForm.item_summary} onChange={(event) => setSpendForm({ ...spendForm, item_summary: event.target.value })} placeholder="3 Wii games, PS2 lot..." /></FormField>
                <FormField label="Notes"><Input value={spendForm.notes} onChange={(event) => setSpendForm({ ...spendForm, notes: event.target.value })} placeholder="Receipt, approval, condition..." /></FormField>
                <Button type="submit" className="self-end" disabled={saving}>Add Spend</Button>
              </div>
            </form>
          </PanelSection>
          <RecentList empty="No spend recorded for this month." rows={(selectedSummary?.spend || []).slice(0, 6).map((entry) => ({
            id: entry.id,
            title: entry.item_summary,
            meta: `${entry.spend_date} • ${entry.vendor || 'No vendor'} • ${entry.status}`,
            amount: money(entry.amount),
          }))} />
        </TabsContent>

        <TabsContent value="work" className="mt-0">
          <PanelSection
            title="Add Work or Commission"
            description="Track hourly work, eBay commission, and one-off additions in one place."
          >
            <form onSubmit={handleWorkSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <FormField label="Date"><Input type="date" value={workForm.work_date} onChange={(event) => setWorkForm({ ...workForm, work_date: event.target.value })} /></FormField>
                <FormField label="Type">
                  <Select value={workForm.work_type} onValueChange={(value: typeof workForm.work_type) => {
                    const isEbay = value === 'ebay_listing_commission';
                    setWorkForm({ ...workForm, work_type: value, hourly_rate: isEbay ? '0' : '12', commission_rate: isEbay ? '0.10' : '0' });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whatnot_moderation">Whatnot moderation</SelectItem>
                      <SelectItem value="ebay_listing_commission">eBay commission</SelectItem>
                      <SelectItem value="inventory_buying">Inventory buying</SelectItem>
                      <SelectItem value="shipping">Shipping</SelectItem>
                      <SelectItem value="prep">Prep</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="15-min increments"><Input type="number" min="0" step="15" value={workForm.minutes_worked} onChange={(event) => setWorkForm({ ...workForm, minutes_worked: event.target.value })} /></FormField>
                <FormField label="Hourly rate"><Input type="number" min="0" step="0.01" value={workForm.hourly_rate} onChange={(event) => setWorkForm({ ...workForm, hourly_rate: event.target.value })} /></FormField>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <FormField label="Sale amount"><Input type="number" min="0" step="0.01" value={workForm.sale_amount} onChange={(event) => setWorkForm({ ...workForm, sale_amount: event.target.value })} placeholder="eBay sale" /></FormField>
                <FormField label="Commission rate"><Input type="number" min="0" max="1" step="0.01" value={workForm.commission_rate} onChange={(event) => setWorkForm({ ...workForm, commission_rate: event.target.value })} placeholder="0.10" /></FormField>
                <FormField label="Additional funds"><Input type="number" min="0" step="0.01" value={workForm.additional_amount} onChange={(event) => setWorkForm({ ...workForm, additional_amount: event.target.value })} /></FormField>
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <div className="text-xs text-muted-foreground">Calculated pay</div>
                  <div className="mt-1 text-xl font-semibold">{money(projectedWorkAmount)}</div>
                </div>
              </div>
              <FormField label="Description"><Input value={workForm.description} onChange={(event) => setWorkForm({ ...workForm, description: event.target.value })} placeholder="Moderated Friday Whatnot show, listed item on eBay..." /></FormField>
              <FormField label="Notes"><Textarea value={workForm.notes} onChange={(event) => setWorkForm({ ...workForm, notes: event.target.value })} placeholder="Optional payout notes" /></FormField>
              <Button type="submit" disabled={saving}>Add Work Log</Button>
            </form>
          </PanelSection>
          <RecentList empty="No work logs yet." rows={(selectedSummary?.workLogs || []).slice(0, 6).map((entry) => ({
            id: entry.id,
            title: entry.description,
            meta: `${entry.work_date} • ${entry.work_type.replaceAll('_', ' ')} • ${entry.minutes_worked} min`,
            amount: money(calculateWorkLogAmount(entry)),
          }))} />
        </TabsContent>

        <TabsContent value="payouts" className="mt-0 space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-base font-semibold">Create weekly payout for {selectedEmployee?.name}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                Work {money(selectedSummary?.unpaidWorkTotal || 0)} + approved inventory spend {money(selectedSummary?.unpaidSpendTotal || 0)}
              </div>
            </div>
            <Button onClick={handleCreatePayout} disabled={saving}>Create Payout</Button>
          </div>
          <RecentList empty="No payouts yet." rows={(selectedSummary?.payouts || []).slice(0, 8).map((entry) => ({
            id: entry.id,
            title: `${entry.period_start} to ${entry.period_end}`,
            meta: `${entry.status} • work ${money(entry.work_total)} • spend ${money(entry.spend_total)}`,
            amount: money(entry.total_amount),
            action: entry.status !== 'paid' && entry.status !== 'cancelled'
              ? <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleMarkPaid(entry.id)} disabled={saving}>Mark Paid</Button>
              : undefined,
          }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/35 p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="text-xs leading-5 text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MiniMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warning ? 'border-amber-500/30 bg-amber-500/10' : 'border-border/40 bg-background/45'}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${warning ? 'text-amber-100' : ''}`}>{value}</div>
    </div>
  );
}

function PanelSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/35 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function RecentList({ rows, empty }: { rows: Array<{ id: string; title: string; meta: string; amount: string; action?: React.ReactNode }>; empty: string }) {
  if (rows.length === 0) {
    return <div className="mt-4 rounded-lg border border-dashed border-border/50 bg-background/20 p-5 text-sm text-muted-foreground">{empty}</div>;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border/40 bg-background/25">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-3 border-b border-border/35 p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{row.title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{row.meta}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-base font-semibold">{row.amount}</div>
            {row.action}
          </div>
        </div>
      ))}
    </div>
  );
}
