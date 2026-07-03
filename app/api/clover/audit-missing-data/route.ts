import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { buildCloverItemRows, parseCloverWorkbookRows, type InventoryExportItem } from '@/lib/server/clover-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function hasPrice(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const formData = await req.formData();
    const upload = formData.get('file');
    if (!(upload instanceof File)) {
      return json({ success: false, message: 'Upload a Clover export workbook first.' }, 400);
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const account = await getServerAccountContext(supabase, user);
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from('inventory_items')
      .select('id, product_name, console, condition, barcode, sku, quantity, sell_price, selected_market_value, price_cib, price_loose, price_new, price_graded, purchase_price, status, category, item_type, description')
      .eq('user_id', account.accountId)
      .not('status', 'in', '(sold,archived,deleted)');

    if (error) throw error;

    const retroItems = (data || []) as InventoryExportItem[];
    const retroRows = buildCloverItemRows(retroItems);
    const retroByKey = new Map<string, Record<string, unknown> & { inventoryId: string; retroName: string; retroConsole: string; retroCondition: string; retroDescription: string }>();

    retroRows.forEach((row, index) => {
      const item = retroItems[index];
      const entry = {
        ...row,
        inventoryId: item.id,
        retroName: item.product_name || 'Untitled item',
        retroConsole: item.console || '',
        retroCondition: item.condition || '',
        retroDescription: String(item.description || '').trim(),
      };
      const keys = [normalizeKey(row.SKU), normalizeKey(row.Code)].filter(Boolean);
      for (const key of keys) {
        if (!retroByKey.has(key)) retroByKey.set(key, entry);
      }
    });

    const cloverRows = parseCloverWorkbookRows(Buffer.from(await upload.arrayBuffer()));
    const issues = cloverRows
      .map((row) => {
        const match = retroByKey.get(normalizeKey(row.sku)) || retroByKey.get(normalizeKey(row.productCode));
        if (!match) return null;

        const missingFields: Array<{ field: string; cloverValue: string; retroLootValue: string }> = [];
        if (!String(row.sku || '').trim() && String(match.SKU || '').trim()) {
          missingFields.push({ field: 'SKU', cloverValue: '', retroLootValue: String(match.SKU || '') });
        }
        if (!String(row.productCode || '').trim() && String(match.Code || '').trim()) {
          missingFields.push({ field: 'Product Code / UPC', cloverValue: '', retroLootValue: String(match.Code || '') });
        }
        if (!String(row.category || '').trim() && String(match.Category || '').trim()) {
          missingFields.push({ field: 'Category', cloverValue: '', retroLootValue: String(match.Category || '') });
        }
        if (!String(row.description || '').trim() && String(match.retroDescription || '').trim()) {
          missingFields.push({ field: 'Description', cloverValue: '', retroLootValue: String(match.retroDescription || '') });
        }
        if (!hasPrice(row.price) && hasPrice(match.Price)) {
          missingFields.push({ field: 'Price', cloverValue: String(row.price || ''), retroLootValue: String(match.Price || '') });
        }

        if (missingFields.length === 0) return null;
        return {
          cloverId: row.cloverId,
          cloverName: row.name,
          retroLootItemId: match.inventoryId,
          retroLootName: match.retroName,
          retroLootConsole: match.retroConsole,
          retroLootCondition: match.retroCondition,
          missingFields,
        };
      })
      .filter(Boolean);

    return json({
      success: true,
      totalCloverRows: cloverRows.length,
      matchedRetroLootRows: issues.length,
      issues,
    });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Clover audit failed' }, 500);
  }
}
