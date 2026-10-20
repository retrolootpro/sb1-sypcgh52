import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(resolve(root, 'app/api/storefront/catalog/route.ts'), 'utf8');
const uuid = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const inventoryItem = (index, overrides = {}) => ({
  id: uuid(index), user_id: uuid(99999), product_name: `Game ${index}`, console: 'SNES',
  condition: 'Loose', quantity: 2, notes: null, image_url: null, barcode: `00${index}`,
  created_at: '2026-10-20T00:00:00Z', ...overrides,
});
const pricingRow = (index, overrides = {}) => ({
  id: uuid(20000 + index), item_id: uuid(index), loose_price: 10, cib_price: 20,
  new_price: 30, fetched_at: '2026-10-20T00:00:00Z', ...overrides,
});

function harness({ inventory = [], pricing = [], metadata = [], metadataError, pricingErrorAt, inventoryError } = {}, routeSource = source) {
  const requests = [];
  const warnings = [];
  const errors = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  const client = createClient('https://catalog-test.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').at(-1);
        const params = url.searchParams;
        requests.push({ url, method: init?.method || 'GET' });
        assert.equal(init?.method || 'GET', 'GET', 'Catalog must only read data');
        if (url.toString().length > 8192) return json({ message: 'Bad Request' }, 400);
        if (table === 'inventory_items' && params.get('select').includes('user_id')) {
          if (inventoryError) return json({ message: inventoryError }, 503);
          return json(inventory);
        }
        const filter = params.get(table === 'pricing_data' ? 'item_id' : 'id');
        assert.ok(filter?.startsWith('in.('));
        const ids = filter.slice(4, -1).split(',');
        if (table === 'inventory_items') {
          if (metadataError) return json({ message: metadataError }, 400);
          return json(metadata.filter((row) => ids.includes(row.id)));
        }
        assert.equal(table, 'pricing_data');
        if (pricingErrorAt && requests.filter((r) => r.url.pathname.endsWith('/pricing_data')).length === pricingErrorAt) {
          return json({ message: 'Pricing backend unavailable', code: 'XX000' }, 503);
        }
        const offset = Number(params.get('offset') || 0);
        const limit = Number(params.get('limit') || 1000);
        const rows = pricing.filter((row) => ids.includes(row.item_id)).sort((a, b) => {
          if (a.fetched_at === b.fetched_at) return b.id.localeCompare(a.id);
          if (!a.fetched_at) return 1;
          if (!b.fetched_at) return -1;
          return b.fetched_at.localeCompare(a.fetched_at);
        });
        return json(rows.slice(offset, offset + limit));
      },
    },
  });
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', 'console', compiled)(
    module.exports, module,
    (name) => name === '@/lib/server/supabase-admin' ? { createSupabaseAdmin: () => client } : require(name),
    { error: (...args) => errors.push(args), warn: (...args) => warnings.push(args) },
  );
  return { GET: module.exports.GET, requests, warnings, errors };
}

test('large catalog stays under URL limits and includes every priced product', async () => {
  const inventory = Array.from({ length: 1000 }, (_, index) => inventoryItem(index + 1));
  const pricing = inventory.map((_, index) => pricingRow(index + 1));
  const metadata = inventory.map((item) => ({ id: item.id, category: 'Books', item_type: 'book' }));
  const { GET, requests } = harness({ inventory, pricing, metadata });
  const response = await GET();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.products.length, 1000);
  assert.equal(result.diagnostics.categorizedInventoryCount, 1000);
  assert.ok(result.products.every((item) => item.category === 'Books' && item.price === 10));
  for (const { url } of requests) {
    assert.ok(url.toString().length < 8192, 'Actual Supabase request URL must fit the size budget');
    const filter = url.searchParams.get('item_id') || url.searchParams.get('id');
    if (filter) assert.ok(filter.slice(4, -1).split(',').length <= 100);
  }
  assert.equal(requests.filter(({ url }) => url.pathname.endsWith('/pricing_data')).length, 10);
});

test('pricing history is paged and latest non-null prices win without dropping other items', async () => {
  const inventory = [inventoryItem(1), inventoryItem(2), inventoryItem(3, { condition: 'New' })];
  const pricing = [
    ...Array.from({ length: 1001 }, (_, index) => pricingRow(1, { id: uuid(index + 30000), loose_price: index + 1 })),
    pricingRow(1, { id: uuid(99998), fetched_at: null, loose_price: 99999 }),
    pricingRow(2, { fetched_at: '2026-10-19T00:00:00Z', loose_price: 17 }),
    pricingRow(3, { fetched_at: '2026-10-18T00:00:00Z', new_price: 33 }),
  ];
  const { GET, requests } = harness({ inventory, pricing });
  const response = await GET();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.products.length, 3);
  assert.deepEqual(result.products.map((item) => item.price), [1001, 17, 33]);
  const queries = requests.filter(({ url }) => url.pathname.endsWith('/pricing_data'));
  assert.deepEqual(queries.map(({ url }) => Number(url.searchParams.get('offset') || 0)), [0, 500, 1000]);
  assert.ok(queries.every(({ url }) => url.searchParams.get('limit') === '500'));
});

test('preserves account selection, condition pricing, product shape and positive-price filter', async () => {
  const inventory = [
    inventoryItem(1),
    inventoryItem(2, { condition: 'CIB' }),
    inventoryItem(3, { condition: 'Sealed' }),
    inventoryItem(4),
    inventoryItem(5, { user_id: uuid(88888) }),
  ];
  const { GET } = harness({ inventory, pricing: [pricingRow(1), pricingRow(2), pricingRow(3), pricingRow(4, { loose_price: 0, cib_price: 0, new_price: 0 }), pricingRow(5)] });
  const response = await GET();
  const result = await response.json();
  assert.deepEqual(result.products.map((item) => item.price), [10, 20, 30]);
  assert.equal(result.diagnostics.accountCandidates, 2);
  assert.equal(result.diagnostics.activeInventoryCount, 4);
  assert.deepEqual(Object.keys(result.products[0]).sort(), [
    'id', 'slug', 'title', 'category', 'platform', 'condition', 'price', 'compare_at_price',
    'quantity', 'featured', 'description', 'image_url', 'thumbnail_url', 'brand', 'barcode', 'created_at',
  ].sort());
  assert.equal(result.profile.store_name, 'Pixel & Page');
});

test('empty inventory avoids enrichment queries and unpriced stock retains its warning', async () => {
  const empty = harness();
  const result = await (await empty.GET()).json();
  assert.deepEqual(result.products, []);
  assert.equal(empty.requests.length, 1);
  const unpriced = harness({ inventory: [inventoryItem(1)] });
  const body = await (await unpriced.GET()).json();
  assert.equal(body.success, true);
  assert.match(body.warning, /1 in-stock items/);
});

test('optional metadata failure is logged and retains existing category fallback', async () => {
  const { GET, warnings } = harness({
    inventory: [inventoryItem(1, { product_name: 'Paperback novel' })],
    pricing: [pricingRow(1)], metadataError: 'Missing metadata columns',
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).products[0].category, 'Books');
  assert.equal(warnings.length, 1);
});

test('pricing failure on a later batch returns an explicit failure, not a partial catalog', async () => {
  const inventory = Array.from({ length: 101 }, (_, index) => inventoryItem(index + 1));
  const { GET, errors } = harness({ inventory, pricing: inventory.map((_, index) => pricingRow(index + 1)), pricingErrorAt: 2 });
  const response = await GET();
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.success, false);
  assert.match(result.message, /Pricing query failed: Pricing backend unavailable/);
  assert.equal(result.products, undefined);
  assert.equal(errors.length, 1);
});

test('inventory failure is explicit and stops enrichment', async () => {
  const { GET, requests } = harness({ inventoryError: 'Inventory unavailable' });
  const response = await GET();
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /Inventory query failed/);
  assert.equal(requests.length, 1);
});
