import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
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

function parsePrice(value: string) {
  const parsed = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function priceStrings(text: string) {
  return unique(text.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).map((price) => price.replace(/\s+/g, ''));
}

function extractConditionPrices(text: string) {
  const conditions = ['New', 'Pre-Owned', 'Used', 'Digital'];
  const results: Array<{ condition: string; price: number; priceText: string }> = [];

  for (const condition of conditions) {
    const pattern = new RegExp(`${condition}[\\s\\S]{0,180}?(\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)`, 'i');
    const match = text.match(pattern);
    if (match?.[1]) {
      const priceText = match[1].replace(/\s+/g, '');
      if (!results.some((item) => item.condition === condition && item.priceText === priceText)) {
        results.push({ condition, price: parsePrice(priceText), priceText });
      }
    }
  }

  return results;
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  const platform = String(body.platform || '').trim();
  const query = [title, platform].filter(Boolean).join(' ').trim();

  if (!query) {
    return NextResponse.json({ success: false, message: 'Title is required' }, { status: 400 });
  }

  const sourceUrl = `https://www.gamestop.com/search/?q=${encodeURIComponent(query)}`;
  const warnings: string[] = [];

  try {
    const searchHtml = await fetchText(sourceUrl);
    const links = productLinksFromSearch(searchHtml);
    if (links.length === 0) {
      return NextResponse.json({
        success: true,
        query,
        sourceUrl,
        price: 0,
        priceText: '',
        title: '',
        url: '',
        conditions: [],
        warnings: ['GameStop search did not expose product links in the returned HTML.'],
      });
    }

    const url = links[0];
    const html = await fetchText(url);
    const text = stripHtml(html);
    const conditions = extractConditionPrices(text);
    const fallbackPrices = priceStrings(text)
      .filter((price) => !['$25', '$25.00'].includes(price))
      .map((priceText) => ({ condition: 'Visible price', price: parsePrice(priceText), priceText }));
    const bestCondition = conditions.find((item) => /pre-owned|used/i.test(item.condition)) || conditions[0] || fallbackPrices[0];
    const productTitle =
      extractMeta(html, 'og:title') ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ') ||
      'GameStop product';

    return NextResponse.json({
      success: true,
      query,
      sourceUrl,
      title: decodeHtml(productTitle),
      url,
      price: bestCondition?.price || 0,
      priceText: bestCondition?.priceText || '',
      conditions: conditions.length ? conditions : fallbackPrices.slice(0, 4),
      warnings,
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      query,
      sourceUrl,
      price: 0,
      priceText: '',
      title: '',
      url: '',
      conditions: [],
      warnings: [`GameStop lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
    });
  }
}
