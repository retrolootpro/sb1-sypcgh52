import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
const account = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const orderId = index => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const orders = Array.from({ length: 125 }, (_, index) => ({
  id: orderId(index), account_id: account, status: index < 61 ? 'paid' : index < 111 ? 'shipped' : index < 120 ? 'pending' : 'creating',
  created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  shipping_quote: index === 0 ? null : { rate: { name: 'USPS Ground Advantage' }, customer: { email: 'private@example.invalid' } },
}));
const requests = [{ id: 'request', account_id: account, status: 'new' }, { id: 'request2', account_id: account, status: 'reviewing' }, { id: 'request3', account_id: account, status: 'closed' }];

function harness({ role = 'admin', authenticated = true, failedTable, missingCount = false, empty = false } = {}) {
  const queries = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: account } : null }, error: null }) },
    from(table) {
      const query = { table, filters: [], sorts: [], head: false, start: 0, end: Infinity };
      const chain = {
        select(columns, options) { query.columns = columns; query.head = options?.head || false; return chain; },
        eq(key, value) { query.filters.push([key, [value]]); return chain; },
        in(key, values) { query.filters.push([key, values]); return chain; },
        single() { return chain; },
        order(key, { ascending = true } = {}) { query.sorts.push([key, ascending]); return chain; },
        range(start, end) { query.start = start; query.end = end; return chain; },
        limit(size) { query.end = size - 1; return chain; },
        then(done) {
          queries.push(query);
          if (table === 'storefront_settings') return Promise.resolve({ data: { user_id: account }, error: null }).then(done);
          const source = empty ? [] : table === 'storefront_orders'
            ? [...orders, { ...orders[0], id: orderId(999), account_id: other }]
            : [...requests, { ...requests[0], account_id: other }];
          let rows = source.filter(row => query.filters.every(([key, values]) => values.includes(row[key])));
          const count = rows.length;
          rows.sort((a, b) => {
            for (const [key, ascending] of query.sorts) {
              const compared = String(a[key]).localeCompare(String(b[key]));
              if (compared) return ascending ? compared : -compared;
            }
            return 0;
          });
          rows = rows.slice(query.start, query.end + 1);
          return Promise.resolve({ data: query.head ? null : rows, count: missingCount ? null : count, error: table === failedTable ? new Error('Database unavailable') : null }).then(done);
        },
      };
      return chain;
    },
  };
  const modules = new Map();
  function load(file) {
    file = resolve(file);
    if (file.endsWith('/server/supabase-admin.ts')) return { createSupabaseAdmin: () => admin };
    if (file.endsWith('/server-account.ts')) return { getServerAccountContext: async () => ({ accountId: account, role }) };
    if (file.endsWith('/server/storefront-payments.ts')) return { paymentConfig: () => ({ rates: [], carrierShipping: false }), requirePaymentsEnabled() {} };
    if (file.endsWith('/server/storefront-shipping.ts')) return {};
    if (file.endsWith('/server/storefront-catalog.ts')) return {};
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    new Function('module', 'exports', 'require', 'console', output)(module, module.exports, name => {
      if (name === '@supabase/supabase-js') return { createClient: () => ({}) };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name.startsWith('./')) return load(resolve(file, '..', `${name}.ts`));
      return require(name);
    }, { error() {}, warn() {} });
    modules.set(file, module.exports);
    return module.exports;
  }
  const get = (route, query = '', token = true) => load(`app/api/${route}/route.ts`).GET(new NextRequest(`https://example.invalid/api/${route}${query}`, { headers: token ? { Authorization: 'Bearer fixture' } : {} }));
  return { get, queries, load };
}

test('a new browser uses the intended 60-day review threshold, not a one-day alert', () => {
  const { normalizeStaleThreshold, normalizeAgingThresholds } = harness().load('lib/inventory-aging.ts');
  for (const value of [null, undefined, '', 'invalid']) assert.equal(normalizeStaleThreshold(value), 60);
  assert.equal(normalizeStaleThreshold('90'), 90);
  assert.equal(normalizeStaleThreshold(0), 1);
  assert.equal(normalizeStaleThreshold(900), 365);
  assert.deepEqual(normalizeAgingThresholds({ reviewDays: 30, watchDays: 45 }), { reviewDays: 30, watchDays: 30 });
});

test('overview counts all company orders, includes creating in unpaid, and returns oldest five without customer data', async () => {
  const h = harness(), response = await h.get('business/overview');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { overview } = await response.json();
  assert.deepEqual([overview.readyToShip, overview.awaitingPayment, overview.shipped, overview.openRequests], [61, 14, 50, 2]);
  assert.deepEqual(overview.orders.map(row => row.id), orders.slice(0, 5).map(row => row.id));
  assert.equal(overview.orders[0].shippingService, null);
  assert.equal(overview.orders[1].shippingService, 'USPS Ground Advantage');
  assert.equal(JSON.stringify(overview).includes('private@example.invalid'), false);
  for (const query of h.queries.filter(q => q.table !== 'storefront_settings')) assert(query.filters.some(([key, values]) => key === 'account_id' && values[0] === account));
});

test('overview denies guests/employees and never reports a failed or missing count as zero', async () => {
  for (const [options, token, status] of [[{}, false, 401], [{ authenticated: false }, true, 401], [{ role: 'user' }, true, 403], [{ failedTable: 'storefront_orders' }, true, 503], [{ missingCount: true }, true, 503]]) {
    const response = await harness(options).get('business/overview', '', token);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.success, false); assert.equal(Object.hasOwn(result, 'overview'), false);
  }
  const response = await harness({ empty: true }).get('business/overview');
  const { overview } = await response.json();
  assert.equal(overview.readyToShip, 0); assert.deepEqual(overview.orders, []);
});

test('fulfillment status filters apply before pagination and exact order links reach older records', async () => {
  const h = harness();
  const response = await h.get('storefront/manage', '?status=paid&page=1');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.orders.length, 11);
  assert.equal(result.orders[0].id, orders[50].id);
  const linked = await h.get('storefront/manage', `?order=${orderId(0)}&status=paid`);
  assert.deepEqual((await linked.json()).orders.map(row => row.id), [orderId(0)]);
  const unpaid = await h.get('storefront/manage', '?status=pending');
  assert.equal((await unpaid.json()).orders.length, 14);
  const unrelated = await h.get('storefront/manage', `?order=${orderId(999)}`);
  assert.deepEqual((await unrelated.json()).orders, []);
  for (const query of ['?order=not-a-uuid', '?status=unknown']) assert.equal((await h.get('storefront/manage', query)).status, 400);
});
