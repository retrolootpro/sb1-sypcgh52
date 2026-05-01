/**
 * search-market-prices — Canonical market pricing engine
 *
 * Source priority (high → low):
 *   1. PriceCharting API  — per-condition prices in cents (requires user API key)
 *   2. PriceCharting web  — direct page scrape for any condition API returned 0
 *   3. eBay sold-listing scrape — final fallback for any still-missing condition
 *
 * Known caveats:
 *   • PC API free/limited keys return loose-price but cib/new/graded = 0.
 *     PC web scraping fills this gap without needing a paid key.
 *   • eBay category MUST be 139973 (Video Games, US).  Using the parent
 *     category 1249 returns 0 results silently — confirmed bug.
 *   • eBay searches must be UNQUOTED by default; exact-phrase quotes are too
 *     restrictive and often return 0 matches.
 *
 * Product resolution for PC API:
 *   1. Stored pc_product_id (fastest)
 *   2. UPC exact-match
 *   3. Title + platform search → re-fetch by ID if CIB = 0 in search result
 *   4. Cleaned title + platform
 *   5. Title alone
 *
 * PC web URL construction:
 *   https://www.pricecharting.com/game/{console-slug}/{title-slug}
 *   Slug = lowercase, spaces → hyphens, non-alphanumeric removed.
 *   Falls back to search page if the direct URL 404s.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

// ─── Constants ─────────────────────────────────────────────────────────────

const CACHE_TTL_HOURS = 12;
const PC_API_BASE = 'https://www.pricecharting.com/api';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ─── Types ──────────────────────────────────────────────────────────────────

type ConditionSource = 'pricecharting_api' | 'pricecharting_web' | 'ebay_90d' | 'ebay_web' | 'cached' | 'none';
type RefreshStatus = 'success' | 'partial' | 'failed';

interface ConditionPrice {
  value: number;
  source: ConditionSource;
  sampleCount: number;
}

interface PcMatch {
  productId: string;
  productName: string;
  platform: string;
  strategy: string;
}

interface PricingDiagnostics {
  refreshStatus: RefreshStatus;
  missingConditions: string[];
  warnings: string[];
  ebayBlocked: boolean;
  pcApiUsed: boolean;
  rawPcApiFields?: Record<string, unknown>;
}

interface SuccessPayload {
  success: true;
  cached: boolean;
  prices: Record<string, ConditionPrice>;
  pcMatch: PcMatch | null;
  diagnostics: PricingDiagnostics;
}

interface ErrorPayload {
  success: false;
  errorCode: string;
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isValidPrice(p: number): boolean {
  return Number.isFinite(p) && p > 0.99 && p < 5000;
}

function trimmedMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  if (arr.length <= 2) return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
  const s = [...arr].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(s.length * 0.1));
  const trimmed = s.length > 6 ? s.slice(cut, s.length - cut) : s;
  return Math.round((trimmed.reduce((a, b) => a + b, 0) / trimmed.length) * 100) / 100;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function recentSalesEstimate(prices: number[]): number {
  const valid = prices.filter(isValidPrice).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  if (valid.length <= 2) return Math.round(median(valid) * 100) / 100;

  const med = median(valid);
  const bounded = valid.filter((p) => p >= med * 0.45 && p <= med * 2.2);
  const finalSet = bounded.length >= 3 ? bounded : valid;
  return trimmedMean(finalSet);
}

function stripTags(html: string): string {
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

function wordsForMatch(s: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'game', 'video', 'nintendo', 'sony', 'microsoft']);
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

/**
 * PriceCharting API returns prices as INTEGER CENTS (e.g. 2399 = $23.99).
 * Some API tiers may omit cib/new/graded (returning 0 or absent).
 */
function pcCents(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const v = typeof raw === 'string' ? parseInt(raw, 10) : Math.round(Number(raw));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v) / 100;
}

function toUrlSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ─── PriceCharting API ──────────────────────────────────────────────────────

async function pcFetchById(id: string, apiKey: string): Promise<Record<string, unknown> | null> {
  console.log(`[PC API] Fetch by id: ${id}`);
  try {
    const r = await fetch(`${PC_API_BASE}/product?t=${apiKey}&id=${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.warn(`[PC API] id fetch HTTP ${r.status}`);
      return null;
    }
    const d = await r.json();
    if (d?.status !== 'success' || !d['product-name']) return null;

    // Log raw pricing fields so we can diagnose API tier issues
    console.log(
      `[PC API] Raw fields for id ${id}: ` +
        `loose-price=${d['loose-price']} cib-price=${d['cib-price']} ` +
        `new-price=${d['new-price']} graded-price=${d['graded-price']}`
    );

    return d as Record<string, unknown>;
  } catch (e) {
    console.warn('[PC API] id fetch error:', (e as Error).message);
    return null;
  }
}

async function pcFetchByUpc(upc: string, apiKey: string): Promise<Record<string, unknown> | null> {
  console.log(`[PC API] Fetch by upc: ${upc}`);
  try {
    const r = await fetch(`${PC_API_BASE}/product?t=${apiKey}&upc=${encodeURIComponent(upc)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.status !== 'success' || !d['product-name']) return null;
    console.log(
      `[PC API] UPC match "${d['product-name']}" (${d['console-name']}): ` +
        `loose=${d['loose-price']} cib=${d['cib-price']} new=${d['new-price']} graded=${d['graded-price']}`
    );
    return d as Record<string, unknown>;
  } catch (e) {
    console.warn('[PC API] upc fetch error:', (e as Error).message);
    return null;
  }
}

async function pcSearchByQuery(query: string, apiKey: string): Promise<Record<string, unknown> | null> {
  console.log(`[PC API] Search: "${query}"`);
  try {
    const r = await fetch(`${PC_API_BASE}/product?t=${apiKey}&q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.status !== 'success' || !d['product-name']) return null;

    console.log(
      `[PC API] Search match "${d['product-name']}" (${d['console-name']}): ` +
        `loose=${d['loose-price']} cib=${d['cib-price']} new=${d['new-price']} graded=${d['graded-price']}`
    );

    // If the search result has cib=0 and we have an ID, re-fetch by ID.
    // Some API tiers return partial data in search results but full data via ID fetch.
    if (d.id && pcCents(d['cib-price']) === 0) {
      console.log('[PC API] cib=0 in search result, re-fetching by ID for full data');
      await sleep(1100);
      const full = await pcFetchById(String(d.id), apiKey);
      return full ?? (d as Record<string, unknown>);
    }
    return d as Record<string, unknown>;
  } catch (e) {
    console.warn('[PC API] search error:', (e as Error).message);
    return null;
  }
}

function cleanTitle(t: string): string {
  return t
    .replace(
      /\s*-?\s*\(?(PlayStation\s*[1-5]?|PS[1-5]?|Xbox\s*(Series\s*[XS]?|One|360)?|Nintendo\s*Switch|Switch|Wii\s*U?|GameCube|N64|SNES|NES)\)?$/i,
      ''
    )
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\b(NEW|SEALED|CIB|COMPLETE|LOOSE)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

interface PcApiResult {
  prices: { loose: number; cib: number; new: number; graded: number };
  match: PcMatch;
  rawFields: Record<string, unknown>;
}

async function resolvePcApi(
  productName: string,
  platform: string,
  upc: string | null,
  storedProductId: string | null,
  apiKey: string
): Promise<PcApiResult | null> {
  let product: Record<string, unknown> | null = null;
  let strategy = 'none';

  // 1. Stored product ID — fastest, skips search entirely
  if (storedProductId) {
    product = await pcFetchById(storedProductId, apiKey);
    if (product) strategy = 'stored_id';
  }

  // 2. UPC exact-match
  if (!product && upc?.trim()) {
    product = await pcFetchByUpc(upc.trim(), apiKey);
    if (product) strategy = 'upc';
    await sleep(1100);
  }

  // 3. Title + platform
  if (!product && platform) {
    product = await pcSearchByQuery(`${productName} ${platform}`, apiKey);
    if (product) strategy = 'title_platform';
    await sleep(1100);
  }

  // 4. Cleaned title + platform
  if (!product) {
    const cleaned = cleanTitle(productName);
    if (cleaned !== productName) {
      const q = platform ? `${cleaned} ${platform}` : cleaned;
      product = await pcSearchByQuery(q, apiKey);
      if (product) strategy = 'cleaned_title_platform';
      await sleep(1100);
    }
  }

  // 5. Title alone
  if (!product) {
    product = await pcSearchByQuery(productName, apiKey);
    if (product) strategy = 'title_only';
  }

  if (!product) return null;

  const rawFields: Record<string, unknown> = {
    'loose-price':  product['loose-price'],
    'cib-price':    product['cib-price'],
    'new-price':    product['new-price'],
    'graded-price': product['graded-price'],
  };

  const result: PcApiResult = {
    prices: {
      loose:  pcCents(product['loose-price']),
      cib:    pcCents(product['cib-price']),
      new:    pcCents(product['new-price']),
      graded: pcCents(product['graded-price']),
    },
    match: {
      productId:   String(product.id ?? ''),
      productName: String(product['product-name'] ?? ''),
      platform:    String(product['console-name'] ?? ''),
      strategy,
    },
    rawFields,
  };

  console.log(
    `[PC API] FINAL ${strategy}: "${result.match.productName}" (${result.match.platform}) ` +
      `L=$${result.prices.loose} C=$${result.prices.cib} N=$${result.prices.new} G=$${result.prices.graded}`
  );

  return result;
}

// ─── PriceCharting Web Scraping ─────────────────────────────────────────────

const PC_CONSOLE_SLUG: Record<string, string> = {
  wii: 'wii',
  'wii u': 'wii-u',
  'nintendo 64': 'nintendo-64',
  n64: 'nintendo-64',
  'super nintendo': 'super-nintendo',
  snes: 'super-nintendo',
  nes: 'nes',
  gamecube: 'gamecube',
  'game boy': 'gameboy',
  gameboy: 'gameboy',
  'game boy advance': 'gameboy-advance',
  gba: 'gameboy-advance',
  'game boy color': 'gameboy-color',
  gbc: 'gameboy-color',
  'nintendo ds': 'nintendo-ds',
  ds: 'nintendo-ds',
  '3ds': 'nintendo-3ds',
  'nintendo 3ds': 'nintendo-3ds',
  'nintendo switch': 'nintendo-switch',
  switch: 'nintendo-switch',
  ps1: 'playstation',
  psx: 'playstation',
  playstation: 'playstation',
  ps2: 'playstation-2',
  'playstation 2': 'playstation-2',
  ps3: 'playstation-3',
  'playstation 3': 'playstation-3',
  ps4: 'playstation-4',
  'playstation 4': 'playstation-4',
  ps5: 'playstation-5',
  'playstation 5': 'playstation-5',
  psp: 'psp',
  vita: 'playstation-vita',
  'playstation vita': 'playstation-vita',
  xbox: 'xbox',
  'xbox 360': 'xbox-360',
  'xbox one': 'xbox-one',
  'xbox series x': 'xbox-series-x',
  'xbox series': 'xbox-series-x',
  dreamcast: 'sega-dreamcast',
  genesis: 'sega-genesis',
  'sega genesis': 'sega-genesis',
  saturn: 'sega-saturn',
  'sega saturn': 'sega-saturn',
};

/** Extract price (dollars) from a specific row in PriceCharting HTML */
function extractPcRow(html: string, rowId: string): number {
  // Match from id="rowId" to end of that table row
  const rowPattern = new RegExp(`id="${rowId}"([\\s\\S]{0,1200}?)<\\/tr>`, 'i');
  const rowMatch = html.match(rowPattern);
  if (!rowMatch) return 0;
  const cell = rowMatch[1];

  // Method 1 — data-price="2399" attribute (cents)
  const dataPriceMatch = cell.match(/data-price="(\d+)"/);
  if (dataPriceMatch) {
    const v = parseInt(dataPriceMatch[1], 10) / 100;
    if (isValidPrice(v)) {
      console.log(`[PC Web] ${rowId} via data-price: $${v}`);
      return v;
    }
  }

  // Method 2 — <span class="js-price">$23.99</span>
  const jsPriceMatch = cell.match(/js-price[^>]*>\s*\$?\s*([0-9,]+\.[0-9]{2})/);
  if (jsPriceMatch) {
    const v = parseFloat(jsPriceMatch[1].replace(/,/g, ''));
    if (isValidPrice(v)) {
      console.log(`[PC Web] ${rowId} via js-price: $${v}`);
      return v;
    }
  }

  // Method 3 — any $XX.XX in the row
  const dollarMatch = cell.match(/>\s*\$\s*([0-9,]+\.[0-9]{2})/);
  if (dollarMatch) {
    const v = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (isValidPrice(v)) {
      console.log(`[PC Web] ${rowId} via dollar sign: $${v}`);
      return v;
    }
  }

  return 0;
}

interface PcWebResult {
  loose: number;
  cib: number;
  new: number;
  graded: number;
  url: string;
}

function extractPcSummaryPrices(html: string): Omit<PcWebResult, 'url'> {
  const text = stripTags(html);
  const guideIdx = text.search(/Full Price Guide:/i);
  const guideText = guideIdx >= 0 ? text.slice(guideIdx, guideIdx + 1200) : text;
  const pick = (label: RegExp) => {
    const match = guideText.match(label);
    if (!match) return 0;
    const v = parseFloat(match[1].replace(/,/g, ''));
    return isValidPrice(v) ? v : 0;
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
    const afterHeader = text.slice(headerIdx, headerIdx + 900);
    const prices = [...afterHeader.matchAll(/\$\s*([0-9,]+\.[0-9]{2})/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, '')))
      .filter(isValidPrice);

    if (prices.length >= 4) {
      return {
        loose: prices[0] || 0,
        cib: prices[1] || 0,
        new: prices[2] || 0,
        graded: prices[3] || 0,
      };
    }
  }

  return guidePrices;
}

async function scrapePcWebPage(
  productName: string,
  platform: string,
  pcMatchName?: string,
  pcMatchPlatform?: string
): Promise<PcWebResult | null> {
  // Prefer the matched PC product name and platform for URL construction
  const titleForSlug  = pcMatchName     || productName;
  const platformForSlug = pcMatchPlatform || platform;
  const consoleSlug = PC_CONSOLE_SLUG[platformForSlug.toLowerCase().trim()]
    ?? toUrlSlug(platformForSlug);
  const titleSlug = toUrlSlug(titleForSlug);

  const directUrl = `https://www.pricecharting.com/game/${consoleSlug}/${titleSlug}`;
  console.log(`[PC Web] Direct URL: ${directUrl}`);

  let html = '';
  let finalUrl = directUrl;

  try {
    const resp = await fetch(directUrl, {
      headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
    });

    if (resp.status === 404 || !resp.ok) {
      // Fall back to search page
      console.log(`[PC Web] Direct URL failed (${resp.status}), trying search`);
      const query = encodeURIComponent(`${titleForSlug} ${platformForSlug}`);
      const searchUrl = `https://www.pricecharting.com/search-products?q=${query}&type=videogames`;
      const searchResp = await fetch(searchUrl, {
        headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (!searchResp.ok) return null;
      const searchHtml = await searchResp.text();

      // Extract first /game/console/title link
      const linkMatch = searchHtml.match(/href="(\/game\/[a-z0-9][a-z0-9\-]*\/[a-z0-9][a-z0-9\-]+)"/);
      if (!linkMatch) {
        console.warn('[PC Web] No game link found in search results');
        return null;
      }
      finalUrl = `https://www.pricecharting.com${linkMatch[1]}`;
      console.log(`[PC Web] Search found: ${finalUrl}`);
      const pageResp = await fetch(finalUrl, {
        headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (!pageResp.ok) return null;
      html = await pageResp.text();
    } else {
      html = await resp.text();
    }

    const summaryPrices = extractPcSummaryPrices(html);

    if (
      !html.includes('price_data') &&
      !html.includes('js-price') &&
      !html.includes('used_price') &&
      summaryPrices.loose === 0 &&
      summaryPrices.cib === 0 &&
      summaryPrices.new === 0 &&
      summaryPrices.graded === 0
    ) {
      console.warn('[PC Web] Page does not look like a PriceCharting game page');
      return null;
    }

    // PriceCharting row IDs:
    //   used_price      = loose
    //   complete_price  = CIB
    //   new_price       = New/Sealed
    //   graded_price    = Graded (may not exist)
    const loose  = summaryPrices.loose  || extractPcRow(html, 'used_price')     || extractPcRow(html, 'loose_price');
    const cib    = summaryPrices.cib    || extractPcRow(html, 'complete_price') || extractPcRow(html, 'cib_price');
    const newP   = summaryPrices.new    || extractPcRow(html, 'new_price');
    const graded = summaryPrices.graded || extractPcRow(html, 'graded_price');

    console.log(`[PC Web] FINAL: L=$${loose} C=$${cib} N=$${newP} G=$${graded} (${finalUrl})`);

    if (loose === 0 && cib === 0 && newP === 0) {
      console.warn('[PC Web] All prices 0 — page may be JS-rendered only');
      return null;
    }

    return { loose, cib, new: newP, graded, url: finalUrl };
  } catch (e) {
    console.error('[PC Web] Error:', (e as Error).message);
    return null;
  }
}

// ─── eBay Scraping ──────────────────────────────────────────────────────────

/**
 * eBay condition keywords (short and unambiguous).
 * FIX: Removed quotes from primary search — quoted searches are too restrictive
 * and often return 0 results on eBay.
 *
 * FIX: Category MUST be 139973 (Video Games, US) NOT 1249.
 * Using 1249 (parent category) returns 0 results silently — confirmed bug.
 */
const EBAY_CONDITION_KW: Record<string, string> = {
  loose:  'loose',
  cib:    'complete CIB',
  new:    'sealed',
  graded: 'graded',
};

// 139973 = Video Games (US eBay) — DO NOT change to 1249 (parent category, broken)
const EBAY_CATEGORY: Record<string, string> = {
  loose:  '139973',
  cib:    '139973',
  new:    '139973',
  graded: '0',       // Graded items cross category boundaries
};

function extractEbayPrices(html: string, cond: string): number[] {
  const prices: number[] = [];
  let m: RegExpExecArray | null;

  // P1 — s-item__price span (eBay's primary price element, handles nested spans)
  const p1 = /s-item__price[^>]*>([\s\S]{0,120}?)\$\s*([0-9,]+\.[0-9]{2})/g;
  while ((m = p1.exec(html)) !== null) {
    const v = parseFloat(m[2].replace(/,/g, ''));
    if (isValidPrice(v)) prices.push(v);
  }
  if (prices.length) {
    console.log(`[eBay] ${cond}: ${prices.length} prices (p1 s-item__price)`);
    return prices;
  }

  // P2 — notranslate spans (alternate eBay layout)
  const p2 = /class="notranslate"[^>]*>\s*\$\s*([0-9,]+\.[0-9]{2})/g;
  while ((m = p2.exec(html)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (isValidPrice(v)) prices.push(v);
  }
  if (prices.length) {
    console.log(`[eBay] ${cond}: ${prices.length} prices (p2 notranslate)`);
    return prices;
  }

  // P3 — inline JSON {"price":{"value":"23.99"}}
  const p3 = /"price"\s*:\s*\{[^}]*"value"\s*:\s*"([0-9.]+)"/g;
  while ((m = p3.exec(html)) !== null) {
    const v = parseFloat(m[1]);
    if (isValidPrice(v)) prices.push(v);
  }
  if (prices.length) {
    console.log(`[eBay] ${cond}: ${prices.length} prices (p3 json)`);
    return prices;
  }

  // P4 — dollar amount near sold/s-item markers
  const p4 = /(?:s-item|POSITIVE)[^$]{0,400}?\$\s*([0-9,]+\.[0-9]{2})/g;
  while ((m = p4.exec(html)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (isValidPrice(v)) prices.push(v);
  }
  if (prices.length) {
    console.log(`[eBay] ${cond}: ${prices.length} prices (p4 fallback)`);
  }

  return prices;
}

function looksLikeCondition(title: string, cond: keyof typeof EBAY_CONDITION_KW): boolean {
  const t = title.toLowerCase();
  const boxed = /\b(cib|complete|case|box|boxed|manual)\b/.test(t);
  const sealed = /\b(new|sealed|brand new|factory sealed|nib)\b/.test(t);
  const graded = /\b(graded|wata|vga|cgc|psa|bgs|sealed a\+|sealed a\+\+)\b/.test(t);
  const partsOnly = /\b(box only|case only|manual only|cover art|replacement case|empty box|repro|reproduction|not for resale)\b/.test(t);

  if (partsOnly) return false;
  if (cond === 'loose') return !boxed && !sealed && !graded;
  if (cond === 'cib') return boxed && !sealed && !graded;
  if (cond === 'new') return sealed && !graded;
  if (cond === 'graded') return graded;
  return true;
}

function looksRelevantSale(
  title: string,
  productName: string,
  platform: string,
  cond: keyof typeof EBAY_CONDITION_KW
): boolean {
  if (!looksLikeCondition(title, cond)) return false;

  const titleWords = new Set(wordsForMatch(title));
  const productWords = wordsForMatch(productName);
  if (productWords.length > 0) {
    const hits = productWords.filter((w) => titleWords.has(w)).length;
    if (hits / productWords.length < 0.55) return false;
  }

  const platformWords = wordsForMatch(platform);
  if (platformWords.length > 0) {
    const hits = platformWords.filter((w) => titleWords.has(w)).length;
    if (hits === 0) {
      const t = title.toLowerCase();
      const p = platform.toLowerCase();
      const aliases: Record<string, string[]> = {
        'nintendo switch': ['switch'],
        'playstation 5': ['ps5'],
        'playstation 4': ['ps4'],
        'playstation 3': ['ps3'],
        'playstation 2': ['ps2'],
        playstation: ['ps1', 'psx'],
        'xbox series x': ['xbox series', 'series x', 'series s'],
        gamecube: ['game cube', 'gc'],
        'nintendo 64': ['n64'],
        'super nintendo': ['snes'],
      };
      const aliasMatch = (aliases[p] ?? []).some((a) => t.includes(a));
      if (!aliasMatch && !t.includes(p)) return false;
    }
  }

  return true;
}

function extractEbayRecentSales(
  html: string,
  cond: keyof typeof EBAY_CONDITION_KW,
  productName: string,
  platform: string
): number[] {
  const sales: number[] = [];
  const itemPattern = /<li[^>]+class="[^"]*s-item[^"]*"[\s\S]*?<\/li>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(html)) !== null) {
    const block = itemMatch[0];
    const titleMatch =
      block.match(/s-item__title[^>]*>([\s\S]{0,700}?)<\/(?:div|span|h3)>/i) ||
      block.match(/<span[^>]*role="heading"[^>]*>([\s\S]{0,700}?)<\/span>/i);
    const priceMatch =
      block.match(/s-item__price[^>]*>([\s\S]{0,180}?)\$\s*([0-9,]+\.[0-9]{2})/i) ||
      block.match(/"price"\s*:\s*\{[^}]*"value"\s*:\s*"([0-9.]+)"/i);
    const priceRaw = priceMatch?.[2] ?? priceMatch?.[1];

    if (!titleMatch || !priceRaw) continue;
    const title = stripTags(titleMatch[1]);
    const price = parseFloat(priceRaw.replace(/,/g, ''));
    if (isValidPrice(price) && looksRelevantSale(title, productName, platform, cond)) {
      sales.push(price);
    }
  }

  if (sales.length > 0) {
    console.log(`[eBay] ${cond}: ${sales.length} relevant sold listings from last 90 days`);
    return sales;
  }

  const fallback = extractEbayPrices(html, cond);
  console.log(`[eBay] ${cond}: ${fallback.length} unfiltered sold prices from fallback parser`);
  return fallback;
}

async function scrapeEbayCondition(
  productName: string,
  platform: string,
  cond: keyof typeof EBAY_CONDITION_KW,
  delayMs: number
): Promise<number[]> {
  if (delayMs > 0) await sleep(delayMs);

  const kw = EBAY_CONDITION_KW[cond];
  const cat = EBAY_CATEGORY[cond];

  // FIX: Use UNQUOTED search by default — quoted searches return 0 results too often.
  // Only fall back to even simpler query if unquoted returns nothing.
  const query = `${productName} ${platform} ${kw}`;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Complete=1&LH_Sold=1&_sop=13&_ipg=100&_sacat=${cat}&rt=nc`;

  console.log(`[eBay] ${cond}: ${url}`);

  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(16000),
    });
    if (!resp.ok) {
      console.warn(`[eBay] ${cond}: HTTP ${resp.status}`);
      return [];
    }
    const html = await resp.text();

    if (html.includes('h-captcha') || /access denied/i.test(html)) {
      console.warn(`[eBay] ${cond}: bot protection detected`);
      return [];
    }

    if (!html.includes('s-item') && !html.includes('srp-results')) {
      // Retry with just product name + condition keyword (no platform)
      console.log(`[eBay] ${cond}: no results, retrying without platform`);
      const query2 = `${productName} ${kw}`;
      const url2 = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query2)}&LH_Complete=1&LH_Sold=1&_sop=13&_ipg=100&_sacat=${cat}&rt=nc`;
      const resp2 = await fetch(url2, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(14000) });
      if (!resp2.ok) return [];
      const html2 = await resp2.text();
      const fallback = extractEbayRecentSales(html2, cond, productName, '');
      if (fallback.length === 0) console.warn(`[eBay] ${cond}: 0 prices after retry`);
      return fallback;
    }

    return extractEbayRecentSales(html, cond, productName, platform);
  } catch (e) {
    console.error(`[eBay] ${cond} error:`, (e as Error).message);
    return [];
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader)
      return jsonResp({ success: false, errorCode: 'UNAUTHORIZED', message: 'Missing authorization' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authErr || !user)
      return jsonResp({ success: false, errorCode: 'UNAUTHORIZED', message: 'Auth failed' });

    const body = await req.json();
    const {
      productName,
      platform = '',
      upc = null,
      storedPcProductId = null,
      forceRefresh = false,
    } = body as {
      productName: string;
      platform?: string;
      upc?: string | null;
      storedPcProductId?: string | null;
      forceRefresh?: boolean;
    };

    if (!productName?.trim())
      return jsonResp({ success: false, errorCode: 'INVALID_INPUT', message: 'productName required' });

    const normName = productName.trim().toLowerCase();
    const normPlatform = platform.trim().toLowerCase();
    console.log(
      `[Market] Lookup: "${productName}" (${platform}) upc=${upc ?? 'none'} ` +
        `storedId=${storedPcProductId ?? 'none'} force=${forceRefresh}`
    );

    // ── Cache read ──────────────────────────────────────────────────────────
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from('market_price_cache')
        .select('*')
        .eq('product_name', normName)
        .eq('platform', normPlatform)
        .maybeSingle();

      if (cached) {
        const ageH = (Date.now() - new Date(cached.cached_at).getTime()) / 3_600_000;
        if (ageH < CACHE_TTL_HOURS) {
          console.log(`[Market] Cache hit (${ageH.toFixed(1)}h old)`);
          const conditions = ['loose', 'cib', 'new', 'graded'] as const;
          const missing = conditions.filter((c) => Number(cached[`price_${c}`]) === 0);
          const refreshStatus: RefreshStatus =
            missing.length === 0 ? 'success' : missing.length < 4 ? 'partial' : 'failed';
          return jsonResp({
            success: true,
            cached: true,
            prices: {
              loose:  { value: Number(cached.price_loose)  || 0, source: cached.source_loose  || 'none', sampleCount: cached.sample_count_loose  || 0 },
              cib:    { value: Number(cached.price_cib)    || 0, source: cached.source_cib    || 'none', sampleCount: cached.sample_count_cib    || 0 },
              new:    { value: Number(cached.price_new)    || 0, source: cached.source_new    || 'none', sampleCount: cached.sample_count_new    || 0 },
              graded: { value: Number(cached.price_graded) || 0, source: cached.source_graded || 'none', sampleCount: cached.sample_count_graded || 0 },
            },
            pcMatch: cached.pc_product_id
              ? { productId: cached.pc_product_id, productName: cached.pc_product_name, platform: normPlatform, strategy: 'cached' }
              : null,
            diagnostics: {
              refreshStatus,
              missingConditions: missing,
              warnings: (cached.warnings as string[]) ?? [],
              ebayBlocked: false,
              pcApiUsed: !!cached.pc_product_id,
            },
          });
        }
        console.log(`[Market] Cache expired (${ageH.toFixed(1)}h old)`);
      }
    }

    // ── Load credentials ────────────────────────────────────────────────────
    const { data: pcKeyRow } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', user.id)
      .eq('provider', 'pricecharting')
      .maybeSingle();
    const pcApiKey: string | null = pcKeyRow?.api_key ?? null;

    // Pull stored product ID from existing cache entry if caller didn't supply it
    let effectiveStoredId = storedPcProductId;
    if (!effectiveStoredId) {
      const { data: existingCache } = await supabase
        .from('market_price_cache')
        .select('pc_product_id')
        .eq('product_name', normName)
        .eq('platform', normPlatform)
        .maybeSingle();
      effectiveStoredId = existingCache?.pc_product_id ?? null;
    }

    const name = productName.trim();
    const plat = platform.trim();
    const warnings: string[] = [];

    // ── Phase 1: PriceCharting API ──────────────────────────────────────────
    let pcApiResult: PcApiResult | null = null;

    if (pcApiKey) {
      pcApiResult = await resolvePcApi(name, plat, upc, effectiveStoredId, pcApiKey);
      if (!pcApiResult) {
        warnings.push('PriceCharting API: no product match found');
      } else {
        // Warn if the API returned 0 for non-loose conditions (API tier issue)
        const apiZeros = (['cib', 'new', 'graded'] as const).filter(
          (c) => pcApiResult!.prices[c] === 0
        );
        if (apiZeros.length > 0 && pcApiResult.prices.loose > 0) {
          warnings.push(
            `PriceCharting API returned 0 for: ${apiZeros.join(', ')}. ` +
              `Raw fields: cib=${pcApiResult.rawFields['cib-price']} ` +
              `new=${pcApiResult.rawFields['new-price']} ` +
              `graded=${pcApiResult.rawFields['graded-price']}. ` +
              `This usually means a limited API key tier — will supplement with web scraping.`
          );
        }
      }
    } else {
      warnings.push('PriceCharting API key not configured — using web scraping and eBay only');
    }

    // Determine which conditions need additional sources
    const needsWeb = {
      loose:  !pcApiResult || pcApiResult.prices.loose  === 0,
      cib:    !pcApiResult || pcApiResult.prices.cib    === 0,
      new:    !pcApiResult || pcApiResult.prices.new    === 0,
      graded: !pcApiResult || pcApiResult.prices.graded === 0,
    };
    const needsAnyWeb = Object.values(needsWeb).some(Boolean);

    // ── Phase 2: PriceCharting Web Scraping (fills gaps from API tier limits) ─
    let pcWebResult: PcWebResult | null = null;

    if (needsAnyWeb) {
      console.log('[Market] Starting PC web scraping for missing conditions');
      pcWebResult = await scrapePcWebPage(
        name,
        plat,
        pcApiResult?.match.productName,
        pcApiResult?.match.platform
      );
      if (!pcWebResult) {
        warnings.push('PriceCharting web scraping: page not found or all prices JS-rendered');
      }
    }

    const soldCompName = pcApiResult?.match.productName || name;
    const soldCompPlatform = pcApiResult?.match.platform || plat;

    // Determine which conditions still need eBay after PC sources
    const needsEbay = {
      loose: needsWeb.loose   && (!pcWebResult || pcWebResult.loose  === 0),
      cib:   needsWeb.cib     && (!pcWebResult || pcWebResult.cib    === 0),
      new:   needsWeb.new     && (!pcWebResult || pcWebResult.new    === 0),
      graded: needsWeb.graded && (!pcWebResult || pcWebResult.graded === 0),
    };

    console.log(
      `[Market] eBay needed: loose=${needsEbay.loose} cib=${needsEbay.cib} ` +
        `new=${needsEbay.new} graded=${needsEbay.graded}`
    );

    // ── Phase 3: eBay sold-listing scraping (final fallback) ────────────────
    const [looseEbay, cibEbay, newEbay, gradedEbay] = await Promise.all([
      scrapeEbayCondition(soldCompName, soldCompPlatform, 'loose',  0),
      scrapeEbayCondition(soldCompName, soldCompPlatform, 'cib',    400),
      scrapeEbayCondition(soldCompName, soldCompPlatform, 'new',    800),
      scrapeEbayCondition(soldCompName, soldCompPlatform, 'graded', 1200),
    ]);

    const ebayMeans = {
      loose:  recentSalesEstimate(looseEbay),
      cib:    recentSalesEstimate(cibEbay),
      new:    recentSalesEstimate(newEbay),
      graded: recentSalesEstimate(gradedEbay),
    };

    const ebayBlocked = needsEbay.loose && looseEbay.length === 0 && needsEbay.cib && cibEbay.length === 0;
    if (ebayBlocked) {
      warnings.push('eBay: scraping blocked or rate-limited — try again shortly');
    }

    // ── Combine: PC API → PC web → eBay (in priority order) ─────────────────
    const conditions = ['loose', 'cib', 'new', 'graded'] as const;
    type Cond = typeof conditions[number];

    const finalPrices: Record<Cond, ConditionPrice> = {
      loose:  { value: 0, source: 'none', sampleCount: 0 },
      cib:    { value: 0, source: 'none', sampleCount: 0 },
      new:    { value: 0, source: 'none', sampleCount: 0 },
      graded: { value: 0, source: 'none', sampleCount: 0 },
    };

    const ebayCounts = {
      loose:  looseEbay.length,
      cib:    cibEbay.length,
      new:    newEbay.length,
      graded: gradedEbay.length,
    };

    for (const cond of conditions) {
      const apiVal  = pcApiResult?.prices[cond]                       ?? 0;
      const webVal  = pcWebResult  ? pcWebResult[cond as keyof PcWebResult] as number : 0;
      const ebayVal = ebayMeans[cond];

      if (ebayVal > 0 && ebayCounts[cond] >= 3) {
        finalPrices[cond] = { value: ebayVal, source: 'ebay_90d', sampleCount: ebayCounts[cond] };
      } else if (apiVal > 0) {
        finalPrices[cond] = { value: apiVal,  source: 'pricecharting_api', sampleCount: 0 };
      } else if (webVal > 0) {
        finalPrices[cond] = { value: webVal,  source: 'pricecharting_web', sampleCount: 0 };
        if (pcApiKey) {
          warnings.push(`${cond}: PC API returned 0 — using PC web price ($${webVal.toFixed(2)})`);
        }
      } else if (ebayVal > 0) {
        finalPrices[cond] = { value: ebayVal, source: 'ebay_90d', sampleCount: ebayCounts[cond] };
        warnings.push(`${cond}: only ${ebayCounts[cond]} recent sold comp${ebayCounts[cond] === 1 ? '' : 's'} found`);
      } else {
        finalPrices[cond] = { value: 0, source: 'none', sampleCount: 0 };
      }
    }

    const missing = conditions.filter((c) => finalPrices[c].value === 0);
    for (const c of missing) warnings.push(`${c}: no data from any source`);

    const refreshStatus: RefreshStatus =
      missing.length === 0 ? 'success' : missing.length < 4 ? 'partial' : 'failed';

    console.log(
      `[Market] RESULT: ` +
        conditions.map((c) => `${c}=$${finalPrices[c].value}(${finalPrices[c].source})`).join(' ')
    );

    if (missing.length === 4) {
      return jsonResp({
        success: false,
        errorCode: 'NO_DATA',
        message:
          'No pricing data found for any condition. ' +
          'eBay may be temporarily blocking requests. Try again shortly.',
      });
    }

    // ── Write cache ─────────────────────────────────────────────────────────
    try {
      await supabase.from('market_price_cache').upsert(
        {
          product_name:        normName,
          platform:            normPlatform,
          price_loose:         finalPrices.loose.value,
          price_cib:           finalPrices.cib.value,
          price_new:           finalPrices.new.value,
          price_graded:        finalPrices.graded.value,
          source_loose:        finalPrices.loose.source,
          source_cib:          finalPrices.cib.source,
          source_new:          finalPrices.new.source,
          source_graded:       finalPrices.graded.source,
          sample_count_loose:  ebayCounts.loose,
          sample_count_cib:    ebayCounts.cib,
          sample_count_new:    ebayCounts.new,
          sample_count_graded: ebayCounts.graded,
          pc_product_id:       pcApiResult?.match.productId ?? null,
          pc_product_name:     pcApiResult?.match.productName ?? null,
          last_refresh_status: refreshStatus,
          warnings,
          source:
            pcApiResult
              ? 'pricecharting_api'
              : pcWebResult
              ? 'pricecharting_web'
              : 'ebay_web',
          cached_at: new Date().toISOString(),
        },
        { onConflict: 'product_name,platform' }
      );
      console.log('[Market] Cache written');
    } catch (ce) {
      console.error('[Market] Cache write error:', (ce as Error).message);
    }

    return jsonResp({
      success: true,
      cached: false,
      prices: finalPrices,
      pcMatch: pcApiResult?.match ?? null,
      diagnostics: {
        refreshStatus,
        missingConditions: missing,
        warnings,
        ebayBlocked,
        pcApiUsed: !!pcApiResult,
        rawPcApiFields: pcApiResult?.rawFields,
      },
    });
  } catch (err) {
    console.error('[Market] Unexpected error:', err);
    return jsonResp({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'Unexpected error',
    });
  }
});
