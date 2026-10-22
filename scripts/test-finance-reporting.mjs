import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(file, resolve = () => { throw new Error('Unexpected import'); }) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, resolve);
  return module.exports;
}
const reporting = load('lib/finance-reporting.ts');
const paging = load('lib/read-all-pages.ts');
const account = '10000000-0000-4000-8000-000000000001';

test('report periods use exclusive UTC boundaries including leap years and fractional last-second sales', () => {
  assert.deepEqual(reporting.financePeriodBounds(2024, 2), { startDate: '2024-02-01', endDate: '2024-02-29', endExclusive: '2024-03-01' });
  assert.deepEqual(reporting.financePeriodBounds(2026, 12), { startDate: '2026-12-01', endDate: '2026-12-31', endExclusive: '2027-01-01' });
  assert.deepEqual(reporting.financePeriodBounds(2026), { startDate: '2026-01-01', endDate: '2026-12-31', endExclusive: '2027-01-01' });
  for (const [year, month] of [[2026, 0], [2026, 13], [2026, 1.5], [NaN, 1], [2026.5, 1], [0, 1]]) assert.throws(() => reporting.financePeriodBounds(year, month));
});

test('CSV quotes commas, quotes and newlines, keeps numeric values numeric and neutralizes formula text', () => {
  assert.equal(reporting.financeCsv([['A, "quoted"\nbook', 1234.56, -10, '=SUM(1,2)', '  @cmd']]),
    '"A, ""quoted""\nbook","1234.56","-10","\'=SUM(1,2)","\'  @cmd"');
});

function fixture() {
  const calls = [];
  let fail = '', missing = '', lateFailure = '', authenticated = true;
  const rows = {
    financial_transactions: Array.from({ length: 1002 }, (_, i) => ({
      id: `tx-${String(i).padStart(4, '0')}`, date: '2026-10-22', created_at: '2026-10-22',
      type: 'income', amount: 10, category: 'Sales', platform: 'Local', source: 'manual', reference_id: null,
    })),
    inventory_items: Array.from({ length: 1002 }, (_, i) => ({
      id: `item-${String(i).padStart(4, '0')}`, status: 'sold', product_name: `Book ${i}`,
      sell_price: 20, purchase_price: 5, sold_at: '2026-10-31T23:59:59.999Z', sold_via: 'Local',
    })),
    storefront_orders: [],
    storefront_labels: [],
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: account } : null } }) },
    rpc: async (name, params) => {
      calls.push(['rpc', name, params]);
      if (fail === 'storefront_labels') return { data: null, error: { message: 'Fixture RPC failed' } };
      if (missing === 'storefront_labels') return { data: null, error: null };
      return { data: rows.storefront_labels.length, error: null };
    },
    from(table) {
      let from = 0, to = Infinity;
      const filters = [];
      const query = {};
      for (const method of ['select', 'order', 'eq', 'gte', 'lte', 'lt', 'ilike']) query[method] = (...args) => {
        calls.push([table, method, ...args]); filters.push([method, ...args]); return query;
      };
      query.limit = limit => { to = limit - 1; return query; };
      query.range = (start, end) => { calls.push([table, 'range', start, end]); from = start; to = end; return query; };
      query.then = (yes, no) => {
        if (fail === table || (lateFailure === table && from >= 500)) return Promise.resolve({ data: null, error: { message: 'Fixture read failed' } }).then(yes, no);
        if (missing === table) return Promise.resolve({ data: null, error: null }).then(yes, no);
        const data = rows[table].filter(row => filters.every(([method, key, value]) => {
          if (key === 'user_id' || key === 'account_id' || method === 'select' || method === 'order') return true;
          if (method === 'gte') return row[key] >= value;
          if (method === 'lte') return row[key] <= value;
          if (method === 'lt') return row[key] < value;
          if (method === 'eq') return row[key] === value;
          return true;
        })).slice(from, to + 1);
        return Promise.resolve({ data, error: null }).then(yes, no);
      };
      return query;
    },
  };
  const api = load('lib/finance-services.ts', path => {
    if (path === './supabase') return { supabase };
    if (path === './account') return { getActiveAccountId: async () => account };
    if (path === './read-all-pages') return paging;
    if (path === './finance-reporting') return reporting;
    throw new Error(`Unexpected import ${path}`);
  });
  return { api, calls, rows, fail: table => { fail = table; }, late: table => { lateFailure = table; }, missing: table => { missing = table; }, guest: () => { authenticated = false; } };
}

test('P&L reads every company row and matches expected revenue, cost and fees beyond 1000 rows', async () => {
  const f = fixture();
  f.rows.financial_transactions.push(
    { id: 'generated', type: 'income', amount: 20, reference_id: 'inv_sale_item-0000', platform: 'Local', date: '2026-10-22' },
    { id: 'refund', type: 'refund', amount: -5, reference_id: 'inv_sale_item-0001', platform: 'Local', date: '2026-10-22' },
    { id: 'fee', type: 'expense', amount: -12, category: 'Fees', date: '2026-10-22' },
    { id: 'purchase', type: 'expense', amount: -999, category: 'Inventory Purchase', date: '2026-10-22' },
    { id: 'loan', type: 'expense', amount: -100, category: 'Owner Loan Repayment', date: '2026-10-22' },
    { id: 'transfer', type: 'transfer', amount: 10000, date: '2026-10-22' },
    { id: 'online', type: 'income', amount: 35, subcategory: 'Online', reference_id: 'order-id', platform: 'Stripe', date: '2026-10-22' },
    { id: 'stripe-fee', type: 'expense', amount: 1.25, category: 'Payment Processing Fees', platform: 'Stripe', date: '2026-10-22' },
    { id: 'postage', type: 'expense', amount: 5.73, category: 'Shipping', platform: 'Shippo', date: '2026-10-22' },
  );
  f.rows.storefront_orders.push(
    { id: 'order-known', account_id: account, items: [{ quantity: 2, unit_amount: 1000, unit_cost_cents: 250 }], accounting_started_at: '2026-10-22T10:00:00Z', stripe_fee_status: 'recorded' },
    { id: 'order-missing', account_id: account, items: [{ quantity: 1, unit_amount: 1200, unit_cost_cents: null }], accounting_started_at: '2026-10-22T11:00:00Z', stripe_fee_status: 'pending' },
  );
  f.rows.storefront_labels.push({ id: 'label-pending', account_id: account, status: 'success', accounting_status: 'pending', created_at: '2026-10-22T12:00:00Z' });
  f.rows.inventory_items[1001].purchase_price = 0;
  const pl = await f.api.getPLStatement(2026, 10);
  assert.equal(pl.revenue, 10020 + 20040 - 5 + 35);
  assert.equal(pl.cogs, 1001 * 5 + 5);
  assert.equal(pl.operatingExpenses, 12 + 1.25 + 5.73);
  assert.equal(pl.netProfit, pl.revenue - pl.cogs - 12 - 1.25 - 5.73);
  assert.equal(pl.missingCogsItemCount, 1);
  assert.equal(pl.missingCogsRevenue, 20);
  assert.equal(pl.cogsStatus, 'needs_review');
  assert.equal(pl.onlineOrderCount, 1);
  assert.equal(pl.onlineOrderCogs, 5);
  assert.equal(pl.onlineOrderUnitsMissingCost, 1);
  assert.equal(pl.onlineOrderMissingCostRevenue, 12);
  assert.equal(pl.onlineOrdersMissingStripeFeeCount, 1);
  assert.equal(pl.onlineLabelsMissingPostageCount, 1);
  assert.equal(pl.revenueByPlatform.Stripe, 35);
  for (const table of ['financial_transactions', 'inventory_items', 'storefront_orders']) {
    const scopeField = table === 'storefront_orders' ? 'account_id' : 'user_id';
    assert(f.calls.some(call => call[0] === table && call[1] === 'eq' && call[2] === scopeField && call[3] === account));
  }
  for (const table of ['financial_transactions', 'inventory_items'])
    assert(f.calls.some(call => call[0] === table && call[1] === 'range' && call[2] === 1000));
  assert(f.calls.some(call => call[1] === 'lt' && call[2] === 'sold_at' && call[3] === '2026-11-01T00:00:00Z'));
  assert(f.calls.some(call => call[0] === 'rpc' && call[1] === 'storefront_pending_label_accounting' &&
    call[2].p_start === '2026-10-01T00:00:00Z' && call[2].p_end === '2026-11-01T00:00:00Z'));
});

test('failed or absent sold-inventory data cannot become zero COGS or a complete report', async () => {
  for (const table of ['financial_transactions', 'inventory_items', 'storefront_orders', 'storefront_labels']) {
    const f = fixture(); f.fail(table);
    if (table === 'storefront_orders') f.rows.storefront_orders = Array.from({ length: 1002 }, (_, i) => ({
      id: `order-${i}`, account_id: account, accounting_started_at: '2026-10-22T10:00:00Z',
      items: [{ quantity: 1, unit_amount: 100, unit_cost_cents: 100 }], stripe_fee_status: 'recorded',
    }));
    if (table === 'storefront_labels') f.rows.storefront_labels = Array.from({ length: 1002 }, (_, i) => ({
      id: `label-${i}`, account_id: account, created_at: '2026-10-22T10:00:00Z', status: 'success', accounting_status: 'pending',
    }));
    await assert.rejects(f.api.getPLStatement(2026, 10), table === 'storefront_labels' ? /Fixture RPC failed/ : /read failed/);
    f.fail(''); f.missing(table);
    if (table === 'storefront_labels') await assert.rejects(f.api.getPLStatement(2026, 10), /valid Shippo postage reconciliation count/);
    else {
      await assert.rejects(f.api.getPLStatement(2026, 10), /missing/);
      f.missing('');
      f.late(table);
      await assert.rejects(f.api.getPLStatement(2026, 10), /read failed/);
    }
  }
  const f = fixture(); f.rows.financial_transactions[0].amount = 'invalid';
  await assert.rejects(f.api.getPLStatement(2026, 10), /invalid amount/);
  f.guest();
  await assert.rejects(f.api.getPLStatement(2026, 10), /Not authenticated/);
  const invalidCost = fixture(); invalidCost.rows.inventory_items[0].purchase_price = 'invalid';
  await assert.rejects(invalidCost.api.getPLStatement(2026, 10), /invalid sale price or cost/);
  const invalidOrder = fixture();
  invalidOrder.rows.storefront_orders.push({ account_id: account, accounting_started_at: '2026-10-20T12:00:00Z', items: [{ quantity: 1, unit_amount: 1200, unit_cost_cents: Number.MAX_SAFE_INTEGER + 1 }] });
  await assert.rejects(invalidOrder.api.getPLStatement(2026, 10), /invalid saved quantity, price or cost/);
});

test('new storefront costs page beyond 1000 records and pending-label count remains complete', async () => {
  const f = fixture();
  f.rows.storefront_orders = Array.from({ length: 1002 }, (_, i) => ({
    id: `order-${i}`, account_id: account, accounting_started_at: '2026-10-22T10:00:00Z',
    items: [{ quantity: 1, unit_amount: 100, unit_cost_cents: 100 }], stripe_fee_status: 'recorded',
  }));
  f.rows.storefront_labels = Array.from({ length: 1002 }, (_, i) => ({
    id: `label-${i}`, account_id: account, created_at: '2026-10-22T10:00:00Z', status: 'success', accounting_status: 'pending',
  }));
  const report = await f.api.getPLStatement(2026, 10);
  assert.equal(report.onlineOrderCogs, 1002);
  assert.equal(report.onlineLabelsMissingPostageCount, 1002);
  assert(f.calls.some(call => call[0] === 'storefront_orders' && call[1] === 'range' && call[2] === 1000));
  assert.equal(f.calls.find(call => call[0] === 'rpc' && call[1] === 'storefront_pending_label_accounting')[2].p_end, '2026-11-01T00:00:00Z');
});

test('calendar-year reports include future-dated entries but month reports do not', async () => {
  const f = fixture();
  f.rows.financial_transactions.push({ id: 'future', type: 'income', amount: 99, platform: 'Local', date: '2026-12-31' });
  assert.equal((await f.api.getPLStatement(2026)).revenue - (await f.api.getPLStatement(2026, 10)).revenue, 99);
});

test('missing-cost queue and transaction exports cover all records while explicit recent limit stays bounded', async () => {
  const f = fixture();
  f.rows.inventory_items.forEach(item => { item.purchase_price = 0; });
  assert.equal((await f.api.getMissingCogsItems(2026, 10)).length, 1002);
  assert.equal((await f.api.getTransactions()).length, 1002);
  assert.equal((await f.api.getTransactions({ limit: 8 })).length, 8);
  await assert.rejects(f.api.getTransactions({ limit: -1 }), /positive integer/);
  f.fail('inventory_items');
  await assert.rejects(f.api.getMissingCogsItems(2026, 10), /failed/);
});
