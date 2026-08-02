import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';

export const dynamic = 'force-dynamic';

const PC_API_BASE = 'https://www.pricecharting.com/api';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function cents(raw: unknown) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'string' ? parseInt(raw, 10) : Math.round(Number(raw));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value) / 100;
}

async function getPriceChartingKey(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader) throw new Error('Missing authorization');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Auth failed');
  const { accountId } = await getServerAccountContext(supabase, user);

  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', accountId)
    .eq('provider', 'pricecharting')
    .eq('status', 'active')
    .maybeSingle();

  if (!keyRow?.api_key) throw new Error('PriceCharting API key not configured');
  return keyRow.api_key as string;
}

async function fetchPriceCharting(path: string, params: Record<string, string>) {
  const url = new URL(`${PC_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status === 'error') {
    throw new Error(data?.['error-message'] || data?.message || `PriceCharting returned ${response.status}`);
  }
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = await getPriceChartingKey(req);
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || 'search');

    if (mode === 'details') {
      const id = String(body.id || '').trim();
      if (!id) return json({ success: false, message: 'Product id is required' }, 400);
      const product = await fetchPriceCharting('/product', { t: apiKey, id });
      return json({
        success: true,
        product: {
          id: String(product.id || id),
          productName: String(product['product-name'] || ''),
          consoleName: String(product['console-name'] || ''),
          prices: {
            loose: cents(product['loose-price']),
            cib: cents(product['cib-price']),
            new: cents(product['new-price']),
            graded: cents(product['graded-price']),
            gamestop: cents(product['gamestop-price']),
            gamestopTrade: cents(product['gamestop-trade-price']),
            retailLooseBuy: cents(product['retail-loose-buy']),
            retailCibBuy: cents(product['retail-cib-buy']),
            retailNewBuy: cents(product['retail-new-buy']),
          },
          raw: product,
        },
      });
    }

    const query = [String(body.title || '').trim(), String(body.platform || '').trim()].filter(Boolean).join(' ');
    if (!query) return json({ success: false, message: 'Search title is required' }, 400);

    const results = await fetchPriceCharting('/products', { t: apiKey, q: query });
    return json({
      success: true,
      query,
      products: (results.products || []).slice(0, 50).map((product: any) => ({
        id: String(product.id || ''),
        productName: String(product['product-name'] || ''),
        consoleName: String(product['console-name'] || ''),
      })),
    });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'PriceCharting search failed',
    }, 200);
  }
}
