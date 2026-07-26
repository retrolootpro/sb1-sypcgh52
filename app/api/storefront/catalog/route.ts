import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeCategory(value: unknown, consoleName: unknown) {
  const text = `${value || ''} ${consoleName || ''}`.toLowerCase();
  if (text.includes('book') || text.includes('media') || text.includes('paperback') || text.includes('hardcover')) return 'Books';
  if (text.includes('console') || text.includes('handheld') || text.includes('system')) return 'Consoles';
  if (text.includes('collect') || text.includes('accessor') || text.includes('controller') || text.includes('figure') || text.includes('funko')) return 'Collectibles';
  return 'Games';
}

function publicPrice(item: Record<string, any>) {
  const condition = String(item.condition || '').toLowerCase();
  const candidates = [
    item.storefront_price,
    item.selected_market_value,
    condition.includes('new') ? item.price_new : null,
    condition.includes('complete') || condition.includes('cib') ? item.price_cib : null,
    item.price_loose,
    item.price_cib,
    item.price_new,
  ];
  for (const value of candidates) {
    const amount = Number(value || 0);
    if (amount > 0) return amount;
  }
  return 0;
}

export async function GET() {
  try {
    const admin = createSupabaseAdmin();

    const { data: setting } = await admin
      .from('storefront_settings')
      .select('*')
      .eq('public_slug', 'pixel-and-page')
      .eq('is_active', true)
      .maybeSingle();

    let accountId = setting?.user_id as string | undefined;

    if (!accountId) {
      const { data: owners, error: ownerError } = await admin
        .from('inventory_items')
        .select('user_id')
        .gt('quantity', 0)
        .not('status', 'in', '(sold,archived,deleted)')
        .limit(5000);
      if (ownerError) throw ownerError;
      const counts = new Map<string, number>();
      for (const row of owners || []) counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
      accountId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    if (!accountId) {
      return NextResponse.json({ success: true, products: [], profile: null, warning: 'No active inventory account was found.' });
    }

    const { data: rows, error } = await admin
      .from('inventory_items')
      .select('id,product_name,console,condition,quantity,status,category,item_type,brand,description,notes,image_url,thumbnail_url,barcode,created_at,storefront_slug,storefront_price,storefront_compare_at_price,storefront_featured,storefront_description,storefront_category,storefront_sort_order,selected_market_value,price_loose,price_cib,price_new')
      .eq('user_id', accountId)
      .gt('quantity', 0)
      .not('status', 'in', '(sold,archived,deleted)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const products = (rows || [])
      .map((item: any) => {
        const price = publicPrice(item);
        return {
          id: String(item.id),
          slug: item.storefront_slug || `${String(item.product_name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${String(item.id).slice(0, 8)}`,
          title: item.product_name || 'Inventory item',
          category: normalizeCategory(item.storefront_category || item.category || item.item_type, item.console),
          platform: item.console || '',
          condition: item.condition || 'Available',
          price,
          compare_at_price: Number(item.storefront_compare_at_price || 0) || null,
          quantity: Number(item.quantity || 0),
          featured: Boolean(item.storefront_featured),
          description: item.storefront_description || item.description || item.notes || null,
          image_url: item.image_url || null,
          thumbnail_url: item.thumbnail_url || null,
          brand: item.brand || null,
          barcode: item.barcode || null,
          created_at: item.created_at,
          sort_order: Number(item.storefront_sort_order || 0),
        };
      })
      .filter((item) => item.price > 0)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order || String(b.created_at).localeCompare(String(a.created_at)));

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
    });
  } catch (error) {
    console.error('Storefront catalog error:', error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Catalog could not be loaded.' }, { status: 500 });
  }
}
