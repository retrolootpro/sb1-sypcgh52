import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

const ENRICHMENT_BATCH_SIZE = 100;
const PRICING_PAGE_SIZE = 500;

function normalizeCategory(item: Record<string, any>) {
  const explicit = `${item.category || ''} ${item.item_type || ''}`.trim().toLowerCase();
  const fallback = `${item.console || ''} ${item.product_name || ''}`.toLowerCase();
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

export async function loadStorefrontCatalog() {
    const admin = createSupabaseAdmin();
    const { data: store, error: storeError } = await admin.from('storefront_settings')
      .select('user_id').eq('public_slug', 'pixel-and-page').eq('is_active', true).single();
    if (storeError || !store?.user_id) throw new Error('Configure the active Pixel & Page account in storefront_settings.');
    const accountId = String(store.user_id);
    const inventoryRows: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data: rows, error: inventoryError } = await admin
      .from('inventory_items')
      .select('id,user_id,product_name,console,condition,quantity,notes,image_url,barcode,created_at,status')
      .eq('user_id', accountId)
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 499);
      if (inventoryError) throw new Error(`Inventory query failed: ${errorDetails(inventoryError)}`);
      inventoryRows.push(...(rows || []));
      if (!rows || rows.length < 500) break;
    }
    const accountInventory = inventoryRows.filter((row) => row.user_id === accountId
      && !['sold', 'archived', 'deleted', 'reserved'].includes(row.status || 'available'));
    const ids = accountInventory.map((row: any) => row.id);

    const metadataByItem = new Map<string, Record<string, any>>();
    for (let offset = 0; offset < ids.length; offset += ENRICHMENT_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + ENRICHMENT_BATCH_SIZE);
      const { data: metadataRows, error: metadataError } = await admin
        .from('inventory_items')
        .select('id,category,item_type,storefront_price,storefront_featured,storefront_description,storefront_category,storefront_compare_at_price')
        .eq('user_id', accountId)
        .in('id', batchIds);

      if (!metadataError) {
        for (const row of metadataRows || []) metadataByItem.set(String(row.id), row);
      } else {
        throw new Error(`Storefront pricing metadata unavailable: ${errorDetails(metadataError)}`);
      }
    }

    const pricingByItem = new Map<string, Record<string, any>>();
    for (let offset = 0; offset < ids.length; offset += ENRICHMENT_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + ENRICHMENT_BATCH_SIZE);
      for (let pageOffset = 0; ; pageOffset += PRICING_PAGE_SIZE) {
        const { data: pricingRows, error: pricingError } = await admin
          .from('pricing_data')
          .select('item_id,loose_price,cib_price,new_price,fetched_at')
          .in('item_id', batchIds)
          .order('fetched_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
          .range(pageOffset, pageOffset + PRICING_PAGE_SIZE - 1);

        if (pricingError) throw new Error(`Pricing query failed: ${errorDetails(pricingError)}`);
        for (const row of pricingRows || []) {
          if (!pricingByItem.has(String(row.item_id))) pricingByItem.set(String(row.item_id), row);
        }
        if (!pricingRows || pricingRows.length < PRICING_PAGE_SIZE) break;
      }
    }

    const products = accountInventory
      .map((baseItem: any) => {
        const item = { ...baseItem, ...(metadataByItem.get(String(baseItem.id)) || {}) };
        const override = Number(item.storefront_price);
        const price = Number.isFinite(override) && override > 0 ? override : priceForCondition(item.condition, pricingByItem.get(String(item.id)));
        return {
          id: String(item.id),
          slug: `${slugify(item.product_name)}-${String(item.id).slice(0, 8)}`,
          title: item.product_name || 'Inventory item',
          category: item.storefront_category || normalizeCategory(item),
          platform: item.console || '',
          condition: item.condition || 'Available',
          price,
          compare_at_price: item.storefront_compare_at_price || null,
          quantity: Number(item.quantity || 0),
          featured: Boolean(item.storefront_featured),
          description: item.storefront_description || null,
          image_url: item.image_url || null,
          thumbnail_url: null,
          brand: null,
          barcode: item.barcode || null,
          created_at: item.created_at,
        };
      })
      .filter((item) => item.price > 0);

    return {
      success: true,
      products,
      profile: {
        store_name: 'Pixel & Page',
        tagline: 'Every Story Has a Save Point',
        announcement: 'Online only - Shipping to your door',
        support_email: 'support@pixelandpagellc.com',
        logo_path: '/pixel-page-logo.svg',
      },
      warning: accountInventory.length > 0 && products.length === 0
        ? `${accountInventory.length} in-stock items were found, but none have usable pricing_data records yet.`
        : undefined,
      diagnostics: {
        activeInventoryCount: accountInventory.length,
        pricedInventoryCount: products.length,
        categorizedInventoryCount: metadataByItem.size,
      },
    };
}
