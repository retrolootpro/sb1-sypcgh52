import { supabase } from './supabase';
import { getPricingData } from './pricing-service';
import { getActiveAccountId } from './account';

export interface UPCLookupResult {
  barcode: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

export interface PriceChartingResult {
  productName: string;
  console: string;
  loosePrice: number;
  cibPrice: number;
  newPrice: number;
  genre?: string;
}

export async function lookupUPC(barcode: string, userId: string, titleHint?: string): Promise<UPCLookupResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session. Please log in again.');
  }

  if (!barcode || barcode.trim().length === 0) {
    throw new Error('Invalid barcode');
  }

  const cleanBarcode = barcode.trim();
  const requestBody = { barcode: cleanBarcode, titleHint: titleHint?.trim() || undefined };
  let routeErrorMessage = '';

  try {
    const response = await fetch('/api/local-upc-lookup', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const routeData = await response.json().catch(() => null);
    if (response.ok && routeData?.success !== false) {
      return {
        barcode: cleanBarcode,
        title: routeData.title,
        description: routeData.description,
        brand: routeData.brand,
        category: routeData.category,
        imageUrl: routeData.imageUrl,
        thumbnailUrl: routeData.thumbnailUrl,
      };
    }

    routeErrorMessage = routeData?.message || routeData?.error || `UPC lookup route failed (${response.status})`;
  } catch (routeError) {
    routeErrorMessage = routeError instanceof Error ? routeError.message : 'UPC lookup route failed';
  }

  if (routeErrorMessage.includes('API key not configured')) {
    throw new Error('API key not configured. Please add a PriceCharting, Barcode Lookup, or UPCitemDB API key in Settings.');
  }

  if (routeErrorMessage.includes('not found')) {
    throw new Error(`Product not found for barcode ${barcode}. This barcode may not exist in the lookup databases.`);
  }

  if (routeErrorMessage.includes('Authentication failed')) {
    throw new Error('Authentication failed. Please try logging out and back in.');
  }

  throw new Error(routeErrorMessage || 'UPC lookup failed. Please try again.');
}

/**
 * @deprecated Use getPricingData from '@/lib/pricing-service' instead
 */
export async function getPricing(productName: string, platform: string, userId: string): Promise<PriceChartingResult | null> {
  if (!productName || productName.trim().length === 0) return null;

  const result = await getPricingData(productName, platform, userId, true);
  if (result.status !== 'success' || !result.data) return null;

  return {
    productName: result.data.productName,
    console: result.data.console,
    loosePrice: result.data.loosePrice,
    cibPrice: result.data.cibPrice,
    newPrice: result.data.newPrice,
    genre: result.data.genre,
  };
}

export async function getEbayComps(productName: string, platform: string, userId: string): Promise<any[]> {
  return [];
}

export interface Employee {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeeGoal {
  id: string;
  employee_id: string;
  user_id: string;
  goal_type: 'items_scanned' | 'revenue' | 'items_sold';
  target_value: number;
  period: 'daily' | 'weekly' | 'monthly';
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface EmployeePerformance {
  employee: Employee;
  goals: EmployeeGoal[];
  metrics: {
    items_scanned: number;
    items_sold: number;
    revenue: number;
  };
}

export async function getEmployees(): Promise<Employee[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function getActiveEmployees(): Promise<Employee[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function createEmployee(employee: Omit<Employee, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Employee> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employees')
    .insert({
      ...employee,
      user_id: await getActiveAccountId(session.user),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .eq('user_id', await getActiveAccountId(session.user))
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEmployee(id: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('id', id)
    .eq('user_id', await getActiveAccountId(session.user));

  if (error) throw error;
}

export async function getEmployeeGoals(employeeId: string): Promise<EmployeeGoal[]> {
  const { data, error } = await supabase
    .from('employee_goals')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getCurrentGoals(employeeId: string): Promise<EmployeeGoal[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('employee_goals')
    .select('*')
    .eq('employee_id', employeeId)
    .lte('start_date', today)
    .gte('end_date', today);

  if (error) throw error;
  return data || [];
}

export async function createEmployeeGoal(goal: Omit<EmployeeGoal, 'id' | 'user_id' | 'created_at'>): Promise<EmployeeGoal> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employee_goals')
    .insert({
      ...goal,
      user_id: await getActiveAccountId(session.user),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEmployeeGoal(id: string, updates: Partial<EmployeeGoal>): Promise<EmployeeGoal> {
  const { data, error } = await supabase
    .from('employee_goals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEmployeeGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from('employee_goals')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getEmployeePerformance(employeeId: string, startDate?: string, endDate?: string): Promise<{
  items_scanned: number;
  items_sold: number;
  revenue: number;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let query = supabase
    .from('inventory_items')
    .select('status, purchase_price, sell_price, added_by_employee_id, sold_by_employee_id, created_at')
    .eq('user_id', await getActiveAccountId(session.user));

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data, error } = await query;

  if (error) throw error;

  const items = data || [];

  const itemsScanned = items.filter(item => item.added_by_employee_id === employeeId).length;
  const itemsSold = items.filter(item => item.sold_by_employee_id === employeeId && item.status === 'sold').length;
  const revenue = items
    .filter(item => item.sold_by_employee_id === employeeId && item.status === 'sold')
    .reduce((sum, item) => sum + (item.sell_price || 0), 0);

  return {
    items_scanned: itemsScanned,
    items_sold: itemsSold,
    revenue: revenue,
  };
}

export async function getAllEmployeesPerformance(startDate?: string, endDate?: string): Promise<EmployeePerformance[]> {
  const employees = await getActiveEmployees();

  const performancePromises = employees.map(async (employee) => {
    const [metrics, goals] = await Promise.all([
      getEmployeePerformance(employee.id, startDate, endDate),
      getCurrentGoals(employee.id),
    ]);

    return {
      employee,
      goals,
      metrics,
    };
  });

  return Promise.all(performancePromises);
}

export interface EmployeeInventorySpend {
  id: string;
  user_id: string;
  employee_id: string;
  spend_date: string;
  amount: number;
  line_item_amount?: number;
  shipping_amount?: number;
  tax_amount?: number;
  tax_rate?: number;
  fulfillment_method?: 'pickup' | 'shipping';
  purchase_type?: 'manual' | 'inventory_cart';
  allowance_month: string;
  vendor?: string;
  item_summary: string;
  inventory_item_id?: string | null;
  status: 'pending_admin' | 'pending_employee' | 'pending' | 'approved' | 'reimbursed' | 'rejected';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeWorkLog {
  id: string;
  user_id: string;
  employee_id: string;
  work_date: string;
  work_type: 'whatnot_moderation' | 'ebay_listing_commission' | 'inventory_buying' | 'shipping' | 'prep' | 'other';
  description: string;
  show_id?: string | null;
  ebay_listing_id?: string | null;
  inventory_item_id?: string | null;
  minutes_worked: number;
  hourly_rate: number;
  sale_amount: number;
  commission_rate: number;
  additional_amount: number;
  payout_status: 'unpaid' | 'approved' | 'paid' | 'void';
  payout_id?: string | null;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeePayout {
  id: string;
  user_id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  work_total: number;
  spend_total: number;
  total_amount: number;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  paid_at?: string | null;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeePayrollSummary {
  employee: Employee;
  monthSpend: number;
  monthPurchaseTotal: number;
  remainingAllowance: number;
  unpaidWorkTotal: number;
  unpaidSpendTotal: number;
  weeklyPayoutTotal: number;
  taxWatchMonthlyPayout: number;
  workLogs: EmployeeWorkLog[];
  spend: EmployeeInventorySpend[];
  payouts: EmployeePayout[];
}

export interface EmployeePurchasableInventoryItem {
  id: string;
  title: string;
  platform?: string | null;
  condition?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  purchase_price?: number | null;
  selected_market_value?: number | null;
  sell_price?: number | null;
  status: string;
}

export interface EmployeeCartPurchaseLine {
  inventory_item_id: string;
  item_summary: string;
  line_item_amount: number;
  shipping_amount: number;
  tax_amount: number;
  tax_rate?: number;
  fulfillment_method: 'pickup' | 'shipping';
  notes?: string;
}

export function calculateWorkLogAmount(log: Pick<EmployeeWorkLog, 'minutes_worked' | 'hourly_rate' | 'sale_amount' | 'commission_rate' | 'additional_amount'>) {
  const hourly = (Number(log.minutes_worked) / 60) * Number(log.hourly_rate || 0);
  const commission = Number(log.sale_amount || 0) * Number(log.commission_rate || 0);
  return hourly + commission + Number(log.additional_amount || 0);
}

export function calculateEmployeePurchaseAmount(entry: Pick<EmployeeInventorySpend, 'amount' | 'line_item_amount' | 'shipping_amount' | 'tax_amount'>) {
  return Number(entry.line_item_amount || entry.amount || 0);
}

export function calculateEmployeePurchaseTotal(entry: Pick<EmployeeInventorySpend, 'amount' | 'line_item_amount' | 'shipping_amount' | 'tax_amount'>) {
  return calculateEmployeePurchaseAmount(entry) + Number(entry.shipping_amount || 0) + Number(entry.tax_amount || 0);
}

function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
}

function nextDay(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

export async function getEmployeePayrollSummaries(options?: { weekStart?: string; weekEnd?: string; month?: string }): Promise<EmployeePayrollSummary[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const accountId = await getActiveAccountId(session.user);
  const employees = await getActiveEmployees();
  const selectedMonth = options?.month || monthStart();
  const weekStart = options?.weekStart;
  const weekEnd = options?.weekEnd;
  const weekEndExclusive = weekEnd ? nextDay(weekEnd) : undefined;
  const monthEnd = nextDay(new Date(new Date(`${selectedMonth}T00:00:00`).getFullYear(), new Date(`${selectedMonth}T00:00:00`).getMonth() + 1, 0).toISOString().split('T')[0]);

  const [{ data: spendData, error: spendError }, { data: workData, error: workError }, { data: payoutData, error: payoutError }] = await Promise.all([
    supabase
      .from('employee_inventory_spend')
      .select('*')
      .eq('user_id', accountId)
      .gte('spend_date', selectedMonth)
      .lt('spend_date', monthEnd)
      .order('spend_date', { ascending: false }),
    supabase
      .from('employee_work_logs')
      .select('*')
      .eq('user_id', accountId)
      .order('work_date', { ascending: false })
      .limit(250),
    supabase
      .from('employee_payouts')
      .select('*')
      .eq('user_id', accountId)
      .order('period_start', { ascending: false })
      .limit(100),
  ]);

  if (spendError) throw spendError;
  if (workError) throw workError;
  if (payoutError) throw payoutError;

  const spend = (spendData || []) as EmployeeInventorySpend[];
  const workLogs = (workData || []) as EmployeeWorkLog[];
  const payouts = (payoutData || []) as EmployeePayout[];

  return employees.map((employee) => {
    const employeeSpend = spend.filter((entry) => entry.employee_id === employee.id);
    const employeeWork = workLogs.filter((entry) => entry.employee_id === employee.id);
    const employeePayouts = payouts.filter((entry) => entry.employee_id === employee.id);
    const monthSpend = employeeSpend
      .filter((entry) => entry.status !== 'rejected')
      .reduce((sum, entry) => sum + calculateEmployeePurchaseAmount(entry), 0);
    const monthPurchaseTotal = employeeSpend
      .filter((entry) => entry.status !== 'rejected')
      .reduce((sum, entry) => sum + calculateEmployeePurchaseTotal(entry), 0);
    const unpaidWorkTotal = employeeWork
      .filter((entry) => entry.payout_status === 'unpaid' || entry.payout_status === 'approved')
      .reduce((sum, entry) => sum + calculateWorkLogAmount(entry), 0);
    const unpaidSpendTotal = employeeSpend
      .filter((entry) => entry.status === 'approved')
      .reduce((sum, entry) => sum + calculateEmployeePurchaseAmount(entry), 0);
    const weeklyPayoutTotal = employeePayouts
      .filter((payout) => {
        if (!weekStart || !weekEndExclusive) return true;
        return payout.period_start >= weekStart && payout.period_start < weekEndExclusive;
      })
      .filter((payout) => payout.status !== 'cancelled')
      .reduce((sum, payout) => sum + Number(payout.total_amount || 0), 0);
    const taxWatchMonthlyPayout = employeePayouts
      .filter((payout) => payout.status !== 'cancelled' && payout.period_start >= selectedMonth && payout.period_start < monthEnd)
      .reduce((sum, payout) => sum + Number(payout.total_amount || 0), 0);

    return {
      employee,
      monthSpend,
      monthPurchaseTotal,
      remainingAllowance: Math.max(0, 500 - monthSpend),
      unpaidWorkTotal,
      unpaidSpendTotal,
      weeklyPayoutTotal,
      taxWatchMonthlyPayout,
      workLogs: employeeWork,
      spend: employeeSpend,
      payouts: employeePayouts,
    };
  });
}

export async function createEmployeeInventorySpend(input: Omit<EmployeeInventorySpend, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<EmployeeInventorySpend> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('employee_inventory_spend')
    .insert({ ...input, user_id: accountId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getCurrentEmployeeProfile(): Promise<Employee | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);
  const email = session.user.email;
  if (!email) return null;

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', accountId)
    .ilike('email', email)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data as Employee | null;
}

export async function getEmployeePurchasableInventory(): Promise<EmployeePurchasableInventoryItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, condition, image_url, thumbnail_url, purchase_price, selected_market_value, sell_price, status')
    .eq('user_id', await getActiveAccountId(session.user))
    .in('status', ['available', 'ready_to_list', 'listed'])
    .order('product_name', { ascending: true })
    .limit(300);

  if (error) throw error;
  return (data || []) as EmployeePurchasableInventoryItem[];
}

export async function createEmployeeCartPurchase(input: {
  employee_id: string;
  spend_date: string;
  allowance_month: string;
  status: EmployeeInventorySpend['status'];
  lines: EmployeeCartPurchaseLine[];
}): Promise<EmployeeInventorySpend[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const rows = input.lines.map((line) => {
    const amount = Number(line.line_item_amount || 0);
    return {
      user_id: accountId,
      employee_id: input.employee_id,
      spend_date: input.spend_date,
      allowance_month: input.allowance_month,
      amount,
      line_item_amount: Number(line.line_item_amount || 0),
      shipping_amount: Number(line.shipping_amount || 0),
      tax_amount: Number(line.tax_amount || 0),
      tax_rate: Number(line.tax_rate || 0),
      fulfillment_method: line.fulfillment_method,
      purchase_type: 'inventory_cart',
      vendor: 'RetroLootPro Inventory',
      item_summary: line.item_summary,
      inventory_item_id: line.inventory_item_id,
      status: input.status,
      notes: line.notes || '',
    };
  });

  const { data, error } = await supabase
    .from('employee_inventory_spend')
    .insert(rows)
    .select();

  if (error) throw error;

  if (input.status === 'approved') {
    await Promise.all(input.lines.map(async (line) => {
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          status: 'sold',
          sell_price: Number(line.line_item_amount || 0),
          sold_at: new Date().toISOString(),
          sold_by_employee_id: input.employee_id,
        })
        .eq('id', line.inventory_item_id)
        .eq('user_id', accountId);
      if (updateError) throw updateError;
    }));
  }

  return (data || []) as EmployeeInventorySpend[];
}

export async function updateEmployeePurchaseLine(input: {
  id: string;
  shipping_amount?: number;
  tax_amount?: number;
  tax_rate?: number;
  status?: EmployeeInventorySpend['status'];
  notes?: string;
}): Promise<EmployeeInventorySpend> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employee_inventory_spend')
    .update({
      shipping_amount: input.shipping_amount,
      tax_amount: input.tax_amount,
      tax_rate: input.tax_rate,
      status: input.status,
      notes: input.notes,
    })
    .eq('id', input.id)
    .select()
    .single();

  if (error) throw error;
  return data as EmployeeInventorySpend;
}

export async function approveEmployeePurchaseLine(entry: EmployeeInventorySpend): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { error } = await supabase
    .from('employee_inventory_spend')
    .update({ status: 'approved' })
    .eq('id', entry.id);
  if (error) throw error;

  if (entry.inventory_item_id) {
    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({
        status: 'sold',
        sell_price: calculateEmployeePurchaseAmount(entry),
        sold_at: new Date().toISOString(),
        sold_by_employee_id: entry.employee_id,
      })
      .eq('id', entry.inventory_item_id)
      .eq('user_id', accountId);
    if (updateError) throw updateError;
  }
}

export async function createEmployeeWorkLog(input: Omit<EmployeeWorkLog, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<EmployeeWorkLog> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('employee_work_logs')
    .insert({ ...input, user_id: accountId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createEmployeePayout(input: Omit<EmployeePayout, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<EmployeePayout> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('employee_payouts')
    .insert({ ...input, user_id: accountId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function markEmployeePayoutPaid(payoutId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);
  const paidAt = new Date().toISOString();

  const { data: payout, error: payoutFetchError } = await supabase
    .from('employee_payouts')
    .select('id, employee_id, period_start, period_end, total_amount, notes')
    .eq('id', payoutId)
    .eq('user_id', accountId)
    .single();

  if (payoutFetchError) throw payoutFetchError;

  const { data: employee } = await supabase
    .from('employees')
    .select('name')
    .eq('id', payout.employee_id)
    .eq('user_id', accountId)
    .maybeSingle();

  const { error } = await supabase
    .from('employee_payouts')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('id', payoutId);

  if (error) throw error;

  const referenceId = `employee_payout:${payoutId}`;
  const transactionPayload = {
    user_id: accountId,
    date: paidAt.slice(0, 10),
    description: `Employee payout - ${employee?.name || 'Team member'}`,
    amount: -Math.abs(Number(payout.total_amount || 0)),
    type: 'expense',
    category: 'Payroll',
    subcategory: 'Employee payout',
    source: 'manual',
    platform: 'RetroLootPro',
    reference_id: referenceId,
    merchant_name: employee?.name || null,
    notes: `Payroll period ${payout.period_start} to ${payout.period_end}. ${payout.notes || ''}`.trim(),
    is_reconciled: false,
    updated_at: paidAt,
  };

  const { data: existingTx, error: existingError } = await supabase
    .from('financial_transactions')
    .select('id')
    .eq('user_id', accountId)
    .eq('reference_id', referenceId)
    .maybeSingle();

  if (existingError) throw existingError;

  const txWrite = existingTx?.id
    ? await supabase.from('financial_transactions').update(transactionPayload).eq('id', existingTx.id)
    : await supabase.from('financial_transactions').insert(transactionPayload);

  if (txWrite.error) throw txWrite.error;
}

export interface EbayListing {
  id: string;
  user_id: string;
  item_id: string;
  employee_id?: string;
  listing_url: string;
  listing_id: string;
  listed_price: number;
  status: 'draft' | 'active' | 'sold' | 'ended' | 'cancelled';
  listed_at?: string;
  sold_at?: string;
  created_at: string;
}

export async function createEbayListing(listing: Omit<EbayListing, 'id' | 'user_id' | 'created_at'>): Promise<EbayListing> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ebay_listings')
    .insert({
      ...listing,
      user_id: await getActiveAccountId(session.user),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getEbayListingsByEmployee(employeeId: string, startDate?: string, endDate?: string): Promise<EbayListing[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let query = supabase
    .from('ebay_listings')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function updateEbayListing(id: string, updates: Partial<EbayListing>): Promise<EbayListing> {
  const { data, error } = await supabase
    .from('ebay_listings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export interface ShowList {
  id: string;
  user_id: string;
  name: string;
  show_date?: string;
  managed_by_employee_id?: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export async function getShowsByEmployee(employeeId: string, startDate?: string, endDate?: string): Promise<ShowList[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let query = supabase
    .from('show_lists')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('managed_by_employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function updateShowList(id: string, updates: Partial<ShowList>): Promise<ShowList> {
  const { data, error } = await supabase
    .from('show_lists')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export interface EnhancedEmployeePerformance extends EmployeePerformance {
  shows_managed: number;
  ebay_listings: number;
  ebay_sales: number;
}

export async function getEnhancedEmployeePerformance(employeeId: string, startDate?: string, endDate?: string): Promise<EnhancedEmployeePerformance> {
  const [baseMetrics, goals, shows, ebayListings] = await Promise.all([
    getEmployeePerformance(employeeId, startDate, endDate),
    getCurrentGoals(employeeId),
    getShowsByEmployee(employeeId, startDate, endDate),
    getEbayListingsByEmployee(employeeId, startDate, endDate),
  ]);

  const employee = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single();

  if (employee.error) throw employee.error;

  const ebay_sales = ebayListings.filter(listing => listing.status === 'sold').length;

  return {
    employee: employee.data,
    goals,
    metrics: baseMetrics,
    shows_managed: shows.length,
    ebay_listings: ebayListings.length,
    ebay_sales,
  };
}

export async function getAllEnhancedEmployeePerformances(startDate?: string, endDate?: string): Promise<EnhancedEmployeePerformance[]> {
  const employees = await getActiveEmployees();

  const performancePromises = employees.map(employee =>
    getEnhancedEmployeePerformance(employee.id, startDate, endDate)
  );

  return Promise.all(performancePromises);
}

export async function getEmployeeById(employeeId: string): Promise<Employee | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('user_id', await getActiveAccountId(session.user))
    .maybeSingle();

  if (error) throw error;
  return data;
}

export interface AmazonListing {
  id: string;
  user_id: string;
  item_id: string;
  employee_id?: string;
  listing_url: string;
  asin: string;
  listed_price: number;
  status: 'draft' | 'active' | 'sold' | 'ended' | 'cancelled';
  listed_at?: string;
  sold_at?: string;
  created_at: string;
}

export async function createAmazonListing(listing: Omit<AmazonListing, 'id' | 'user_id' | 'created_at'>): Promise<AmazonListing> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('amazon_listings')
    .insert({ ...listing, user_id: await getActiveAccountId(session.user) })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getAmazonListingsByEmployee(employeeId: string): Promise<AmazonListing[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('amazon_listings')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function updateAmazonListing(id: string, updates: Partial<AmazonListing>): Promise<AmazonListing> {
  const { data, error } = await supabase
    .from('amazon_listings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAmazonListing(id: string): Promise<void> {
  const { error } = await supabase
    .from('amazon_listings')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export interface InventoryItemShipping {
  id: string;
  title: string;
  platform?: string;
  sell_price?: number;
  purchase_price?: number;
  status: string;
  shipping_status?: string;
  shipped_at?: string;
  tracking_number?: string;
  shipping_carrier?: string;
  sold_by_employee_id?: string;
  added_by_employee_id?: string;
  sold_via?: string;
  marketplace_order_id?: string;
  created_at: string;
  updated_at: string;
}

export async function getItemsToShipByEmployee(employeeId: string): Promise<InventoryItemShipping[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, sell_price, purchase_price, status, shipping_status, shipped_at, tracking_number, shipping_carrier, sold_by_employee_id, added_by_employee_id, sold_via, marketplace_order_id, created_at, updated_at')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('sold_by_employee_id', employeeId)
    .eq('status', 'sold')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getReceivedItemsByEmployee(employeeId: string): Promise<InventoryItemShipping[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, sell_price, purchase_price, status, shipping_status, shipped_at, tracking_number, shipping_carrier, sold_by_employee_id, added_by_employee_id, sold_via, marketplace_order_id, created_at, updated_at')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('added_by_employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

export async function markItemShipped(itemId: string, carrier: string, trackingNumber: string): Promise<void> {
  const { error } = await supabase
    .from('inventory_items')
    .update({
      shipping_status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipping_carrier: carrier,
      tracking_number: trackingNumber,
    })
    .eq('id', itemId);

  if (error) throw error;
}

export async function markItemShippingPending(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('inventory_items')
    .update({ shipping_status: 'pending' })
    .eq('id', itemId);

  if (error) throw error;
}

export interface EbayListingWithItem extends EbayListing {
  inventory_items?: { title: string; platform?: string };
}

export async function getEbayListingsWithItemsByEmployee(employeeId: string): Promise<EbayListingWithItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ebay_listings')
    .select('*, inventory_items(title:product_name, platform:console)')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export interface AmazonListingWithItem extends AmazonListing {
  inventory_items?: { title: string; platform?: string };
}

export async function getAmazonListingsWithItemsByEmployee(employeeId: string): Promise<AmazonListingWithItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('amazon_listings')
    .select('*, inventory_items(title:product_name, platform:console)')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getShowListsAll(): Promise<ShowList[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('show_lists')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createShowList(show: { name: string; show_date?: string; managed_by_employee_id?: string }): Promise<ShowList> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('show_lists')
    .insert({ ...show, user_id: await getActiveAccountId(session.user), status: 'draft' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getInventoryItemsForListing(): Promise<{ id: string; title: string; platform?: string; status: string }[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, status')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('status', 'available')
    .order('product_name');

  if (error) throw error;
  return data || [];
}

export interface OutboundOrder {
  id: string;
  title: string;
  platform?: string;
  sell_price?: number;
  purchase_price?: number;
  status: string;
  shipping_status?: string;
  shipped_at?: string;
  tracking_number?: string;
  shipping_carrier?: string;
  sold_via?: string;
  marketplace_order_id?: string;
  sold_by_employee_id?: string;
  sold_at?: string;
  created_at: string;
  updated_at: string;
}

export async function getOutboundOrders(soldViaFilter?: string): Promise<OutboundOrder[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let query = supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, sell_price, purchase_price, status, shipping_status, shipped_at, tracking_number, shipping_carrier, sold_via, marketplace_order_id, sold_by_employee_id, sold_at, created_at, updated_at')
    .eq('user_id', await getActiveAccountId(session.user))
    .eq('status', 'sold')
    .order('updated_at', { ascending: false });

  if (soldViaFilter) {
    query = query.eq('sold_via', soldViaFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateItemSoldVia(itemId: string, soldVia: string, marketplaceOrderId?: string): Promise<void> {
  const { error } = await supabase
    .from('inventory_items')
    .update({ sold_via: soldVia, marketplace_order_id: marketplaceOrderId || null })
    .eq('id', itemId);

  if (error) throw error;
}

export interface InboundShipment {
  id: string;
  user_id: string;
  title: string;
  source: string;
  notes?: string;
  tracking_number?: string;
  carrier?: string;
  expected_date?: string;
  status: string;
  received_at?: string;
  lot_id?: string | null;
  total_paid?: number | null;
  created_at: string;
  updated_at: string;
}

export async function getInboundShipments(): Promise<InboundShipment[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inbound_shipments')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createInboundShipment(shipment: Omit<InboundShipment, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<InboundShipment> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('inbound_shipments')
    .insert({ ...shipment, user_id: await getActiveAccountId(session.user) })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateInboundShipment(id: string, updates: Partial<InboundShipment>): Promise<void> {
  const { error } = await supabase
    .from('inbound_shipments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function markInboundReceived(id: string, totalPaid: number): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  if (!Number.isFinite(totalPaid) || totalPaid <= 0) throw new Error('Enter the total paid before receiving this shipment');

  const accountId = await getActiveAccountId(session.user);
  const { data: shipment, error: shipmentError } = await supabase
    .from('inbound_shipments')
    .select('*')
    .eq('id', id)
    .eq('user_id', accountId)
    .single();
  if (shipmentError) throw shipmentError;
  if (!shipment) throw new Error('Shipment not found');
  if (shipment.lot_id) {
    const { error } = await supabase
      .from('inbound_shipments')
      .update({ status: 'received', received_at: shipment.received_at || new Date().toISOString(), total_paid: totalPaid, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', accountId);
    if (error) throw error;
    return shipment.lot_id;
  }

  const now = new Date().toISOString();
  const { data: lot, error: lotError } = await supabase
    .from('lots')
    .insert({
      user_id: accountId,
      name: shipment.title || 'Received shipment',
      source: shipment.source || '',
      notes: shipment.notes || '',
      received_at: now,
      shipment_id: id,
      total_paid: totalPaid,
      allocation_status: 'pending',
      updated_at: now,
    })
    .select('id')
    .single();
  if (lotError) throw lotError;

  const { error } = await supabase
    .from('inbound_shipments')
    .update({ status: 'received', received_at: now, lot_id: lot.id, total_paid: totalPaid, updated_at: now })
    .eq('id', id)
    .eq('user_id', accountId);

  if (error) throw error;
  return lot.id;
}

export async function deleteInboundShipment(id: string): Promise<void> {
  const { error } = await supabase
    .from('inbound_shipments')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export interface PlatformOrder {
  id: string;
  user_id: string;
  platform: string;
  platform_order_id: string;
  buyer_username?: string;
  item_title: string;
  item_sku?: string;
  quantity: number;
  sale_price?: number;
  shipping_cost?: number;
  shipping_address?: Record<string, string>;
  order_status: string;
  shipping_status: string;
  tracking_number?: string;
  shipping_carrier?: string;
  shipped_at?: string;
  order_created_at?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export async function getPlatformOrders(platform?: string): Promise<PlatformOrder[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let query = supabase
    .from('platform_orders')
    .select('*')
    .eq('user_id', await getActiveAccountId(session.user))
    .order('order_created_at', { ascending: false });

  if (platform) {
    query = query.eq('platform', platform);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function markPlatformOrderShipped(id: string, carrier: string, trackingNumber: string): Promise<void> {
  const { error } = await supabase
    .from('platform_orders')
    .update({
      shipping_status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipping_carrier: carrier,
      tracking_number: trackingNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function syncEbayOrders(): Promise<{ imported: number; skipped: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('ebay-sync-orders', {
    body: {},
  });

  if (error) throw new Error(error.message || 'Sync failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function syncWhatnotOrders(): Promise<{ imported: number; skipped: number }> {
  const { data, error } = await supabase.functions.invoke('whatnot-sync-orders', {
    body: {},
  });

  if (error) throw new Error(error.message || 'Sync failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function syncAmazonOrders(): Promise<{ imported: number; skipped: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('amazon-sync-orders', {
    body: {},
  });

  if (error) throw new Error(error.message || 'Sync failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createPlatformOrder(order: {
  platform: string;
  platform_order_id: string;
  buyer_username?: string;
  item_title: string;
  quantity?: number;
  sale_price?: number;
  shipping_address?: Record<string, string>;
}): Promise<PlatformOrder> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('platform_orders')
    .insert({
      ...order,
      user_id: await getActiveAccountId(session.user),
      quantity: order.quantity || 1,
      order_status: 'awaiting_shipment',
      shipping_status: 'pending',
      synced_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
