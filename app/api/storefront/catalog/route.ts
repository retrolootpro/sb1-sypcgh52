import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeCategory(item: Record<string, any>) {
  const explicit = `${item.category || ''} ${item.item_type || ''} ${item.book_format || ''}`.trim().toLowerCase();
  const fallback = `${item.console || ''} ${item.product_name || ''} ${item.genre || ''}`.toLowerCase();
  const text = `${explicit} ${fallback}`;

  if (/book|paperback|hardcover|novel|manga|comic|literature/.test(text)) return 'Books';
  if (/console|system|handheld|hardware/.test(explicit) || /console bundle|system bundle|handheld console/.test(fallback)) return 'Consoles';
  if (/collectible|accessor|controller|figure|funko|toy|plush|card|memorabilia|cable|adapter|case/.test(text)) return 'Collectibles';
  return 'Games';
}

function slugify(value: unknown) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function priceForCondition(condition: unknown, pricing: Record<string, any> | undefined) {
  if (!pricing) return 0;
  const value = String(condition || '').toLowerCase();
  const candidates = value.includes('new') || value.includes('sealed')
    ? [pricing.new_price, pricing.cib_price, pricing.loose_price]
    : value.includes('cib') || value.includes('complete')
      ? [pricing.cib_price, pricing.loose_price, pricing.new_price]
      : [pricing.loose_price, pricing.cib_price, pricing.new_price];

  for (const candidate of candidates) {
    const amount = Number(candidate || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function errorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return String(error || 'Unknown error');
  const value = error as Record<string, unknown>;
  return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' | ') || 'Unknown database error';
}

export async function GET() {
  try {
    const admin = createSupabaseAdmin();

    const { data: inventoryRows, error: inventoryError } = await admin
      .from('inventory_items')
      .select('id,user_id,product_name,console,condition,quantity,notes,image_url,barcode,created_at')
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (inventoryError) throw new Error(`Inventory query failed: ${errorDetails(inventoryError)}`);

    const counts = new Map<string, number>();
    for (const row of inventoryRows || []) {
      if (!row.user_id) continue;
      counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
    }

    const accountId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const accountInventory = (inventoryRows || []).filter((row: any) => row.user_id === accountId);
    const ids = accountInventory.map((row: any) => row.id);

    const metadataByItem = new Map<string, Record<string, any>>();
    if (ids.length > 0) {
      // Newer RetroLootPro deployments include these merchandising fields. This query is
      // intentionally optional so an older production schema can still serve the shop.
      const { data: metadataRows, error: metadataError } = await admin
        .from('inventory_items')
        .select('id,category,item_type,book_format,genre,thumbnail_url')
        .in('id', ids);

      if (!metadataError) {
        for (const row of metadataRows || []) metadataByItem.set(String(row.id), row);
      } else {
        console.warn('Storefront metadata enrichment unavailable:', errorDetails(metadataError));
      }
    }

    const pricingByItem = new Map<string, Record<string, any>>();
    if (ids.length > 0) {
      const { data: pricingRows, error: pricingError } = await admin
        .from('pricing_data')
        .select('item_id,loose_price,cib_price,new_price,fetched_at')
        .in('item_id', ids)
        .order('fetched_at', { ascending: false });

      if (pricingError) throw new Error(`Pricing query failed: ${errorDetails(pricingError)}`);
      for (const row of pricingRows || []) {
        if (!pricingByItem.has(String(row.item_id))) pricingByItem.set(String(row.item_id), row);
      }
    }

    const products = accountInventory
      .map((baseItem: any) => {
        const item = { ...baseItem, ...(metadataByItem.get(String(baseItem.id)) || {}) };
        const price = priceForCondition(item.condition, pricingByItem.get(String(item.id)));
        return {
          id: String(item.id),
          slug: `${slugify(item.product_name)}-${String(item.id).slice(0, 8)}`,
          title: item.product_name || 'Inventory item',
          category: normalizeCategory(item),
          platform: item.console || '',
          condition: item.condition || 'Available',
          price,
          compare_at_price: null,
          quantity: Number(item.quantity || 0),
          featured: false,
          description: item.notes || null,
          image_url: item.image_url || null,
          thumbnail_url: item.thumbnail_url || null,
          brand: null,
          barcode: item.barcode || null,
          created_at: item.created_at,
        };
      })
      .filter((item) => item.price > 0);

    return NextResponse.json({
      success: true,
      products,
      profile: {
        store_name: 'Pixel & Page',
        tagline: 'Every Story Has a Save Point',
        announcement: 'Fresh inventory added every week',
        pickup_name: 'Pixel & Page at Daytona Flea Market',
        pickup_details: 'Friday-Sunday. Pickup instructions are provided after checkout.',
        logo_path: '/pixel-page-logo.svg',
      },
      warning: accountInventory.length > 0 && products.length === 0
        ? `${accountInventory.length} in-stock items were found, but none have usable pricing_data records yet.`
        : undefined,
      diagnostics: {
        accountCandidates: counts.size,
        activeInventoryCount: accountInventory.length,
        pricedInventoryCount: products.length,
        enrichedInventoryCount: metadataByItem.size,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : errorDetails(error);
    console.error('Storefront catalog error:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
