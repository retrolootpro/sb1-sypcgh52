import { supabase } from './supabase';
import { getActiveAccountId } from './account';

export type Transaction = {
  id: string;
  user_id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'refund';
  category: string;
  subcategory?: string | null;
  source: 'manual' | 'plaid' | 'ebay' | 'amazon' | 'whatnot' | 'show' | 'import';
  platform?: string | null;
  reference_id?: string | null;
  plaid_transaction_id?: string | null;
  plaid_account_id?: string | null;
  merchant_name?: string | null;
  notes?: string | null;
  is_reconciled: boolean;
  created_at: string;
  updated_at: string;
};

export type BankConnection = {
  id: string;
  user_id: string;
  plaid_item_id: string;
  institution_name: string | null;
  institution_id: string | null;
  account_ids: string[];
  account_names: string[];
  account_types: string[];
  last_synced_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type TaxProfile = {
  id: string;
  user_id: string;
  business_name: string;
  business_type: string;
  home_state: string;
  nexus_states: string[];
  tax_year: number;
  effective_tax_rate: number;
  quarterly_q1: number | null;
  quarterly_q2: number | null;
  quarterly_q3: number | null;
  quarterly_q4: number | null;
  notes: string | null;
};

export type OwnerLoan = {
  id: string;
  user_id: string;
  lender_name: string;
  loan_date: string;
  original_amount: number;
  purpose: string | null;
  status: 'open' | 'paid' | 'forgiven';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OwnerLoanPayment = {
  id: string;
  loan_id: string;
  user_id: string;
  payment_date: string;
  amount: number;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
};

export type OwnerLoanSummary = OwnerLoan & {
  paidAmount: number;
  balance: number;
  payments: OwnerLoanPayment[];
};

export type LotCostItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  quantity?: number | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  lot_market_value_at_allocation?: number | null;
  lot_allocation_ratio?: number | null;
  purchase_price_override?: boolean | null;
};

export type LotCostSummary = {
  id: string;
  name: string;
  source: string | null;
  received_at: string | null;
  shipment_id?: string | null;
  total_paid?: number | null;
  total_market_value?: number | null;
  allocation_ratio?: number | null;
  allocation_status?: string | null;
  cost_allocated_at?: string | null;
  totalCost: number;
  totalMarketValue: number;
  discountPercent: number;
  itemCount: number;
  allocatedCost: number;
  averageCost: number;
  items: LotCostItem[];
  purchaseTransactionId?: string | null;
};

export const TRANSACTION_CATEGORIES = [
  'Inventory Purchase',
  'Shipping',
  'Platform Fees',
  'Software & Subscriptions',
  'Supplies',
  'Packaging',
  'Advertising',
  'Meals & Entertainment',
  'Travel',
  'Bank Fees',
  'Interest',
  'Owner Loan',
  'Owner Loan Repayment',
  'Transfer',
  'Services',
  'Taxes',
  'Other',
  'Uncategorized',
];

export const INCOME_CATEGORIES = [
  'Sales - eBay',
  'Sales - Amazon',
  'Sales - Whatnot',
  'Sales - Show',
  'Sales - Other',
  'Refund Received',
  'Other Income',
];

export async function getTransactions(filters?: {
  startDate?: string;
  endDate?: string;
  type?: string;
  category?: string;
  source?: string;
  search?: string;
  limit?: number;
}): Promise<Transaction[]> {
  let query = supabase
    .from('financial_transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.startDate) query = query.gte('date', filters.startDate);
  if (filters?.endDate) query = query.lte('date', filters.endDate);
  if (filters?.type && filters.type !== 'all') query = query.eq('type', filters.type);
  if (filters?.category && filters.category !== 'all') query = query.eq('category', filters.category);
  if (filters?.source && filters.source !== 'all') query = query.eq('source', filters.source);
  if (filters?.search) query = query.ilike('description', `%${filters.search}%`);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createTransaction(tx: Omit<Transaction, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Transaction> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('financial_transactions')
    .insert({ ...tx, user_id: await getActiveAccountId(user), updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateTransaction(id: string, updates: Partial<Transaction>): Promise<void> {
  const { error } = await supabase
    .from('financial_transactions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getOwnerLoans(): Promise<OwnerLoanSummary[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const [{ data: loans, error: loanError }, { data: payments, error: paymentError }] = await Promise.all([
    supabase
      .from('owner_loans')
      .select('*')
      .eq('user_id', accountId)
      .order('loan_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('owner_loan_payments')
      .select('*')
      .eq('user_id', accountId)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);

  if (loanError) throw new Error(loanError.message);
  if (paymentError) throw new Error(paymentError.message);

  const paymentsByLoan = new Map<string, OwnerLoanPayment[]>();
  for (const payment of (payments || []) as OwnerLoanPayment[]) {
    const list = paymentsByLoan.get(payment.loan_id) || [];
    list.push(payment);
    paymentsByLoan.set(payment.loan_id, list);
  }

  return ((loans || []) as OwnerLoan[]).map((loan) => {
    const loanPayments = paymentsByLoan.get(loan.id) || [];
    const paidAmount = loanPayments.reduce((sum, payment) => sum + Math.abs(Number(payment.amount) || 0), 0);
    return {
      ...loan,
      paidAmount,
      balance: Math.max(0, Number(loan.original_amount) - paidAmount),
      payments: loanPayments,
    };
  });
}

export async function createOwnerLoan(input: {
  lender_name: string;
  loan_date: string;
  original_amount: number;
  purpose?: string | null;
  notes?: string | null;
  createTransaction?: boolean;
}): Promise<OwnerLoan> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data, error } = await supabase
    .from('owner_loans')
    .insert({
      user_id: accountId,
      lender_name: input.lender_name,
      loan_date: input.loan_date,
      original_amount: input.original_amount,
      purpose: input.purpose || null,
      notes: input.notes || null,
      status: 'open',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (input.createTransaction) {
    const { error: txError } = await supabase.from('financial_transactions').insert({
      user_id: accountId,
      date: input.loan_date,
      description: `Owner loan from ${input.lender_name}`,
      amount: Math.abs(input.original_amount),
      type: 'transfer',
      category: 'Owner Loan',
      source: 'manual',
      reference_id: `owner_loan_${data.id}`,
      notes: input.purpose || input.notes || null,
      is_reconciled: false,
      updated_at: new Date().toISOString(),
    });
    if (txError) throw new Error(txError.message);
  }

  return data;
}

export async function addOwnerLoanPayment(input: {
  loan_id: string;
  payment_date: string;
  amount: number;
  transaction_id?: string | null;
  notes?: string | null;
  createTransaction?: boolean;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  let transactionId = input.transaction_id || null;
  if (input.createTransaction && !transactionId) {
    const { data: tx, error: txError } = await supabase
      .from('financial_transactions')
      .insert({
        user_id: accountId,
        date: input.payment_date,
        description: 'Owner loan repayment',
        amount: -Math.abs(input.amount),
        type: 'transfer',
        category: 'Owner Loan Repayment',
        source: 'manual',
        reference_id: `owner_loan_repayment_${input.loan_id}_${Date.now()}`,
        notes: input.notes || null,
        is_reconciled: false,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (txError) throw new Error(txError.message);
    transactionId = tx.id;
  }

  const { error } = await supabase.from('owner_loan_payments').insert({
    user_id: accountId,
    loan_id: input.loan_id,
    payment_date: input.payment_date,
    amount: Math.abs(input.amount),
    transaction_id: transactionId,
    notes: input.notes || null,
  });
  if (error) throw new Error(error.message);

  const loans = await getOwnerLoans();
  const loan = loans.find((entry) => entry.id === input.loan_id);
  if (loan && loan.balance <= 0.01) {
    await supabase
      .from('owner_loans')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', input.loan_id)
      .eq('user_id', accountId);
  }
}

export async function getLotCostSummaries(): Promise<LotCostSummary[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const [{ data: lots, error: lotsError }, { data: items, error: itemsError }, { data: txns, error: txError }] = await Promise.all([
    supabase
      .from('lots')
      .select('id, name, source, received_at, shipment_id, total_paid, total_market_value, allocation_ratio, allocation_status, cost_allocated_at')
      .eq('user_id', await getActiveAccountId(user))
      .order('received_at', { ascending: false }),
    supabase
      .from('inventory_items')
      .select('id, lot_id, product_name, console, condition, purchase_price, quantity, selected_market_value, price_loose, price_cib, price_new, price_graded, lot_market_value_at_allocation, lot_allocation_ratio, purchase_price_override')
      .eq('user_id', await getActiveAccountId(user))
      .not('lot_id', 'is', null),
    supabase
      .from('financial_transactions')
      .select('id, reference_id, amount')
      .eq('user_id', await getActiveAccountId(user))
      .eq('category', 'Inventory Purchase')
      .like('reference_id', 'lot_purchase_%'),
  ]);

  if (lotsError) throw new Error(lotsError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (txError) throw new Error(txError.message);

  const itemsByLot = new Map<string, LotCostItem[]>();
  for (const item of (items || [])) {
    const lotId = item.lot_id as string;
    const list = itemsByLot.get(lotId) || [];
    list.push({
      id: item.id,
      product_name: item.product_name,
      console: item.console,
      condition: item.condition,
      purchase_price: Number(item.purchase_price) || 0,
      quantity: Number(item.quantity) || 1,
      selected_market_value: Number(item.selected_market_value) || 0,
      price_loose: Number(item.price_loose) || 0,
      price_cib: Number(item.price_cib) || 0,
      price_new: Number(item.price_new) || 0,
      price_graded: Number(item.price_graded) || 0,
      lot_market_value_at_allocation: Number(item.lot_market_value_at_allocation) || 0,
      lot_allocation_ratio: Number(item.lot_allocation_ratio) || 0,
      purchase_price_override: Boolean(item.purchase_price_override),
    });
    itemsByLot.set(lotId, list);
  }

  const txByLot = new Map<string, { id: string; amount: number }>();
  for (const tx of (txns || [])) {
    const lotId = String(tx.reference_id || '').replace('lot_purchase_', '');
    if (lotId) txByLot.set(lotId, { id: tx.id, amount: Math.abs(Number(tx.amount) || 0) });
  }

  return (lots || []).map((lot) => {
    const lotItems = itemsByLot.get(lot.id) || [];
    const tx = txByLot.get(lot.id);
    const allocatedCost = lotItems.reduce((sum, item) => sum + (Number(item.purchase_price) || 0) * (Number(item.quantity) || 1), 0);
    const liveMarketValue = lotItems.reduce((sum, item) => sum + marketWeight(item) * (Number(item.quantity) || 1), 0);
    const storedPaid = Number((lot as any).total_paid) || 0;
    const totalCost = storedPaid || tx?.amount || allocatedCost;
    const totalMarketValue = Number((lot as any).total_market_value) || liveMarketValue;
    const allocationRatio = Number((lot as any).allocation_ratio) || (totalMarketValue > 0 && totalCost > 0 ? totalCost / totalMarketValue : 0);
    return {
      id: lot.id,
      name: lot.name,
      source: lot.source,
      received_at: lot.received_at,
      shipment_id: (lot as any).shipment_id || null,
      total_paid: storedPaid,
      total_market_value: totalMarketValue,
      allocation_ratio: allocationRatio,
      allocation_status: (lot as any).allocation_status || null,
      cost_allocated_at: (lot as any).cost_allocated_at || null,
      totalCost,
      totalMarketValue,
      discountPercent: allocationRatio > 0 ? (1 - allocationRatio) * 100 : 0,
      itemCount: lotItems.length,
      allocatedCost,
      averageCost: lotItems.length > 0 ? totalCost / lotItems.length : 0,
      items: lotItems,
      purchaseTransactionId: tx?.id ?? null,
    };
  });
}

export async function upsertLotPurchase(lot: { id: string; name: string; source?: string | null; received_at?: string | null }, amount: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (amount < 0) throw new Error('Amount must be positive');

  const referenceId = `lot_purchase_${lot.id}`;
  const { data: existing, error: findError } = await supabase
    .from('financial_transactions')
    .select('id')
    .eq('user_id', await getActiveAccountId(user))
    .eq('reference_id', referenceId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const payload = {
    user_id: await getActiveAccountId(user),
    date: (lot.received_at || new Date().toISOString()).slice(0, 10),
    description: `Lot purchase: ${lot.name}`,
    amount: -Math.abs(amount),
    type: 'expense' as const,
    category: 'Inventory Purchase',
    source: 'manual' as const,
    reference_id: referenceId,
    merchant_name: lot.source || null,
    notes: 'Lot purchase principal used for inventory cost allocation.',
    is_reconciled: false,
    updated_at: new Date().toISOString(),
  };

  const result = existing
    ? await supabase.from('financial_transactions').update(payload).eq('id', existing.id)
    : await supabase.from('financial_transactions').insert(payload);

  if (result.error) throw new Error(result.error.message);

  const { error: lotError } = await supabase
    .from('lots')
    .update({ total_paid: amount, updated_at: new Date().toISOString() })
    .eq('id', lot.id)
    .eq('user_id', await getActiveAccountId(user));
  if (lotError) throw new Error(lotError.message);
}

function marketWeight(item: LotCostItem): number {
  return (
    Number(item.selected_market_value) ||
    Number(item.price_cib) ||
    Number(item.price_loose) ||
    Number(item.price_new) ||
    Number(item.price_graded) ||
    0
  );
}

export async function allocateLotCost(lotId: string, totalCost: number, method: 'equal' | 'weighted' | 'market_weighted' = 'market_weighted'): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('id, quantity, purchase_price, purchase_price_override, selected_market_value, price_loose, price_cib, price_new, price_graded')
    .eq('user_id', await getActiveAccountId(user))
    .eq('lot_id', lotId);
  if (error) throw new Error(error.message);
  if (!items || items.length === 0) throw new Error('This lot has no items to allocate');

  const useMarketWeight = method === 'weighted' || method === 'market_weighted';
  const overrideTotal = items.reduce((sum, item) => {
    if (!item.purchase_price_override) return sum;
    return sum + (Number(item.purchase_price) || 0) * (Number(item.quantity) || 1);
  }, 0);
  const remainingCost = Math.max(0, totalCost - overrideTotal);
  const weights = items.map((item) => {
    if (item.purchase_price_override) return 0;
    return useMarketWeight ? marketWeight(item as LotCostItem) * (Number(item.quantity) || 1) : (Number(item.quantity) || 1);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || items.length;
  const fallbackEqual = totalWeight <= 0;
  const marketTotal = items.reduce((sum, item) => sum + marketWeight(item as LotCostItem) * (Number(item.quantity) || 1), 0);
  const allocationRatio = marketTotal > 0 ? totalCost / marketTotal : 0;
  const now = new Date().toISOString();

  const accountId = await getActiveAccountId(user);
  const updates = items.map((item, index) => {
    const itemMarket = marketWeight(item as LotCostItem);
    const weight = fallbackEqual ? 1 : weights[index];
    const divisor = fallbackEqual ? items.length : totalWeight;
    const quantity = Number(item.quantity) || 1;
    const allocatedUnitCost = item.purchase_price_override
      ? Number(item.purchase_price) || 0
      : useMarketWeight && totalWeight > 0
        ? (remainingCost * weight) / divisor / quantity
        : (remainingCost * weight) / divisor / quantity;
    const profit = itemMarket - allocatedUnitCost;
    return supabase
      .from('inventory_items')
      .update({
        purchase_price: Number(allocatedUnitCost.toFixed(2)),
        lot_market_value_at_allocation: Number(itemMarket.toFixed(2)),
        lot_allocation_ratio: Number(allocationRatio.toFixed(6)),
        estimated_profit: Number(profit.toFixed(2)),
        estimated_margin_percent: itemMarket > 0 ? Number(((profit / itemMarket) * 100).toFixed(2)) : 0,
        cost_allocated_at: now,
        updated_at: now,
      })
      .eq('id', item.id)
      .eq('user_id', accountId);
  });

  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const { error: lotError } = await supabase
    .from('lots')
    .update({
      total_paid: Number(totalCost.toFixed(2)),
      total_market_value: Number(marketTotal.toFixed(2)),
      allocation_ratio: Number(allocationRatio.toFixed(6)),
      allocation_method: useMarketWeight ? 'market_weighted' : 'equal',
      allocation_status: marketTotal > 0 ? 'allocated' : 'needs_market_values',
      cost_allocated_at: now,
      updated_at: now,
    })
    .eq('id', lotId)
    .eq('user_id', accountId);
  if (lotError) throw new Error(lotError.message);
}

export async function importPlatformSales(): Promise<{ imported: number }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: soldItems, error } = await supabase
    .from('inventory_items')
    .select('id, product_name, console, sell_price, sold_at, sold_via, purchase_price')
    .eq('status', 'sold')
    .not('sell_price', 'is', null)
    .not('sold_at', 'is', null);

  if (error) throw new Error(error.message);

  let imported = 0;
  for (const item of (soldItems || [])) {
    const refId = `inv_sale_${item.id}`;
    const { data: existing } = await supabase
      .from('financial_transactions')
      .select('id')
      .eq('reference_id', refId)
      .maybeSingle();
    if (existing) continue;

    const label = [item.product_name, item.console].filter(Boolean).join(' - ');
    const platform = item.sold_via || 'other';
    const category = platform === 'ebay' ? 'Sales - eBay'
      : platform === 'amazon' ? 'Sales - Amazon'
      : platform === 'whatnot' ? 'Sales - Whatnot'
      : platform === 'show' ? 'Sales - Show'
      : 'Sales - Other';

    await supabase.from('financial_transactions').insert({
      user_id: await getActiveAccountId(user),
      date: (item.sold_at as string).slice(0, 10),
      description: `Sale: ${label}`,
      amount: parseFloat(item.sell_price),
      type: 'income',
      category,
      source: (platform as Transaction['source']) || 'manual',
      platform,
      reference_id: refId,
      updated_at: new Date().toISOString(),
    });
    imported++;
  }

  return { imported };
}

export async function getBankConnections(): Promise<BankConnection[]> {
  const { data, error } = await supabase
    .from('bank_connections')
    .select('id, user_id, plaid_item_id, institution_name, institution_id, account_ids, account_names, account_types, last_synced_at, is_active, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteBankConnection(id: string): Promise<void> {
  const { error } = await supabase.from('bank_connections').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function syncBankTransactions(connectionId?: string): Promise<{ added: number; modified: number; removed: number }> {
  const { data, error } = await supabase.functions.invoke('plaid-sync-transactions', {
    body: connectionId ? { connection_id: connectionId } : {},
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function getTaxProfile(): Promise<TaxProfile | null> {
  const { data, error } = await supabase
    .from('tax_profiles')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertTaxProfile(profile: Partial<TaxProfile>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('tax_profiles')
    .upsert({ ...profile, user_id: await getActiveAccountId(user), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export type PLStatement = {
  period: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  grossMargin: number;
  netMargin: number;
  revenueByPlatform: Record<string, number>;
  expensesByCategory: Record<string, number>;
};

export async function getPLStatement(year: number, month?: number): Promise<PLStatement> {
  const startDate = month
    ? `${year}-${String(month).padStart(2, '0')}-01`
    : `${year}-01-01`;
  const endDate = month
    ? new Date(year, month, 0).toISOString().slice(0, 10)
    : `${year}-12-31`;

  const { data: txns, error } = await supabase
    .from('financial_transactions')
    .select('type, amount, category, platform, source, reference_id')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) throw new Error(error.message);

  const { data: soldItems } = await supabase
    .from('inventory_items')
    .select('id, sell_price, purchase_price, sold_at, sold_via')
    .eq('status', 'sold')
    .gte('sold_at', startDate + 'T00:00:00Z')
    .lte('sold_at', endDate + 'T23:59:59Z');

  let revenue = 0;
  let cogs = 0;
  let operatingExpenses = 0;
  const revenueByPlatform: Record<string, number> = {};
  const expensesByCategory: Record<string, number> = {};
  const generatedSaleRefs = new Set((txns || []).map((tx) => tx.reference_id).filter(Boolean));

  for (const item of (soldItems || [])) {
    const sp = parseFloat(item.sell_price) || 0;
    const pp = parseFloat(item.purchase_price) || 0;
    cogs += pp;
    const generatedRef = `inv_sale_${item.id}`;
    if (!generatedSaleRefs.has(generatedRef)) {
      revenue += sp;
      const platform = item.sold_via || 'Other';
      revenueByPlatform[platform] = (revenueByPlatform[platform] || 0) + sp;
    }
  }

  for (const tx of (txns || [])) {
    const amt = parseFloat(String(tx.amount));
    if (tx.type === 'income') {
      revenue += Math.abs(amt);
      const platform = tx.platform || 'Other';
      revenueByPlatform[platform] = (revenueByPlatform[platform] || 0) + Math.abs(amt);
    } else if (tx.type === 'refund') {
      const refund = Math.abs(amt);
      revenue -= refund;
      const platform = tx.platform || 'Other';
      revenueByPlatform[platform] = (revenueByPlatform[platform] || 0) - refund;
    } else if (tx.type === 'expense') {
      const expense = Math.abs(amt);
      if (tx.category === 'Inventory Purchase') {
        // Inventory purchases are cash-out when bought, but COGS belongs on the
        // P&L only when the item sells. Sold inventory rows above carry that cost.
        continue;
      } else if (tx.category === 'Owner Loan Repayment' || tx.category === 'Owner Loan') {
        continue;
      } else {
        operatingExpenses += expense;
        expensesByCategory[tx.category] = (expensesByCategory[tx.category] || 0) + expense;
      }
    }
  }

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - operatingExpenses;
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  return {
    period: month ? `${year}-${String(month).padStart(2, '0')}` : String(year),
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    netProfit,
    grossMargin,
    netMargin,
    revenueByPlatform,
    expensesByCategory,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatCurrencyCompact(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  }
  return formatCurrency(amount);
}
