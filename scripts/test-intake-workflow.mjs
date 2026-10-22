import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, resolve = require) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, resolve);
  return module.exports;
}
const { readIntakeDraft } = load('lib/intake-draft.ts');
const { parseIntakeMoney, lotCostFinalized } = load('lib/intake-input.ts');
const { readAllPages } = load('lib/read-all-pages.ts');
const account = '10000000-0000-4000-8000-000000000001';
const staff = '10000000-0000-4000-8000-000000000002';
const draft = {
  accountId: account, staffId: staff, selectedLotId: 'none', selectedEmployeeId: null,
  scanMode: 'continuous', intakeItemType: 'book', batchMode: true,
  pendingBarcodes: [{ barcode: '9780123456789', scannedAt: 100, scanCount: 2 }],
  queue: [{ id: 'scan-1', barcode: '9780123456789', status: 'awaiting_price', scannedAt: 100, result: { title: 'Preview book', classification: { itemType: 'book' }, confidence: { overall: 90 } } }],
  manualBarcode: '', manualTitle: '', manualPlatform: '', savedAt: new Date().toISOString(),
};
test('browser drafts restore only validated records from the current staff and company', () => {
  assert.deepEqual(readIntakeDraft(JSON.stringify(draft), account, staff), draft);
  for (const raw of ['bad json', '{}', JSON.stringify({ ...draft, accountId: staff }), JSON.stringify({ ...draft, staffId: account }), JSON.stringify({ ...draft, batchMode: 'false' }), JSON.stringify({ ...draft, queue: [{ ...draft.queue[0], status: 'bogus' }] })]) {
    assert.throws(() => readIntakeDraft(raw, account, staff));
  }
});
test('interrupted operations remain visible and never silently restore as successful inventory', () => {
  for (const status of ['scanning', 'looking_up', 'pricing', 'calculating']) {
    const restored = readIntakeDraft(JSON.stringify({ ...draft, queue: [{ ...draft.queue[0], status }] }), account, staff);
    assert.equal(restored.queue.length, 1);
    assert.equal(restored.queue[0].status, 'failed');
    assert.match(restored.queue[0].error, /Check inventory/);
  }
});
test('intake money distinguishes blank cost from malformed input; no prefix parsing or exponents', () => {
  for (const [raw, value] of [['', undefined], ['  ', undefined], ['0', 0], ['12.34', 12.34], ['100000', 100000]]) assert.equal(parseIntakeMoney(raw), value);
  for (const raw of ['-1', '1e3', '1.234', '100000.01', 'NaN', 'Infinity', '10abc', '$20']) assert.throws(() => parseIntakeMoney(raw));
});
test('derived cost ratios and needs-market timestamps are not finalized allocation', () => {
  assert.equal(lotCostFinalized(null), false);
  assert.equal(lotCostFinalized({ allocation_status: 'needs_market_values', cost_allocated_at: 'date' }), false);
  assert.equal(lotCostFinalized({}), false);
  assert.equal(lotCostFinalized({ cost_allocated_at: 'date' }), true);
  assert.equal(lotCostFinalized({ allocation_status: 'allocated' }), true);
});
test('all-page reads cover more than the database limit and reject late/missing responses', async () => {
  const input = Array.from({ length: 1002 }, (_, id) => ({ id }));
  const ranges = [];
  assert.deepEqual(await readAllPages(async (from, to) => { ranges.push([from, to]); return { data: input.slice(from, to + 1), error: null }; }), input);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  await assert.rejects(readAllPages(async from => from === 0 ? { data: input.slice(0, 500), error: null } : { data: null, error: { message: 'Late page denied' } }), /Late page denied/);
  await assert.rejects(readAllPages(async () => ({ data: null, error: null })), /missing/);
});
test('undo deletes only the exact available, unsold, non-lot item in the verified account', async () => {
  const calls = [];
  let response = { data: { id: 'item' }, error: null };
  const query = {};
  for (const method of ['from', 'delete', 'eq', 'is', 'select']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.single = async () => response;
  const { undoIntakeItem } = load('lib/intake-actions.ts', path => { assert.equal(path, '@/lib/supabase'); return { supabase: query }; });
  await undoIntakeItem(account, 'item');
  for (const expected of [['eq', 'user_id', account], ['eq', 'id', 'item'], ['eq', 'status', 'available'], ['is', 'sold_at', null], ['is', 'lot_id', null], ['select', 'id']]) assert(calls.some(call => JSON.stringify(call) === JSON.stringify(expected)));
  assert(!calls.some(call => call.includes('barcode')));
  response = { data: null, error: null };
  await assert.rejects(undoIntakeItem(account, 'item'), /No eligible item/);
  response = { data: null, error: new Error('Denied') };
  await assert.rejects(undoIntakeItem(account, 'item'), /Denied/);
});
test('lot summaries and allocation read all rows and never confirm missing mutation rows', async () => {
  const tables = {
    lots: Array.from({ length: 1002 }, (_, id) => ({ id: `lot-${id}`, name: `Lot ${id}`, total_paid: 0 })),
    inventory_items: Array.from({ length: 1002 }, (_, id) => ({ id: `item-${id}`, lot_id: `lot-${id}`, quantity: 1, selected_market_value: 20, purchase_price: 1, purchase_price_override: false })),
    financial_transactions: Array.from({ length: 1002 }, (_, id) => ({ id: `tx-${id}`, reference_id: `lot_purchase_lot-${id}`, amount: -10 })),
  };
  const mutations = [], reads = [];
  let missingRow = false;
  const supabase = { auth: { getUser: async () => ({ data: { user: { id: account } } }) }, from: table => {
    let from = 0, to = 499, patch, lot;
    const query = {};
    for (const method of ['select', 'order', 'not', 'like']) query[method] = () => query;
    query.eq = (field, value) => { if (field === 'lot_id') lot = value; if (field === 'user_id') assert.equal(value, account); return query; };
    query.range = (start, end) => { from = start; to = end; return query; };
    query.update = value => { patch = value; return query; };
    query.single = async () => { mutations.push({ table, patch }); return { data: missingRow ? null : { id: 'confirmed' }, error: null }; };
    query.then = (yes, no) => {
      reads.push({ table, from });
      const data = tables[table].filter(item => !lot || item.lot_id === lot).slice(from, to + 1);
      return Promise.resolve({ data, error: null }).then(yes, no);
    };
    return query;
  } };
  const { getLotCostSummaries, allocateLotCost } = load('lib/finance-services.ts', path => {
    if (path === './supabase') return { supabase };
    if (path === './account') return { getActiveAccountId: async () => account };
    if (path === './read-all-pages') return { readAllPages };
    if (path === './finance-reporting') return load('lib/finance-reporting.ts');
    throw new Error(`Unexpected import: ${path}`);
  });
  const summaries = await getLotCostSummaries();
  assert.equal(summaries.length, 1002);
  assert.equal(summaries[1001].totalCost, 10);
  assert.equal(summaries[1001].totalMarketValue, 20);
  for (const table of Object.keys(tables)) assert(reads.some(read => read.table === table && read.from === 1000));
  tables.inventory_items.forEach(item => { item.lot_id = 'bulk'; });
  await allocateLotCost('bulk', 1002);
  assert.equal(mutations.filter(write => write.table === 'inventory_items').length, 1002);
  assert(mutations.filter(write => write.table === 'inventory_items').every(write => write.patch.purchase_price === 1));
  assert.equal(mutations.at(-1).patch.total_market_value, 20040);
  assert.equal(mutations.at(-1).patch.allocation_status, 'allocated');
  mutations.length = 0; missingRow = true;
  await assert.rejects(allocateLotCost('bulk', 1002), /confirm every item/);
  assert(mutations.every(write => write.table === 'inventory_items'), 'Missing inventory update must not mark the lot finalized');
});
