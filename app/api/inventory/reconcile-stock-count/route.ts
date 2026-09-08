import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

type StockRecord = {
  section: 'Book' | 'Game' | 'Misc';
  sourceRow: number;
  'Item Name': string;
  SKU?: string | null;
  Quantity?: number | null;
  'Unit Price'?: number | null;
  Version?: string | null;
  Region?: string | null;
  Console?: string | null;
  Condition?: string | null;
  Notes?: string | null;
};

type InventoryRow = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  quantity: number;
  item_type?: string | null;
  category?: string | null;
  created_at: string;
  lot_id?: string | null;
  status?: string | null;
};

type DesiredStock = {
  key: string;
  section: StockRecord['section'];
  sourceRows: number[];
  name: string;
  console: string;
  condition: string;
  quantity: number;
  unitPrice: number;
  sku: string;
  version: string;
  region: string;
  notes: string;
};

const PROTECTED_LOT_START = '2026-09-06T04:00:00.000Z';
const PROTECTED_LOT_END = '2026-09-07T04:00:00.000Z';
const ARCHIVE_REASON = 'stock_count_2026-08-30';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the|edition|game)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedPlatform(value: unknown) {
  const platform = normalizeText(value).replace(/playstation/g, 'ps').replace(/nintendo/g, '').trim();
  const aliases: Record<string, string> = {
    'xbox': 'og xbox',
    'xbox original': 'og xbox',
    'game boy': 'gameboy',
    'game boy color': 'gameboy color',
    'game boy advance': 'gameboy advance',
    '3ds': '3ds',
    'ds': 'ds',
    'switch': 'switch',
  };
  return aliases[platform] || platform;
}

function mapCondition(section: StockRecord['section'], value: unknown) {
  if (section === 'Book') return 'Loose';
  if (section === 'Misc') return normalizeText(value).includes('new') ? 'New' : 'Loose';
  const condition = normalizeText(value);
  if (condition.includes('new') || condition.includes('sealed')) return 'New';
  if (condition.includes('cib') || condition.includes('complete')) return 'CIB';
  if (condition.includes('graded')) return 'Graded';
  return 'Loose';
}

function levenshteinRatio(left: string, right: string) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function tokenRatio(left: string, right: string) {
  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = Array.from(a).filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

function titleSimilarity(left: string, right: string) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (a === b) return 1;
  return levenshteinRatio(a, b) * 0.65 + tokenRatio(a, b) * 0.35;
}

function isBookRow(item: InventoryRow) {
  const type = normalizeText(item.item_type);
  const category = normalizeText(item.category);
  const platform = normalizeText(item.console);
  return ['book', 'manga', 'comic', 'graphic novel', 'strategy guide'].some((value) => (
    type.includes(value) || category.includes(value) || platform.includes(value)
  ));
}

function familyCompatible(desired: DesiredStock, item: InventoryRow) {
  if (desired.section === 'Book') return isBookRow(item);
  if (desired.section === 'Game') return !isBookRow(item);
  return !isBookRow(item);
}

function aggregateRecords(records: StockRecord[]) {
  const grouped = new Map<string, DesiredStock>();
  for (const record of records) {
    const name = String(record['Item Name'] || '').trim();
    const quantity = Math.max(0, Math.round(Number(record.Quantity) || 0));
    if (!name || quantity <= 0 || !['Book', 'Game', 'Misc'].includes(record.section)) continue;
    const consoleName = record.section === 'Game'
      ? String(record.Console || 'Unknown').trim()
      : record.section === 'Book' ? 'Book' : 'Miscellaneous';
    const condition = mapCondition(record.section, record.Condition);
    const key = [record.section, normalizeText(name), normalizedPlatform(consoleName), condition].join('|');
    const current = grouped.get(key);
    if (current) {
      current.quantity += quantity;
      current.sourceRows.push(record.sourceRow);
      continue;
    }
    grouped.set(key, {
      key,
      section: record.section,
      sourceRows: [record.sourceRow],
      name,
      console: consoleName,
      condition,
      quantity,
      unitPrice: Math.max(0, Number(record['Unit Price']) || 0),
      sku: String(record.SKU || '').trim(),
      version: String(record.Version || '').trim(),
      region: String(record.Region || '').trim(),
      notes: String(record.Notes || '').trim(),
    });
  }
  return Array.from(grouped.values());
}

function reconcile(desired: DesiredStock[], inventory: InventoryRow[], protectedIds: Set<string>) {
  const available = inventory.filter((item) => !protectedIds.has(item.id));
  const unused = new Set(available.map((item) => item.id));
  const matches: Array<{ desired: DesiredStock; item: InventoryRow; score: number }> = [];
  const additions: DesiredStock[] = [];

  for (const target of desired) {
    let best: { item: InventoryRow; score: number } | null = null;
    for (const item of available) {
      if (!unused.has(item.id) || !familyCompatible(target, item)) continue;
      const similarity = titleSimilarity(target.name, item.product_name);
      const samePlatform = normalizedPlatform(target.console) === normalizedPlatform(item.console);
      const sameCondition = target.condition === item.condition;
      let score = similarity;
      if (target.section === 'Game') score += samePlatform ? 0.12 : -0.18;
      if (target.section === 'Game') score += sameCondition ? 0.04 : -0.04;
      if (!best || score > best.score) best = { item, score };
    }
    const exactTitle = best && normalizeText(best.item.product_name) === normalizeText(target.name);
    if (best && (best.score >= 0.78 || exactTitle)) {
      matches.push({ desired: target, item: best.item, score: best.score });
      unused.delete(best.item.id);
    } else {
      additions.push(target);
    }
  }

  const archives = available.filter((item) => unused.has(item.id));
  const updates = matches.filter(({ desired: target, item }) => Number(item.quantity) !== target.quantity);
  return { matches, additions, archives, updates };
}

async function authenticate(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader) throw new Error('Missing authorization');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Authentication failed');
  const account = await getServerAccountContext(supabase, user);
  if (account.role !== 'admin') throw new Error('Account administrator access required');
  return account.accountId;
}

async function loadCurrent(accountId: string) {
  const admin = createSupabaseAdmin();
  const [{ data: inventory, error: inventoryError }, { data: lots, error: lotsError }] = await Promise.all([
    admin
      .from('inventory_items')
      .select('id,product_name,console,condition,quantity,item_type,category,created_at,lot_id,status')
      .eq('user_id', accountId)
      .not('status', 'in', '(sold,archived,deleted)'),
    admin
      .from('lots')
      .select('id,name,source,created_at,received_at')
      .eq('user_id', accountId)
      .or(`and(created_at.gte.${PROTECTED_LOT_START},created_at.lt.${PROTECTED_LOT_END}),and(received_at.gte.${PROTECTED_LOT_START},received_at.lt.${PROTECTED_LOT_END})`),
  ]);
  if (inventoryError) throw inventoryError;
  if (lotsError) throw lotsError;
  const protectedLots = lots || [];
  const protectedLotIds = new Set(protectedLots.map((lot) => lot.id));
  const protectedItems = (inventory || []).filter((item) => item.lot_id && protectedLotIds.has(item.lot_id));
  return { admin, inventory: (inventory || []) as InventoryRow[], protectedLots, protectedItems };
}

function previewResult(
  desired: DesiredStock[],
  current: Awaited<ReturnType<typeof loadCurrent>>,
  result: ReturnType<typeof reconcile>,
) {
  return {
    success: true,
    workbook: {
      groups: desired.length,
      units: desired.reduce((sum, item) => sum + item.quantity, 0),
    },
    current: {
      rows: current.inventory.length,
      units: current.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    },
    protectedLots: current.protectedLots,
    protectedItems: current.protectedItems.map((item) => ({
      id: item.id,
      product_name: item.product_name,
      quantity: 1,
      lot_id: item.lot_id,
    })),
    changes: {
      matched: result.matches.length,
      quantityUpdates: result.updates.length,
      additions: result.additions.length,
      archives: result.archives.length,
      additionUnits: result.additions.reduce((sum, item) => sum + item.quantity, 0),
      archivedUnits: result.archives.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    },
    samples: {
      additions: result.additions.slice(0, 20).map((item) => ({ name: item.name, console: item.console, condition: item.condition, quantity: item.quantity })),
      archives: result.archives.slice(0, 20).map((item) => ({ id: item.id, name: item.product_name, console: item.console, condition: item.condition, quantity: item.quantity })),
      fuzzyMatches: result.matches
        .filter((match) => match.score < 0.9)
        .sort((left, right) => left.score - right.score)
        .slice(0, 20)
        .map((match) => ({ workbook: match.desired.name, inventory: match.item.product_name, score: Number(match.score.toFixed(3)) })),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const accountId = await authenticate(req);
    const body = await req.json() as { records?: StockRecord[]; apply?: boolean; confirmation?: string };
    if (!Array.isArray(body.records)) return json({ success: false, message: 'Stock-count records are required' }, 400);
    const desired = aggregateRecords(body.records);
    if (desired.length < 100) return json({ success: false, message: 'The stock-count file does not contain enough valid rows' }, 400);
    const current = await loadCurrent(accountId);
    const protectedIds = new Set(current.protectedItems.map((item) => item.id));
    const result = reconcile(desired, current.inventory, protectedIds);
    const preview = previewResult(desired, current, result);

    if (!body.apply) return json(preview);
    if (body.confirmation !== 'APPLY STOCK COUNT 2026-08-30') {
      return json({ success: false, message: 'Confirmation phrase is invalid' }, 400);
    }

    const changedAt = new Date().toISOString();
    const liveItemTypes = Array.from(new Set(current.inventory.map((item) => item.item_type).filter(Boolean))) as string[];
    const candidateTypes: Record<StockRecord['section'], string[]> = {
      Book: Array.from(new Set([...liveItemTypes, 'book', 'media', 'unknown', 'game'])),
      Game: Array.from(new Set([...liveItemTypes, 'game', 'unknown', 'console', 'accessory'])),
      Misc: Array.from(new Set([...liveItemTypes, 'accessory', 'unknown', 'console', 'game'])),
    };
    const compatibleTypes = {} as Record<StockRecord['section'], string>;
    for (const section of ['Book', 'Game', 'Misc'] as const) {
      const sample = result.additions.find((item) => item.section === section);
      if (!sample) continue;
      let accepted = '';
      for (const candidate of candidateTypes[section]) {
        const { data: probe, error: probeError } = await current.admin
          .from('inventory_items')
          .insert({
            user_id: accountId,
            product_name: sample.name,
            console: sample.console,
            condition: sample.condition,
            purchase_price: 0,
            quantity: 1,
            notes: [sample.notes, 'Imported from P&P Stock Count - 8.30.26'].filter(Boolean).join(' | '),
            category: section === 'Book' ? 'Books & Media' : section === 'Game' ? 'Video Games' : 'Miscellaneous',
            item_type: candidate,
          })
          .select('id')
          .single();
        if (!probeError && probe) {
          await current.admin.from('inventory_items').delete().eq('id', probe.id).eq('user_id', accountId);
          accepted = candidate;
          break;
        }
      }
      if (!accepted) throw new Error(`No production-compatible item type found for ${section}`);
      compatibleTypes[section] = accepted;
    }

    const updatesByQuantity = new Map<number, string[]>();
    for (const update of result.updates) {
      const ids = updatesByQuantity.get(update.desired.quantity) || [];
      ids.push(update.item.id);
      updatesByQuantity.set(update.desired.quantity, ids);
    }
    const quantityWrites = Array.from(updatesByQuantity.entries()).flatMap(([quantity, ids]) => (
      Array.from({ length: Math.ceil(ids.length / 200) }, (_, batchIndex) => (
        current.admin
          .from('inventory_items')
          .update({ quantity, updated_at: changedAt, clover_sync_status: 'pending' })
          .eq('user_id', accountId)
          .in('id', ids.slice(batchIndex * 200, (batchIndex + 1) * 200))
      ))
    ));
    const quantityResults = await Promise.all(quantityWrites);
    const quantityError = quantityResults.find((write) => write.error)?.error;
    if (quantityError) throw quantityError;

    for (let index = 0; index < result.archives.length; index += 200) {
      const ids = result.archives.slice(index, index + 200).map((item) => item.id);
      const { error } = await current.admin
        .from('inventory_items')
        .update({
          status: 'archived',
          quantity: 0,
          archived_at: changedAt,
          archived_reason: ARCHIVE_REASON,
          updated_at: changedAt,
          clover_sync_status: 'pending',
        })
        .eq('user_id', accountId)
        .in('id', ids);
      if (error) throw error;
    }

    const insertRows = result.additions.map((item) => ({
      user_id: accountId,
      product_name: item.name,
      console: item.console,
      condition: item.condition,
      purchase_price: 0,
      quantity: item.quantity,
      notes: [item.notes, 'Imported from P&P Stock Count - 8.30.26'].filter(Boolean).join(' | '),
      category: item.section === 'Book' ? 'Books & Media' : item.section === 'Game' ? 'Video Games' : 'Miscellaneous',
      item_type: compatibleTypes[item.section],
    }));
    for (const section of ['Book', 'Game', 'Misc'] as const) {
      const sectionRows = insertRows.filter((_, index) => result.additions[index].section === section);
      for (let index = 0; index < sectionRows.length; index += 100) {
        const { error } = await current.admin.from('inventory_items').insert(sectionRows.slice(index, index + 100));
        if (error) throw new Error(`${section} rows ${index + 1}-${Math.min(index + 100, sectionRows.length)}: ${error.message}`);
      }
    }

    const { data: verified, error: verifyError } = await current.admin
      .from('inventory_items')
      .select('id,quantity,lot_id,status')
      .eq('user_id', accountId)
      .not('status', 'in', '(sold,archived,deleted)');
    if (verifyError) throw verifyError;
    return json({
      ...preview,
      applied: true,
      verified: {
        rows: verified?.length || 0,
        units: (verified || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        protectedItemsPresent: current.protectedItems.every((item) => verified?.some((row) => row.id === item.id)),
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : 'Stock-count reconciliation failed';
    const status = /auth|administrator/i.test(message) ? 401 : 500;
    return json({ success: false, message }, status);
  }
}
