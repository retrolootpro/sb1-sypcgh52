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
  calculateEmployeePurchaseAmount,
  calculateEmployeePurchaseTotal,
  calculateWorkLogAmount,
  createEmployeeCartPurchase,
  createEmployeeInventorySpend,
  createEmployeePayout,
  createEmployeeWorkLog,
  getActiveEmployees,
  getCurrentEmployeeProfile,
  getEmployeePayrollSummaries,
  getEmployeePurchasableInventory,
  approveEmployeePurchaseLine,
  markEmployeePayoutPaid,
  updateEmployeePurchaseLine,
  type Employee,
  type EmployeePurchasableInventoryItem,
  type EmployeeInventorySpend,
  type EmployeePayrollSummary,
  type EmployeeWorkLog,
} from '@/lib/api-services';
import { AlertTriangle, Banknote, BriefcaseBusiness, CalendarDays, DollarSign, Package, ReceiptText, RefreshCw, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const today = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
};

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function currentBiWeeklyWindow() {
  const anchor = new Date('2024-01-01T00:00:00');
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((todayLocal.getTime() - anchor.getTime()) / 86400000);
  const biWeekOffset = Math.floor(diffDays / 14) * 14;
  const startDate = new Date(anchor);
  startDate.setDate(anchor.getDate() + biWeekOffset);
  const start = startDate.toISOString().split('T')[0];
  const end = addDays(start, 13);

  return { start, end };
}

type CartItem = EmployeePurchasableInventoryItem & { cartPrice: number };

export function EmployeePayrollPanel({ isAdmin = true }: { isAdmin?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<EmployeePayrollSummary[]>([]);
  const [inventoryItems, setInventoryItems] = useState<EmployeePurchasableInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(monthStart());
  const [periodStart, setPeriodStart] = useState(() => currentBiWeeklyWindow().start);
  const [periodEnd, setPeriodEnd] = useState(() => currentBiWeeklyWindow().end);
  const [inventorySearch, setInventorySearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<'pickup' | 'shipping'>('pickup');
  const [shippingCharge, setShippingCharge] = useState('');
  const [taxRate, setTaxRate] = useState('7');
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { shipping: string; taxRate: string }>>({});
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [showAllWorkLogs, setShowAllWorkLogs] = useState(false);

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
  const cartSubtotal = cart.reduce((sum, item) => sum + Number(item.cartPrice || 0), 0);
  const cartShipping = Number(shippingCharge || 0);
  const cartTaxRate = Math.max(0, Number(taxRate || 0)) / 100;
  const cartTax = cartSubtotal * cartTaxRate;
  const cartTotal = cartSubtotal + cartShipping + cartTax;
  const filteredInventoryItems = inventoryItems
    .filter((item) => !cart.some((cartItem) => cartItem.id === item.id))
    .filter((item) => {
      const search = inventorySearch.trim().toLowerCase();
      if (!search) return true;
      return `${item.title} ${item.platform || ''} ${item.condition || ''}`.toLowerCase().includes(search);
    })
    .slice(0, 24);
  const selectedSpendRows = selectedSummary?.spend || [];
  const visibleSpendRows = showAllTransactions ? selectedSpendRows : selectedSpendRows.slice(0, 6);
  const selectedWorkRows = selectedSummary?.workLogs || [];
  const visibleWorkRows = showAllWorkLogs ? selectedWorkRows : selectedWorkRows.slice(0, 12);

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, summary) => {
        acc.monthSpend += summary.monthSpend;
        acc.monthPurchaseTotal += summary.monthPurchaseTotal;
        acc.unpaidWork += summary.unpaidWorkTotal;
        acc.unpaidSpend += summary.unpaidSpendTotal;
        acc.biWeeklyPayout += summary.biWeeklyPayoutTotal;
        return acc;
      },
      { monthSpend: 0, monthPurchaseTotal: 0, unpaidWork: 0, unpaidSpend: 0, biWeeklyPayout: 0 }
    );
  }, [summaries]);

  const load = async () => {
    setLoading(true);
    try {
      const currentEmployee = isAdmin ? null : await getCurrentEmployeeProfile();
      const employeeData = isAdmin
        ? await getActiveEmployees()
        : (currentEmployee ? [currentEmployee] : []);
      setEmployees(employeeData);
      setInventoryItems(await getEmployeePurchasableInventory());
      try {
        const summaryData = await getEmployeePayrollSummaries({ month: selectedMonth, periodStart, periodEnd });
        setSummaries(isAdmin ? summaryData : summaryData.filter((summary) => summary.employee.id === employeeData[0]?.id));
      } catch (summaryError: any) {
        if (summaryError?.message?.includes('employee_inventory_spend') || summaryError?.message?.includes('employee_work_logs') || summaryError?.message?.includes('employee_payouts')) {
          setSummaries(employeeData.map((employee) => ({
            employee,
            monthSpend: 0,
            monthPurchaseTotal: 0,
            remainingAllowance: 500,
            unpaidWorkTotal: 0,
            unpaidSpendTotal: 0,
            biWeeklyPayoutTotal: 0,
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
        line_item_amount: Number(spendForm.amount || 0),
        shipping_amount: 0,
        tax_amount: 0,
        tax_rate: 0,
        fulfillment_method: 'pickup',
        purchase_type: 'manual',
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

  const getInventoryCompanyCost = (item: EmployeePurchasableInventoryItem) => {
    return Number(item.purchase_price || item.selected_market_value || item.sell_price || 0);
  };

  const handleAddToCart = (item: EmployeePurchasableInventoryItem) => {
    setCart((current) => [...current, { ...item, cartPrice: getInventoryCompanyCost(item) }]);
  };

  const handleCheckout = async () => {
    const employeeId = requireEmployee();
    if (!employeeId) return;
    if (cart.length === 0) return toast.error('Add at least one inventory item to the cart');

    setSaving(true);
    try {
      const lineTotal = cartSubtotal || cart.length;
      await createEmployeeCartPurchase({
        employee_id: employeeId,
        spend_date: today(),
        allowance_month: selectedMonth,
        status: isAdmin ? 'pending_employee' : 'pending_admin',
        lines: cart.map((item) => {
          const ratio = cartSubtotal > 0 ? Number(item.cartPrice || 0) / lineTotal : 1 / cart.length;
          const shipping = fulfillmentMethod === 'shipping' ? cartShipping * ratio : 0;
          const tax = cartTax * ratio;
          return {
            inventory_item_id: item.id,
            item_summary: `${item.title}${item.platform ? ` (${item.platform})` : ''}`,
            line_item_amount: Number(item.cartPrice || 0),
            shipping_amount: shipping,
            tax_amount: tax,
            tax_rate: cartTaxRate,
            fulfillment_method: fulfillmentMethod,
            notes: isAdmin
              ? 'Admin reviewed employee purchase. Awaiting employee final approval.'
              : 'Employee inventory purchase request. Awaiting admin shipping review.',
          };
        }),
      });
      toast.success(isAdmin ? 'Purchase sent for employee final approval' : 'Purchase request sent for admin review');
      setCart([]);
      setShippingCharge('');
      setInventorySearch('');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add employee purchase');
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
    const total = Math.max(0, workTotal - spendTotal);
    if (workTotal <= 0 && spendTotal <= 0) return toast.error('No unpaid work or approved employee purchases to settle');

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
        notes: 'Bi-weekly payout generated from unpaid work minus approved employee inventory purchases.',
      });
      toast.success('Bi-weekly payout created');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create payout');
    } finally {
      setSaving(false);
    }
  };

  const handleSendPurchaseForApproval = async (entry: EmployeeInventorySpend) => {
    const draft = reviewDrafts[entry.id] || {};
    const shipping = Number(draft.shipping ?? entry.shipping_amount ?? 0);
    const defaultTaxRate = Number(entry.tax_rate || 0) > 0 ? Number(entry.tax_rate || 0) * 100 : Number(taxRate || 0);
    const rate = Math.max(0, Number(draft.taxRate ?? defaultTaxRate)) / 100;
    const itemAmount = calculateEmployeePurchaseAmount(entry);

    setSaving(true);
    try {
      await updateEmployeePurchaseLine({
        id: entry.id,
        shipping_amount: shipping,
        tax_rate: rate,
        tax_amount: itemAmount * rate,
        status: 'pending_employee',
        notes: 'Admin reviewed shipping and tax. Awaiting employee final approval.',
      });
      toast.success('Purchase sent back for employee approval');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update purchase');
    } finally {
      setSaving(false);
    }
  };

  const handleApprovePurchase = async (entry: EmployeeInventorySpend) => {
    setSaving(true);
    try {
      await approveEmployeePurchaseLine(entry);
      toast.success('Purchase approved and added to employee spend');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve purchase');
    } finally {
      setSaving(false);
    }
  };

  const handleRejectPurchase = async (entry: EmployeeInventorySpend) => {
    setSaving(true);
    try {
      await updateEmployeePurchaseLine({ id: entry.id, status: 'rejected', notes: 'Employee purchase rejected.' });
      toast.success('Purchase rejected');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject purchase');
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
        <p className="mt-1 text-xs text-muted-foreground">Add an active employee before tracking inventory spend, work logs, or bi-weekly payouts.</p>
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
            Track employee inventory purchasing allowance, Whatnot moderation time, eBay commission, additional funds, and bi-weekly payouts.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon={ReceiptText} label="Allowance used" value={money(totals.monthSpend)} />
        <SummaryCard icon={ShoppingCart} label="Employee total due" value={money(totals.monthPurchaseTotal)} />
        <SummaryCard icon={BriefcaseBusiness} label="Unpaid work" value={money(totals.unpaidWork)} />
        <SummaryCard icon={DollarSign} label="Approved allowance deductions" value={money(totals.unpaidSpend)} />
        <SummaryCard icon={CalendarDays} label="Payouts this period" value={money(totals.biWeeklyPayout)} />
      </div>

      <div className="rounded-xl border border-border/40 bg-background/35 p-4">
        <div className="mb-4">
          <div className="text-sm font-semibold">Review Window</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the employee, allowance month, and bi-weekly payout window before adding spend or work.</p>
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
              <Label>Period start</Label>
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label>Period end</Label>
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
                {money(selectedSummary.monthSpend)} used of $500 monthly item-cost allowance. {money(selectedSummary.remainingAllowance)} remaining. Employee total due with tax/shipping is {money(selectedSummary.monthPurchaseTotal)}.
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[440px]">
              <MiniMetric label="Unpaid work" value={money(selectedSummary.unpaidWorkTotal)} />
              <MiniMetric label="Purchase deductions" value={money(selectedSummary.unpaidSpendTotal)} />
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
              This employee is over the $500 company-cost inventory purchase allowance for this month.
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
          <TabsTrigger value="spend" className="h-10 text-xs">Employee Store</TabsTrigger>
          <TabsTrigger value="work" className="h-10 text-xs">Work & Commission</TabsTrigger>
          <TabsTrigger value="payouts" className="h-10 text-xs">Bi-Weekly Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="spend" className="mt-0">
          <PanelSection
            title="Add Inventory Spend"
            description="Use this when an employee buys company inventory. These purchases are deducted from payouts."
          >
            <div className="mb-5 rounded-xl border border-border/40 bg-card/60 p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                    Inventory Purchase Cart
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Browse available inventory and submit a cart for approval. Tax is calculated automatically; shipping can be added after admin review.</p>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{money(cartTotal)}</div>
                  <div className="text-xs text-muted-foreground">Allowance {money(cartSubtotal)}</div>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search inventory by title, platform, or condition..." />
                  </div>
                  <div className="max-h-72 overflow-auto rounded-lg border border-border/40">
                    {filteredInventoryItems.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">No available inventory matches this search.</div>
                    ) : filteredInventoryItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 border-b border-border/35 p-3 last:border-b-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-background/50">
                          {item.thumbnail_url || item.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail_url || item.image_url || ''} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Package className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.title}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{item.platform || 'No platform'} • {item.condition || 'No condition'} • Cost {money(getInventoryCompanyCost(item))}</div>
                        </div>
                        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAddToCart(item)}>Add</Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/40 bg-background/35">
                    {cart.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">Cart is empty.</div>
                    ) : cart.map((item) => (
                      <div key={item.id} className="grid gap-2 border-b border-border/35 p-3 last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.title}</div>
                            <div className="text-xs text-muted-foreground">{item.platform || 'No platform'}</div>
                          </div>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCart((current) => current.filter((cartItem) => cartItem.id !== item.id))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Input type="number" min="0" step="0.01" value={item.cartPrice} onChange={(event) => setCart((current) => current.map((cartItem) => cartItem.id === item.id ? { ...cartItem, cartPrice: Number(event.target.value || 0) } : cartItem))} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Fulfillment">
                      <Select value={fulfillmentMethod} onValueChange={(value: 'pickup' | 'shipping') => setFulfillmentMethod(value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pickup">Pickup</SelectItem>
                          <SelectItem value="shipping">Ship to employee</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Shipping">
                      <Input type="number" min="0" step="0.01" value={shippingCharge} onChange={(event) => setShippingCharge(event.target.value)} disabled={fulfillmentMethod === 'pickup'} placeholder="0.00" />
                    </FormField>
                    <FormField label="Tax rate %">
                      <Input type="number" min="0" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} placeholder="7.00" />
                    </FormField>
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                      <div className="text-xs text-muted-foreground">Employee total due</div>
                      <div className="mt-1 text-lg font-semibold">{money(cartTotal)}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Allowance: {money(cartSubtotal)} • Tax: {money(cartTax)}</div>
                    </div>
                  </div>
                  <Button type="button" className="w-full" disabled={saving || cart.length === 0} onClick={handleCheckout}>
                    Submit Cart for Approval
                  </Button>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="mt-5 border-t border-border/40 pt-5">
                <div className="mb-3">
                  <div className="text-sm font-semibold">Manual Employee Purchase Entry</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Use this for an item that is not already in inventory or for a correction.</p>
                </div>
                <form onSubmit={handleSpendSubmit} className="grid gap-4 lg:grid-cols-5">
                  <FormField label="Date"><Input type="date" value={spendForm.spend_date} onChange={(event) => setSpendForm({ ...spendForm, spend_date: event.target.value })} /></FormField>
                  <FormField label="Amount"><Input type="number" min="0" step="0.01" value={spendForm.amount} onChange={(event) => setSpendForm({ ...spendForm, amount: event.target.value })} placeholder="0.00" /></FormField>
                  <FormField label="Vendor"><Input value={spendForm.vendor} onChange={(event) => setSpendForm({ ...spendForm, vendor: event.target.value })} placeholder="RetroLootPro, correction..." /></FormField>
                  <FormField label="Status">
                    <Select value={spendForm.status} onValueChange={(value: 'pending' | 'approved' | 'reimbursed' | 'rejected') => setSpendForm({ ...spendForm, status: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="reimbursed">Settled</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <div className="lg:col-span-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                    <FormField label="Items purchased"><Input value={spendForm.item_summary} onChange={(event) => setSpendForm({ ...spendForm, item_summary: event.target.value })} placeholder="3 Wii games, PS2 lot..." /></FormField>
                    <FormField label="Notes"><Input value={spendForm.notes} onChange={(event) => setSpendForm({ ...spendForm, notes: event.target.value })} placeholder="Receipt, approval, condition..." /></FormField>
                    <Button type="submit" className="self-end" disabled={saving}>Add Manual Purchase</Button>
                  </div>
                </form>
              </div>
            )}
          </PanelSection>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Monthly Transactions</div>
              <p className="mt-1 text-xs text-muted-foreground">Allowance spend excludes tax and shipping. Total due includes all employee-paid charges.</p>
            </div>
            {selectedSpendRows.length > 6 && (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowAllTransactions((value) => !value)}>
                {showAllTransactions ? 'Show Recent' : `Show All ${selectedSpendRows.length}`}
              </Button>
            )}
          </div>
          <RecentList empty="No employee purchases recorded for this month." rows={visibleSpendRows.map((entry) => {
            const draft = reviewDrafts[entry.id] || {
              shipping: String(Number(entry.shipping_amount || 0)),
              taxRate: String(Number(entry.tax_rate || 0) * 100 || Number(taxRate || 0)),
            };
            const draftShipping = Number(draft.shipping || 0);
            const draftTaxRate = Math.max(0, Number(draft.taxRate || 0)) / 100;
            const draftTax = calculateEmployeePurchaseAmount(entry) * draftTaxRate;
            const reviewControls = isAdmin && (entry.status === 'pending_admin' || entry.status === 'pending') ? (
              <div className="grid gap-2 sm:grid-cols-[90px_80px_auto]">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-8 text-xs"
                  value={draft.shipping}
                  onChange={(event) => setReviewDrafts((current) => ({ ...current, [entry.id]: { ...draft, shipping: event.target.value } }))}
                  placeholder="Ship"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-8 text-xs"
                  value={draft.taxRate}
                  onChange={(event) => setReviewDrafts((current) => ({ ...current, [entry.id]: { ...draft, taxRate: event.target.value } }))}
                  placeholder="Tax %"
                />
                <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => handleSendPurchaseForApproval(entry)}>
                  Send Final
                </Button>
              </div>
            ) : null;
            const employeeControls = !isAdmin && entry.status === 'pending_employee' ? (
              <div className="flex gap-2">
                <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => handleApprovePurchase(entry)}>Approve</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saving} onClick={() => handleRejectPurchase(entry)}>Reject</Button>
              </div>
            ) : null;
            return {
              id: entry.id,
              title: entry.item_summary,
              meta: `${entry.spend_date} • ${entry.vendor || 'No vendor'} • ${entry.status.replaceAll('_', ' ')}${entry.fulfillment_method ? ` • ${entry.fulfillment_method}` : ''}`,
              amount: `Allowance ${money(calculateEmployeePurchaseAmount(entry))}`,
              detail: `Total due ${money(calculateEmployeePurchaseTotal({ ...entry, shipping_amount: reviewControls ? draftShipping : entry.shipping_amount, tax_amount: reviewControls ? draftTax : entry.tax_amount }))} • tax ${money(reviewControls ? draftTax : Number(entry.tax_amount || 0))} • shipping ${money(reviewControls ? draftShipping : Number(entry.shipping_amount || 0))}`,
              action: reviewControls || employeeControls || undefined,
            };
          })} />
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
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Showing {visibleWorkRows.length} of {selectedWorkRows.length} work logs for this payout period.
            </div>
            {selectedWorkRows.length > 12 && (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowAllWorkLogs((current) => !current)}>
                {showAllWorkLogs ? 'Show fewer' : 'Show all work logs'}
              </Button>
            )}
          </div>
          <RecentList empty="No work logs yet for this payout period." rows={visibleWorkRows.map((entry) => ({
            id: entry.id,
            title: entry.description,
            meta: `${entry.work_date} • ${entry.work_type.replaceAll('_', ' ')} • ${entry.minutes_worked} min • ${entry.payout_status}`,
            amount: money(calculateWorkLogAmount(entry)),
          }))} />
        </TabsContent>

        <TabsContent value="payouts" className="mt-0 space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-base font-semibold">Create bi-weekly payout for {selectedEmployee?.name}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                Work {money(selectedSummary?.unpaidWorkTotal || 0)} - employee purchases {money(selectedSummary?.unpaidSpendTotal || 0)} = payout {money(Math.max(0, (selectedSummary?.unpaidWorkTotal || 0) - (selectedSummary?.unpaidSpendTotal || 0)))}
              </div>
            </div>
            <Button onClick={handleCreatePayout} disabled={saving}>Create Payout</Button>
          </div>
          <RecentList empty="No payouts yet." rows={(selectedSummary?.payouts || []).slice(0, 8).map((entry) => ({
            id: entry.id,
            title: `${entry.period_start} to ${entry.period_end}`,
            meta: `${entry.status} • work ${money(entry.work_total)} • purchases deducted ${money(entry.spend_total)}`,
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

function RecentList({ rows, empty }: { rows: Array<{ id: string; title: string; meta: string; amount: string; detail?: string; action?: React.ReactNode }>; empty: string }) {
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
            {row.detail && <div className="mt-1 text-xs leading-5 text-muted-foreground">{row.detail}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <div className="text-base font-semibold">{row.amount}</div>
            {row.action}
          </div>
        </div>
      ))}
    </div>
  );
}
