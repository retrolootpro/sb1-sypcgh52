import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type ConditionSource = 'pricecharting_api' | 'pricecharting_web' | 'none';

type ConditionPrice = {
  value: number;
  source: ConditionSource;
  sampleCount: number;
};

const PC_API_BASE = 'https://www.pricecharting.com/api';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

function isValidPrice(price: number) {
  return Number.isFinite(price) && price > 0.99 && price < 5000;
}

function cents(raw: unknown) {
  if (raw === null || raw === undefined) return 0;
  const value = typeof raw === 'string' ? parseInt(raw, 10) : Math.round(Number(raw));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value) / 100;
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
    .replace(/\s*-?\s*\(?(PlayStation\s*[1-5]?|PS[1-5]?|Xbox\s*(Series\s*[XS]?|One|360)?|Nintendo\s*Switch|Switch|Wii\s*U?|GameCube|N64|SNES|NES)\)?$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\b(NEW|SEALED|CIB|COMPLETE|LOOSE)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#43;/g, '+')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSummaryPrices(html: string) {
  const text = stripTags(html);
  const guideIdx = text.search(/Full Price Guide:/i);
  const guideText = guideIdx >= 0 ? text.slice(guideIdx, guideIdx + 1200) : text;
  const pick = (pattern: RegExp) => {
    const match = guideText.match(pattern);
    if (!match) return 0;
    const value = parseFloat(match[1].replace(/,/g, ''));
    return isValidPrice(value) ? value : 0;
  };

  const guidePrices = {
    loose: pick(/Loose\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    cib: pick(/(?:Complete|CIB)\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    new: pick(/New\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    graded:
      pick(/Graded New\s+\$\s*([0-9,]+\.[0-9]{2})/i) ||
      pick(/Graded\s+\$\s*([0-9,]+\.[0-9]{2})/i),
  };

  if (guidePrices.loose || guidePrices.cib || guidePrices.new || guidePrices.graded) {
    return guidePrices;
  }

  const headerIdx = text.search(/Loose Price\s+Complete Price\s+New Price\s+Graded Price/i);

  if (headerIdx >= 0) {
    const prices: number[] = [];
    const pricePattern = /\$\s*([0-9,]+\.[0-9]{2})/g;
    const summaryText = text.slice(headerIdx, headerIdx + 900);
    let match: RegExpExecArray | null;
    while ((match = pricePattern.exec(summaryText)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (isValidPrice(price)) prices.push(price);
    }

    if (prices.length >= 4) {
      return {
        loose: prices[0],
        cib: prices[1],
        new: prices[2],
        graded: prices[3],
      };
    }
  }

  return guidePrices;
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

async function resolvePriceCharting(productName: string, platform: string, upc: string | null, apiKey: string) {
  const queries: Array<{ url: string; strategy: string }> = [];
  if (upc) queries.push({ url: `${PC_API_BASE}/product?t=${apiKey}&upc=${encodeURIComponent(upc)}`, strategy: 'upc' });
  queries.push({ url: `${PC_API_BASE}/product?t=${apiKey}&q=${encodeURIComponent(`${productName} ${platform}`)}`, strategy: 'title_platform' });

  const cleaned = cleanTitle(productName);
  if (cleaned && cleaned !== productName) {
    queries.push({ url: `${PC_API_BASE}/product?t=${apiKey}&q=${encodeURIComponent(`${cleaned} ${platform}`)}`, strategy: 'cleaned_title_platform' });
  }

  queries.push({ url: `${PC_API_BASE}/product?t=${apiKey}&q=${encodeURIComponent(productName)}`, strategy: 'title_only' });

  for (const query of queries) {
    const data = await pcFetch(query.url);
    if (data) {
      const id = String(data.id ?? '');
      if (id) {
        const full = await pcFetch(`${PC_API_BASE}/product?t=${apiKey}&id=${encodeURIComponent(id)}`);
        return { product: full ?? data, strategy: query.strategy };
      }
      return { product: data, strategy: query.strategy };
    }
  }

  return null;
}

async function scrapePriceChartingPage(productName: string, platform: string, matchName?: string, matchPlatform?: string) {
  const platformSlug = PLATFORM_SLUGS[(matchPlatform || platform).toLowerCase().trim()] ?? slug(matchPlatform || platform);
  const titleSlug = slug(matchName || productName);
  const directUrl = `https://www.pricecharting.com/game/${platformSlug}/${titleSlug}`;

  const direct = await fetch(directUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });
  let html = '';
  let finalUrl = directUrl;

  if (direct.ok) {
    html = await direct.text();
  } else {
    const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`${matchName || productName} ${matchPlatform || platform}`)}&type=videogames`;
    const search = await fetch(searchUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });
    if (!search.ok) return null;
    const searchHtml = await search.text();
    const link = searchHtml.match(/href="(\/game\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]+)"/);
    if (!link) return null;
    finalUrl = `https://www.pricecharting.com${link[1]}`;
    const page = await fetch(finalUrl, { headers: BROWSER_HEADERS, cache: 'no-store' });
    if (!page.ok) return null;
    html = await page.text();
  }

  const prices = extractSummaryPrices(html);
  if (prices.loose === 0 && prices.cib === 0 && prices.new === 0 && prices.graded === 0) return null;
  return { ...prices, url: finalUrl };
}

function condition(value: number, source: ConditionSource): ConditionPrice {
  return { value: value || 0, source: value > 0 ? source : 'none', sampleCount: 0 };
}

export async function GET() {
  return json({
    ok: true,
    message: 'Local pricing endpoint is running. Open http://127.0.0.1:3000 to use the app; this endpoint is called by Refresh Pricing.',
    method: 'POST',
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, errorCode: 'UNAUTHORIZED', message: 'Missing authorization' });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, errorCode: 'UNAUTHORIZED', message: 'Auth failed' });

    const { productName, platform = '', upc = null } = await req.json();
    if (!productName?.trim()) return json({ success: false, errorCode: 'INVALID_INPUT', message: 'productName required' });

    const { data: keyRow } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', user.id)
      .eq('provider', 'pricecharting')
      .eq('status', 'active')
      .maybeSingle();

    const apiKey = keyRow?.api_key;
    if (!apiKey) {
      return json({ success: false, errorCode: 'CONFIG_ERROR', message: 'PriceCharting API key not configured' });
    }

    const resolved = await resolvePriceCharting(productName.trim(), platform.trim(), upc, apiKey);
    const apiProduct = resolved?.product ?? null;
    const apiPrices = {
      loose: cents(apiProduct?.['loose-price']),
      cib: cents(apiProduct?.['cib-price']),
      new: cents(apiProduct?.['new-price']),
      graded: cents(apiProduct?.['graded-price']),
    };

    const webPrices = await scrapePriceChartingPage(
      productName.trim(),
      platform.trim(),
      apiProduct?.['product-name'],
      apiProduct?.['console-name']
    );

    const finalPrices = {
      loose: apiPrices.loose || webPrices?.loose || 0,
      cib: apiPrices.cib || webPrices?.cib || 0,
      new: apiPrices.new || webPrices?.new || 0,
      graded: apiPrices.graded || webPrices?.graded || 0,
    };

    const conditions = ['loose', 'cib', 'new', 'graded'] as const;
    const missing = conditions.filter((key) => finalPrices[key] === 0);
    if (missing.length === 4) {
      return json({ success: false, errorCode: 'NO_DATA', message: 'No PriceCharting prices found' });
    }

    return json({
      success: true,
      cached: false,
      prices: {
        loose: condition(finalPrices.loose, apiPrices.loose ? 'pricecharting_api' : 'pricecharting_web'),
        cib: condition(finalPrices.cib, apiPrices.cib ? 'pricecharting_api' : 'pricecharting_web'),
        new: condition(finalPrices.new, apiPrices.new ? 'pricecharting_api' : 'pricecharting_web'),
        graded: condition(finalPrices.graded, apiPrices.graded ? 'pricecharting_api' : 'pricecharting_web'),
      },
      pcMatch: apiProduct
        ? {
            productId: String(apiProduct.id ?? ''),
            productName: String(apiProduct['product-name'] ?? productName),
            platform: String(apiProduct['console-name'] ?? platform),
            strategy: resolved?.strategy ?? 'local_pricecharting',
          }
        : null,
      diagnostics: {
        refreshStatus: missing.length === 0 ? 'success' : 'partial',
        missingConditions: missing,
        warnings: webPrices?.url ? [`Local PriceCharting page checked: ${webPrices.url}`] : [],
        ebayBlocked: false,
        pcApiUsed: !!apiProduct,
      },
    });
  } catch (error) {
    return json({
      success: false,
      errorCode: 'LOCAL_ERROR',
      message: error instanceof Error ? error.message : 'Local pricing failed',
    });
  }
}
