import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { lookupBookMetadataByBarcode, normalizeBookIdentifier } from '@/lib/book-metadata-service';

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

type LookupMode = 'auto' | 'book' | 'game';

type RetailBarcodeResult = {
  title: string;
  description: string;
  brand: string;
  category: string;
  imageUrl: string;
  thumbnailUrl: string;
  source: string;
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

async function timedFetchJson(url: string, init: RequestInit = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function cleanProductText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function imageFromList(value: unknown) {
  return Array.isArray(value) ? cleanProductText(value[0]) : '';
}

async function lookupBarcodeLookupProduct(barcode: string, apiKey?: string | null): Promise<RetailBarcodeResult | null> {
  if (!apiKey) return null;
  const data = await timedFetchJson(
    `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(barcode)}&formatted=y&key=${encodeURIComponent(apiKey)}`
  );
  const product = Array.isArray(data?.products) ? data.products[0] : null;
  const title = cleanProductText(product?.title || product?.product_name);
  if (!title) return null;
  const imageUrl = imageFromList(product?.images);
  return {
    title,
    description: cleanProductText(product?.description),
    brand: cleanProductText(product?.brand || product?.manufacturer || 'Books'),
    category: cleanProductText(product?.category || 'Books'),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: 'barcode_lookup',
  };
}

async function lookupUpcItemDbProduct(barcode: string, apiKey?: string | null): Promise<RetailBarcodeResult | null> {
  if (!apiKey) return null;
  const data = await timedFetchJson(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
    {
      headers: {
        Accept: 'application/json',
        user_key: apiKey,
      },
    }
  );
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  const title = cleanProductText(item?.title);
  if (!title) return null;
  const imageUrl = imageFromList(item?.images);
  return {
    title,
    description: cleanProductText(item?.description),
    brand: cleanProductText(item?.brand || 'Books'),
    category: cleanProductText(item?.category || 'Books'),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: 'upcitemdb',
  };
}

async function lookupRetailBookProduct(barcode: string, keyMap: Map<string, string>): Promise<RetailBarcodeResult | null> {
  const providers = [
    () => lookupBarcodeLookupProduct(barcode, keyMap.get('barcode_lookup')),
    () => lookupUpcItemDbProduct(barcode, keyMap.get('upc_lookup')),
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result?.title) return result;
    } catch {
      // Continue to the next provider; this path is a rescue lookup, not a hard failure.
    }
  }

  return null;
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

function normalizeLookupMode(value: unknown): LookupMode {
  const mode = String(value || 'auto').toLowerCase();
  if (mode === 'book' || mode === 'books' || mode === 'media') return 'book';
  if (mode === 'game' || mode === 'games') return 'game';
  return 'auto';
}

function manualBookFallback(barcode: string, message: string, sourcesTried: string[] = []) {
  const title = `Book ${barcode}`;
  return {
    success: true,
    manualFallback: true,
    barcode,
    title,
    platform: 'Book',
    category: 'Books',
    brand: 'Books',
    description: message,
    imageUrl: '',
    thumbnailUrl: '',
    pcProductId: '',
    source: 'manual_book_barcode',
    bookMetadata: {
      title,
      subtitle: '',
      authors: [],
      publisher: '',
      publishedDate: '',
      publishedYear: '',
      description: '',
      pageCount: null,
      categories: [],
      language: '',
      isbn10: '',
      isbn13: '',
      coverImageUrl: '',
      format: '',
      retailPrice: null,
      retailPriceCurrency: '',
      retailPriceSource: '',
      source: 'manual_book_barcode',
      sourcesTried,
    },
  };
}

function googleBooksKeyFromSettings(keyMap: Map<string, string>) {
  const explicit = keyMap.get('google_books');
  if (explicit) return explicit.trim();
  const googleSearch = keyMap.get('google_search') || '';
  return googleSearch.split(':')[0]?.trim() || '';
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

    const { barcode, titleHint, lookupMode } = await req.json().catch(() => ({}));
    const cleanBarcode = String(barcode ?? '').trim();
    if (!cleanBarcode) return json({ success: false, message: 'Barcode is required' }, 400);
    const mode = normalizeLookupMode(lookupMode);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);
    const { accountId } = await getServerAccountContext(supabase, user);

    const { data: apiKeys } = await supabase
      .from('user_api_keys')
      .select('provider, api_key')
      .eq('user_id', accountId)
      .eq('status', 'active');

    const keyMap = new Map((apiKeys as ApiKeyRow[] | null ?? []).map((row) => [row.provider, row.api_key]));
    const pcKey = keyMap.get('pricecharting');
    const bookIdentifier = normalizeBookIdentifier(cleanBarcode);
    const shouldLookupAsBook = mode === 'book' || (mode !== 'game' && bookIdentifier.valid);

    if (shouldLookupAsBook) {
      if (!bookIdentifier.valid) {
        return json(manualBookFallback(
          cleanBarcode,
          bookIdentifier.reason || `Barcode ${cleanBarcode} could not be validated as an ISBN. Enter the book title and price manually.`,
          []
        ));
      }

      let book = null;
      try {
        book = await lookupBookMetadataByBarcode(cleanBarcode, {
          googleBooksApiKey: googleBooksKeyFromSettings(keyMap),
        });
      } catch {
        book = null;
      }

      if (book) {
        const displayTitle = book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
        return json({
          success: true,
          barcode: cleanBarcode,
          title: displayTitle,
          platform: book.platform,
          category: book.category,
          brand: book.brand,
          description: book.description,
          imageUrl: book.imageUrl,
          thumbnailUrl: book.thumbnailUrl,
          pcProductId: '',
          source: book.source,
          bookMetadata: {
            title: book.title,
            subtitle: book.subtitle,
            authors: book.authors,
            publisher: book.publisher,
            publishedDate: book.publishedDate,
            publishedYear: book.publishedYear,
            description: book.description,
            pageCount: book.pageCount,
            categories: book.categories,
            language: book.language,
            isbn10: book.isbn10,
            isbn13: book.isbn13,
            coverImageUrl: book.coverImageUrl,
            format: book.format,
            retailPrice: book.retailPrice,
            retailPriceCurrency: book.retailPriceCurrency,
            retailPriceSource: book.retailPriceSource,
            source: book.source,
            sourcesTried: book.sourcesTried,
          },
        });
      }

      const retailProduct = await lookupRetailBookProduct(cleanBarcode, keyMap);
      if (retailProduct) {
        return json({
          success: true,
          barcode: cleanBarcode,
          title: retailProduct.title,
          platform: 'Book',
          category: retailProduct.category || 'Books',
          brand: retailProduct.brand || 'Books',
          description: retailProduct.description,
          imageUrl: retailProduct.imageUrl,
          thumbnailUrl: retailProduct.thumbnailUrl,
          pcProductId: '',
          source: retailProduct.source,
          bookMetadata: {
            title: retailProduct.title,
            subtitle: '',
            authors: [],
            publisher: retailProduct.brand || '',
            publishedDate: '',
            publishedYear: '',
            description: retailProduct.description,
            pageCount: null,
            categories: [retailProduct.category || 'Books'].filter(Boolean),
            language: '',
            isbn10: bookIdentifier.isbn10,
            isbn13: bookIdentifier.isbn13,
            coverImageUrl: retailProduct.imageUrl,
            format: '',
            retailPrice: null,
            retailPriceCurrency: '',
            retailPriceSource: '',
            source: retailProduct.source,
            sourcesTried: ['open_library', 'google_books', 'barcode_lookup', 'upcitemdb'],
          },
        });
      }

      return json(manualBookFallback(
        cleanBarcode,
        `No book metadata found for barcode ${cleanBarcode}. Enter the book title and price manually.`,
        bookIdentifier.valid ? ['open_library', 'google_books', 'barcode_lookup', 'upcitemdb'] : []
      ));
    }

    if (!pcKey) {
      return json({
        success: false,
        errorCode: 'CONFIG_ERROR',
        message: 'PriceCharting API key is required for game UPC lookup.',
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
