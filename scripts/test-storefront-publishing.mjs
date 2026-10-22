import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const module = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync('lib/storefront-publishing.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(module, module.exports);
const { isStorefrontStock, matchesPublishingFilter, parseStorefrontPrice } = module.exports;
const item = { id: 'item', quantity: 1, status: 'available', image_url: null, thumbnail_url: '/internal.png', storefront_shipping_promotion: 'eligible' };

test('publishing queues use actual catalog membership without inventing a publish flag', () => {
  assert.equal(matchesPublishingFilter(item, { item: 10 }, 'live'), true);
  assert.equal(matchesPublishingFilter(item, {}, 'needs-price'), true);
  assert.equal(matchesPublishingFilter(item, { item: 10 }, 'needs-price'), false);
  assert.equal(matchesPublishingFilter(item, { item: 10 }, 'needs-photo'), true, 'An internal thumbnail is not a public photo');
  assert.equal(matchesPublishingFilter({ ...item, image_url: '/public.png' }, {}, 'needs-photo'), false);
  assert.equal(matchesPublishingFilter(item, {}, 'shipping-excluded'), false);
  assert.equal(matchesPublishingFilter({ ...item, storefront_shipping_promotion: 'excluded' }, {}, 'shipping-excluded'), true);
  for (const status of ['sold', 'reserved', 'deleted', 'archived']) {
    assert.equal(isStorefrontStock({ ...item, status }), false);
    for (const filter of ['all', 'live', 'needs-price', 'needs-photo', 'shipping-excluded']) assert.equal(matchesPublishingFilter({ ...item, status }, { item: 10 }, filter), false);
  }
  assert.equal(isStorefrontStock({ ...item, quantity: 0 }), false);
  assert.equal(isStorefrontStock({ ...item, status: null }), true);
});

test('saved price overrides require a positive dollar value with at most two decimals', () => {
  for (const [input, price] of [['24.95', 24.95], [' 10 ', 10], ['0.01', .01], ['100000', 100000]]) assert.equal(parseStorefrontPrice(input), price);
  for (const input of ['', ' ', '0', '0.00', '-1', 'NaN', 'Infinity', '1e3', '1.001', '$10', '100000.01', '1,000']) assert.throws(() => parseStorefrontPrice(input));
});
