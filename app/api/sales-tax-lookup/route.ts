import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function cleanZip(value: unknown) {
  return String(value || '').trim().match(/^\d{5}/)?.[0] || '';
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

function parsePercent(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : 0;
}

async function getStateForZip(zip: string) {
  const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  const place = data?.places?.[0];
  const stateAbbreviation = String(place?.['state abbreviation'] || '').trim().toLowerCase();
  if (!response.ok || !stateAbbreviation) {
    throw new Error(`Could not find a U.S. state for ZIP ${zip}`);
  }
  return {
    stateAbbreviation,
    city: String(place?.['place name'] || ''),
    state: String(place?.state || ''),
  };
}

async function lookupPublicSalesTax(zip: string) {
  const location = await getStateForZip(zip);
  const url = `https://www.sales-taxes.com/${location.stateAbbreviation}/${zip}`;
  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    cache: 'no-store',
  });
  const html = await response.text();

  if (!response.ok || !html) {
    throw new Error(`No public sales tax page found for ZIP ${zip}`);
  }

  const combinedText =
    html.match(/Combined Sales Tax:\s*[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*%/i)?.[0] ||
    html.match(/The\s+\d{4}\s+sales tax rate[^.]*?\bis\s+(\d+(?:\.\d+)?)\s*%/i)?.[0] ||
    '';
  const ratePercent =
    parsePercent(combinedText) ||
    parsePercent(html.match(/Zip code\s+\d{5}[\s\S]{0,300}?sales tax rate[^.]*?\./i)?.[0] || '');

  if (!Number.isFinite(ratePercent) || ratePercent <= 0) {
    throw new Error(`Could not parse a public sales tax rate for ZIP ${zip}`);
  }

  const stateRate = parsePercent(html.match(/State<\/a>\s*(\d+(?:\.\d+)?)%/i)?.[0] || html.match(/State[\s\S]{0,80}?(\d+(?:\.\d+)?)%/i)?.[0] || '');
  const countyName = decodeHtml(html.match(/<a[^>]*>([^<]*County)<\/a>/i)?.[1] || '');
  const cityName = decodeHtml(html.match(/Zip code\s+\d{5}\s+is located in\s*<a[^>]*>([^<]+)<\/a>/i)?.[1] || location.city);

  return {
    zip,
    provider: 'Sales-Taxes.com',
    rate: Number((ratePercent / 100).toFixed(6)),
    ratePercent: Number(ratePercent.toFixed(4)),
    source: `Sales-Taxes.com ZIP ${zip}`,
    sourceUrl: url,
    jurisdictions: {
      state: location.state,
      stateAbbreviation: location.stateAbbreviation.toUpperCase(),
      county: countyName,
      city: cityName,
      stateRate: stateRate ? Number((stateRate / 100).toFixed(6)) : 0,
    },
    notes: 'ZIP-based public estimate. Verify with the state/local revenue authority if exact compliance matters.',
  };
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const body = await req.json().catch(() => ({}));
    const zip = cleanZip(body.zip);
    if (!zip) return json({ success: false, message: 'Enter a valid 5-digit ZIP code.' }, 400);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    return json({
      success: true,
      ...(await lookupPublicSalesTax(zip)),
    });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'Sales tax lookup failed',
    }, 200);
  }
}
