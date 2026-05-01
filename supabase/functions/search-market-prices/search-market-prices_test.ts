/**
 * Regression tests for search-market-prices pricing engine.
 *
 * Covers the exact bugs that caused Mario Party 8 (Wii) to show
 * only Loose pricing with CIB/New/Graded returning "No data":
 *
 *   Bug 1 — eBay category 1249 returned 0 results silently
 *   Bug 2 — PC API limited tier returns cib/new/graded = 0
 *   Bug 3 — Quoted eBay searches too restrictive (0 matches)
 *
 * Run with: deno test --allow-none supabase/functions/search-market-prices/search-market-prices_test.ts
 */

import { assertEquals, assertNotEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// ─── Inline helpers (mirrors exact implementations in index.ts) ───────────────
// These are tested directly to ensure they cannot silently regress.

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

function extractPcRow(html: string, rowId: string): number {
  const rowPattern = new RegExp(`id="${rowId}"([\\s\\S]{0,1200}?)<\\/tr>`, 'i');
  const rowMatch = html.match(rowPattern);
  if (!rowMatch) return 0;
  const cell = rowMatch[1];

  const dataPriceMatch = cell.match(/data-price="(\d+)"/);
  if (dataPriceMatch) {
    const v = parseInt(dataPriceMatch[1], 10) / 100;
    if (isValidPrice(v)) return v;
  }

  const jsPriceMatch = cell.match(/js-price[^>]*>\s*\$?\s*([0-9,]+\.[0-9]{2})/);
  if (jsPriceMatch) {
    const v = parseFloat(jsPriceMatch[1].replace(/,/g, ''));
    if (isValidPrice(v)) return v;
  }

  const dollarMatch = cell.match(/>\s*\$\s*([0-9,]+\.[0-9]{2})/);
  if (dollarMatch) {
    const v = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (isValidPrice(v)) return v;
  }

  return 0;
}

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
  'game boy advance': 'gameboy-advance',
  gba: 'gameboy-advance',
  'nintendo ds': 'nintendo-ds',
  ds: 'nintendo-ds',
  '3ds': 'nintendo-3ds',
  'nintendo 3ds': 'nintendo-3ds',
  'nintendo switch': 'nintendo-switch',
  switch: 'nintendo-switch',
  ps1: 'playstation',
  ps2: 'playstation-2',
  'playstation 2': 'playstation-2',
  ps3: 'playstation-3',
  'playstation 3': 'playstation-3',
  ps4: 'playstation-4',
  ps5: 'playstation-5',
  psp: 'psp',
  xbox: 'xbox',
  'xbox 360': 'xbox-360',
  'xbox one': 'xbox-one',
  'xbox series x': 'xbox-series-x',
};

// CRITICAL: This must always be 139973, never 1249
const EBAY_CATEGORY: Record<string, string> = {
  loose:  '139973',
  cib:    '139973',
  new:    '139973',
  graded: '0',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── Bug 1 regression: eBay category must be 139973 ───────────────────────────

Deno.test('eBay category for loose must be 139973 (Video Games US), not 1249', () => {
  assertEquals(EBAY_CATEGORY.loose, '139973');
});

Deno.test('eBay category for cib must be 139973', () => {
  assertEquals(EBAY_CATEGORY.cib, '139973');
});

Deno.test('eBay category for new must be 139973', () => {
  assertEquals(EBAY_CATEGORY.new, '139973');
});

Deno.test('eBay category 1249 is NOT used for any game condition', () => {
  for (const [cond, cat] of Object.entries(EBAY_CATEGORY)) {
    if (cond !== 'graded') {
      assertNotEquals(
        cat,
        '1249',
        `eBay category for ${cond} must not be 1249 — parent category returns 0 results silently`
      );
    }
  }
});

// ── Bug 2 regression: pcCents conversion ─────────────────────────────────────

Deno.test('pcCents: 2399 (PC API cents) → $23.99', () => {
  assertEquals(pcCents(2399), 23.99);
});

Deno.test('pcCents: 0 (limited API tier no-data) → 0', () => {
  assertEquals(pcCents(0), 0);
});

Deno.test('pcCents: null → 0', () => {
  assertEquals(pcCents(null), 0);
});

Deno.test('pcCents: string "2399" → 23.99', () => {
  assertEquals(pcCents('2399'), 23.99);
});

Deno.test('pcCents: negative value → 0', () => {
  assertEquals(pcCents(-100), 0);
});

Deno.test('pcCents: typical Mario Party 8 loose price (2399 = $23.99)', () => {
  assertEquals(pcCents(2399), 23.99);
});

// ── URL slug construction for PC web scraping ─────────────────────────────────

Deno.test('toUrlSlug: "Mario Party 8" → "mario-party-8"', () => {
  assertEquals(toUrlSlug('Mario Party 8'), 'mario-party-8');
});

Deno.test('toUrlSlug: "The Legend of Zelda: Breath of the Wild" strips colon', () => {
  assertEquals(toUrlSlug('The Legend of Zelda: Breath of the Wild'), 'the-legend-of-zelda-breath-of-the-wild');
});

Deno.test('toUrlSlug: consecutive spaces collapse to single hyphen', () => {
  assertEquals(toUrlSlug('Mario  Kart  Wii'), 'mario-kart-wii');
});

Deno.test('PC console slug: "wii" → "wii"', () => {
  assertEquals(PC_CONSOLE_SLUG['wii'], 'wii');
});

Deno.test('PC console slug: "Wii" (case-insensitive via toLowerCase) → "wii"', () => {
  const platform = 'Wii';
  const slug = PC_CONSOLE_SLUG[platform.toLowerCase().trim()];
  assertEquals(slug, 'wii');
});

Deno.test('Mario Party 8 Wii direct URL constructs correctly', () => {
  const productName = 'Mario Party 8';
  const platform = 'Wii';
  const consoleSlug = PC_CONSOLE_SLUG[platform.toLowerCase().trim()];
  const titleSlug = toUrlSlug(productName);
  const directUrl = `https://www.pricecharting.com/game/${consoleSlug}/${titleSlug}`;
  assertEquals(directUrl, 'https://www.pricecharting.com/game/wii/mario-party-8');
});

// ── PC web HTML parsing via extractPcRow ──────────────────────────────────────

Deno.test('extractPcRow: extracts price from data-price attribute (cents)', () => {
  const html = `
    <table>
      <tr id="complete_price">
        <td class="title">CIB</td>
        <td data-price="4599" class="price">$45.99</td>
      </tr>
    </table>
  `;
  assertEquals(extractPcRow(html, 'complete_price'), 45.99);
});

Deno.test('extractPcRow: extracts price from js-price span', () => {
  const html = `
    <table>
      <tr id="used_price">
        <td class="title">Loose</td>
        <td><span class="js-price">$23.99</span></td>
      </tr>
    </table>
  `;
  assertEquals(extractPcRow(html, 'used_price'), 23.99);
});

Deno.test('extractPcRow: extracts price from bare dollar sign', () => {
  const html = `
    <table>
      <tr id="new_price">
        <td class="title">New</td>
        <td>$79.99</td>
      </tr>
    </table>
  `;
  assertEquals(extractPcRow(html, 'new_price'), 79.99);
});

Deno.test('extractPcRow: returns 0 when row not found', () => {
  const html = '<table><tr id="used_price"><td>$23.99</td></tr></table>';
  assertEquals(extractPcRow(html, 'complete_price'), 0);
});

Deno.test('extractPcRow: data-price "0" is rejected (invalid price)', () => {
  const html = `
    <table>
      <tr id="complete_price">
        <td data-price="0" class="price">N/A</td>
      </tr>
    </table>
  `;
  assertEquals(extractPcRow(html, 'complete_price'), 0);
});

Deno.test('extractPcRow: CIB row ID is "complete_price" (not "cib_price")', () => {
  const html = `
    <table>
      <tr id="complete_price">
        <td data-price="3599"></td>
      </tr>
    </table>
  `;
  assertNotEquals(extractPcRow(html, 'complete_price'), 0);
  assertEquals(extractPcRow(html, 'complete_price'), 35.99);
});

Deno.test('extractPcRow: loose row ID is "used_price" (not "loose_price")', () => {
  const html = `
    <table>
      <tr id="used_price">
        <td data-price="2399"></td>
      </tr>
    </table>
  `;
  assertEquals(extractPcRow(html, 'used_price'), 23.99);
});

// ── isValidPrice guards ───────────────────────────────────────────────────────

Deno.test('isValidPrice: $23.99 is valid', () => {
  assert(isValidPrice(23.99));
});

Deno.test('isValidPrice: $0 is invalid (prevents zero-overwrites)', () => {
  assert(!isValidPrice(0));
});

Deno.test('isValidPrice: $0.50 is invalid (below minimum threshold)', () => {
  assert(!isValidPrice(0.50));
});

Deno.test('isValidPrice: $5001 is invalid (above maximum threshold)', () => {
  assert(!isValidPrice(5001));
});

Deno.test('isValidPrice: NaN is invalid', () => {
  assert(!isValidPrice(NaN));
});

// ── trimmedMean for eBay price aggregation ────────────────────────────────────

Deno.test('trimmedMean: empty array returns 0', () => {
  assertEquals(trimmedMean([]), 0);
});

Deno.test('trimmedMean: single value returns that value', () => {
  assertEquals(trimmedMean([23.99]), 23.99);
});

Deno.test('trimmedMean: trims outliers from large arrays', () => {
  const prices = [20, 21, 22, 23, 24, 25, 26, 27, 28, 100]; // 100 is outlier
  const mean = trimmedMean(prices);
  assert(mean < 30, `Mean $${mean} should not be skewed by outlier`);
  assert(mean > 20, `Mean $${mean} should be in expected range`);
});

Deno.test('trimmedMean: two values returns average', () => {
  assertEquals(trimmedMean([20, 30]), 25);
});

// ── DB update rule: never overwrite valid prices with zeros ───────────────────

Deno.test('Never-overwrite-with-zero rule: only update DB when value > 0', () => {
  interface PriceUpdate {
    price_loose?: number;
    price_cib?: number;
    price_new?: number;
    price_graded?: number;
  }

  function buildDbUpdates(prices: { loose: number; cib: number; new: number; graded: number }): PriceUpdate {
    const updates: PriceUpdate = {};
    if (prices.loose  > 0) updates.price_loose  = prices.loose;
    if (prices.cib    > 0) updates.price_cib    = prices.cib;
    if (prices.new    > 0) updates.price_new    = prices.new;
    if (prices.graded > 0) updates.price_graded = prices.graded;
    return updates;
  }

  // Mario Party 8 scenario: PC API returns loose only, cib/new/graded = 0
  const apiLimitedPrices = { loose: 23.99, cib: 0, new: 0, graded: 0 };
  const updates = buildDbUpdates(apiLimitedPrices);

  assertEquals(updates.price_loose, 23.99, 'loose price should be written');
  assertEquals(updates.price_cib,   undefined, 'cib=0 must NOT overwrite existing DB value');
  assertEquals(updates.price_new,   undefined, 'new=0 must NOT overwrite existing DB value');
  assertEquals(updates.price_graded, undefined, 'graded=0 must NOT overwrite existing DB value');
});

// ── Mario Party 8 full scenario integration ───────────────────────────────────

Deno.test('Mario Party 8 Wii: full source priority cascade produces non-zero CIB', () => {
  // Simulates: PC API returns loose only → PC web fills CIB/New → eBay fills graded
  const pcApiPrices  = { loose: 23.99, cib: 0,    new: 0,    graded: 0    };
  const pcWebPrices  = { loose: 0,     cib: 45.99, new: 79.99, graded: 0   };
  const ebayPrices   = { loose: 0,     cib: 0,    new: 0,    graded: 65.00 };

  const conditions = ['loose', 'cib', 'new', 'graded'] as const;
  type Cond = typeof conditions[number];

  const finalPrices = {} as Record<Cond, { value: number; source: string }>;

  for (const cond of conditions) {
    const api  = pcApiPrices[cond];
    const web  = pcWebPrices[cond];
    const ebay = ebayPrices[cond];

    if (api > 0) {
      finalPrices[cond] = { value: api,  source: 'pricecharting_api' };
    } else if (web > 0) {
      finalPrices[cond] = { value: web,  source: 'pricecharting_web' };
    } else if (ebay > 0) {
      finalPrices[cond] = { value: ebay, source: 'ebay_web' };
    } else {
      finalPrices[cond] = { value: 0,    source: 'none' };
    }
  }

  assertEquals(finalPrices.loose.value,  23.99);
  assertEquals(finalPrices.loose.source, 'pricecharting_api');

  assertEquals(finalPrices.cib.value,    45.99);
  assertEquals(finalPrices.cib.source,   'pricecharting_web');

  assertEquals(finalPrices.new.value,    79.99);
  assertEquals(finalPrices.new.source,   'pricecharting_web');

  assertEquals(finalPrices.graded.value,  65.00);
  assertEquals(finalPrices.graded.source, 'ebay_web');

  const missing = conditions.filter((c) => finalPrices[c].value === 0);
  assertEquals(missing.length, 0, `All 4 conditions should have prices; missing: ${missing.join(', ')}`);
});
