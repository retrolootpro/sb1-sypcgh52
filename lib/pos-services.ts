import { supabase } from './supabase';
import { getActiveAccountId } from './account';

const cents = (value: number) => Math.round((Number(value) || 0) * 100);
const currency = (value: number) => Number((cents(value) / 100).toFixed(2));

export type PosCustomer = {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  phone?: string;
  rewards_number?: string;
  credit_balance: number;
  lifetime_spend: number;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type PosInventoryItem = {
  id: string;
  title: string;
  platform?: string | null;
  condition?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  purchase_price?: number | null;
  status: string;
};

export type PosCartLine = {
  id: string;
  source: 'inventory' | 'manual';
  inventory_item_id?: string | null;
  item_name: string;
  platform?: string;
  quantity: number;
  unit_price: number;
};

export type PosSaleItem = {
  id: string;
  sale_id: string;
  inventory_item_id?: string | null;
  item_name: string;
  platform?: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  item_source: 'inventory' | 'manual';
  created_at: string;
};

export type PosSale = {
  id: string;
  sale_number: string;
  customer_id?: string | null;
  subtotal: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  tax_zip?: string;
  tax_source?: string;
  total_amount: number;
  payment_method: 'cash' | 'clover_card' | 'external_card' | 'square' | 'stripe' | 'trade_credit' | 'split' | 'other';
  trade_credit_used: number;
  cash_received: number;
  processor_reference?: string;
  status: 'draft' | 'completed' | 'voided' | 'refunded';
  notes?: string;
  sold_at: string;
  pos_sale_items?: PosSaleItem[];
};

export type PosSaleActionStatus = 'voided' | 'refunded';

export type PosTaxSettings = {
  user_id: string;
  default_tax_rate: number;
  tax_zip: string;
  tax_source: string;
  tax_lookup_provider: string;
  tax_lookup_enabled: boolean;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const DEFAULT_POS_TAX_SETTINGS: Omit<PosTaxSettings, 'user_id'> = {
  default_tax_rate: 0,
  tax_zip: '',
  tax_source: 'manual',
  tax_lookup_provider: '',
  tax_lookup_enabled: false,
};

export type PosBuy = {
  id: string;
  buy_number: string;
  customer_id?: string | null;
  item_summary: string;
  offer_amount: number;
  payout_type: 'cash' | 'trade_credit' | 'mixed';
  cash_paid: number;
  trade_credit_issued: number;
  status: 'quoted' | 'completed' | 'declined' | 'voided';
  notes?: string;
  bought_at: string;
};

export type PosBuyItem = {
  id?: string;
  title: string;
  platform?: string;
  condition?: string;
  condition_rating?: number;
  quantity: number;
  pricecharting_value: number;
  gamestop_value: number;
  market_value: number;
  recommended_cash_offer: number;
  recommended_trade_offer: number;
  accepted_offer: number;
  pricing_source?: string;
  pricing_notes?: string;
};

export async function searchPosInventory(search = ''): Promise<PosInventoryItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  let query = supabase
    .from('inventory_items')
    .select('id, title:product_name, platform:console, condition, barcode, image_url, thumbnail_url, sell_price, selected_market_value, price_loose, price_cib, price_new, price_graded, purchase_price, status')
    .eq('user_id', accountId)
    .in('status', ['available', 'ready_to_list', 'listed', 'reserved'])
    .order('product_name', { ascending: true })
    .limit(80);

  const term = search.trim();
  if (term) {
    query = query.or(`product_name.ilike.%${term}%,console.ilike.%${term}%,barcode.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PosInventoryItem[];
}

export async function searchPosCustomers(search = ''): Promise<PosCustomer[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  let query = supabase
    .from('pos_customers')
    .select('*')
    .eq('user_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(40);

  const term = search.trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,rewards_number.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PosCustomer[];
}

export async function createPosCustomer(input: { name: string; email?: string; phone?: string; notes?: string }): Promise<PosCustomer> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('pos_customers')
    .insert({
      user_id: accountId,
      name: input.name.trim(),
      email: input.email?.trim() || '',
      phone: input.phone?.trim() || '',
      notes: input.notes?.trim() || '',
    })
    .select()
    .single();

  if (error) throw error;
  return data as PosCustomer;
}

export async function getPosTaxSettings(): Promise<PosTaxSettings> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('pos_tax_settings')
    .select('*')
    .eq('user_id', accountId)
    .maybeSingle();

  if (error) throw error;
  return {
    user_id: accountId,
    ...DEFAULT_POS_TAX_SETTINGS,
    ...(data || {}),
  } as PosTaxSettings;
}

export async function upsertPosTaxSettings(input: Partial<PosTaxSettings>): Promise<PosTaxSettings> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const rate = Math.max(0, Math.min(1, Number(input.default_tax_rate || 0)));
  const { data, error } = await supabase
    .from('pos_tax_settings')
    .upsert({
      user_id: accountId,
      default_tax_rate: rate,
      tax_zip: input.tax_zip?.trim() || '',
      tax_source: input.tax_source?.trim() || 'manual',
      tax_lookup_provider: input.tax_lookup_provider?.trim() || '',
      tax_lookup_enabled: Boolean(input.tax_lookup_enabled),
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return data as PosTaxSettings;
}

export async function completePosSale(input: {
  customer_id?: string | null;
  lines: PosCartLine[];
  discount_amount: number;
  tax_rate: number;
  tax_zip?: string;
  tax_source?: string;
  payment_method: PosSale['payment_method'];
  trade_credit_used: number;
  cash_received: number;
  processor_reference?: string;
  notes?: string;
}): Promise<PosSale> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const subtotal = currency(input.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0));
  const discount = currency(Math.min(Number(input.discount_amount || 0), subtotal));
  const taxableSubtotal = currency(Math.max(0, subtotal - discount));
  const taxAmount = currency(taxableSubtotal * Number(input.tax_rate || 0));
  const total = currency(taxableSubtotal + taxAmount);
  const creditUsed = currency(Math.min(Number(input.trade_credit_used || 0), total));

  const { data: sale, error: saleError } = await supabase
    .from('pos_sales')
    .insert({
      user_id: accountId,
      customer_id: input.customer_id || null,
      subtotal,
      discount_amount: discount,
      tax_rate: Number(input.tax_rate || 0),
      tax_amount: taxAmount,
      tax_zip: input.tax_zip?.trim() || '',
      tax_source: input.tax_source?.trim() || '',
      total_amount: total,
      payment_method: input.payment_method,
      trade_credit_used: creditUsed,
      cash_received: Number(input.cash_received || 0),
      processor_reference: input.processor_reference?.trim() || '',
      status: 'completed',
      notes: input.notes?.trim() || '',
    })
    .select()
    .single();

  if (saleError) throw saleError;

  const saleItems = input.lines.map((line) => ({
    user_id: accountId,
    sale_id: sale.id,
    inventory_item_id: line.inventory_item_id || null,
    item_name: line.item_name,
    platform: line.platform || '',
    quantity: Number(line.quantity || 1),
    unit_price: Number(line.unit_price || 0),
    line_total: currency(Number(line.quantity || 1) * Number(line.unit_price || 0)),
    item_source: line.source,
  }));

  const { error: itemsError } = await supabase.from('pos_sale_items').insert(saleItems);
  if (itemsError) throw itemsError;

  const { error: financeError } = await supabase.from('financial_transactions').insert({
    user_id: accountId,
    date: new Date().toISOString().slice(0, 10),
    description: `POS sale ${sale.sale_number}`,
    amount: total,
    type: 'income',
    category: 'Sales',
    subcategory: 'POS',
    source: 'show',
    platform: 'POS Register',
    reference_id: sale.id,
    merchant_name: 'RetroLootPro POS',
    notes: [
      input.payment_method ? `Tender: ${input.payment_method}` : '',
      input.processor_reference?.trim() ? `Card ref: ${input.processor_reference.trim()}` : '',
      creditUsed > 0 ? `Trade credit used: $${creditUsed.toFixed(2)}` : '',
    ].filter(Boolean).join(' | '),
    is_reconciled: false,
  });
  if (financeError) throw financeError;

  const inventoryIds = input.lines
    .filter((line) => line.source === 'inventory' && line.inventory_item_id)
    .map((line) => line.inventory_item_id as string);

  await Promise.all(inventoryIds.map(async (id) => {
    const { error } = await supabase
      .from('inventory_items')
      .update({
        status: 'sold',
        sell_price: input.lines.find((line) => line.inventory_item_id === id)?.unit_price || 0,
        sold_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', accountId);
    if (error) throw error;
  }));

  if (input.customer_id) {
    const { data: customer } = await supabase
      .from('pos_customers')
      .select('credit_balance, lifetime_spend')
      .eq('id', input.customer_id)
      .single();

    const nextCredit = Math.max(0, Number(customer?.credit_balance || 0) - creditUsed);
    const nextSpend = Number(customer?.lifetime_spend || 0) + total;

    const { error: customerError } = await supabase
      .from('pos_customers')
      .update({ credit_balance: nextCredit, lifetime_spend: nextSpend })
      .eq('id', input.customer_id);
    if (customerError) throw customerError;

    if (creditUsed > 0) {
      const { error: ledgerError } = await supabase.from('pos_customer_credit_ledger').insert({
        user_id: accountId,
        customer_id: input.customer_id,
        amount: -creditUsed,
        entry_type: 'redeemed',
        source_type: 'sale',
        source_id: sale.id,
        note: `Redeemed on sale ${sale.sale_number}`,
      });
      if (ledgerError) throw ledgerError;
    }
  }

  return sale as PosSale;
}

export async function getRecentPosSales(limit = 30): Promise<PosSale[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data, error } = await supabase
    .from('pos_sales')
    .select('*, pos_sale_items(*)')
    .eq('user_id', accountId)
    .order('sold_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as PosSale[];
}

export async function updatePosSaleStatus(saleId: string, status: PosSaleActionStatus): Promise<PosSale> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data: sale, error: saleError } = await supabase
    .from('pos_sales')
    .select('*')
    .eq('id', saleId)
    .eq('user_id', accountId)
    .single();
  if (saleError) throw saleError;
  if (!sale) throw new Error('Sale not found');
  if (sale.status !== 'completed') throw new Error(`Sale is already ${sale.status}`);

  const { error: updateError } = await supabase
    .from('pos_sales')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', saleId)
    .eq('user_id', accountId);
  if (updateError) throw updateError;

  const reversalLabel = status === 'refunded' ? 'POS refund' : 'POS void';
  const { error: financeError } = await supabase.from('financial_transactions').insert({
    user_id: accountId,
    date: new Date().toISOString().slice(0, 10),
    description: `${reversalLabel} ${sale.sale_number}`,
    amount: -Math.abs(Number(sale.total_amount || 0)),
    type: 'refund',
    category: 'Refunds',
    subcategory: 'POS',
    source: 'show',
    platform: 'POS Register',
    reference_id: sale.id,
    merchant_name: 'RetroLootPro POS',
    notes: `Reversal for POS sale ${sale.sale_number}`,
    is_reconciled: false,
  });
  if (financeError) throw financeError;

  const { data: saleItems, error: itemError } = await supabase
    .from('pos_sale_items')
    .select('inventory_item_id')
    .eq('sale_id', saleId)
    .eq('user_id', accountId);
  if (itemError) throw itemError;

  const inventoryIds = (saleItems || [])
    .map((item: any) => item.inventory_item_id)
    .filter(Boolean);

  if (inventoryIds.length > 0) {
    const { error: inventoryError } = await supabase
      .from('inventory_items')
      .update({ status: 'available', sold_at: null })
      .in('id', inventoryIds)
      .eq('user_id', accountId);
    if (inventoryError) throw inventoryError;
  }

  const creditUsed = Number(sale.trade_credit_used || 0);
  if (sale.customer_id && creditUsed > 0) {
    const { data: customer } = await supabase
      .from('pos_customers')
      .select('credit_balance')
      .eq('id', sale.customer_id)
      .eq('user_id', accountId)
      .single();

    const nextCredit = Number(customer?.credit_balance || 0) + creditUsed;
    const { error: customerError } = await supabase
      .from('pos_customers')
      .update({ credit_balance: nextCredit })
      .eq('id', sale.customer_id)
      .eq('user_id', accountId);
    if (customerError) throw customerError;

    const { error: ledgerError } = await supabase.from('pos_customer_credit_ledger').insert({
      user_id: accountId,
      customer_id: sale.customer_id,
      amount: creditUsed,
      entry_type: 'adjustment',
      source_type: 'sale',
      source_id: sale.id,
      note: `Returned credit from ${status} sale ${sale.sale_number}`,
    });
    if (ledgerError) throw ledgerError;
  }

  return { ...(sale as PosSale), status };
}

export async function completeCustomerBuy(input: {
  customer_id?: string | null;
  item_summary: string;
  items?: PosBuyItem[];
  offer_amount: number;
  payout_type: PosBuy['payout_type'];
  cash_paid: number;
  trade_credit_issued: number;
  notes?: string;
}): Promise<PosBuy> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const accountId = await getActiveAccountId(session.user);

  const { data: buy, error } = await supabase
    .from('pos_customer_buys')
    .insert({
      user_id: accountId,
      customer_id: input.customer_id || null,
      item_summary: input.item_summary.trim(),
      offer_amount: Number(input.offer_amount || 0),
      payout_type: input.payout_type,
      cash_paid: Number(input.cash_paid || 0),
      trade_credit_issued: Number(input.trade_credit_issued || 0),
      status: 'completed',
      notes: input.notes?.trim() || '',
    })
    .select()
    .single();

  if (error) throw error;

  if (input.items?.length) {
    const buyItems = input.items.map((item) => ({
      user_id: accountId,
      buy_id: buy.id,
      title: item.title.trim(),
      platform: item.platform?.trim() || '',
      condition: item.condition?.trim() || '',
      condition_rating: Number(item.condition_rating || 5),
      quantity: Number(item.quantity || 1),
      pricecharting_value: Number(item.pricecharting_value || 0),
      gamestop_value: Number(item.gamestop_value || 0),
      market_value: Number(item.market_value || 0),
      recommended_cash_offer: Number(item.recommended_cash_offer || 0),
      recommended_trade_offer: Number(item.recommended_trade_offer || 0),
      accepted_offer: Number(item.accepted_offer || 0),
      pricing_source: item.pricing_source?.trim() || '',
      pricing_notes: item.pricing_notes?.trim() || '',
    }));

    const { error: itemsError } = await supabase.from('pos_customer_buy_items').insert(buyItems);
    if (itemsError) throw itemsError;
  }

  if (input.customer_id && Number(input.trade_credit_issued || 0) > 0) {
    const { data: customer } = await supabase
      .from('pos_customers')
      .select('credit_balance')
      .eq('id', input.customer_id)
      .single();

    const nextCredit = Number(customer?.credit_balance || 0) + Number(input.trade_credit_issued || 0);
    const { error: customerError } = await supabase
      .from('pos_customers')
      .update({ credit_balance: nextCredit })
      .eq('id', input.customer_id);
    if (customerError) throw customerError;

    const { error: ledgerError } = await supabase.from('pos_customer_credit_ledger').insert({
      user_id: accountId,
      customer_id: input.customer_id,
      amount: Number(input.trade_credit_issued || 0),
      entry_type: 'issued',
      source_type: 'buy',
      source_id: buy.id,
      note: `Trade credit issued for buy ${buy.buy_number}`,
    });
    if (ledgerError) throw ledgerError;
  }

  return buy as PosBuy;
}
