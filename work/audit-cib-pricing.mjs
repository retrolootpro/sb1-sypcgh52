import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readEnv(file) {
  const env = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

function cents(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Math.round(Number(raw));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value) / 100;
}

function money(raw) {
  const n = Number(raw) || 0;
  return Math.round(n * 100) / 100;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s*-?\s*\(?(PlayStation\s*[1-5]?|PS[1-5]?|Xbox\s*(Series\s*[XS]?|One|360)?|Nintendo\s*Switch|Switch|Wii\s*U?|GameCube|N64|SNES|NES)\)?$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\b(NEW|SEALED|CIB|COMPLETE|LOOSE)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

async function pcFetch(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.status === 'success' && data['product-name'] ? data : null;
}

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function platformSlug(value) {
  const known = {
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
  const cleaned = String(value || '').toLowerCase().trim();
  return known[cleaned] || slug(cleaned);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function stripTags(html) {
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

function extractSummaryPrices(html) {
  const text = stripTags(html);
  const guideIdx = text.search(/Full Price Guide:/i);
  const guideText = guideIdx >= 0 ? text.slice(guideIdx, guideIdx + 1200) : text;
  const pick = (pattern) => {
    const match = guideText.match(pattern);
    if (!match) return 0;
    const value = Number.parseFloat(match[1].replace(/,/g, ''));
    return Number.isFinite(value) && value > 0.99 && value < 5000 ? value : 0;
  };

  const guidePrices = {
    loose: pick(/Loose\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    cib: pick(/(?:Complete|CIB)\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    new: pick(/New\s+\$\s*([0-9,]+\.[0-9]{2})/i),
    graded:
      pick(/Graded New\s+\$\s*([0-9,]+\.[0-9]{2})/i) ||
      pick(/Graded\s+\$\s*([0-9,]+\.[0-9]{2})/i),
  };
  if (guidePrices.loose || guidePrices.cib || guidePrices.new || guidePrices.graded) return guidePrices;

  const headerIdx = text.search(/Loose Price\s+Complete Price\s+New Price\s+Graded Price/i);
  if (headerIdx < 0) return guidePrices;
  const prices = [];
  const pricePattern = /\$\s*([0-9,]+\.[0-9]{2})/g;
  const summaryText = text.slice(headerIdx, headerIdx + 900);
  let match;
  while ((match = pricePattern.exec(summaryText)) !== null) {
    const price = Number.parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(price) && price > 0.99 && price < 5000) prices.push(price);
  }
  if (prices.length < 4) return guidePrices;
  return { loose: prices[0], cib: prices[1], new: prices[2], graded: prices[3] };
}

async function scrapePriceCharting(item) {
  const platform = platformSlug(item.console);
  const title = slug(cleanTitle(item.product_name) || item.product_name);
  const directUrl = `https://www.pricecharting.com/game/${platform}/${title}`;
  let finalUrl = directUrl;
  let response = await fetch(directUrl, { headers: browserHeaders, signal: AbortSignal.timeout(12000) });

  if (!response.ok) {
    const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`${item.product_name} ${item.console || ''}`.trim())}&type=videogames`;
    const search = await fetch(searchUrl, { headers: browserHeaders, signal: AbortSignal.timeout(12000) });
    if (!search.ok) return null;
    const searchHtml = await search.text();
    const links = [...searchHtml.matchAll(/href="(\/game\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]+)"/g)];
    if (!links.length) return null;
    finalUrl = `https://www.pricecharting.com${links[0][1]}`;
    response = await fetch(finalUrl, { headers: browserHeaders, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
  }

  const html = await response.text();
  const prices = extractSummaryPrices(html);
  if (!prices.loose && !prices.cib && !prices.new && !prices.graded) return null;
  const pageTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+Prices.*$/i, '').trim() || item.product_name;
  const id = html.match(/\/offer\?product=([0-9]+)/i)?.[1] || '';
  return {
    product: {
      id,
      'product-name': pageTitle,
      'console-name': item.console || '',
      'loose-price': Math.round(prices.loose * 100),
      'cib-price': Math.round(prices.cib * 100),
      'new-price': Math.round(prices.new * 100),
      'graded-price': Math.round(prices.graded * 100),
    },
    strategy: 'pricecharting_web',
    url: finalUrl,
  };
}

async function resolvePriceCharting(item, apiKey) {
  const base = 'https://www.pricecharting.com/api/product';
  const queries = [];
  if (item.pc_source_product_id) {
    queries.push({ url: `${base}?t=${apiKey}&id=${encodeURIComponent(item.pc_source_product_id)}`, strategy: 'stored_id' });
  }
  if (item.barcode) {
    queries.push({ url: `${base}?t=${apiKey}&upc=${encodeURIComponent(item.barcode)}`, strategy: 'upc' });
  }
  queries.push({ url: `${base}?t=${apiKey}&q=${encodeURIComponent(`${item.product_name} ${item.console || ''}`.trim())}`, strategy: 'title_platform' });
  const cleaned = cleanTitle(item.product_name);
  if (cleaned && cleaned !== item.product_name) {
    queries.push({ url: `${base}?t=${apiKey}&q=${encodeURIComponent(`${cleaned} ${item.console || ''}`.trim())}`, strategy: 'cleaned_title_platform' });
  }
  queries.push({ url: `${base}?t=${apiKey}&q=${encodeURIComponent(item.product_name)}`, strategy: 'title_only' });

  for (const query of queries) {
    const data = await pcFetch(query.url);
    if (!data) continue;
    const id = String(data.id ?? '');
    if (id && query.strategy !== 'stored_id') {
      const full = await pcFetch(`${base}?t=${apiKey}&id=${encodeURIComponent(id)}`);
      return { product: full ?? data, strategy: query.strategy };
    }
    return { product: data, strategy: query.strategy };
  }
  return scrapePriceCharting(item);
}

function selectedForCondition(condition, prices) {
  if (/new/i.test(condition)) return prices.new;
  if (/graded/i.test(condition)) return prices.graded || prices.new;
  if (/cib|complete/i.test(condition)) return prices.cib;
  return prices.loose;
}

function hasEditionMismatch(itemName, matchedName) {
  const wanted = String(itemName || '').toLowerCase();
  const matched = String(matchedName || '').toLowerCase();
  const editionWords = ['deluxe', 'limited', 'collector', 'collectors', 'goty', 'game of the year'];
  return editionWords.some((word) => wanted.includes(word) && !matched.includes(word));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const env = readEnv(path.join(root, '.env'));
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: items, error: itemsError } = await supabase
    .from('inventory_items')
    .select('id,user_id,product_name,console,condition,status,barcode,price_loose,price_cib,price_new,price_graded,selected_market_value,pricing_status,pricing_source,pricing_matched_title,pricing_matched_platform,pc_source_product_id,updated_at')
    .eq('condition', 'CIB')
    .order('product_name', { ascending: true });
  if (itemsError) throw itemsError;

  const userIds = [...new Set((items || []).map((item) => item.user_id).filter(Boolean))];
  const { data: keys, error: keyError } = await supabase
    .from('user_api_keys')
    .select('user_id,api_key,status,provider')
    .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('provider', 'pricecharting')
    .eq('status', 'active');
  if (keyError) throw keyError;

  const keyByUser = new Map((keys || []).map((row) => [row.user_id, row.api_key]));
  const rows = [];
  const corrections = [];
  const needsReview = [];

  for (const [index, item] of (items || []).entries()) {
    if (index % 25 === 0) console.error(`Checking ${index + 1}/${items.length}: ${item.product_name}`);
    const apiKey = keyByUser.get(item.user_id);
    if (!apiKey) {
      needsReview.push({ ...item, issue: 'missing_pricecharting_key' });
      continue;
    }

    const resolved = await resolvePriceCharting(item, apiKey);
    if (!resolved?.product) {
      needsReview.push({ ...item, issue: 'pricecharting_no_match' });
      continue;
    }

    const product = resolved.product;
    const pcPrices = {
      loose: cents(product['loose-price']),
      cib: cents(product['cib-price']),
      new: cents(product['new-price']),
      graded: cents(product['graded-price']),
    };
    const pcSelected = selectedForCondition(item.condition, pcPrices);
    const savedLoose = money(item.price_loose);
    const savedCib = money(item.price_cib);
    const savedSelected = money(item.selected_market_value);
    const selectedLooksLoose =
      savedSelected > 0 &&
      savedLoose > 0 &&
      Math.abs(savedSelected - savedLoose) <= 0.01 &&
      pcPrices.cib > 0 &&
      Math.abs(pcPrices.cib - savedLoose) > 0.01;
    const savedCibWrong =
      pcPrices.cib > 0 &&
      (savedCib === 0 || Math.abs(savedCib - pcPrices.cib) > 0.01);
    const selectedWrong =
      pcSelected > 0 &&
      (savedSelected === 0 || Math.abs(savedSelected - pcSelected) > 0.01);

    const suspiciousMatch = hasEditionMismatch(item.product_name, product['product-name']);
    const row = {
      id: item.id,
      product_name: item.product_name,
      console: item.console,
      condition: item.condition,
      status: item.status || '',
      saved_selected_market_value: savedSelected,
      saved_price_loose: savedLoose,
      saved_price_cib: savedCib,
      pc_loose: pcPrices.loose,
      pc_cib: pcPrices.cib,
      pc_new: pcPrices.new,
      pc_graded: pcPrices.graded,
      pc_selected_market_value: pcSelected,
      delta_selected: money(pcSelected - savedSelected),
      pc_product_id: String(product.id ?? ''),
      pc_product_name: product['product-name'] || '',
      pc_platform: product['console-name'] || '',
      match_strategy: resolved.strategy,
      flag: suspiciousMatch ? 'needs_manual_match_review' : selectedLooksLoose ? 'selected_market_value_is_loose' : selectedWrong || savedCibWrong ? 'price_refresh_needed' : 'ok',
    };
    rows.push(row);

    if (suspiciousMatch) {
      needsReview.push({ ...item, issue: 'possible_wrong_pricecharting_match' });
      continue;
    }

    if (row.flag !== 'ok') {
      const update = {
        price_loose: pcPrices.loose || savedLoose,
        price_cib: pcPrices.cib || savedCib,
        price_new: pcPrices.new || money(item.price_new),
        price_graded: pcPrices.graded || money(item.price_graded),
        selected_market_value: pcSelected || savedSelected,
        pricing_status: 'found',
        pricing_source: 'PriceCharting',
        pricing_matched_title: product['product-name'] || item.pricing_matched_title,
        pricing_matched_platform: product['console-name'] || item.pricing_matched_platform,
        pc_source_product_id: String(product.id ?? item.pc_source_product_id ?? ''),
        pricing_last_checked_at: new Date().toISOString(),
      };
      corrections.push({ item, row, update });
    }

    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  const outDir = path.join(root, 'work');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `cib-pricing-audit-${stamp}.csv`);
  const headers = [
    'id',
    'product_name',
    'console',
    'condition',
    'status',
    'saved_selected_market_value',
    'saved_price_loose',
    'saved_price_cib',
    'pc_loose',
    'pc_cib',
    'pc_new',
    'pc_graded',
    'pc_selected_market_value',
    'delta_selected',
    'pc_product_id',
    'pc_product_name',
    'pc_platform',
    'match_strategy',
    'flag',
  ];
  fs.writeFileSync(
    csvPath,
    [headers.join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n')
  );

  const reviewPath = path.join(outDir, `cib-pricing-needs-review-${stamp}.csv`);
  const reviewHeaders = ['id', 'product_name', 'console', 'condition', 'status', 'issue'];
  fs.writeFileSync(
    reviewPath,
    [reviewHeaders.join(','), ...needsReview.map((row) => reviewHeaders.map((key) => csvEscape(row[key])).join(','))].join('\n')
  );

  if (apply) {
    for (const correction of corrections) {
      const { error } = await supabase
        .from('inventory_items')
        .update(correction.update)
        .eq('id', correction.item.id);
      if (error) throw error;
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scanned: (items || []).length,
    pricechartingChecked: rows.length,
    corrections: corrections.length,
    needsReview: needsReview.length,
    selectedLooksLoose: rows.filter((row) => row.flag === 'selected_market_value_is_loose').length,
    refreshNeeded: rows.filter((row) => row.flag === 'price_refresh_needed').length,
    report: csvPath,
    needsReviewReport: reviewPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
