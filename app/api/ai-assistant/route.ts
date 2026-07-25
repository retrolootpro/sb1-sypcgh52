import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import {
  analyzeInventory,
  buildAppContext,
  buildAppDeterministicAnswer,
  type AssistantAnalysis,
  type AssistantAppContext,
  type AssistantInventoryItem,
  type AssistantLot,
  type AssistantShipment,
} from '@/lib/ai-inventory-analysis';
import { buildItemBusinessPlan } from '@/lib/business-rules';

export const dynamic = 'force-dynamic';

type AssistantRequest = {
  message?: string;
  theme?: string;
  targetItemCount?: number;
  minMarginPercent?: number;
  clarificationContext?: {
    originalMessage?: string;
    question?: string;
    choices?: AssistantClarification['choices'];
  } | null;
};

type GameStopLookup = {
  provider: 'gamestop';
  query: string;
  searchedAt: string;
  sourceUrl: string;
  results: Array<{
    title: string;
    url: string;
    priceText: string;
    conditions: Array<{ condition: string; price: string }>;
    availability: string;
  }>;
  warnings: string[];
};

type EbaySoldLookup = {
  provider: 'ebay_sold';
  query: string;
  searchedAt: string;
  sourceUrl: string;
  sampleSize: number;
  averagePrice: number;
  medianPrice: number;
  lowPrice: number;
  highPrice: number;
  prices: number[];
  warnings: string[];
};

type PriceChartingLookup = {
  provider: 'pricecharting';
  query: string;
  searchedAt: string;
  sourceUrl: string;
  product: {
    id: string;
    productName: string;
    consoleName: string;
    prices: {
      loose: number;
      cib: number;
      new: number;
      graded: number;
      gamestop: number;
      gamestopTrade: number;
      retailLooseBuy: number;
      retailCibBuy: number;
      retailNewBuy: number;
    };
  } | null;
  warnings: string[];
};

type ExternalLookup = GameStopLookup | EbaySoldLookup | PriceChartingLookup;
type InventoryMatchSummary = {
  rows: AssistantInventoryItem[];
  query: string;
};
type AssistantClarification = {
  originalMessage: string;
  question: string;
  choices: Array<{
    label: string;
    detail: string;
    source: 'inventory' | 'pricecharting';
  }>;
};

const PC_API_BASE = 'https://www.pricecharting.com/api';
const DEFAULT_ASSISTANT_MODEL = 'gpt-5.1';
const DEFAULT_ASSISTANT_REASONING_EFFORT = 'low';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function absoluteGamestopUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://www.gamestop.com${url.startsWith('/') ? '' : '/'}${url}`;
}

function extractMeta(html: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function priceStrings(text: string) {
  return unique(text.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).map((price) => price.replace(/\s+/g, ''));
}

function extractConditionPrices(text: string) {
  const conditions = ['New', 'Pre-Owned', 'Digital', 'Used'];
  const results: Array<{ condition: string; price: string }> = [];

  for (const condition of conditions) {
    const pattern = new RegExp(`${condition}[\\s\\S]{0,180}?(\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)`, 'i');
    const match = text.match(pattern);
    if (match?.[1] && !results.some((item) => item.condition === condition && item.price === match[1])) {
      results.push({ condition, price: match[1].replace(/\s+/g, '') });
    }
  }

  return results;
}

function productLinksFromSearch(html: string) {
  const links: string[] = [];
  const linkRegex = /href=["']([^"']*\/products\/[^"']+?\.html(?:\?[^"']*)?)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) && links.length < 8) {
    links.push(absoluteGamestopUrl(match[1]));
  }
  return unique(links);
}

function cleanExternalGameQuery(message: string) {
  return message
    .replace(/\b(what('| i)?s|what is|current|price|cost|gamestop|game stop|at|from|for|of|the|a|an|game)\b/gi, ' ')
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLATFORM_ALIASES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bxbox\s*360\b/i, label: 'Xbox 360' },
  { pattern: /\bxbox\s*one\b/i, label: 'Xbox One' },
  { pattern: /\bxbox\s*series\s*x\b/i, label: 'Xbox Series X' },
  { pattern: /\bps5|playstation\s*5\b/i, label: 'PlayStation 5' },
  { pattern: /\bps4|playstation\s*4\b/i, label: 'PlayStation 4' },
  { pattern: /\bps3|playstation\s*3\b/i, label: 'PlayStation 3' },
  { pattern: /\bps2|playstation\s*2\b/i, label: 'PlayStation 2' },
  { pattern: /\bnintendo\s*switch|switch\b/i, label: 'Nintendo Switch' },
  { pattern: /\bwii\s*u\b/i, label: 'Wii U' },
  { pattern: /\bwii\b/i, label: 'Wii' },
  { pattern: /\bgamecube\b/i, label: 'GameCube' },
  { pattern: /\bnintendo\s*64|n64\b/i, label: 'Nintendo 64' },
  { pattern: /\bsnes|super\s*nintendo\b/i, label: 'Super Nintendo' },
  { pattern: /\bnes\b/i, label: 'NES' },
];

function detectPlatform(message: string) {
  return PLATFORM_ALIASES.find((platform) => platform.pattern.test(message))?.label || '';
}

function cleanPriceChartingQuery(message: string) {
  return message
    .replace(/\b(can you|could you|please|tell me|show me|look up|lookup|search|find|what('| i)?s|what is|what|is|are|how much|worth|value|priced?|pricecharting|price charting|market|current|going for|for|on|the|a|an|game)\b/gi, ' ')
    .replace(/\b(loose|cib|complete|new|sealed|graded)\b/gi, ' ')
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldLookupGamestop(message: string) {
  return /\bgamestop|game stop\b/i.test(message) && /\b(price|cost|current|sell|available|stock|pre-owned|new)\b/i.test(message);
}

function shouldLookupEbaySold(message: string) {
  return /\bebay\b/i.test(message) && /\b(avg|average|sold|selling price|sale price|comps?|last 90|90 days|ninety)\b/i.test(message);
}

function shouldLookupPriceCharting(message: string) {
  if (/\b(do i have|what do i have|in my inventory|my inventory|on hand|available)\b/i.test(message)) return false;
  return /\b(pricecharting|price charting|worth|value|market value|current price|price|priced|cost|how much|what('| i)?s .* worth|how much .* worth|what .* goes? for)\b/i.test(message);
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function pcCents(raw: unknown) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'string' ? parseInt(raw, 10) : Math.round(Number(raw));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value) / 100;
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

async function getAccountPriceChartingKey(supabase: SupabaseClient<any>, accountId: string) {
  const { data: keyRow, error } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', accountId)
    .eq('provider', 'pricecharting')
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return keyRow?.api_key as string | undefined;
}

async function searchPriceChartingProducts(query: string, supabase: SupabaseClient<any>, accountId: string) {
  const apiKey = await getAccountPriceChartingKey(supabase, accountId);
  if (!apiKey) return [];
  const results = await fetchPriceCharting('/products', { t: apiKey, q: query });
  return ((results.products || []) as any[])
    .map((product) => ({
      id: String(product.id || ''),
      productName: String(product['product-name'] || ''),
      consoleName: String(product['console-name'] || ''),
    }))
    .filter((product) => product.productName);
}

function compactPriceChartingProduct(product: any, fallbackId = ''): NonNullable<PriceChartingLookup['product']> {
  return {
    id: String(product.id || fallbackId),
    productName: String(product['product-name'] || ''),
    consoleName: String(product['console-name'] || ''),
    prices: {
      loose: pcCents(product['loose-price']),
      cib: pcCents(product['cib-price']),
      new: pcCents(product['new-price']),
      graded: pcCents(product['graded-price']),
      gamestop: pcCents(product['gamestop-price']),
      gamestopTrade: pcCents(product['gamestop-trade-price']),
      retailLooseBuy: pcCents(product['retail-loose-buy']),
      retailCibBuy: pcCents(product['retail-cib-buy']),
      retailNewBuy: pcCents(product['retail-new-buy']),
    },
  };
}

async function lookupPriceCharting(
  message: string,
  supabase: SupabaseClient<any>,
  accountId: string
): Promise<ExternalLookup> {
  const warnings: string[] = [];
  const platform = detectPlatform(message);
  const cleaned = cleanPriceChartingQuery(message);
  const query = [cleaned, platform].filter(Boolean).join(' ').trim() || message;
  const sourceUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=videogames`;

  try {
    const apiKey = await getAccountPriceChartingKey(supabase, accountId);
    if (!apiKey) {
      return {
        provider: 'pricecharting',
        query,
        searchedAt: new Date().toISOString(),
        sourceUrl,
        product: null,
        warnings: ['PriceCharting API key is not configured in Settings.'],
      };
    }

    let product: any = null;
    try {
      product = await fetchPriceCharting('/product', { t: apiKey, q: query });
    } catch (error) {
      warnings.push(`Direct PriceCharting product lookup missed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!product?.id) {
      const results = await fetchPriceCharting('/products', { t: apiKey, q: query });
      const products = (results.products || []) as any[];
      const best = products.find((item) => platform && String(item['console-name'] || '').toLowerCase() === platform.toLowerCase()) || products[0];
      if (best?.id) {
        product = await fetchPriceCharting('/product', { t: apiKey, id: String(best.id) });
      }
    }

    if (!product?.id && !product?.['product-name']) {
      warnings.push('No matching PriceCharting product was found.');
    }

    return {
      provider: 'pricecharting',
      query,
      searchedAt: new Date().toISOString(),
      sourceUrl,
      product: product?.id || product?.['product-name'] ? compactPriceChartingProduct(product) : null,
      warnings,
    };
  } catch (error) {
    return {
      provider: 'pricecharting',
      query,
      searchedAt: new Date().toISOString(),
      sourceUrl,
      product: null,
      warnings: [`PriceCharting lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

async function lookupGamestop(message: string): Promise<ExternalLookup> {
  const query = cleanExternalGameQuery(message) || message;
  const sourceUrl = `https://www.gamestop.com/search/?q=${encodeURIComponent(query)}`;
  const warnings: string[] = [];
  const results: GameStopLookup['results'] = [];

  try {
    const searchHtml = await fetchText(sourceUrl);
    const links = productLinksFromSearch(searchHtml);

    if (links.length === 0) {
      warnings.push('GameStop search did not expose product links in the returned HTML.');
    }

    for (const url of links.slice(0, 3)) {
      try {
        const html = await fetchText(url);
        const text = stripHtml(html);
        const title =
          extractMeta(html, 'og:title') ||
          html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ') ||
          'GameStop product';
        const prices = priceStrings(text).filter((price) => !['$25', '$25.00'].includes(price));
        const conditions = extractConditionPrices(text);
        const availability = /out of stock|unavailable/i.test(text)
          ? 'May be unavailable'
          : /add to cart|available now|pick up in-store|ship to home/i.test(text)
            ? 'Availability shown on page'
            : 'Availability unclear';

        results.push({
          title: decodeHtml(title),
          url,
          priceText: conditions.length
            ? conditions.map((item) => `${item.condition}: ${item.price}`).join(', ')
            : prices.slice(0, 4).join(' - ') || 'No visible price found',
          conditions,
          availability,
        });
      } catch (error) {
        warnings.push(`Could not parse one GameStop result: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  } catch (error) {
    warnings.push(`GameStop lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    provider: 'gamestop',
    query,
    searchedAt: new Date().toISOString(),
    sourceUrl,
    results,
    warnings,
  };
}

function cleanEbaySoldQuery(message: string) {
  return message
    .replace(/\b(what('| i)?s|what is|average|avg|selling|sale|sold|price|prices|for|on|ebay|over|last|past|days|day|ninety|90|has|been|the|a|an|game)\b/gi, ' ')
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePriceNumber(value: string) {
  const cleaned = value.replace(/[$,\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

async function lookupEbaySold(message: string): Promise<ExternalLookup> {
  const query = cleanEbaySoldQuery(message) || message;
  const sourceUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;
  const warnings: string[] = [];
  let prices: number[] = [];

  try {
    const html = await fetchText(sourceUrl);
    const text = stripHtml(html);
    prices = unique(priceStrings(text))
      .map(parsePriceNumber)
      .filter((price) => price >= 1 && price <= 2000);

    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    if (prices.length >= 8 && iqr > 0) {
      prices = prices.filter((price) => price >= q1 - 1.5 * iqr && price <= q3 + 1.5 * iqr);
    }

    if (prices.length === 0) {
      warnings.push('eBay did not expose readable sold-price values in the returned HTML. This can happen when eBay blocks automated result parsing.');
    }
  } catch (error) {
    warnings.push(`eBay sold lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const averagePrice = sorted.length ? sorted.reduce((sum, price) => sum + price, 0) / sorted.length : 0;
  const medianPrice = sorted.length
    ? sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : 0;

  return {
    provider: 'ebay_sold',
    query,
    searchedAt: new Date().toISOString(),
    sourceUrl,
    sampleSize: sorted.length,
    averagePrice,
    medianPrice,
    lowPrice: sorted[0] || 0,
    highPrice: sorted[sorted.length - 1] || 0,
    prices: sorted.slice(0, 40),
    warnings,
  };
}

function compactInventoryForAi(inventory: AssistantInventoryItem[]) {
  return inventory.slice(0, 350).map((item) => ({
    id: item.id,
    name: item.product_name,
    console: item.console,
    condition: item.condition,
    status: item.status || 'available',
    quantity: item.quantity || 1,
    cost: item.purchase_price || 0,
    marketValue: item.selected_market_value || item.price_cib || item.price_loose || item.price_new || item.price_graded || 0,
    estimatedProfit: item.estimated_profit || 0,
    marginPercent: item.estimated_margin_percent || 0,
    lotId: item.lot_id || null,
    lotMarketValueAtAllocation: item.lot_market_value_at_allocation || 0,
    lotAllocationRatio: item.lot_allocation_ratio || 0,
    costOverride: Boolean(item.purchase_price_override),
    dealScore: item.deal_score || 0,
    dealScoreLabel: item.deal_score_label || '',
    category: item.category || '',
    genre: item.genre || '',
    notes: item.notes || '',
    createdAt: item.created_at,
    soldAt: item.sold_at || null,
    sellPrice: item.sell_price || null,
    soldVia: item.sold_via || null,
    prep: {
      sorted: Boolean(item.sorted_at),
      cleaned: Boolean(item.cleaned_at),
      tested: Boolean(item.tested_at),
      notes: Boolean(item.notes_added_at),
      onRack: Boolean(item.on_rack_at),
      listed: Boolean(item.listed_ebay_at || item.listed_amazon_at || item.listed_whatnot_at),
    },
  }));
}

function compactAnalysisForAi(analysis: AssistantAnalysis, app: AssistantAppContext, inventory: AssistantInventoryItem[]) {
  return {
    inventoryRowsAvailableToYou: inventory.length,
    inventoryRowsIncluded: Math.min(inventory.length, 350),
    inventory: compactInventoryForAi(inventory),
    summary: analysis.summary,
    prep: {
      needsSortedCount: app.prep.needsSorted.length,
      needsCleanedCount: app.prep.needsCleaned.length,
      needsTestedCount: app.prep.needsTested.length,
      needsNotesCount: app.prep.needsNotes.length,
      readyToListCount: app.prep.readyToList.length,
      listedCount: app.prep.listed.length,
      needsCleaned: app.prep.needsCleaned.slice(0, 15).map((item) => ({
        name: item.product_name,
        console: item.console,
        condition: item.condition,
      })),
      readyToList: app.prep.readyToList.slice(0, 15).map((item) => ({
        name: item.product_name,
        console: item.console,
        condition: item.condition,
      })),
    },
    finance: {
      inventoryProfitLast4Days: app.finance.inventoryProfitLast4Days,
      inventoryProfitLast7Days: app.finance.inventoryProfitLast7Days,
      inventoryProfitLast30Days: app.finance.inventoryProfitLast30Days,
      revenueLast4Days: app.finance.revenueLast4Days,
      soldLast4DaysCount: app.finance.soldLast4Days.length,
      ledgerLast30Days: app.finance.ledgerLast30Days,
      recentTransactions: app.finance.recentTransactions.slice(0, 12),
    },
    intake: {
      pendingShipments: app.intake.pendingShipments,
      receivedShipments: app.intake.receivedShipments.slice(0, 12),
      lotsNeedingAllocation: app.intake.lotsNeedingAllocation,
      lots: app.intake.lots.slice(0, 25),
      process:
        'Every item starts as a shipment. Receiving a shipment creates a lot with total paid. Scanned items attach to that lot. Final COGS uses lot total paid divided by total current market value, then applies that ratio to each item market value. Profit is market value minus allocated COGS.',
    },
    shows: app.shows,
    suggestedActions: app.suggestedActions,
    showPlan: {
      ...analysis.showPlan,
      items: analysis.showPlan.items.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.product_name,
        console: item.console,
        condition: item.condition,
        cost: item.cost,
        marketValue: item.marketValue,
        profit: item.profit,
        marginPercent: item.marginPercent,
        ageDays: item.ageDays,
        score: item.showScore,
        startPrice: item.startPrice,
        reasons: item.reasons,
      })),
    },
    topProfitItems: analysis.topProfitItems.slice(0, 12).map((item) => ({
      name: item.product_name,
      console: item.console,
      condition: item.condition,
      cost: item.cost,
      marketValue: item.marketValue,
      profit: item.profit,
      marginPercent: item.marginPercent,
    })),
    staleItems: analysis.staleItems.slice(0, 8).map((item) => ({
      name: item.product_name,
      console: item.console,
      ageDays: item.ageDays,
      profit: item.profit,
    })),
    dataIssues: analysis.dataIssues.slice(0, 8).map((item) => ({
      name: item.product_name,
      console: item.console,
      missingPrice: item.marketValue <= 0,
      missingCost: item.cost <= 0,
      missingImage: !item.image_url,
    })),
  };
}

function outputTextFromResponse(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function assistantModel() {
  return process.env.OPENAI_MODEL || process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL;
}

function assistantReasoningEffort() {
  const effort = process.env.OPENAI_REASONING_EFFORT || process.env.ASSISTANT_REASONING_EFFORT || DEFAULT_ASSISTANT_REASONING_EFFORT;
  return ['minimal', 'low', 'medium', 'high'].includes(effort) ? effort : DEFAULT_ASSISTANT_REASONING_EFFORT;
}

function openAIErrorMessage(status: number, errorText: string) {
  try {
    const parsed = JSON.parse(errorText);
    const message = parsed?.error?.message || 'OpenAI request failed';
    const code = parsed?.error?.code || '';
    if (status === 429 && code === 'insufficient_quota') {
      return 'OpenAI quota exceeded. Check your OpenAI billing plan, credits, or usage limits, then try again.';
    }
    return `${message}${code ? ` (${code})` : ''}`;
  } catch {
    return `OpenAI request failed (${status})${errorText ? `: ${errorText.slice(0, 180)}` : ''}`;
  }
}

function buildExternalLookupAnswer(lookup: ExternalLookup, inventoryMatch?: InventoryMatchSummary | null) {
  const inventoryLead = inventoryMatch ? `${buildInventoryLookupLead(inventoryMatch)}\n\nExternal market info\n` : '';

  if (lookup.provider === 'pricecharting') {
    if (!lookup.product) {
      const warning = lookup.warnings.length ? `\n\nWhat happened: ${lookup.warnings.join(' ')}` : '';
      return `${inventoryLead}I tried to check PriceCharting for "${lookup.query}", but I could not find a matching product with readable prices.${warning}\n\nSearch used: ${lookup.sourceUrl}`;
    }

    const prices = lookup.product.prices;
    const rows = [
      ['Loose', prices.loose],
      ['CIB / Complete', prices.cib],
      ['New / Sealed', prices.new],
      ['Graded', prices.graded],
      ['GameStop', prices.gamestop],
      ['GameStop trade', prices.gamestopTrade],
    ]
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => `- ${label}: $${Number(value).toFixed(2)}`)
      .join('\n');

    const warning = lookup.warnings.length ? `\n\nLookup notes: ${lookup.warnings.join(' ')}` : '';
    return `${inventoryLead}PriceCharting has "${lookup.product.productName}" for ${lookup.product.consoleName || 'Unknown platform'} at:\n\n${rows || 'No condition prices were returned.'}\n\nSource: ${lookup.sourceUrl}${warning}`;
  }

  if (lookup.provider === 'ebay_sold') {
    if (lookup.sampleSize === 0) {
      const warning = lookup.warnings.length ? `\n\nWhat happened: ${lookup.warnings.join(' ')}` : '';
      return `${inventoryLead}I tried to calculate recent eBay sold comps for "${lookup.query}", but I could not read sold prices from eBay's result HTML.${warning}\n\nSearch used: ${lookup.sourceUrl}`;
    }

    const warning = lookup.warnings.length ? `\n\nParsing notes: ${lookup.warnings.join(' ')}` : '';
    return `${inventoryLead}I checked visible eBay completed/sold results for "${lookup.query}" and calculated this from ${lookup.sampleSize} readable sold price(s):\n\nAverage: $${lookup.averagePrice.toFixed(2)}\nMedian: $${lookup.medianPrice.toFixed(2)}\nRange: $${lookup.lowPrice.toFixed(2)} - $${lookup.highPrice.toFixed(2)}\n\nSource: ${lookup.sourceUrl}${warning}`;
  }

  if (lookup.results.length === 0) {
    const warning = lookup.warnings.length ? `\n\nWhat happened: ${lookup.warnings.join(' ')}` : '';
    return `${inventoryLead}I tried to check GameStop for "${lookup.query}", but I could not find a readable product price in the page HTML.${warning}\n\nSearch used: ${lookup.sourceUrl}`;
  }

  const rows = lookup.results
    .map((item, index) => {
      const conditionText = item.conditions.length
        ? item.conditions.map((condition) => `${condition.condition} ${condition.price}`).join(', ')
        : item.priceText;
      return `${index + 1}. ${item.title}\n   ${conditionText}\n   ${item.availability}\n   ${item.url}`;
    })
    .join('\n\n');

  const warning = lookup.warnings.length ? `\n\nParsing notes: ${lookup.warnings.join(' ')}` : '';
  return `${inventoryLead}I checked GameStop for "${lookup.query}" and found:\n\n${rows}${warning}`;
}

const QUERY_STOP_WORDS = new Set([
  'about',
  'all',
  'any',
  'clean',
  'cleaned',
  'console',
  'find',
  'game',
  'games',
  'have',
  'inventory',
  'item',
  'items',
  'list',
  'need',
  'needs',
  'show',
  'still',
  'that',
  'the',
  'what',
  'which',
  'with',
]);

function queryWords(message: string) {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !QUERY_STOP_WORDS.has(word));
}

function itemMatchesWords(item: AssistantInventoryItem, words: string[]) {
  if (words.length === 0) return true;
  const haystack = [item.product_name, item.console, item.condition, item.category, item.genre, item.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function fallbackMarketValue(item: AssistantInventoryItem) {
  return Number(item.selected_market_value || item.price_cib || item.price_loose || item.price_new || item.price_graded || 0);
}

function normalizeLookupWords(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !QUERY_STOP_WORDS.has(word));
}

function inventoryLookupQuery(message: string, lookup?: ExternalLookup | null) {
  if (lookup?.provider === 'pricecharting' && lookup.product?.productName) {
    return [lookup.product.productName, lookup.product.consoleName].filter(Boolean).join(' ');
  }
  return cleanPriceChartingQuery(message) || cleanExternalGameQuery(message) || cleanEbaySoldQuery(message) || message;
}

function findInventoryMatchesForLookup(
  message: string,
  inventory: AssistantInventoryItem[],
  lookup?: ExternalLookup | null
): InventoryMatchSummary {
  const query = inventoryLookupQuery(message, lookup);
  const platform = detectPlatform(query) || (lookup?.provider === 'pricecharting' ? lookup.product?.consoleName || '' : '');
  const titleWords = normalizeLookupWords(
    platform
      ? query.replace(new RegExp(platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
      : query
  );
  const searchWords = titleWords.length ? titleWords : normalizeLookupWords(query);

  const rows = inventory
    .filter((item) => (item.status || 'available') !== 'sold')
    .map((item) => {
      const haystack = [item.product_name, item.console, item.condition].filter(Boolean).join(' ').toLowerCase();
      const wordMatches = searchWords.filter((word) => haystack.includes(word)).length;
      const platformMatch = platform ? String(item.console || '').toLowerCase().includes(platform.toLowerCase()) : true;
      const score = wordMatches + (platformMatch ? 1 : 0);
      return { item, score, wordMatches, platformMatch };
    })
    .filter((row) => row.wordMatches >= Math.max(1, Math.min(searchWords.length, 2)) && (!platform || row.platformMatch || row.wordMatches >= searchWords.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((row) => row.item);

  return { rows, query };
}

function uniqueVariantKey(name: string, platform: string) {
  return `${name.trim().toLowerCase()}|${platform.trim().toLowerCase()}`;
}

function shouldClarifyPriceQuestion(message: string) {
  if (!shouldLookupPriceCharting(message)) return false;
  if (detectPlatform(message)) return false;

  const query = cleanPriceChartingQuery(message);
  const words = normalizeLookupWords(query);
  const hasSpecificNumber = /\b\d+\b/.test(query);
  if (hasSpecificNumber) return false;

  return words.length > 0 && words.length <= 3;
}

async function buildPriceLookupClarification(
  message: string,
  inventory: AssistantInventoryItem[],
  supabase: SupabaseClient<any>,
  accountId: string
): Promise<AssistantClarification | null> {
  if (!shouldClarifyPriceQuestion(message)) return null;

  const query = cleanPriceChartingQuery(message);
  const inventoryMatches = findInventoryMatchesForLookup(message, inventory, null).rows;
  const choices = new Map<string, AssistantClarification['choices'][number]>();

  for (const item of inventoryMatches.slice(0, 6)) {
    const label = [item.product_name, item.console].filter(Boolean).join(' - ');
    choices.set(uniqueVariantKey(item.product_name, item.console || ''), {
      label,
      detail: `In inventory: ${item.condition || 'Condition?'}${Number(item.quantity || 1) > 1 ? ` x${item.quantity}` : ''}`,
      source: 'inventory',
    });
  }

  try {
    const products = await searchPriceChartingProducts(query, supabase, accountId);
    for (const product of products.slice(0, 12)) {
      const key = uniqueVariantKey(product.productName, product.consoleName);
      if (!choices.has(key)) {
        choices.set(key, {
          label: [product.productName, product.consoleName].filter(Boolean).join(' - '),
          detail: 'PriceCharting match',
          source: 'pricecharting',
        });
      }
    }
  } catch {
    // If PriceCharting cannot provide candidates, inventory matches can still clarify.
  }

  const finalChoices = Array.from(choices.values()).slice(0, 10);
  if (finalChoices.length <= 1) return null;

  const rows = finalChoices.map((choice, index) => `${index + 1}. ${choice.label} (${choice.detail})`).join('\n');
  return {
    originalMessage: message,
    question: `I found multiple matches for "${query}". Which one should I price?\n\n${rows}\n\nReply with the number, title, or platform.`,
    choices: finalChoices,
  };
}

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function inventoryAskPrice(item: AssistantInventoryItem) {
  const explicit = Number(item.sell_price) || 0;
  if (explicit > 0) return explicit;
  try {
    return buildItemBusinessPlan(item).pricePlan.recommendedAskingPrice || fallbackMarketValue(item);
  } catch {
    return fallbackMarketValue(item);
  }
}

function buildInventoryLookupLead(match: InventoryMatchSummary) {
  if (match.rows.length === 0) {
    return `Your inventory\nI did not find an available copy in your inventory for "${match.query}".`;
  }

  const totalQuantity = match.rows.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0);
  const rows = match.rows
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const market = fallbackMarketValue(item);
      const ask = inventoryAskPrice(item);
      const cost = Number(item.purchase_price || 0);
      const profit = ask > 0 ? ask - cost : market - cost;
      return `- ${item.product_name} (${item.console || 'Unknown'}, ${item.condition || 'Condition?'})${quantity > 1 ? ` x${quantity}` : ''}\n  Your ask: ${ask > 0 ? formatMoney(ask) : 'not set'}${market > 0 ? ` / app market: ${formatMoney(market)}` : ''}${cost > 0 ? ` / cost: ${formatMoney(cost)}` : ''}${Number.isFinite(profit) && (ask > 0 || market > 0) ? ` / est. profit: ${formatMoney(profit)}` : ''}`;
    })
    .join('\n');

  return `Your inventory\nYou have ${totalQuantity} available cop${totalQuantity === 1 ? 'y' : 'ies'} matching "${match.query}":\n${rows}`;
}

function resolveClarifiedMessage(
  originalMessage: string | undefined,
  clarificationReply: string,
  choices?: AssistantClarification['choices']
) {
  const original = originalMessage?.trim();
  if (!original) return clarificationReply;

  const reply = clarificationReply.trim();
  const numericChoice = reply.match(/^\s*(\d{1,2})\s*$/);
  if (numericChoice && choices?.length) {
    const index = Number(numericChoice[1]) - 1;
    const choice = choices[index];
    if (choice) return `${original} ${choice.label}`;
  }

  return `${original} ${reply}`;
}

function buildInventorySearchAnswer(message: string, inventory: AssistantInventoryItem[], app: AssistantAppContext) {
  if (/\b(lot|lots|shipment|shipments|cogs|cost basis|allocation|allocated)\b/i.test(message)) {
    return null;
  }

  const words = queryWords(message);
  const isSearchy = /\b(do i have|find|search|show me|which|what.*inventory|list.*games|games.*have)\b/i.test(message);
  const isCleanQuestion = /\bclean|cleaned|cleaning\b/i.test(message);
  const isCountQuestion = /\bhow many|count|total\b/i.test(message);

  if (!isSearchy && !isCleanQuestion && !isCountQuestion) return null;

  const source = isCleanQuestion ? app.prep.needsCleaned : inventory.filter((item) => (item.status || 'available') !== 'sold');
  const matches = source.filter((item) => itemMatchesWords(item, words));

  if (isCountQuestion) {
    const countSource = words.length > 0 ? matches : source;
    const byConsole = countSource.reduce<Record<string, number>>((acc, item) => {
      const key = item.console || 'Unknown';
      acc[key] = (acc[key] || 0) + Number(item.quantity || 1);
      return acc;
    }, {});
    const consoleRows = Object.entries(byConsole)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([consoleName, count]) => `- ${consoleName}: ${count}`)
      .join('\n');
    return `I found ${countSource.reduce((sum, item) => sum + Number(item.quantity || 1), 0)} matching item(s).${consoleRows ? `\n\nBy console:\n${consoleRows}` : ''}`;
  }

  if (matches.length === 0) {
    return isCleanQuestion
      ? `I did not find any matching items that still need cleaned${words.length ? ` for "${words.join(' ')}"` : ''}.`
      : `I did not find matching available inventory${words.length ? ` for "${words.join(' ')}"` : ''}.`;
  }

  const rows = matches
    .slice(0, 15)
    .map((item) => {
      const market = fallbackMarketValue(item);
      const quantity = Number(item.quantity || 1);
      return `- ${item.product_name} (${item.console || 'Unknown'}, ${item.condition || 'Condition?'})${quantity > 1 ? ` x${quantity}` : ''}${market > 0 ? ` - market about $${market.toFixed(2)}` : ''}`;
    })
    .join('\n');

  const prefix = isCleanQuestion
    ? `${matches.length} matching item(s) still need cleaned:`
    : `I found ${matches.length} matching available item(s):`;

  return `${prefix}\n\n${rows}${matches.length > 15 ? `\n\nShowing the first 15. Narrow the title, console, or condition to drill in.` : ''}`;
}

async function askOpenAI(
  message: string,
  analysis: AssistantAnalysis,
  app: AssistantAppContext,
  inventory: AssistantInventoryItem[],
  externalLookup: ExternalLookup | null
): Promise<{ answer: string | null; error: string | null; model: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { answer: null, error: 'OPENAI_API_KEY is not configured', model: null };

  const model = assistantModel();
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 2200,
        reasoning: { effort: assistantReasoningEffort() },
        text: { verbosity: 'medium' },
        instructions:
          'You are RetroLoot Pro Analyst, a natural-language business copilot for a video game resale inventory app. Think through the user request, choose the relevant app data or external lookup data, perform any needed math, and answer plainly. You can answer questions about inventory, prep, finance, profit, stale inventory, metadata, shipments, lots, COGS allocation, show curation, specific titles, and external pricing. For app data, use only the provided inventory, prep, finance, intake, shows, and suggestions. Intake rule: every item starts as a shipment; received shipments create lots with total paid; scanned lot items get market values; COGS is allocated by lot total paid divided by total lot market value, applied to each item market value; item profit is market value minus allocated COGS. For external PriceCharting, GameStop, and eBay sold-comps questions, use the provided externalLookup results and cite the source included there. Do not invent prices, sales, quantities, or app capabilities. If data is missing or a source could not be parsed, say exactly what is missing and suggest the next best action. You may recommend changes, but clearly say changes require user approval before records are modified. Keep recommendations direct, helpful, and business-practical.',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `User request: ${message}\n\nApp analysis JSON:\n${JSON.stringify(compactAnalysisForAi(analysis, app, inventory))}\n\nExternal lookup JSON:\n${JSON.stringify(externalLookup)}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { answer: null, error: openAIErrorMessage(response.status, errorText), model };
    }
    const data = await response.json();
    return { answer: outputTextFromResponse(data) || null, error: null, model };
  } catch (error) {
    return { answer: null, error: error instanceof Error ? error.message : 'OpenAI request failed', model };
  }
}

export async function GET() {
  return json({
    ok: true,
    message: 'AI assistant endpoint is running. Use POST from the Assistant page.',
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: assistantModel(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);
    const { accountId } = await getServerAccountContext(supabase, user);

    const body = (await req.json()) as AssistantRequest;
    const rawMessage = body.message?.trim() || 'Give me the best business opportunities in my inventory.';
    const clarificationOriginal = body.clarificationContext?.originalMessage?.trim();
    const message = clarificationOriginal
      ? resolveClarifiedMessage(clarificationOriginal, rawMessage, body.clarificationContext?.choices)
      : rawMessage;

    const inventoryRes = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1500);
    if (inventoryRes.error) throw inventoryRes.error;

    const inventory = (inventoryRes.data || []) as AssistantInventoryItem[];
    const clarification = clarificationOriginal
      ? null
      : await buildPriceLookupClarification(message, inventory, supabase, accountId);
    const externalLookupPromise = clarification
      ? Promise.resolve(null)
      : shouldLookupGamestop(message)
        ? lookupGamestop(message)
        : shouldLookupEbaySold(message)
          ? lookupEbaySold(message)
          : shouldLookupPriceCharting(message)
            ? lookupPriceCharting(message, supabase, accountId)
            : Promise.resolve(null);

    const [txRes, showsRes, lotsRes, shipmentsRes, externalLookup] = await Promise.all([
      supabase
        .from('financial_transactions')
        .select('id, date, description, amount, type, category, source, platform, is_reconciled')
        .eq('user_id', accountId)
        .order('date', { ascending: false })
        .limit(500),
      supabase
        .from('show_lists')
        .select('id, name, show_date, created_at, status, show_items(id)')
        .eq('user_id', accountId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('lots')
        .select('id, name, source, received_at, total_paid, total_market_value, allocation_ratio, allocation_status, shipment_id')
        .eq('user_id', accountId)
        .order('received_at', { ascending: false })
        .limit(100),
      supabase
        .from('inbound_shipments')
        .select('id, title, source, status, total_paid, lot_id, expected_date, received_at')
        .eq('user_id', accountId)
        .order('created_at', { ascending: false })
        .limit(100),
      externalLookupPromise,
    ]);

    const analysis = analyzeInventory(inventory, {
      theme: body.theme || message,
      targetItemCount: body.targetItemCount,
      minMarginPercent: body.minMarginPercent,
    });
    const appContext = buildAppContext(
      inventory,
      txRes.error ? [] : (txRes.data || []) as any,
      showsRes.error ? [] : (showsRes.data || []) as any,
      lotsRes.error ? [] : (lotsRes.data || []) as AssistantLot[],
      shipmentsRes.error ? [] : (shipmentsRes.data || []) as AssistantShipment[]
    );
    if (txRes.error) appContext.suggestedActions.push(`Finance data was unavailable to the assistant: ${txRes.error.message}`);
    if (showsRes.error) appContext.suggestedActions.push(`Show list data was unavailable to the assistant: ${showsRes.error.message}`);
    if (lotsRes.error) appContext.suggestedActions.push(`Lot data was unavailable to the assistant: ${lotsRes.error.message}`);
    if (shipmentsRes.error) appContext.suggestedActions.push(`Shipment data was unavailable to the assistant: ${shipmentsRes.error.message}`);

    if (clarification) {
      return json({
        success: true,
        answer: clarification.question,
        clarification,
        usedAI: false,
        openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
        aiError: null,
        aiModel: assistantModel(),
        fallbackAnswer: clarification.question,
        externalLookup: null,
        analysis,
        appContext,
      });
    }

    const intakeQuestion = /\b(lot|lots|shipment|shipments|cogs|cost basis|allocation|allocated)\b/i.test(message);
    const deterministicAnswer = buildAppDeterministicAnswer(message, analysis, appContext);
    const inventorySearchAnswer = buildInventorySearchAnswer(message, inventory, appContext);
    const externalInventoryMatch = externalLookup ? findInventoryMatchesForLookup(message, inventory, externalLookup) : null;
    const fallbackAnswer = externalLookup
      ? buildExternalLookupAnswer(externalLookup, externalInventoryMatch)
      : intakeQuestion
        ? deterministicAnswer
        : inventorySearchAnswer || deterministicAnswer;
    let answer = fallbackAnswer;
    let usedAI = false;
    let aiError: string | null = null;
    let aiModel: string | null = assistantModel();

    const shouldUseOpenAI = !externalLookup && !inventorySearchAnswer;
    if (shouldUseOpenAI) {
      const aiResult = await askOpenAI(message, analysis, appContext, inventory, externalLookup);
      aiError = aiResult.error;
      aiModel = aiResult.model || aiModel;
      if (aiResult.answer) {
        answer = aiResult.answer;
        usedAI = true;
      }
    }

    return json({
      success: true,
      answer,
      usedAI,
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      aiError,
      aiModel,
      fallbackAnswer,
      externalLookup,
      analysis,
      appContext,
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Assistant request failed',
      },
      500
    );
  }
}
