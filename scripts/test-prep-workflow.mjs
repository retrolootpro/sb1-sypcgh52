import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(file, require = () => { throw new Error('Unexpected import'); }) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, require);
  return module.exports;
}
const { matchesPrepQueue, prepSalePrice } = load('lib/prep-workflow.ts');
const item = { quantity: 1, status: 'available' };
test('work queues are mutually exclusive and exclude unavailable stock; lot history is preserved', () => {
  const queues = ['in_progress', 'ready', 'listed', 'sold'];
  for (const [record, expected] of [
    [item, 'in_progress'],
    [{ ...item, on_rack_at: 'date' }, 'ready'],
    [{ ...item, listed_amazon_at: 'date' }, 'listed'],
    [{ ...item, on_rack_at: 'date', listed_ebay_at: 'date' }, 'listed'],
    [{ ...item, status: 'sold', quantity: 0 }, 'sold'],
    [{ ...item, sold_at: 'date' }, 'sold'],
  ]) assert.deepEqual(queues.filter(queue => matchesPrepQueue(record, queue)), [expected]);
  for (const record of [
    ...['reserved', 'archived', 'deleted'].map(status => ({ ...item, status, listed_ebay_at: 'date' })),
    { ...item, quantity: 0 }, { ...item, quantity: -1 },
  ]) {
    assert.deepEqual(queues.filter(queue => matchesPrepQueue(record, queue)), []);
    assert.equal(matchesPrepQueue(record, 'lots'), true);
  }
});
test('sale entry never silently changes negative, malformed or blank prices into valid sales', () => {
  for (const [raw, expected] of [['0', 0], ['$24.95', 24.95], [' 10 ', 10], ['100000', 100000]]) assert.equal(prepSalePrice(raw), expected);
  for (const raw of ['', ' ', '-10', '1e3', 'NaN', 'Infinity', '1.234', '100000.01', '$', 'abc10', '10.2.3', '1,000']) assert.throws(() => prepSalePrice(raw));
});
test('prep writes are company scoped and require a confirmed updated row', async () => {
  const calls = [];
  let response = { data: { id: 'item' }, error: null };
  const query = {};
  for (const method of ['from', 'update', 'eq', 'select']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.single = async () => response;
  const { savePrepUpdate } = load('lib/prep-update.ts', path => { assert.equal(path, '@/lib/supabase'); return { supabase: query }; });
  await savePrepUpdate('company', 'item', { sorted_at: 'date' });
  assert(calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'company'));
  assert(calls.some(call => call[0] === 'eq' && call[1] === 'id' && call[2] === 'item'));
  assert(calls.some(call => call[0] === 'select' && call[1] === 'id'));
  response = { data: null, error: null };
  await assert.rejects(savePrepUpdate('company', 'item', { sorted_at: null }), /No inventory row/);
  response = { data: null, error: new Error('Denied') };
  await assert.rejects(savePrepUpdate('company', 'item', { sorted_at: null }), /Denied/);
});
