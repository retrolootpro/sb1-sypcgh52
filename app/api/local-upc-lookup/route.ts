import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const PC_API_BASE = 'https://www.pricecharting.com/api';
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

type ApiKeyRow = {
  provider: string;
  api_key: string;
};

const PLATFORM_SLUGS: Record<string, string> = {
  wii: 'wii',
  'wii u': 'wii-u',
  switch: 'nintendo-switch',
  'nintendo switch': 'nintendo-switch',
  gamecube: 'gamecube',
  'nintendo 64': 'nintendo-64',
  n64: 'nintendo-64',
  snes: 'super-nintendo',
  nes: 'nes',
  'playstation 5': 'playstation-5',
  ps5: 'playstation-5',
  'playstation 4': 'playstation-4',
  ps4: 'playstation-4',
  'playstation 3': 'playstation-3',
  ps3: 'playstation-3',
  'playstation 2': 'playstation-2',
  ps2: 'playstation-2',
  playstation: 'playstation',
  'xbox series x': 'xbox-series-x',
  'xbox one': 'xbox-one',
  'xbox 360': 'xbox-360',
  xbox: 'xbox',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function absoluteUrl(url: string, base = 'https://www.pricecharting.com') {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function pcFetch(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.status === 'success' && data['product-name'] ? data : null;
}

async function fetchPriceChartingImage(productName: string, platform: string) {
  const platformSlug = PLATFORM_SLUGS[platform.toLowerCase().trim()] ?? slug(platform);
  const directUrl = `https://www.pricecharting.com/game/${platformSlug}/${slug(productName)}`;
  const response = await fetch(directUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!response.ok) return { imageUrl: '', thumbnailUrl: '' };

  const html = await response.text();
  const coverBlock = html.match(/<div[^>]+class=["'][^"']*\bcover\b[^"']*["'][\s\S]*?<\/div>/i)?.[0] ?? '';
  const image =
    coverBlock.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/<img[^>]+itemprop=["']image["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]+itemprop=["']image["']/i)?.[1] ||
    '';

  if (!image) return { imageUrl: '', thumbnailUrl: '' };
  const thumbnailUrl = absoluteUrl(decodeHtml(image), new URL(directUrl).origin);
  return {
    imageUrl: thumbnailUrl.replace(/\/240\.jpg($|\?)/, '/1600.jpg$1'),
    thumbnailUrl,
  };
}

export async function GET() {
  return json({
    ok: true,
    message: 'Local UPC lookup endpoint is running. Use POST with a barcode from the deal scanner.',
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const { barcode, titleHint } = await req.json().catch(() => ({}));
    const cleanBarcode = String(barcode ?? '').trim();
    if (!cleanBarcode) return json({ success: false, message: 'Barcode is required' }, 400);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const { data: apiKeys } = await supabase
      .from('user_api_keys')
      .select('provider, api_key')
      .eq('user_id', user.id)
      .eq('status', 'active');

    const keyMap = new Map((apiKeys as ApiKeyRow[] | null ?? []).map((row) => [row.provider, row.api_key]));
    const pcKey = keyMap.get('pricecharting');
    if (!pcKey) {
      return json({
        success: false,
        errorCode: 'CONFIG_ERROR',
        message: 'PriceCharting API key is required for local UPC lookup.',
      });
    }

    const queries = [
      `${PC_API_BASE}/product?t=${pcKey}&upc=${encodeURIComponent(cleanBarcode)}`,
      titleHint ? `${PC_API_BASE}/product?t=${pcKey}&q=${encodeURIComponent(String(titleHint))}` : '',
    ].filter(Boolean);

    let product: any = null;
    for (const query of queries) {
      product = await pcFetch(query);
      if (product) break;
    }

    if (!product) {
      return json({
        success: false,
        errorCode: 'NO_MATCH',
        message: `No PriceCharting product found for UPC ${cleanBarcode}.`,
      });
    }

    const title = String(product['product-name'] ?? '').trim();
    const platform = String(product['console-name'] ?? '').trim();
    const image = title && platform ? await fetchPriceChartingImage(title, platform) : { imageUrl: '', thumbnailUrl: '' };

    return json({
      success: true,
      barcode: cleanBarcode,
      title,
      platform,
      category: 'Video Games',
      brand: platform,
      imageUrl: image.imageUrl,
      thumbnailUrl: image.thumbnailUrl,
      pcProductId: product.id ? String(product.id) : '',
      source: 'pricecharting',
    });
  } catch (error) {
    return json({
      success: false,
      errorCode: 'LOCAL_UPC_ERROR',
      message: error instanceof Error ? error.message : 'Local UPC lookup failed',
    });
  }
}
