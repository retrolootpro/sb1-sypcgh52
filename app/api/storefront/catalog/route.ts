import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BLOCKED_STATUSES = new Set(['sold', 'archived', 'deleted']);

function normalizeCategory(value: unknown, consoleName: unknown) {
  const text = `${value || ''} ${consoleName || ''}`.toLowerCase();
  if (text.includes('book') || text.includes('media') || text.includes('paperback') || text.includes('hardcover')) return 'Books';
  if (text.includes('console') || text.includes('handheld') || text.includes('system')) return 'Consoles';
  if (text.includes('collect') || text.includes('accessor') || text.includes('controller') || text.includes('figure') || text.includes('funko')) return 'Collectibles';
  return 'Games';
}

function isUnavailable(item: Record<string, any>) {
  const status = String(item.status || '').trim().toLowerCase();
  return BLOCKED_STATUSES.has(status) || Boolean(item.sold_at) || Boolean(item.archived_at);
}

function publicPrice(item: Record<string, any>) {
  const condition = String(item.condition || '').toLowerCase();
  const candidates = [
    item.selected_market_value,
    condition.includes('graded') ? item.price_graded : null,
    condition.includes('new') || condition.includes('sealed') ? item.price_new : null,
    condition.includes('complete') || condition.includes('cib') ? item.price_cib : null,
    item.price_loose,
    item.price_cib,
    item.price_new,
    item.price_graded,
  ];

  for (const value of candidates) {
    const amount = Number(value || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return 0;
}

function slugify(value: unknown) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function GET() {
  try {
    const admin = createSupabaseAdmin();

    const { data: setting, error: settingError } = await admin
      .from('storefront_settings')
      .select('*')
      .eq('public_slug', 'pixel-and-page')
      .eq('is_active', true)
      .maybeSingle();

    if (settingError) {
      console.warn('Storefront settings are not available yet; using defaults.', settingError.message);
    }

    const { data: ownerRows, error: ownerError } = await admin
      .from('inventory_items')
      .select('user_id,status,sold_at,archived_at')
      .gt('quantity', 0)
      .limit(10000);

    if (ownerError) throw ownerError;

    const counts = new Map<string, number>();
    for (const row of ownerRows || []) {
      if (!row.user_id || isUnavailable(row)) continue;
      counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
    }

    const configuredAccountId = setting?.user_id as string | undefined;
    const accountId = configuredAccountId && counts.has(configuredAccountId)
      ? configuredAccountId
      : Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!accountId) {
      return NextResponse.json({
        success: true,
        products: [],
        profile: setting || null,
        warning: 'RetroLootPro did not find any in-stock inventory records for the storefront.',
        diagnostics: { activeInventoryCount: 0, pricedInventoryCount: 0, accountCandidates: counts.size },
      });
    }

    const { data: rows, error } = await admin
      .from('inventory_items')
      .select('id,product_name,console,condition,quantity,status,sold_at,archived_at,category,item_type,description,image_url,thumbnail_url,barcode,created_at,selected_market_value,price_loose,price_cib,price_new,price_graded')
      .eq('user_id', accountId)
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const activeRows = (rows || []).filter((item: any) => !isUnavailable(item));
    const products = activeRows
      .map((item: any) => {
        const price = publicPrice(item);
        return {
          id: String(item.id),
          slug: `${slugify(item.product_name)}-${String(item.id).slice(0, 8)}`,
          title: item.product_name || 'Inventory item',
          category: normalizeCategory(item.category || item.item_type, item.console),
          platform: item.console || '',
          condition: item.condition || 'Available',
          price,
          compare_at_price: null,
          quantity: Number(item.quantity || 0),
          featured: false,
          description: item.description || null,
          image_url: item.image_url || null,
          thumbnail_url: item.thumbnail_url || null,
          brand: null,
          barcode: item.barcode || null,
          created_at: item.created_at,
        };
      })
      .filter((item) => item.price > 0)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const warning = activeRows.length > 0 && products.length === 0
      ? `${activeRows.length} in-stock inventory item${activeRows.length === 1 ? '' : 's'} were found, but none currently have a market price. Add a selected, loose, CIB, new, or graded price in RetroLootPro.`
      : undefined;

    return NextResponse.json({
      success: true,
      products,
      profile: setting || {
        store_name: 'Pixel & Page',
        tagline: 'Every Story Has a Save Point',
        announcement: 'Fresh inventory added every week',
        pickup_name: 'Pixel & Page at Daytona Flea Market',
        pickup_details: 'Friday-Sunday. Pickup instructions are provided after checkout.',
        logo_path: '/pixel-page-logo.svg',
      },
      warning,
      diagnostics: {
        activeInventoryCount: activeRows.length,
        pricedInventoryCount: products.length,
        accountCandidates: counts.size,
        usedConfiguredAccount: Boolean(configuredAccountId && configuredAccountId === accountId),
      },
    });
  } catch (error) {
    console.error('Storefront catalog error:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Catalog could not be loaded.',
    }, { status: 500 });
  }
}
