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

export type BusinessExpense = {
  id: string;
  user_id: string;
  created_by_user_id: string | null;
  incurred_by_email: string | null;
  incurred_by_name: string | null;
  expense_date: string;
  merchant: string | null;
  description: string;
  amount: number;
  irs_category: string;
  business_purpose: string | null;
  payment_method: string | null;
  receipt_url: string | null;
  receipt_storage_path: string | null;
  receipt_file_name: string | null;
  receipt_mime_type: string | null;
  source_transaction_id: string | null;
  status: 'draft' | 'ready' | 'reviewed' | 'disallowed';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpensePerson = {
  email: string;
  name: string;
  role?: string | null;
  status?: string | null;
};

export type ExpensePersonTotal = {
  email: string;
  name: string;
  total: number;
  count: number;
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
  unitCount: number;
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

export const IRS_WRITE_OFF_CATEGORIES = [
  {
    value: 'Advertising',
    label: 'Advertising',
    scheduleC: 'Advertising',
    examples: 'Promoted listings, flyers, social media ads, branding, business cards.',
  },
  {
    value: 'Car and Truck',
    label: 'Car and Truck',
    scheduleC: 'Car and truck expenses',
    examples: 'Mileage for sourcing runs, post office trips, storage trips, shows, and supplier pickups.',
  },
  {
    value: 'Commissions and Fees',
    label: 'Commissions and Fees',
    scheduleC: 'Commissions and fees',
    examples: 'Marketplace commissions, payment processor fees, consignment fees, referral fees.',
  },
  {
    value: 'Contract Labor',
    label: 'Contract Labor',
    scheduleC: 'Contract labor',
    examples: 'Paid helpers for cleaning, photographing, listing, packing, or show prep.',
  },
  {
    value: 'Cost of Goods Sold',
    label: 'Inventory / COGS',
    scheduleC: 'Cost of goods sold',
    examples: 'Games, consoles, books, collectibles, lots, inbound shipping, import costs, and purchase fees included in inventory cost.',
  },
  {
    value: 'Insurance',
    label: 'Insurance',
    scheduleC: 'Insurance',
    examples: 'Business property, shipping insurance, liability coverage, and other business policies.',
  },
  {
    value: 'Legal and Professional',
    label: 'Legal and Professional',
    scheduleC: 'Legal and professional services',
    examples: 'CPA, bookkeeping, legal help, tax preparation, entity setup, and compliance support.',
  },
  {
    value: 'Office Expense',
    label: 'Office Expense',
    scheduleC: 'Office expense',
    examples: 'Printer ink, labels, paper, scanners, small office tools, and admin supplies.',
  },
  {
    value: 'Rent or Lease',
    label: 'Rent or Lease',
    scheduleC: 'Rent or lease',
    examples: 'Storage unit, rented equipment, booth space, workspace, or business-use property.',
  },
  {
    value: 'Repairs and Maintenance',
    label: 'Repairs and Maintenance',
    scheduleC: 'Repairs and maintenance',
    examples: 'Business equipment repairs, cleaning machine upkeep, label printer repair.',
  },
  {
    value: 'Supplies',
    label: 'Supplies',
    scheduleC: 'Supplies',
    examples: 'Boxes, tape, bubble wrap, sleeves, protectors, cleaners, batteries used for testing.',
  },
  {
    value: 'Taxes and Licenses',
    label: 'Taxes and Licenses',
    scheduleC: 'Taxes and licenses',
    examples: 'Business licenses, reseller permits, local licenses, some business taxes.',
  },
  {
    value: 'Travel and Meals',
    label: 'Travel and Meals',
    scheduleC: 'Travel and meals',
    examples: 'Sourcing trips, show travel, hotels, parking, tolls, and eligible business meals.',
  },
  {
    value: 'Utilities',
    label: 'Utilities',
    scheduleC: 'Utilities',
    examples: 'Business phone, internet, electricity portion for business space, app-connected devices.',
  },
  {
    value: 'Software and Subscriptions',
    label: 'Software and Subscriptions',
    scheduleC: 'Other expenses',
    examples: 'RetroLootPro, pricing tools, accounting software, cloud storage, listing tools.',
  },
  {
    value: 'Home Office',
    label: 'Home Office',
    scheduleC: 'Business use of home',
    examples: 'Dedicated regular business space, calculated with actual expenses or simplified method.',
  },
  {
    value: 'Other',
    label: 'Other',
    scheduleC: 'Other expenses',
    examples: 'Business expenses that do not fit another category. Add a clear business purpose.',
  },
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

export type LedgerAutomationRule = {
  id: string;
  label: string;
  match: string;
  category: string;
  type: Transaction['type'];
  confidence: 'high' | 'medium' | 'review';
  reason: string;
};

export type LedgerReviewItem = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: Transaction['type'];
  category: string;
  source: Transaction['source'];
  is_reconciled: boolean;
  suggestedCategory: string;
  suggestedType: Transaction['type'];
  confidence: LedgerAutomationRule['confidence'];
  reason: string;
};

export type LedgerAutomationSummary = {
  connectedInstitutions: number;
  connectedBankAccounts: number;
  lastSyncedAt: string | null;
  transactionsYtd: number;
  unreconciledCount: number;
  uncategorizedCount: number;
  needsReviewCount: number;
  draftExpenseCount: number;
  lotReviewCount: number;
  readyForExportScore: number;
  reviewItems: LedgerReviewItem[];
  rules: LedgerAutomationRule[];
};

export type LedgerSourceSyncResult = {
  bank: { added: number; modified: number; removed: number; error?: string | null };
  ebay: { imported: number; skipped: number; total?: number; error?: string | null };
  whatnot: { imported: number; skipped: number; error?: string | null };
  ledgerOrders: { imported: number; skipped: number; error?: string | null };
};

export type LedgerAutoReconcileResult = {
  categorized: number;
  reconciled: number;
  payoutMatches: number;
  reviewed: number;
};

export type LedgerReviewAction = {
  transactionId: string;
  category: string;
  type: Transaction['type'];
  reason?: string;
  markReconciled?: boolean;
};

export const LEDGER_AUTOMATION_RULES: LedgerAutomationRule[] = [
  {
    id: 'shipping-labels',
    label: 'Shipping labels',
    match: 'USPS, Pirate Ship, ShipStation, UPS, FedEx',
    category: 'Shipping',
    type: 'expense',
    confidence: 'high',
    reason: 'Label and carrier charges should usually land in Shipping.',
  },
  {
    id: 'marketplace-fees',
    label: 'Marketplace fees',
    match: 'eBay fees, Whatnot fees, Amazon seller fees',
    category: 'Platform Fees',
    type: 'expense',
    confidence: 'high',
    reason: 'Marketplace fee lines reduce net profit but are not COGS.',
  },
  {
    id: 'packaging-supplies',
    label: 'Packaging supplies',
    match: 'Uline, Staples, Walmart boxes, tape, mailers',
    category: 'Packaging',
    type: 'expense',
    confidence: 'medium',
    reason: 'Common supply vendors often need a quick human check.',
  },
  {
    id: 'software',
    label: 'Software subscriptions',
    match: 'Netlify, Google, OpenAI, pricing tools, bookkeeping apps',
    category: 'Software & Subscriptions',
    type: 'expense',
    confidence: 'medium',
    reason: 'Recurring app charges belong in operating expenses.',
  },
  {
    id: 'inventory-buys',
    label: 'Inventory buys',
    match: 'GameStop, estate sales, marketplace buys, cash withdrawals',
    category: 'Inventory Purchase',
    type: 'expense',
    confidence: 'review',
    reason: 'Inventory purchases should tie back to a lot so COGS is right when items sell.',
  },
  {
    id: 'platform-payouts',
    label: 'Platform payouts',
    match: 'eBay, Whatnot, Amazon, Square, Stripe deposits',
    category: 'Transfer',
    type: 'transfer',
    confidence: 'review',
    reason: 'Deposits should be matched to platform sales/fees rather than counted twice as new income.',
  },
];

function inferLedgerRule(tx: Pick<Transaction, 'description' | 'merchant_name' | 'amount' | 'type' | 'category' | 'source'>): LedgerAutomationRule {
  const haystack = `${tx.description || ''} ${tx.merchant_name || ''}`.toLowerCase();
  const amount = Number(tx.amount) || 0;

  if (/usps|pirate\s*ship|shipstation|ups|fedex|postage|shipping label/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[0];
  }
  if (/ebay.*fee|whatnot.*fee|amazon.*fee|seller fee|final value|payment processing|commission/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[1];
  }
  if (/uline|staples|box|boxes|mailer|mailers|tape|bubble|label printer|thermal label/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[2];
  }
  if (/netlify|google|openai|quickbooks|seller ledger|reseller genie|pricecharting|barcode|subscription|software/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[3];
  }
  if (/gamestop|goodwill|estate|yard sale|facebook marketplace|mercari purchase|cash withdrawal|atm withdrawal/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[4];
  }
  if (amount > 0 && /ebay|whatnot|amazon|square|stripe|paypal|payout|deposit|transfer/.test(haystack)) {
    return LEDGER_AUTOMATION_RULES[5];
  }

  return {
    id: 'human-review',
    label: 'Human review',
    match: 'No confident rule match',
    category: tx.category === 'Uncategorized' ? 'Uncategorized' : tx.category,
    type: tx.type,
    confidence: 'review',
    reason: 'No strong reseller rule matched this transaction yet.',
  };
}

async function invokeLedgerFunction<T>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

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

export async function getLedgerAutomationSummary(): Promise<LedgerAutomationSummary> {
  const now = new Date();
  const startDate = `${now.getFullYear()}-01-01`;
  const [transactions, connections, expenses, lots] = await Promise.all([
    getTransactions({ startDate, limit: 500 }),
    getBankConnections(),
    getBusinessExpenses({ startDate }),
    getLotCostSummaries(),
  ]);

  const unreconciled = transactions.filter((tx) => !tx.is_reconciled);
  const uncategorized = transactions.filter((tx) => tx.category === 'Uncategorized');
  const draftExpenses = expenses.filter((expense) => expense.status === 'draft' || expense.status === 'ready');
  const lotsNeedingReview = lots.filter((lot) => (
    lot.itemCount > 0 &&
    (lot.totalCost <= 0 || lot.allocation_status !== 'allocated' || lot.allocatedCost <= 0)
  ));
  const reviewCandidates = transactions
    .filter((tx) => !tx.is_reconciled || tx.category === 'Uncategorized')
    .slice(0, 12)
    .map((tx) => {
      const rule = inferLedgerRule(tx);
      return {
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: Number(tx.amount) || 0,
        type: tx.type,
        category: tx.category,
        source: tx.source,
        is_reconciled: tx.is_reconciled,
        suggestedCategory: rule.category,
        suggestedType: rule.type,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    });

  const connectedBankAccounts = connections.reduce((sum, connection) => (
    sum + Math.max(1, connection.account_ids?.length || connection.account_names?.length || 0)
  ), 0);
  const lastSyncedAt = connections
    .map((connection) => connection.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const needsReviewCount = unreconciled.length + uncategorized.length + draftExpenses.length + lotsNeedingReview.length;
  const score = Math.max(0, Math.min(100, 100
    - Math.min(35, unreconciled.length * 2)
    - Math.min(25, uncategorized.length * 4)
    - Math.min(20, draftExpenses.length * 3)
    - Math.min(20, lotsNeedingReview.length * 5)
    - (connections.length === 0 ? 15 : 0)));

  return {
    connectedInstitutions: connections.length,
    connectedBankAccounts,
    lastSyncedAt,
    transactionsYtd: transactions.length,
    unreconciledCount: unreconciled.length,
    uncategorizedCount: uncategorized.length,
    needsReviewCount,
    draftExpenseCount: draftExpenses.length,
    lotReviewCount: lotsNeedingReview.length,
    readyForExportScore: Math.round(score),
    reviewItems: reviewCandidates,
    rules: LEDGER_AUTOMATION_RULES,
  };
}

export async function importPlatformOrdersToLedger(): Promise<{ imported: number; skipped: number }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data: orders, error } = await supabase
    .from('platform_orders')
    .select('id, platform, platform_order_id, item_title, quantity, sale_price, shipping_cost, order_created_at, buyer_username, item_sku')
    .order('order_created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  let imported = 0;
  let skipped = 0;

  for (const order of (orders || [])) {
    const platform = String(order.platform || 'other').toLowerCase();
    const orderId = String(order.platform_order_id || order.id);
    const referenceId = `platform_order_${platform}_${orderId}`;
    const amount = Number(order.sale_price) || 0;
    if (amount <= 0) {
      skipped++;
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from('financial_transactions')
      .select('id')
      .eq('user_id', accountId)
      .eq('reference_id', referenceId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      skipped++;
      continue;
    }

    const category = platform === 'ebay' ? 'Sales - eBay'
      : platform === 'amazon' ? 'Sales - Amazon'
      : platform === 'whatnot' ? 'Sales - Whatnot'
      : 'Sales - Other';
    const source: Transaction['source'] =
      platform === 'ebay' || platform === 'amazon' || platform === 'whatnot' ? platform : 'import';

    const { error: insertError } = await supabase.from('financial_transactions').insert({
      user_id: accountId,
      date: (order.order_created_at || new Date().toISOString()).slice(0, 10),
      description: `${platform.toUpperCase()} order: ${order.item_title || orderId}`,
      amount,
      type: 'income',
      category,
      source,
      platform,
      reference_id: referenceId,
      merchant_name: order.buyer_username || platform,
      notes: [
        `Platform order ${orderId}`,
        order.item_sku ? `SKU ${order.item_sku}` : null,
        `Quantity ${Number(order.quantity) || 1}`,
        order.shipping_cost != null ? `Shipping ${Number(order.shipping_cost).toFixed(2)}` : null,
      ].filter(Boolean).join(' | '),
      is_reconciled: false,
      updated_at: new Date().toISOString(),
    });
    if (insertError) throw new Error(insertError.message);
    imported++;
  }

  return { imported, skipped };
}

export async function syncLedgerSources(): Promise<LedgerSourceSyncResult> {
  const result: LedgerSourceSyncResult = {
    bank: { added: 0, modified: 0, removed: 0, error: null },
    ebay: { imported: 0, skipped: 0, total: 0, error: null },
    whatnot: { imported: 0, skipped: 0, error: null },
    ledgerOrders: { imported: 0, skipped: 0, error: null },
  };

  try {
    const bank = await syncBankTransactions();
    result.bank = { ...bank, error: null };
  } catch (error) {
    result.bank.error = error instanceof Error ? error.message : 'Bank sync failed';
  }

  try {
    const ebay = await invokeLedgerFunction<{ imported?: number; skipped?: number; total?: number }>('ebay-sync-orders');
    result.ebay = {
      imported: Number(ebay.imported || 0),
      skipped: Number(ebay.skipped || 0),
      total: Number(ebay.total || 0),
      error: null,
    };
  } catch (error) {
    result.ebay.error = error instanceof Error ? error.message : 'eBay sync failed';
  }

  try {
    const whatnot = await invokeLedgerFunction<{ imported?: number; skipped?: number }>('whatnot-sync-orders');
    result.whatnot = {
      imported: Number(whatnot.imported || 0),
      skipped: Number(whatnot.skipped || 0),
      error: null,
    };
  } catch (error) {
    result.whatnot.error = error instanceof Error ? error.message : 'Whatnot sync failed';
  }

  try {
    result.ledgerOrders = { ...(await importPlatformOrdersToLedger()), error: null };
  } catch (error) {
    result.ledgerOrders.error = error instanceof Error ? error.message : 'Ledger order import failed';
  }

  return result;
}

export async function autoReconcileLedger(): Promise<LedgerAutoReconcileResult> {
  const transactions = await getTransactions({ limit: 500 });
  let categorized = 0;
  let reconciled = 0;
  let payoutMatches = 0;
  let reviewed = 0;

  const platformIncome = transactions
    .filter((tx) => (
      !tx.is_reconciled &&
      tx.type === 'income' &&
      Boolean(tx.platform) &&
      ['ebay', 'amazon', 'whatnot'].includes(String(tx.platform).toLowerCase())
    ))
    .sort((a, b) => a.date.localeCompare(b.date));

  const bankDeposits = transactions.filter((tx) => (
    !tx.is_reconciled &&
    tx.source === 'plaid' &&
    Number(tx.amount) > 0 &&
    /ebay|whatnot|amazon|paypal|square|stripe|payout|deposit/i.test(`${tx.description} ${tx.merchant_name || ''}`)
  ));

  const matchedIds = new Set<string>();

  for (const deposit of bankDeposits) {
    const haystack = `${deposit.description} ${deposit.merchant_name || ''}`.toLowerCase();
    const platform = haystack.includes('whatnot') ? 'whatnot'
      : haystack.includes('amazon') ? 'amazon'
      : haystack.includes('ebay') ? 'ebay'
      : '';
    if (!platform) continue;

    const depositDate = new Date(deposit.date).getTime();
    const candidates = platformIncome.filter((tx) => {
      if (matchedIds.has(tx.id)) return false;
      if (String(tx.platform || '').toLowerCase() !== platform) return false;
      const txDate = new Date(tx.date).getTime();
      const daysApart = Math.abs(depositDate - txDate) / 86_400_000;
      return daysApart <= 14;
    });

    const exactSingle = candidates.find((tx) => Math.abs(Math.abs(Number(tx.amount)) - Math.abs(Number(deposit.amount))) < 0.01);
    if (!exactSingle) continue;

    const matchNote = `Auto matched ${platform} payout deposit ${deposit.id} to sale ${exactSingle.reference_id || exactSingle.id}.`;
    await updateTransaction(deposit.id, {
      type: 'transfer',
      category: 'Transfer',
      is_reconciled: true,
      notes: [deposit.notes, matchNote].filter(Boolean).join('\n'),
    });
    await updateTransaction(exactSingle.id, {
      is_reconciled: true,
      notes: [exactSingle.notes, matchNote].filter(Boolean).join('\n'),
    });
    matchedIds.add(deposit.id);
    matchedIds.add(exactSingle.id);
    payoutMatches++;
  }

  for (const tx of transactions) {
    if (matchedIds.has(tx.id)) continue;
    if (tx.is_reconciled && tx.category !== 'Uncategorized') continue;

    const rule = inferLedgerRule(tx);
    const updates: Partial<Transaction> = {};
    const shouldApplyCategory =
      tx.category === 'Uncategorized' &&
      rule.category !== 'Uncategorized' &&
      rule.confidence !== 'review';
    const canAutoReconcile =
      rule.confidence === 'high' &&
      rule.type === tx.type &&
      tx.source !== 'manual' &&
      rule.category !== 'Transfer';

    if (shouldApplyCategory) {
      updates.category = rule.category;
      categorized++;
    }
    if (!tx.is_reconciled && canAutoReconcile) {
      updates.is_reconciled = true;
      reconciled++;
    }

    if (Object.keys(updates).length > 0) {
      await updateTransaction(tx.id, updates);
    } else if (!tx.is_reconciled || tx.category === 'Uncategorized') {
      reviewed++;
    }
  }

  return { categorized, reconciled, payoutMatches, reviewed };
}

async function getTransactionNotes(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('financial_transactions')
    .select('notes')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.notes || null;
}

function appendLedgerNote(notes: string | null | undefined, note: string): string {
  return [notes, note].filter(Boolean).join('\n');
}

export async function applyLedgerReviewAction(action: LedgerReviewAction): Promise<void> {
  const notes = await getTransactionNotes(action.transactionId);
  const reviewNote = [
    `Ledger review: applied ${action.category} (${action.type}).`,
    action.reason,
    action.markReconciled ? 'Marked reconciled.' : null,
  ].filter(Boolean).join(' ');
  const updates: Partial<Transaction> = {
    category: action.category,
    type: action.type,
    notes: appendLedgerNote(notes, reviewNote),
  };

  if (action.markReconciled) updates.is_reconciled = true;

  await updateTransaction(action.transactionId, updates);
}

export async function markLedgerTransactionReconciled(id: string): Promise<void> {
  const notes = await getTransactionNotes(id);
  await updateTransaction(id, {
    is_reconciled: true,
    notes: appendLedgerNote(notes, 'Ledger review: marked reconciled by user.'),
  });
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

export async function getExpensePeople(): Promise<ExpensePerson[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data, error } = await supabase
    .from('user_account_memberships')
    .select('email, role, status')
    .eq('account_owner_id', accountId)
    .neq('status', 'revoked')
    .order('email', { ascending: true });
  if (error) throw new Error(error.message);

  const people = ((data || []) as Array<{ email: string; role: string | null; status: string | null }>).map((entry) => ({
    email: entry.email,
    name: entry.email,
    role: entry.role,
    status: entry.status,
  }));

  if (user.email && !people.some((person) => person.email.toLowerCase() === user.email!.toLowerCase())) {
    people.unshift({ email: user.email.toLowerCase(), name: user.email.toLowerCase(), role: 'admin', status: 'active' });
  }

  return people;
}

export async function getBusinessExpenses(filters?: {
  startDate?: string;
  endDate?: string;
  category?: string;
  person?: string;
  status?: string;
  search?: string;
}): Promise<BusinessExpense[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  let query = supabase
    .from('business_expenses')
    .select('*')
    .eq('user_id', await getActiveAccountId(user))
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.startDate) query = query.gte('expense_date', filters.startDate);
  if (filters?.endDate) query = query.lte('expense_date', filters.endDate);
  if (filters?.category && filters.category !== 'all') query = query.eq('irs_category', filters.category);
  if (filters?.person && filters.person !== 'all') query = query.eq('incurred_by_email', filters.person);
  if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters?.search) query = query.or(`description.ilike.%${filters.search}%,merchant.ilike.%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as BusinessExpense[];
}

export async function createBusinessExpense(input: Omit<BusinessExpense, 'id' | 'user_id' | 'created_by_user_id' | 'created_at' | 'updated_at'>): Promise<BusinessExpense> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(user);

  const { data, error } = await supabase
    .from('business_expenses')
    .insert({
      ...input,
      user_id: accountId,
      created_by_user_id: user.id,
      amount: Math.abs(Number(input.amount) || 0),
      incurred_by_email: (input.incurred_by_email || user.email || '').toLowerCase(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as BusinessExpense;
}

const EXPENSE_RECEIPTS_BUCKET = 'expense-receipts';
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

function safeReceiptName(name: string) {
  const fallback = 'receipt';
  const cleaned = (name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return cleaned || fallback;
}

export async function uploadExpenseReceipt(file: File): Promise<{
  receiptUrl: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (file.size > MAX_RECEIPT_BYTES) throw new Error('Receipt files must be 10 MB or smaller.');
  if (file.type && !ALLOWED_RECEIPT_TYPES.has(file.type)) {
    throw new Error('Receipt must be a JPG, PNG, WebP, HEIC, or PDF file.');
  }

  const accountId = await getActiveAccountId(user);
  const fileName = safeReceiptName(file.name);
  const storagePath = `${accountId}/expenses/${Date.now()}-${crypto.randomUUID()}-${fileName}`;
  const mimeType = file.type || null;
  const { error: uploadError } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: signed, error: signedError } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || 'Failed to create receipt link');

  return {
    receiptUrl: signed.signedUrl,
    storagePath,
    fileName,
    mimeType,
  };
}

export async function getExpenseReceiptUrl(expense: BusinessExpense): Promise<string | null> {
  if (!expense.receipt_storage_path) return expense.receipt_url;
  const { data, error } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .createSignedUrl(expense.receipt_storage_path, 60 * 60 * 24 * 7);
  if (error) throw new Error(error.message);
  return data?.signedUrl || expense.receipt_url;
}

export async function updateBusinessExpense(id: string, updates: Partial<BusinessExpense>): Promise<void> {
  const payload = {
    ...updates,
    amount: updates.amount == null ? undefined : Math.abs(Number(updates.amount) || 0),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('business_expenses')
    .update(payload)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteBusinessExpense(id: string): Promise<void> {
  const { data: existing } = await supabase
    .from('business_expenses')
    .select('receipt_storage_path')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('business_expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);

  const receiptPath = (existing as Pick<BusinessExpense, 'receipt_storage_path'> | null)?.receipt_storage_path;
  if (receiptPath) {
    const { error: storageError } = await supabase.storage
      .from(EXPENSE_RECEIPTS_BUCKET)
      .remove([receiptPath]);
    if (storageError) console.warn('Failed to remove expense receipt', storageError.message);
  }
}

export async function getExpenseTotalsByPerson(year?: number): Promise<ExpensePersonTotal[]> {
  const startDate = year ? `${year}-01-01` : undefined;
  const endDate = year ? `${year}-12-31` : undefined;
  const expenses = await getBusinessExpenses({ startDate, endDate });
  const totals = new Map<string, ExpensePersonTotal>();

  for (const expense of expenses) {
    if (expense.status === 'disallowed') continue;
    const email = (expense.incurred_by_email || 'Unassigned').toLowerCase();
    const current = totals.get(email) || {
      email,
      name: expense.incurred_by_name || email,
      total: 0,
      count: 0,
    };
    current.total += Math.abs(Number(expense.amount) || 0);
    current.count += 1;
    totals.set(email, current);
  }

  return Array.from(totals.values()).sort((a, b) => b.total - a.total);
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
    const unitCount = lotItems.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
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
      unitCount,
      allocatedCost,
      averageCost: unitCount > 0 ? totalCost / unitCount : 0,
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
  const allocatableUnitCount = items.reduce((sum, item) => item.purchase_price_override ? sum : sum + (Number(item.quantity) || 1), 0);
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
      : fallbackEqual
        ? remainingCost / Math.max(1, allocatableUnitCount)
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
  missingCogsItemCount: number;
  missingCogsRevenue: number;
  cogsCoverage: number;
  cogsStatus: 'complete' | 'needs_review';
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  grossMargin: number;
  netMargin: number;
  revenueByPlatform: Record<string, number>;
  expensesByCategory: Record<string, number>;
};

export type MissingCogsItem = {
  id: string;
  product_name: string;
  console: string | null;
  sell_price: number;
  sold_at: string | null;
  sold_via: string | null;
};

function getPeriodBounds(year: number, month?: number) {
  return {
    startDate: month
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`,
    endDate: month
      ? new Date(year, month, 0).toISOString().slice(0, 10)
      : `${year}-12-31`,
  };
}

export async function getPLStatement(year: number, month?: number): Promise<PLStatement> {
  const { startDate, endDate } = getPeriodBounds(year, month);

  const { data: txns, error } = await supabase
    .from('financial_transactions')
    .select('type, amount, category, platform, source, reference_id')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) throw new Error(error.message);

  const { data: soldItems } = await supabase
    .from('inventory_items')
    .select('id, product_name, console, sell_price, purchase_price, sold_at, sold_via')
    .eq('status', 'sold')
    .gte('sold_at', startDate + 'T00:00:00Z')
    .lte('sold_at', endDate + 'T23:59:59Z');

  let revenue = 0;
  let cogs = 0;
  let soldItemCount = 0;
  let knownCogsItemCount = 0;
  let missingCogsItemCount = 0;
  let missingCogsRevenue = 0;
  let operatingExpenses = 0;
  const revenueByPlatform: Record<string, number> = {};
  const expensesByCategory: Record<string, number> = {};
  const generatedSaleRefs = new Set((txns || []).map((tx) => tx.reference_id).filter(Boolean));

  for (const item of (soldItems || [])) {
    const sp = parseFloat(item.sell_price) || 0;
    const pp = parseFloat(item.purchase_price) || 0;
    soldItemCount++;
    if (pp > 0) {
      cogs += pp;
      knownCogsItemCount++;
    } else {
      missingCogsItemCount++;
      missingCogsRevenue += sp;
    }
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
  const cogsCoverage = soldItemCount > 0 ? (knownCogsItemCount / soldItemCount) * 100 : 100;

  return {
    period: month ? `${year}-${String(month).padStart(2, '0')}` : String(year),
    revenue,
    cogs,
    missingCogsItemCount,
    missingCogsRevenue,
    cogsCoverage,
    cogsStatus: missingCogsItemCount > 0 ? 'needs_review' : 'complete',
    grossProfit,
    operatingExpenses,
    netProfit,
    grossMargin,
    netMargin,
    revenueByPlatform,
    expensesByCategory,
  };
}

export async function getMissingCogsItems(year: number, month?: number): Promise<MissingCogsItem[]> {
  const { startDate, endDate } = getPeriodBounds(year, month);
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, product_name, console, sell_price, sold_at, sold_via, purchase_price')
    .eq('status', 'sold')
    .gte('sold_at', startDate + 'T00:00:00Z')
    .lte('sold_at', endDate + 'T23:59:59Z')
    .or('purchase_price.is.null,purchase_price.eq.0')
    .order('sold_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((item) => ({
    id: item.id,
    product_name: item.product_name || 'Untitled item',
    console: item.console,
    sell_price: Number(item.sell_price) || 0,
    sold_at: item.sold_at,
    sold_via: item.sold_via,
  }));
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
