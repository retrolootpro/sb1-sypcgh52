import { supabase } from './supabase';
import { getActiveAccountId } from './account';

export type DisputeReason =
  | 'shipping_damage'
  | 'as_is_untested'
  | 'buyer_remorse'
  | 'item_as_described'
  | 'missing_item'
  | 'region_compatibility'
  | 'not_working'
  | 'other';

export type DisputeCase = {
  id: string;
  user_id: string;
  inventory_item_id: string | null;
  platform: string;
  order_reference: string | null;
  buyer_name: string | null;
  tracking_number: string | null;
  status: string;
  reason: DisputeReason;
  claim_amount: number;
  refund_amount: number;
  opened_at: string;
  response_due_at: string | null;
  condition_notes: string | null;
  testing_status: string | null;
  packing_notes: string | null;
  buyer_messages: string | null;
  dispute_notes: string | null;
  response_template: string | null;
  inventory_items?: { product_name: string; console: string; condition: string } | null;
};

export type InventoryBundle = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  strategy: string;
  status: string;
  best_channel: string | null;
  cost_basis: number;
  market_value: number;
  recommended_ask: number;
  floor_price: number;
  emergency_floor_price: number;
  expected_profit: number;
  notes: string | null;
  bundle_items?: { id: string; inventory_item_id: string; inventory_items?: { product_name: string; console: string; condition: string } | null }[];
};

export type BuyRule = {
  id: string;
  user_id: string;
  subject_type: string;
  subject: string;
  recommendation: 'buy_under' | 'bundle_only' | 'avoid' | 'hold' | 'watch';
  max_buy_price: number;
  target_margin_percent: number;
  reason: string | null;
  evidence_summary: string | null;
  total_bought: number;
  total_sold: number;
  total_spent: number;
  total_sales: number;
  defect_count: number;
  return_count: number;
  average_days_to_sell: number;
};

export type PrebuyLotItem = {
  id?: string;
  title: string;
  platform?: string;
  category?: string;
  condition?: string;
  estimated_market_value: number;
  estimated_sell_price?: number;
  estimated_shipping?: number;
  risk_level?: 'low' | 'normal' | 'high' | 'avoid';
  item_role?: 'best_item' | 'normal' | 'slow_mover' | 'risky' | 'avoid';
  notes?: string;
  sort_order?: number;
};

export type PrebuyLotAnalysis = {
  id: string;
  user_id: string;
  name: string;
  source: string | null;
  supplier: string | null;
  asking_price: number;
  estimated_shipping: number;
  estimated_fees: number;
  total_estimated_cost: number;
  estimated_resale_value: number;
  recommended_max_buy_price: number;
  expected_profit: number;
  worst_case_liquidation_value: number;
  decision: 'good_buy' | 'risky_buy' | 'pass' | 'needs_review';
  risk_flags: string[];
  notes: string | null;
  status: string;
  prebuy_lot_items?: PrebuyLotItem[];
};

export type InventoryForBundle = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  selected_market_value: number | null;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
  price_graded: number | null;
  status: string | null;
  bundle_id: string | null;
};

async function getSessionContext() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return { session, accountId: await getActiveAccountId(session.user) };
}

function money(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

export function disputeResponseTemplate(reason: DisputeReason, itemName = 'the item') {
  const templates: Record<DisputeReason, string> = {
    shipping_damage: `Thank you for reaching out. I am sorry to hear ${itemName} may have been damaged in transit. The item was packed securely and shipped with tracking. Please provide clear photos of the packaging, label, packing material, and item damage so I can review the claim and assist through the platform process.`,
    as_is_untested: `${itemName} was sold as-is/untested as stated in the listing. The description and photos were provided so the buyer could review the condition before purchase. Please refer to the listing notes and photos for the stated condition.`,
    buyer_remorse: `I understand the concern. ${itemName} was accurately described and shown in the listing photos. The item was delivered as listed, so this appears to be a change of mind rather than an item-not-as-described issue.`,
    item_as_described: `${itemName} was shown and described accurately in the listing. The included photos and condition notes document the item before shipment. Please review the listing details and attached evidence.`,
    missing_item: `I am sorry there is a concern about a missing item. Please provide photos of the package, all packing material, and the received contents. I will compare those against my packing records and shipment details.`,
    region_compatibility: `${itemName} was listed with its region/platform information. Region compatibility can vary by system, so buyers should confirm compatibility before purchase. The listing notes and photos identify the item as provided.`,
    not_working: `I am sorry there is a functionality concern. Please provide a short video or photos showing the issue, the system used for testing, and any error messages. I will compare that to the testing/condition notes attached to the order.`,
    other: `Thank you for reaching out. Please provide clear details and photos showing the issue so I can review the listing, condition notes, packing records, and tracking information.`,
  };
  return templates[reason];
}

export function calculateBundleFinancials(items: InventoryForBundle[]) {
  const cost = items.reduce((sum, item) => sum + (Number(item.purchase_price) || 0), 0);
  const market = items.reduce((sum, item) => {
    const selected = Number(item.selected_market_value) || 0;
    const fallback = Number(item.price_cib) || Number(item.price_loose) || Number(item.price_new) || Number(item.price_graded) || 0;
    return sum + (selected || fallback);
  }, 0);
  const recommendedAsk = money(market * 0.9);
  const floorPrice = money(Math.max(cost * 1.2, market * 0.65));
  const emergencyFloorPrice = money(Math.max(cost * 1.05, market * 0.5));
  return {
    cost_basis: money(cost),
    market_value: money(market),
    recommended_ask: recommendedAsk,
    floor_price: floorPrice,
    emergency_floor_price: emergencyFloorPrice,
    expected_profit: money(recommendedAsk - cost),
  };
}

export function analyzePrebuyLot(items: PrebuyLotItem[], askingPrice: number, shipping = 0, fees = 0) {
  const totalCost = money(askingPrice + shipping + fees);
  const resale = money(items.reduce((sum, item) => sum + (Number(item.estimated_sell_price) || Number(item.estimated_market_value) || 0), 0));
  const worstCase = money(items.reduce((sum, item) => {
    const value = Number(item.estimated_market_value) || 0;
    const risk = item.risk_level || 'normal';
    const multiplier = risk === 'avoid' ? 0.15 : risk === 'high' ? 0.35 : risk === 'low' ? 0.65 : 0.5;
    return sum + value * multiplier;
  }, 0));
  const recommendedMaxBuyPrice = money(Math.max(0, resale * 0.45 - shipping - fees));
  const expectedProfit = money(resale - totalCost);
  const margin = resale > 0 ? (expectedProfit / resale) * 100 : 0;
  const riskFlags = [
    items.some((item) => item.risk_level === 'avoid') ? 'Contains avoid-level items' : '',
    items.filter((item) => item.item_role === 'slow_mover').length >= 3 ? 'Multiple slow movers' : '',
    worstCase < totalCost ? 'Worst-case liquidation does not cover cost' : '',
    margin < 20 ? 'Thin expected margin' : '',
  ].filter(Boolean);

  const decision =
    resale <= 0 || totalCost <= 0 ? 'needs_review' :
    askingPrice > recommendedMaxBuyPrice * 1.15 ? 'pass' :
    riskFlags.length > 0 || margin < 30 ? 'risky_buy' :
    'good_buy';

  return {
    total_estimated_cost: totalCost,
    estimated_resale_value: resale,
    recommended_max_buy_price: recommendedMaxBuyPrice,
    expected_profit: expectedProfit,
    worst_case_liquidation_value: worstCase,
    decision,
    risk_flags: riskFlags,
  };
}

export async function getPlanningData() {
  const { accountId } = await getSessionContext();
  const [disputes, bundles, rules, analyses, inventory] = await Promise.all([
    supabase
      .from('dispute_cases')
      .select('*, inventory_items(product_name, console, condition)')
      .eq('user_id', accountId)
      .order('opened_at', { ascending: false }),
    supabase
      .from('inventory_bundles')
      .select('*, bundle_items(id, inventory_item_id, inventory_items(product_name, console, condition))')
      .eq('user_id', accountId)
      .order('created_at', { ascending: false }),
    supabase
      .from('buy_list_rules')
      .select('*')
      .eq('user_id', accountId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('prebuy_lot_analyses')
      .select('*, prebuy_lot_items(*)')
      .eq('user_id', accountId)
      .order('created_at', { ascending: false }),
    supabase
      .from('inventory_items')
      .select('id, product_name, console, condition, purchase_price, selected_market_value, price_loose, price_cib, price_new, price_graded, status, bundle_id')
      .eq('user_id', accountId)
      .neq('status', 'sold')
      .order('product_name', { ascending: true }),
  ]);

  for (const result of [disputes, bundles, rules, analyses, inventory]) {
    if (result.error) throw result.error;
  }

  return {
    disputes: (disputes.data || []) as DisputeCase[],
    bundles: (bundles.data || []) as InventoryBundle[],
    rules: (rules.data || []) as BuyRule[],
    analyses: (analyses.data || []) as PrebuyLotAnalysis[],
    inventory: (inventory.data || []) as InventoryForBundle[],
  };
}

export async function createDisputeCase(input: {
  inventory_item_id?: string | null;
  platform: string;
  order_reference?: string;
  buyer_name?: string;
  tracking_number?: string;
  reason: DisputeReason;
  claim_amount?: number;
  condition_notes?: string;
  testing_status?: string;
  packing_notes?: string;
  buyer_messages?: string;
}) {
  const { accountId } = await getSessionContext();
  const itemName = input.order_reference || 'the item';
  const { error } = await supabase.from('dispute_cases').insert({
    ...input,
    user_id: accountId,
    claim_amount: input.claim_amount || 0,
    response_template: disputeResponseTemplate(input.reason, itemName),
  });
  if (error) throw error;
}

export async function createBundle(input: {
  name: string;
  strategy: string;
  best_channel: string;
  notes?: string;
  itemIds: string[];
  inventory: InventoryForBundle[];
}) {
  const { session, accountId } = await getSessionContext();
  const selected = input.inventory.filter((item) => input.itemIds.includes(item.id));
  const financials = calculateBundleFinancials(selected);

  const { data: bundle, error } = await supabase
    .from('inventory_bundles')
    .insert({
      user_id: accountId,
      name: input.name.trim(),
      strategy: input.strategy,
      best_channel: input.best_channel,
      notes: input.notes || '',
      created_by_user_id: session.user.id,
      ...financials,
    })
    .select('*')
    .single();

  if (error) throw error;

  if (selected.length > 0) {
    const { error: itemsError } = await supabase.from('bundle_items').insert(
      selected.map((item) => ({
        user_id: accountId,
        bundle_id: bundle.id,
        inventory_item_id: item.id,
        allocated_cost: Number(item.purchase_price) || 0,
        market_value_at_add: Number(item.selected_market_value) || Number(item.price_cib) || Number(item.price_loose) || 0,
      }))
    );
    if (itemsError) throw itemsError;

    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({ bundle_id: bundle.id, status: 'reserved' })
      .in('id', selected.map((item) => item.id));
    if (updateError) throw updateError;
  }
}

export async function createBuyRule(input: Omit<BuyRule, 'id' | 'user_id' | 'total_bought' | 'total_sold' | 'total_spent' | 'total_sales' | 'defect_count' | 'return_count' | 'average_days_to_sell'>) {
  const { accountId } = await getSessionContext();
  const { error } = await supabase.from('buy_list_rules').insert({ ...input, user_id: accountId });
  if (error) throw error;
}

export async function createPrebuyAnalysis(input: {
  name: string;
  source?: string;
  supplier?: string;
  asking_price: number;
  estimated_shipping: number;
  estimated_fees: number;
  notes?: string;
  items: PrebuyLotItem[];
}) {
  const { accountId } = await getSessionContext();
  const result = analyzePrebuyLot(input.items, input.asking_price, input.estimated_shipping, input.estimated_fees);
  const { data: analysis, error } = await supabase
    .from('prebuy_lot_analyses')
    .insert({
      user_id: accountId,
      name: input.name,
      source: input.source || '',
      supplier: input.supplier || '',
      asking_price: input.asking_price,
      estimated_shipping: input.estimated_shipping,
      estimated_fees: input.estimated_fees,
      notes: input.notes || '',
      ...result,
      status: 'reviewed',
    })
    .select('*')
    .single();

  if (error) throw error;

  if (input.items.length > 0) {
    const { error: itemsError } = await supabase.from('prebuy_lot_items').insert(
      input.items.map((item, index) => ({
        ...item,
        user_id: accountId,
        analysis_id: analysis.id,
        estimated_sell_price: item.estimated_sell_price || item.estimated_market_value,
        estimated_shipping: item.estimated_shipping || 0,
        risk_level: item.risk_level || 'normal',
        item_role: item.item_role || 'normal',
        sort_order: index,
      }))
    );
    if (itemsError) throw itemsError;
  }
}
