import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-prep-browser.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const base = process.argv[2] || 'http://127.0.0.1:3218', screenshots = process.argv[3];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 } });
const account = '10000000-0000-4000-8000-000000000001';
const user = { id: account, email: 'staff@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: account, exp: 4102444800 }))}.fixture`;
const session = { access_token: token, refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const items = Array.from({ length: 1002 }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`, user_id: account,
  product_name: index === 0 ? 'A Preview Book' : `Preview book ${String(index).padStart(4, '0')}`,
  console: 'Books', category: 'Books', condition: 'Used', quantity: index === 4 ? 0 : 1,
  status: ({ 1: 'sold', 2: 'reserved', 3: 'archived', 5: 'deleted' })[index] || 'available',
  purchase_price: 5, selected_market_value: 20, sell_price: 0, price_loose: 20,
  created_at: '2026-10-01T12:00:00Z', image_url: '/pixel-page-badge.webp',
  lot_id: index === 0 ? 'unknown-lot' : null,
  notes: 'Sample internal condition notes. All pages use fixture data.',
  description: 'A well-loved sample book.', pricing_status: 'fresh',
  sorted_at: null, cleaned_at: null, tested_at: null, notes_added_at: null,
  on_rack_at: index === 6 ? '2026-10-01T12:00:00Z' : null,
  listed_ebay_at: [2, 7].includes(index) ? '2026-10-01T12:00:00Z' : null,
}));
let readFailure = false, lotsFailure = false, detailFailure = false, saveMode = 'ok';
const writes = [], offsets = [], lotOffsets = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(session => localStorage.setItem('sb-storefront-test-auth-token', JSON.stringify(session)), session);
await page.route('**/api/**', route => { throw new Error(`Unexpected fixture API: ${route.request().url()}`); });
await page.route('**/api/business/session', route => route.fulfill({ json: { success: true, accountId: account, accountRole: 'admin',
  membership: { id: account, user_id: account, account_owner_id: account, role: 'admin', status: 'active' } } }));
await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
await page.route('**/rest/v1/**', async route => {
  const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
  if (table === 'inventory_items') {
    assert.equal(url.searchParams.get('user_id'), `eq.${account}`);
    const id = url.searchParams.get('id')?.slice(3), item = items.find(item => item.id === id);
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      assert(Object.keys(patch).every(key => ['sorted_at', 'cleaned_at', 'tested_at', 'notes_added_at', 'on_rack_at', 'listed_ebay_at', 'listed_amazon_at', 'listed_whatnot_at', 'sold_at', 'status', 'sell_price', 'updated_at'].includes(key)));
      writes.push(patch);
      await new Promise(resolve => setTimeout(resolve, 250));
      if (saveMode === 'denied') return route.fulfill({ status: 403, json: { message: 'Fixture denied' } });
      if (saveMode === 'missing') return route.fulfill({ json: null });
      assert(item); Object.assign(item, patch);
      return route.fulfill({ json: { id } });
    }
    assert.equal(request.method(), 'GET');
    if (id) return route.fulfill(detailFailure ? { status: 503, json: { message: 'Fixture detail unavailable' } } : { json: item || null });
    const offset = Number(url.searchParams.get('offset') || 0);
    offsets.push(offset);
    return route.fulfill(readFailure ? { status: 503, json: { message: 'Fixture inventory unavailable' } } : { json: items.slice(offset, offset + Number(url.searchParams.get('limit') || 500)) });
  }
  assert(['GET', 'HEAD'].includes(request.method()), `Unexpected write ${table}`);
  if (table === 'lots') {
    const offset = Number(url.searchParams.get('offset') || 0); lotOffsets.push(offset);
    return route.fulfill(lotsFailure ? { status: 503, json: { message: 'Fixture lots unavailable' } } : { json: Array.from({ length: 1001 }, (_, i) => ({ id: `lot-${i}`, name: `Sample lot ${i}`, received_at: '2026-10-01T12:00:00Z' })).slice(offset, offset + 500) });
  }
  return route.fulfill({ json: table === 'account_security_settings' ? null : [] });
});
const first = page.getByRole('article', { name: 'A Preview Book', exact: true });
const queue = label => page.getByRole('button', { name: new RegExp(`^${label}(\\s+\\d+)?$`) });
const fits = async name => {
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}px`);
    if (screenshots && [1448, 390].includes(width)) {
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: `${screenshots}-${name}-${width}.png`, animations: 'disabled' });
    }
  }
};
try {
  await page.goto(`${base}/business/prep`);
  await first.waitFor();
  assert(offsets.includes(1000) && lotOffsets.includes(1000), 'Read every inventory and lot page');
  assert.equal(await page.getByRole('article').count(), 24);
  assert.match(await queue('Needs Work').innerText(), /995/);
  await fits('preparation');
  if (screenshots) {
    await page.setViewportSize({ width: 390, height: 1050 });
    await first.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 25, behavior: 'instant' }));
    await page.screenshot({ path: `${screenshots}-card-390.png`, animations: 'disabled' });
  }
  await page.getByRole('navigation', { name: 'Preparation pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  assert.equal(await first.count(), 0);
  await page.getByRole('navigation', { name: 'Preparation pages' }).getByRole('button', { name: 'Previous' }).click();
  await first.waitFor();
  saveMode = 'denied';
  await first.getByRole('button', { name: 'Mark Sorted', exact: true }).click();
  await first.getByRole('alert').waitFor();
  assert.equal(items[0].sorted_at, null);
  assert.equal(await page.getByText('Sort marked done', { exact: true }).count(), 0);
  saveMode = 'missing';
  await first.getByRole('button', { name: 'Mark Sorted', exact: true }).click();
  await first.getByRole('button', { name: 'Mark Sorted', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('article button[disabled]'));
  assert.equal(items[0].sorted_at, null);
  assert.equal(await page.getByText('Sort marked done', { exact: true }).count(), 0);
  saveMode = 'ok';
  for (const label of ['Mark Sorted', 'Mark Cleaned', 'Mark Tested', 'Mark Notes Done', 'Move to Rack']) {
    await first.getByRole('button', { name: label, exact: true }).click();
  }
  await first.waitFor({ state: 'hidden' });
  await queue('Ready to List').click();
  await first.waitFor();
  assert.equal(await page.getByRole('article').count(), 2);
  saveMode = 'denied';
  await first.getByRole('button', { name: 'eBay', exact: true }).click();
  await first.getByRole('alert').waitFor();
  assert.equal(items[0].listed_ebay_at, null);
  assert.equal(await page.getByText('Marked listed on eBay', { exact: true }).count(), 0);
  saveMode = 'ok';
  await first.getByRole('button', { name: 'eBay', exact: true }).click();
  await first.waitFor({ state: 'hidden' });
  await queue('Listed').click();
  await first.waitFor();
  page.once('dialog', dialog => dialog.accept('-10'));
  const before = writes.length;
  await first.getByRole('button', { name: 'Mark Sold', exact: true }).click();
  assert.equal(writes.length, before, 'Negative price must not create a sale');
  page.once('dialog', dialog => dialog.accept('24.95'));
  await first.getByRole('button', { name: 'Mark Sold', exact: true }).click();
  await first.waitFor({ state: 'hidden' });
  await queue('Sold').click();
  await first.waitFor();
  assert.equal(items[0].sell_price, 24.95);
  await first.getByRole('button', { name: 'Show full checklist' }).click();
  await first.getByRole('button', { name: /^Sold/ }).click();
  await first.waitFor({ state: 'hidden' });
  await queue('By Lot').click();
  await first.waitFor();
  assert(await page.getByRole('button', { name: /No Lot/ }).count(), 'Unknown lot item remains visible');
  readFailure = true;
  await page.getByRole('button', { name: 'Refresh preparation' }).click();
  await page.getByRole('alert').filter({ hasText: 'Preparation inventory and lots could not be loaded' }).waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  assert.equal(await queue('Needs Work').count(), 0, 'Read failure must not display zero counts');
  readFailure = false;
  await page.getByRole('button', { name: 'Retry preparation' }).click();
  await first.waitFor();
  lotsFailure = true;
  await page.getByRole('button', { name: 'Refresh preparation' }).click();
  await page.getByRole('alert').filter({ hasText: 'Preparation inventory and lots could not be loaded' }).waitFor();
  lotsFailure = false;
  await page.getByRole('button', { name: 'Retry preparation' }).click();
  await first.waitFor();
  detailFailure = true;
  await page.goto(`${base}/business/inventory/${items[0].id}`);
  await page.getByRole('heading', { name: 'Item unavailable' }).waitFor();
  assert(page.url().endsWith(items[0].id), 'Failed detail must not silently redirect');
  detailFailure = false;
  await page.getByRole('button', { name: 'Retry item', exact: true }).click();
  await page.getByRole('heading', { name: 'A Preview Book', exact: true }).waitFor();
  await fits('item');
  await page.getByRole('button', { name: 'Undo Sorted', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Sorted done', exact: true }).waitFor();
  saveMode = 'missing';
  await page.getByRole('button', { name: 'Mark Sorted done', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Preparation change could not be confirmed' }).waitFor();
  assert.equal(items[0].sorted_at, null);
  assert.equal(await page.getByRole('button', { name: 'Mark Sorted done', exact: true }).count(), 1);
  await page.goto(`${base}/business/inventory/${items[2].id}`);
  await page.getByRole('heading', { name: items[2].product_name, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mark Sorted done', exact: true }).isDisabled(), true, 'Reserved stock stages must be read-only');
  await page.goto(`${base}/business/prep`);
  await page.getByRole('article').first().waitFor();
  await queue('By Lot').click();
  const reserved = page.getByRole('article', { name: items[2].product_name, exact: true });
  await reserved.waitFor();
  await reserved.getByRole('button', { name: 'Show full checklist' }).click();
  assert.equal(await reserved.getByRole('button', { name: 'Sort', exact: true }).isDisabled(), true);
  assert.equal(await reserved.getByRole('button', { name: /^Sold/ }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Preparation/detail browser checks passed: 1,002 inventory/1,001 lots, queues and paging, scoped writes, denied/no-row recovery, sale entry, detail retry and 320–1448px.');
} finally {
  await browser.close();
}
