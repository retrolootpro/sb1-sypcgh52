import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const module = { exports: {} };
const source = ts.transpileModule(readFileSync(new URL('../lib/storefront-browse.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('module', 'exports', source)(module, module.exports);
const { browseProducts, browseUrl, defaultBrowse, readBrowse, isOnSale } = module.exports;
const products = Array.from({ length: 73 }, (_, i) => ({
  id: `item-${i}`, title: `Game ${String(i).padStart(2, '0')}`, category: 'Games', platform: `Platform ${i % 20}`,
  condition: i % 2 ? 'CIB' : 'Loose', price: i + 1, compare_at_price: i === 2 ? 100 : null,
  featured: i === 1, created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}));

test('default browsing has 24 items with actual discounted stock first, then newest arrivals', () => {
  const result = browseProducts(products, defaultBrowse);
  assert.equal(result.total, 73);
  assert.equal(result.items.length, 24);
  assert.equal(result.pageCount, 4);
  assert.equal(result.items[0].id, 'item-2');
  assert.equal(result.items[1].id, 'item-72');
  assert.equal(isOnSale({ price: 10, compare_at_price: 10 }), false);
  assert.equal(isOnSale({ price: 10, compare_at_price: null }), false);
});
test('pagination covers each item exactly once, respects page sizes, and clamps out-of-range pages', () => {
  const ids = [1, 2, 3, 4].flatMap(page => browseProducts(products, { ...defaultBrowse, page }).items.map(item => item.id));
  assert.equal(new Set(ids).size, 73);
  assert.equal(ids.length, 73);
  assert.equal(browseProducts(products, { ...defaultBrowse, page: 999 }).page, 4);
  assert.equal(browseProducts(products, { ...defaultBrowse, page: 999 }).items.length, 1);
  assert.equal(browseProducts(products, { ...defaultBrowse, pageSize: 48 }).items.length, 48);
  assert.equal(browseProducts(products, { ...defaultBrowse, pageSize: 96 }).items.length, 73);
});
test('category, platform, condition, search, price bounds, and sale filters intersect', () => {
  const state = { ...defaultBrowse, category: 'Games', platform: 'Platform 2', condition: 'Loose', query: 'Game',
    minPrice: '3', maxPrice: '3', saleOnly: true };
  assert.deepEqual(browseProducts(products, state).items.map(item => item.id), ['item-2']);
  assert.equal(browseProducts(products, { ...state, condition: 'CIB' }).total, 0);
  assert.equal(browseProducts(products, { ...state, minPrice: '10', maxPrice: '2' }).total, 0);
});
test('sort choices use deterministic tie breaks and do not mutate the source catalog', () => {
  const copy = structuredClone(products);
  assert.equal(browseProducts(products, { ...defaultBrowse, sort: 'price-high' }).items[0].price, 73);
  assert.equal(browseProducts(products, { ...defaultBrowse, sort: 'price-low' }).items[0].price, 1);
  assert.equal(browseProducts(products, { ...defaultBrowse, sort: 'name' }).items[0].title, 'Game 00');
  assert.equal(browseProducts(products, { ...defaultBrowse, sort: 'featured' }).items[0].id, 'item-1');
  const ties = products.slice(0, 3).map(item => ({ ...item, created_at: 'invalid', compare_at_price: null, title: 'Same' }));
  assert.deepEqual(browseProducts(ties.toReversed(), defaultBrowse).items.map(item => item.id), ['item-0', 'item-1', 'item-2']);
  assert.deepEqual(products, copy);
});
test('URL state round-trips all controls without losing combined category and query', () => {
  const state = { ...defaultBrowse, category: 'Games', platform: 'Platform 19', condition: 'CIB', query: 'Game & Book',
    minPrice: '0', maxPrice: '50.25', saleOnly: true, sort: 'price-high', page: 3, pageSize: 48 };
  assert.deepEqual(readBrowse(new URL(browseUrl(state), 'https://test.invalid').searchParams), state);
  assert.deepEqual(readBrowse(new URLSearchParams('page=-2&size=999&sort=invalid&min=NaN&max=-1')), defaultBrowse);
  assert.equal(readBrowse(new URLSearchParams('page=1e99')).page, 1);
});
test('empty results keep a valid first page and existing accessories/apparel matching', () => {
  const empty = browseProducts([], defaultBrowse);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.deepEqual(empty.items, []);
  const extras = [
    { ...products[0], title: 'Wireless controller', category: 'Collectibles' },
    { ...products[1], title: 'Pixel Hoodie', category: 'Games' },
  ];
  assert.equal(browseProducts(extras, { ...defaultBrowse, category: 'Accessories' }).total, 1);
  assert.equal(browseProducts(extras, { ...defaultBrowse, category: 'Apparel' }).total, 1);
});
