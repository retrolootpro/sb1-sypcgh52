import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeInventory,
  buildAppContext,
  buildAppDeterministicAnswer,
  type AssistantAnalysis,
  type AssistantAppContext,
  type AssistantInventoryItem,
} from '@/lib/ai-inventory-analysis';

export const dynamic = 'force-dynamic';

type AssistantRequest = {
  message?: string;
  theme?: string;
  targetItemCount?: number;
  minMarginPercent?: number;
};

type ExternalLookup = {
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

function shouldLookupGamestop(message: string) {
  return /\bgamestop|game stop\b/i.test(message) && /\b(price|cost|current|sell|available|stock|pre-owned|new)\b/i.test(message);
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function lookupGamestop(message: string): Promise<ExternalLookup> {
  const query = cleanExternalGameQuery(message) || message;
  const sourceUrl = `https://www.gamestop.com/search/?q=${encodeURIComponent(query)}`;
  const warnings: string[] = [];
  const results: ExternalLookup['results'] = [];

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

function buildExternalLookupAnswer(lookup: ExternalLookup) {
  if (lookup.results.length === 0) {
    const warning = lookup.warnings.length ? `\n\nWhat happened: ${lookup.warnings.join(' ')}` : '';
    return `I tried to check GameStop for "${lookup.query}", but I could not find a readable product price in the page HTML.${warning}\n\nSearch used: ${lookup.sourceUrl}`;
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
  return `I checked GameStop for "${lookup.query}" and found:\n\n${rows}${warning}`;
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

function buildInventorySearchAnswer(message: string, inventory: AssistantInventoryItem[], app: AssistantAppContext) {
  const lower = message.toLowerCase();
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
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      store: false,
      max_output_tokens: 1400,
      instructions:
        'You are RetroLoot Pro Analyst, a practical resale business assistant for a video game resale inventory app. Read the provided inventory rows and app analysis before answering. Handle natural language flexibly: users may ask about counts, cleanup, profit, show curation, stale inventory, data quality, or specific titles. For app data, use only the provided inventory, prep, finance, shows, and suggestions. For external GameStop questions, use the provided externalLookup results and cite that it was parsed from GameStop pages at request time. Do not invent prices, sales, quantities, or app capabilities. If data is missing or a source could not be parsed, say exactly what is missing. You may recommend changes, but clearly say changes require user approval before records are modified. Keep recommendations direct, helpful, and business-practical.',
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

  if (!response.ok) return null;
  const data = await response.json();
  return outputTextFromResponse(data) || null;
}

export async function GET() {
  return json({
    ok: true,
    message: 'AI assistant endpoint is running. Use POST from the Assistant page.',
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
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

    const body = (await req.json()) as AssistantRequest;
    const message = body.message?.trim() || 'Give me the best business opportunities in my inventory.';

    const inventoryRes = await supabase
      .from('inventory_items')
      .select(
        'id, product_name, console, condition, purchase_price, selected_market_value, price_loose, price_cib, price_new, price_graded, estimated_profit, estimated_margin_percent, deal_score, deal_score_label, status, quantity, created_at, sold_at, sell_price, sold_via, image_url, category, genre, notes, sorted_at, cleaned_at, tested_at, notes_added_at, on_rack_at, listed_ebay_at, listed_amazon_at, listed_whatnot_at, lot_id'
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1500);
    if (inventoryRes.error) throw inventoryRes.error;

    const [txRes, showsRes, externalLookup] = await Promise.all([
      supabase
        .from('financial_transactions')
        .select('id, date, description, amount, type, category, source, platform, is_reconciled')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(500),
      supabase
        .from('show_lists')
        .select('id, name, show_date, created_at, status, show_items(id)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      shouldLookupGamestop(message) ? lookupGamestop(message) : Promise.resolve(null),
    ]);

    const inventory = (inventoryRes.data || []) as AssistantInventoryItem[];
    const analysis = analyzeInventory(inventory, {
      theme: body.theme || message,
      targetItemCount: body.targetItemCount,
      minMarginPercent: body.minMarginPercent,
    });
    const appContext = buildAppContext(
      inventory,
      txRes.error ? [] : (txRes.data || []) as any,
      showsRes.error ? [] : (showsRes.data || []) as any
    );
    if (txRes.error) appContext.suggestedActions.push(`Finance data was unavailable to the assistant: ${txRes.error.message}`);
    if (showsRes.error) appContext.suggestedActions.push(`Show list data was unavailable to the assistant: ${showsRes.error.message}`);

    let answer = externalLookup
      ? buildExternalLookupAnswer(externalLookup)
      : buildInventorySearchAnswer(message, inventory, appContext) || buildAppDeterministicAnswer(message, analysis, appContext);
    let usedAI = false;

    try {
      const aiAnswer = await askOpenAI(message, analysis, appContext, inventory, externalLookup);
      if (aiAnswer) {
        answer = aiAnswer;
        usedAI = true;
      }
    } catch {
      usedAI = false;
    }

    return json({
      success: true,
      answer,
      usedAI,
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
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
