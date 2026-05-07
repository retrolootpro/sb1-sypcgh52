import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getItemRegionDetails } from '@/lib/region';
import { getServerAccountContext } from '@/lib/server-account';

export const dynamic = 'force-dynamic';

type ApiKeyRow = {
  provider: string;
  api_key: string;
};

type InventoryRow = {
  id: string;
  product_name: string;
  console: string;
  barcode?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  genre?: string | null;
  region?: string | null;
  pricing_matched_title?: string | null;
  pricing_matched_platform?: string | null;
  pc_source_product_id?: string | null;
};

type MetadataResult = {
  title?: string;
  platform?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  description?: string;
  genre?: string;
  brand?: string;
  category?: string;
  pcProductId?: string;
  source: string;
};

const PC_API_BASE = 'https://www.pricecharting.com/api';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const PLATFORM_SLUGS: Record<string, string> = {
  wii: 'wii',
  'wii u': 'wii-u',
  'nintendo switch': 'nintendo-switch',
  switch: 'nintendo-switch',
  gamecube: 'gamecube',
  'nintendo 64': 'nintendo-64',
  n64: 'nintendo-64',
  'super nintendo': 'super-nintendo',
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

function cleanTitle(value: string) {
  return value
    .replace(/^\s*(Nintendo|Sony|Microsoft|Ubisoft|EA Sports|EA|Activision|Capcom|Konami|Square Enix|Bethesda|Rockstar Games)\s+/i, '')
    .replace(/\s*-?\s*\(?(PlayStation\s*[1-5]?|PS[1-5]?|Xbox\s*(Series\s*[XS]?|One|360)?|Nintendo\s*Switch|Switch|Wii\s*U?|GameCube|N64|SNES|NES)\)?$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\b(NEW|SEALED|CIB|COMPLETE|LOOSE)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanDescription(value?: string | null) {
  if (!value) return '';
  return value
    .replace(/\s+/g, ' ')
    .replace(/PriceCharting.*$/i, '')
    .trim()
    .slice(0, 500);
}

function absoluteUrl(url: string, base = 'https://www.pricecharting.com') {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
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

async function resolvePriceCharting(item: InventoryRow, apiKey?: string): Promise<{ product: any; strategy: string } | null> {
  if (!apiKey) return null;

  if (item.pc_source_product_id) {
    const product = await pcFetch(`${PC_API_BASE}/product?t=${apiKey}&id=${encodeURIComponent(item.pc_source_product_id)}`);
    if (product) return { product, strategy: 'stored_id' };
  }

  if (item.barcode) {
    const product = await pcFetch(`${PC_API_BASE}/product?t=${apiKey}&upc=${encodeURIComponent(item.barcode)}`);
    if (product) return { product, strategy: 'upc' };
  }

  const cleaned = cleanTitle(item.product_name);
  const queries = [
    `${item.product_name} ${item.console}`,
    cleaned !== item.product_name ? `${cleaned} ${item.console}` : '',
    item.product_name,
  ].filter(Boolean);

  for (const query of queries) {
    const product = await pcFetch(`${PC_API_BASE}/product?t=${apiKey}&q=${encodeURIComponent(query)}`);
    if (product) {
      const id = product.id ? String(product.id) : '';
      if (id) {
        const full = await pcFetch(`${PC_API_BASE}/product?t=${apiKey}&id=${encodeURIComponent(id)}`);
        return { product: full ?? product, strategy: 'title_search' };
      }
      return { product, strategy: 'title_search' };
    }
  }

  return null;
}

async function fetchPriceChartingPage(productName: string, platform: string) {
  const platformSlug = PLATFORM_SLUGS[platform.toLowerCase().trim()] ?? slug(platform);
  const directUrl = `https://www.pricecharting.com/game/${platformSlug}/${slug(productName)}`;
  const direct = await fetch(directUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });

  if (direct.ok) {
    return { html: await direct.text(), url: directUrl };
  }

  const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`${productName} ${platform}`)}&type=videogames`;
  const search = await fetch(searchUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!search.ok) return null;
  const searchHtml = await search.text();
  const link = searchHtml.match(/href="(\/game\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]+)"/);
  if (!link) return null;

  const url = `https://www.pricecharting.com${link[1]}`;
  const page = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!page.ok) return null;
  return { html: await page.text(), url };
}

function extractMeta(html: string, pageUrl: string): Pick<MetadataResult, 'imageUrl' | 'thumbnailUrl' | 'description'> {
  const meta = (property: string) => {
    const regexes = [
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
    ];
    for (const regex of regexes) {
      const match = html.match(regex);
      if (match?.[1]) return decodeHtml(match[1]);
    }
    return '';
  };

  const coverBlock = html.match(/<div[^>]+class=["'][^"']*\bcover\b[^"']*["'][\s\S]*?<\/div>/i)?.[0] ?? '';
  const image =
    coverBlock.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/<img[^>]+itemprop=["']image["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]+itemprop=["']image["']/i)?.[1] ||
    meta('og:image') ||
    meta('twitter:image') ||
    html.match(/<img[^>]+(?:id|class)=["'][^"']*(?:cover|product|game)[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
    '';

  const fullImage = image ? decodeHtml(image).replace(/\/240\.jpg($|\?)/, '/1600.jpg$1') : '';

  return {
    imageUrl: fullImage ? absoluteUrl(fullImage, new URL(pageUrl).origin) : '',
    thumbnailUrl: image ? absoluteUrl(decodeHtml(image), new URL(pageUrl).origin) : '',
    description: cleanDescription(meta('og:description') || meta('description')),
  };
}

async function lookupRawg(title: string, apiKey?: string): Promise<Partial<MetadataResult>> {
  const params = new URLSearchParams({ search: cleanTitle(title), page_size: '3' });
  if (apiKey) params.set('key', apiKey);
  const response = await fetch(`https://api.rawg.io/api/games?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) return {};
  const data = await response.json();
  const game = data.results?.[0];
  if (!game) return {};
  return {
    imageUrl: game.background_image || '',
    thumbnailUrl: game.background_image || '',
    genre: Array.isArray(game.genres) ? game.genres.map((g: any) => g.name).filter(Boolean).slice(0, 2).join(', ') : '',
  };
}

async function lookupSteam(title: string): Promise<Partial<MetadataResult>> {
  const response = await fetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleanTitle(title))}&l=english&cc=US`,
    { cache: 'no-store' }
  );
  if (!response.ok) return {};
  const data = await response.json();
  const appId = data.items?.[0]?.id;
  if (!appId) return {};
  const imageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  return { imageUrl, thumbnailUrl: imageUrl };
}

async function lookupGoogleImage(title: string, platform: string, combinedKey?: string): Promise<Partial<MetadataResult>> {
  if (!combinedKey || !combinedKey.includes(':')) return {};
  const [apiKey, cx] = combinedKey.split(':');
  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: `${cleanTitle(title)} ${platform} video game box art`,
    searchType: 'image',
    num: '3',
    safe: 'active',
    imgType: 'photo',
  });
  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) return {};
  const data = await response.json();
  const link = data.items?.[0]?.link || '';
  return link ? { imageUrl: link, thumbnailUrl: link } : {};
}

function chooseImage(...candidates: Array<string | undefined>) {
  return candidates.find((url) => {
    if (!url) return false;
    const lower = url.toLowerCase();
    return /^https?:\/\//.test(url) && !lower.includes('placeholder') && !lower.includes('no-image');
  }) || '';
}

async function enrichItem(item: InventoryRow, keys: Map<string, string>): Promise<MetadataResult> {
  const pc = await resolvePriceCharting(item, keys.get('pricecharting'));
  const pcProduct = pc?.product;
  const pcTitle = pcProduct?.['product-name'] ? String(pcProduct['product-name']) : item.pricing_matched_title || item.product_name;
  const pcPlatform = pcProduct?.['console-name'] ? String(pcProduct['console-name']) : item.pricing_matched_platform || item.console;

  let pcPageMeta: Partial<MetadataResult> = {};
  const page = await fetchPriceChartingPage(pcTitle, pcPlatform);
  if (page) pcPageMeta = extractMeta(page.html, page.url);

  const rawg = (!pcPageMeta.imageUrl || !item.genre)
    ? await lookupRawg(pcTitle, keys.get('rawg'))
    : {};
  const google = !pcPageMeta.imageUrl && !rawg.imageUrl
    ? await lookupGoogleImage(pcTitle, pcPlatform, keys.get('google_search'))
    : {};
  const steam = !pcPageMeta.imageUrl && !rawg.imageUrl && !google.imageUrl
    ? await lookupSteam(pcTitle)
    : {};

  const imageUrl = chooseImage(pcPageMeta.imageUrl, rawg.imageUrl, google.imageUrl, steam.imageUrl, item.image_url || '');

  return {
    title: pcTitle,
    platform: pcPlatform,
    imageUrl,
    thumbnailUrl: chooseImage(pcPageMeta.thumbnailUrl, rawg.thumbnailUrl, google.thumbnailUrl, steam.thumbnailUrl, imageUrl),
    description: pcPageMeta.description || item.description || '',
    genre: rawg.genre || item.genre || '',
    brand: item.brand || publisherFromPlatform(pcPlatform),
    category: item.category || 'Video Games',
    pcProductId: pcProduct?.id ? String(pcProduct.id) : item.pc_source_product_id || '',
    source: pc ? `pricecharting:${pc.strategy}` : imageUrl ? 'image_search' : 'none',
  };
}

function publisherFromPlatform(platform: string) {
  const p = platform.toLowerCase();
  if (p.includes('nintendo') || ['wii', 'switch', 'gamecube', 'nes', 'snes', 'n64'].some((v) => p.includes(v))) return 'Nintendo';
  if (p.includes('playstation') || p.includes('ps')) return 'Sony';
  if (p.includes('xbox')) return 'Microsoft';
  return '';
}

function shouldUseCleanTitle(current: string, next?: string) {
  if (!next) return false;
  const cleanCurrent = cleanTitle(current).toLowerCase();
  return current.length > next.length + 6 || cleanCurrent === next.toLowerCase();
}

export async function GET() {
  return json({
    ok: true,
    message: 'Local metadata refresh endpoint is running. Use the inventory page button to refresh item metadata and images.',
    method: 'POST',
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, errorCode: 'UNAUTHORIZED', message: 'Missing authorization' });

    const body = await req.json().catch(() => ({}));
    const limit = Number(body.limit) > 0 ? Math.min(Number(body.limit), 250) : 250;
    const force = body.force === true;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, errorCode: 'UNAUTHORIZED', message: 'Auth failed' });
    const { accountId } = await getServerAccountContext(supabase, user);

    const { data: apiKeys } = await supabase
      .from('user_api_keys')
      .select('provider, api_key')
      .eq('user_id', accountId)
      .eq('status', 'active');
    const keyMap = new Map((apiKeys as ApiKeyRow[] | null ?? []).map((key) => [key.provider, key.api_key]));

    const { data: items, error } = await supabase
      .from('inventory_items')
      .select('id, product_name, console, barcode, image_url, thumbnail_url, description, brand, category, genre, region, pricing_matched_title, pricing_matched_platform, pc_source_product_id')
      .eq('user_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rows = (items as InventoryRow[] | null ?? []).filter((item) =>
      force ||
      !item.image_url ||
      !item.thumbnail_url ||
      !item.description ||
      !item.genre ||
      !item.pricing_matched_title ||
      item.product_name !== cleanTitle(item.product_name)
    );

    let updated = 0;
    let skipped = 0;
    const failures: Array<{ id: string; title: string; error: string }> = [];

    for (const item of rows) {
      try {
        const meta = await enrichItem(item, keyMap);
        const updates: Record<string, unknown> = {};

        if (shouldUseCleanTitle(item.product_name, meta.title)) updates.product_name = meta.title;
        if (meta.platform && (!item.console || item.console === 'Unknown')) updates.console = meta.platform;
        if (meta.imageUrl && (force || !item.image_url || item.image_url !== meta.imageUrl)) updates.image_url = meta.imageUrl;
        if (meta.thumbnailUrl && (force || !item.thumbnail_url || item.thumbnail_url !== meta.thumbnailUrl)) updates.thumbnail_url = meta.thumbnailUrl;
        if (meta.description && (force || !item.description)) updates.description = meta.description;
        if (meta.genre && (force || !item.genre)) updates.genre = meta.genre;
        if (meta.brand && (force || !item.brand)) updates.brand = meta.brand;
        if (meta.category && (force || !item.category)) updates.category = meta.category;
        if (meta.title) updates.pricing_matched_title = meta.title;
        if (meta.platform) updates.pricing_matched_platform = meta.platform;
        if (meta.pcProductId) updates.pc_source_product_id = meta.pcProductId;
        const detectedRegion = getItemRegionDetails({
          ...item,
          product_name: meta.title || item.product_name,
          console: meta.platform || item.console,
          description: meta.description || item.description,
          pricing_matched_title: meta.title || item.pricing_matched_title,
          pricing_matched_platform: meta.platform || item.pricing_matched_platform,
        });
        if (detectedRegion && (!item.region || force)) updates.region = detectedRegion.value;

        if (Object.keys(updates).length === 0) {
          skipped++;
          continue;
        }

        const { error: updateError } = await supabase
          .from('inventory_items')
          .update(updates)
          .eq('id', item.id)
          .eq('user_id', accountId);

        if (updateError) throw updateError;
        updated++;
      } catch (err) {
        failures.push({
          id: item.id,
          title: item.product_name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return json({
      success: true,
      scanned: rows.length,
      updated,
      skipped,
      failed: failures.length,
      failures: failures.slice(0, 10),
    });
  } catch (error) {
    return json({
      success: false,
      errorCode: 'LOCAL_METADATA_ERROR',
      message: error instanceof Error ? error.message : 'Local metadata refresh failed',
    });
  }
}
