import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

function loadSource(name, dependencies = {}) {
  const source = readFileSync(resolve(root, `lib/${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', compiled)(
    module.exports, module, (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
  );
  return module.exports;
}

const model = loadSource('scanner-lab-model');
const account = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000002';
const session = { id: '30000000-0000-4000-8000-000000000003', name: 'Test', created_at: '2026-10-20T06:00:00Z', closed_at: null };
const item = {
  id: '40000000-0000-4000-8000-000000000004', product_name: 'Test game',
  barcode: '001234567890', sku: 'GAME-A', console: 'SNES', condition: 'Loose',
  quantity: 3, status: 'available', purchase_price: 4, sell_price: 12,
};
const entry = { id: '50000000-0000-4000-8000-000000000005', code: item.barcode, created_at: session.created_at, inventory_snapshot: [item] };

function harness(results) {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = {
        select(fields) { call.fields = fields; return query; },
        eq(field, value) { call.filters.push(['eq', field, value]); return query; },
        is(field, value) { call.filters.push(['is', field, value]); return query; },
        or(filter) { call.or = filter; return query; },
        order(field, options) { call.order = [field, options]; return query; },
        limit(limit) { call.limit = limit; return query; },
        range(start, end) { call.range = [start, end]; return query; },
        insert(value) { call.method = 'insert'; call.value = value; return query; },
        update(value) { call.method = 'update'; call.value = value; return query; },
        single() { return query; },
        then(resolveResult, reject) {
          assert.ok(results.length, 'Unexpected database request');
          return Promise.resolve(results.shift()).then(resolveResult, reject);
        },
      };
      return query;
    },
  };
  return { calls, api: loadSource('scanner-lab', { './supabase': { supabase }, './scanner-lab-model': model }) };
}

test('preserves leading zeros, alphanumeric SKUs and scanner line endings', () => {
  assert.equal(model.normalizeLabCode(' 001234567890\r\n'), '001234567890');
  assert.equal(model.normalizeLabCode('BOOK-ABC/2'), 'BOOK-ABC/2');
  assert.equal(model.normalizeLabCode('X'.repeat(100)).length, 100);
  for (const value of ['', ' ', 'X'.repeat(101), 'ABC\u0000DEF', 'ABC\nDEF']) {
    assert.throws(() => model.normalizeLabCode(value));
  }
});

test('quotes punctuation and escapes PostgREST filter literals', () => {
  assert.equal(model.labLookupFilter('a,b).or(sku.eq.*'), 'barcode.eq."a,b).or(sku.eq.*",sku.eq."a,b).or(sku.eq.*"');
  assert.equal(model.labLookupFilter('a"b\\c'), 'barcode.eq."a\\"b\\\\c",sku.eq."a\\"b\\\\c"');
});

test('validates trimmed session names at the actual boundaries', () => {
  assert.equal(model.labSessionName(' Test '), 'Test');
  assert.equal(model.labSessionName('A'.repeat(100)).length, 100);
  assert.throws(() => model.labSessionName(' '));
  assert.throws(() => model.labSessionName('A'.repeat(101)));
});

test('scans account inventory read-only and saves a separate snapshot for the actual user', async () => {
  const { api, calls } = harness([{ data: [item], error: null }, { data: entry, error: null }]);
  assert.deepEqual(await api.scanToLabSession(account, user, session, item.barcode), entry);
  assert.equal(calls[0].table, 'inventory_items');
  assert.equal(calls[0].method, undefined);
  assert.deepEqual(calls[0].filters, [['eq', 'user_id', account]]);
  assert.equal(calls[0].limit, 51);
  assert.equal(calls[1].table, 'scanner_lab_entries');
  assert.deepEqual(calls[1].value, { account_id: account, created_by: user, session_id: session.id, code: item.barcode, inventory_snapshot: [item] });
});

test('saves all ambiguous inventory matches instead of selecting a random row', async () => {
  const second = { ...item, id: '60000000-0000-4000-8000-000000000006', quantity: 1 };
  const saved = { ...entry, inventory_snapshot: [item, second] };
  const { api } = harness([{ data: [item, second], error: null }, { data: saved, error: null }]);
  assert.equal((await api.scanToLabSession(account, user, session, item.barcode)).inventory_snapshot.length, 2);
});

test('no-match scans are stored without inserting an inventory item', async () => {
  const { api, calls } = harness([{ data: [], error: null }, { data: { ...entry, inventory_snapshot: [] }, error: null }]);
  const saved = await api.scanToLabSession(account, user, session, item.barcode);
  assert.deepEqual(saved.inventory_snapshot, []);
  assert.deepEqual(calls.filter((call) => call.method).map((call) => call.table), ['scanner_lab_entries']);
});

test('lookup errors and excessive matches never save a false no-match entry', async () => {
  for (const result of [
    { data: null, error: { message: 'Inventory permission denied', code: '42501' } },
    { data: Array(51).fill(item), error: null },
    { data: [{ ...item, quantity: 'bad data' }], error: null },
  ]) {
    const { api, calls } = harness([result]);
    await assert.rejects(api.scanToLabSession(account, user, session, item.barcode));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, undefined);
  }
});

test('save failures are surfaced and closed sessions make no requests', async () => {
  const { api } = harness([{ data: [item], error: null }, { data: null, error: { message: 'Save denied' } }]);
  await assert.rejects(api.scanToLabSession(account, user, session, item.barcode), /Save denied/);
  const closed = harness([]);
  await assert.rejects(closed.api.scanToLabSession(account, user, { ...session, closed_at: session.created_at }, item.barcode), /closed/);
  assert.equal(closed.calls.length, 0);
});

test('missing migration is actionable, never reported as empty session history', async () => {
  const { api } = harness([{ data: null, error: { code: 'PGRST205', message: 'Missing relation' } }]);
  await assert.rejects(api.listLabSessions(account, user), /Apply the Scanner Lab migration/);
});

test('session creation, history and closing are scoped and restricted to lab tables', async () => {
  const { api, calls } = harness([
    { data: session, error: null },
    { data: [session], error: null },
    { data: [entry], error: null },
    { data: { ...session, closed_at: session.created_at }, error: null },
  ]);
  await api.createLabSession(account, user, ' Test ');
  assert.deepEqual(await api.listLabSessions(account, user), [session]);
  assert.deepEqual(await api.listLabEntries(account, user, session.id), [entry]);
  await api.closeLabSession(account, user, session.id);
  assert.deepEqual(calls[0].value, { account_id: account, created_by: user, name: 'Test' });
  for (const call of calls.slice(1)) {
    assert.ok(call.filters.some((filter) => filter[1] === 'account_id' && filter[2] === account));
    assert.ok(call.filters.some((filter) => filter[1] === 'created_by' && filter[2] === user));
  }
  assert.deepEqual(Object.keys(calls[3].value), ['closed_at']);
  assert.ok(calls[3].filters.some((filter) => filter[0] === 'is' && filter[1] === 'closed_at'));
  assert.ok(calls.every((call) => call.table.startsWith('scanner_lab_')));
});

test('loads complete history and sessions beyond a server response page', async () => {
  for (const [method, row, args] of [
    ['listLabEntries', entry, [account, user, session.id]],
    ['listLabSessions', session, [account, user]],
  ]) {
    const { api, calls } = harness([
      { data: Array(500).fill(row), error: null },
      { data: [row], error: null },
    ]);
    assert.equal((await api[method](...args)).length, 501);
    assert.deepEqual(calls.map((call) => call.range), [[0, 499], [500, 999]]);
    assert.ok(calls.every((call) => call.filters.some((filter) => filter[1] === 'account_id' && filter[2] === account)));
  }
});
