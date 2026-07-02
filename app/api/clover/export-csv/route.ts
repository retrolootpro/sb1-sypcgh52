import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

type InventoryExportItem = {
  id: string;
  product_name: string | null;
  console?: string | null;
  condition?: string | null;
  barcode?: string | null;
  sku?: string | null;
  quantity?: number | null;
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_cib?: number | null;
  price_loose?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  purchase_price?: number | null;
  status?: string | null;
  category?: string | null;
  item_type?: string | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0.00';
  return numeric.toFixed(2);
}

function quantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '1';
  return String(Math.max(1, Math.floor(numeric)));
}

function firstPositiveMoney(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function retailLabelPrice(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const whole = Math.floor(numeric);
  const cents = numeric - whole;
  return cents < 0.5 ? Math.max(0, whole - 0.01) : Math.max(0, whole + 1 - 0.01);
}

function labelBasePrice(item: InventoryExportItem) {
  return firstPositiveMoney(
    item.sell_price,
    item.selected_market_value,
    item.price_cib,
    item.price_loose,
    item.price_new,
    item.price_graded,
    item.purchase_price,
  );
}

function categoryFor(item: InventoryExportItem) {
  const itemType = String(item.item_type || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  const platform = String(item.console || '').toLowerCase();

  if (itemType.includes('book') || category.includes('book') || category.includes('manga')) return 'Books & Media';
  if (itemType.includes('console') || category.includes('console')) return 'Consoles';
  if (itemType.includes('accessory') || category.includes('accessory')) return 'Accessories';
  if (itemType.includes('collect') || category.includes('collect')) return 'Collectibles';
  if (platform || itemType.includes('game') || category.includes('game')) return 'Video Games';
  return 'RetroLootPro';
}

function itemName(item: InventoryExportItem) {
  const title = String(item.product_name || 'Untitled Item').trim();
  const parts = [item.console, item.condition].map((part) => String(part || '').trim()).filter(Boolean);
  return parts.length ? `${title} (${parts.join(' - ')})` : title;
}

function skuFor(item: InventoryExportItem) {
  const explicitSku = item.sku?.trim();
  if (explicitSku) return explicitSku;
  const id = String(item.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  return id ? `RLP-${id}` : '';
}

function writeCsv(headers: string[], rows: Record<string, unknown>[]) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\r\n');
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const account = await getServerAccountContext(supabase, user);
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from('inventory_items')
      .select('id, product_name, console, condition, barcode, sku, quantity, sell_price, selected_market_value, price_cib, price_loose, price_new, price_graded, purchase_price, status, category, item_type')
      .eq('user_id', account.accountId)
      .order('product_name', { ascending: true });

    if (error) throw error;

    const rows = (data || [])
      .filter((item: InventoryExportItem) => !['sold', 'shipped', 'returned', 'archived', 'deleted', 'dead stock', 'dead_stock'].includes(String(item.status || '').toLowerCase()))
      .map((item: InventoryExportItem) => ({
        Name: itemName(item),
        Price: money(retailLabelPrice(labelBasePrice(item))),
        SKU: skuFor(item),
        Code: item.barcode || '',
        Category: categoryFor(item),
        Taxable: 'TRUE',
        Quantity: quantity(item.quantity),
      }));

    const csv = writeCsv(['Name', 'Price', 'SKU', 'Code', 'Category', 'Taxable', 'Quantity'], rows);
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="retrolootpro-clover-import-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Clover CSV export failed' }, 500);
  }
}
