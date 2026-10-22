import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-publishing-browser.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const base = process.argv[2] || 'http://127.0.0.1:3218';
const screenshots = process.argv[3];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 } });
const account = '10000000-0000-4000-8000-000000000001';
const user = { id: account, email: 'staff@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: account, exp: 4102444800 }))}.fixture`;
const session = { access_token: token, refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const items = Array.from({ length: 1002 }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`, user_id: account,
  product_name: index === 0 ? 'A Preview Adventure' : index === 6 ? 'A Preview Mystery' : `Preview find ${String(index).padStart(4, '0')}`,
  console: 'Nintendo DS', condition: 'CIB', quantity: index === 3 ? 0 : 1,
  status: ({ 1: 'sold', 2: 'reserved', 4: 'archived', 5: 'deleted' })[index] || 'available',
  image_url: index === 0 ? '/pixel-page-badge.webp' : null, thumbnail_url: index === 6 ? '/pixel-page-badge.webp' : null,
  purchase_price: 10, selected_market_value: 30, created_at: new Date().toISOString(),
  storefront_price: index === 0 ? 44.07 : null, storefront_featured: index === 0, storefront_enabled: false,
  storefront_shipping_promotion: index === 7 ? 'excluded' : 'eligible',
  pricing_data: index === 6 ? [] : [{ loose_price: 25, cib_price: 30, new_price: 40 }],
}));
const stock = item => item.quantity > 0 && !['sold', 'reserved', 'archived', 'deleted'].includes(item.status);
let inventoryError = false, catalogError = false, collectionError = false, saveFailure = false, saveMissingRow = false;
const writes = [], offsets = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(session => localStorage.setItem('sb-storefront-test-auth-token', JSON.stringify(session)), session);
await page.route('**/api/business/session', route => route.fulfill({ json: {
  success: true, accountId: account, accountRole: 'admin',
  membership: { id: account, user_id: account, account_owner_id: account, role: 'admin', status: 'active' },
} }));
await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
await page.route('**/api/storefront/catalog', route => route.fulfill(catalogError
  ? { status: 503, json: { success: false, message: 'Fixture catalog unavailable' } }
  : { json: { success: true, products: items.filter(stock).map(item => ({
    id: item.id, slug: `preview-${item.id}`, price: item.storefront_price || item.pricing_data[0]?.cib_price || 0,
  })).filter(item => item.price > 0) } }));
await page.route('**/rest/v1/**', async route => {
  const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
  if (request.method() === 'PATCH' && table === 'inventory_items') {
    assert.equal(url.searchParams.get('user_id'), `eq.${account}`, 'Updates must remain company scoped');
    const id = url.searchParams.get('id')?.slice(3);
    const patch = request.postDataJSON();
    assert(Object.keys(patch).every(key => ['storefront_price', 'storefront_featured', 'storefront_shipping_promotion', 'storefront_updated_at'].includes(key)));
    writes.push({ id, patch });
    await new Promise(resolve => setTimeout(resolve, 250));
    if (saveFailure) return route.fulfill({ status: 403, json: { message: 'Fixture save denied' } });
    if (saveMissingRow) return route.fulfill({ json: null });
    const item = items.find(item => item.id === id);
    assert(item); Object.assign(item, patch);
    return route.fulfill({ json: { id } });
  }
  assert(['GET', 'HEAD'].includes(request.method()), `Unexpected preview write: ${request.method()} ${table}`);
  if (table === 'inventory_items') {
    assert.equal(url.searchParams.get('user_id'), `eq.${account}`);
    const offset = Number(url.searchParams.get('offset') || 0);
    offsets.push(offset);
    return route.fulfill(inventoryError ? { status: 503, json: { message: 'Fixture inventory unavailable' } }
      : { json: items.slice(offset, offset + Number(url.searchParams.get('limit') || 500)) });
  }
  if (table === 'collections' && collectionError) return route.fulfill({ status: 503, json: { message: 'Fixture collections unavailable' } });
  return route.fulfill({ json: table === 'account_security_settings' ? null : [] });
});
const queue = label => page.getByRole('navigation', { name: 'Publishing queues' }).getByRole('button', { name: new RegExp(`^${label}`) });
const first = page.getByRole('article', { name: 'A Preview Adventure', exact: true });
const missing = page.getByRole('article', { name: 'A Preview Mystery', exact: true });
const price = first.getByRole('textbox', { name: 'Online price for A Preview Adventure', exact: true });
const assertFits = async (name, widths = [1448, 1024, 768, 390, 320]) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}px`);
    if (screenshots && [1448, 390].includes(width)) {
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: `${screenshots}-${name}-${width}.png`, animations: 'disabled' });
    }
  }
};
try {
  await page.goto(`${base}/business/storefront`);
  await first.waitFor();
  assert.match(await queue('All available').innerText(), /997/);
  assert.match(await queue('Live in shop').innerText(), /996/);
  assert.match(await queue('Needs online price').innerText(), /1/);
  assert.match(await queue('Needs public photo').innerText(), /996/);
  assert(offsets.includes(500) && offsets.includes(1000), 'Publishing reads all inventory pages');
  assert.equal(await page.getByRole('article').count(), 24, 'Render a bounded publishing page');
  await assertFits('publishing');
  await page.getByRole('button', { name: 'Open Quick Deal Scanner', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Quick Deal Scanner', exact: true });
  await scanner.waitFor();
  assert.equal(await scanner.locator('iframe').getAttribute('src'), '/business/deal-scanner?embedded=1');
  await page.frameLocator('iframe[title="Quick Deal Scanner"]').getByRole('heading', { name: 'Quick Deal Scanner', exact: true }).waitFor();
  assert.equal(await scanner.isVisible(), true, 'Embedded auth must not tear down the open scanner');
  await page.frameLocator('iframe[title="Quick Deal Scanner"]').locator('input').first().focus();
  await page.keyboard.press('Escape');
  await scanner.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Open Quick Deal Scanner', exact: true }).evaluate(element => element === document.activeElement), true, 'Scanner restores keyboard focus to its trigger');
  if (screenshots) {
    await page.setViewportSize({ width: 390, height: 1000 });
    await first.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 20, behavior: 'instant' }));
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await page.screenshot({ path: `${screenshots}-product-390.png`, animations: 'disabled' });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Page 2 of 42 · up to 24 items', { exact: true }).waitFor();
  await queue('Needs online price').click();
  await missing.waitFor();
  assert.equal(await page.getByRole('article').count(), 1);
  await missing.getByText('Needs public photo', { exact: true }).waitFor();
  await missing.getByRole('textbox', { name: 'Online price for A Preview Mystery', exact: true }).fill('19.95');
  await missing.getByRole('button', { name: 'Save price', exact: true }).click();
  await missing.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'No items in this view.', exact: true }).waitFor();
  await queue('Live in shop').click();
  await missing.getByText('$19.95', { exact: true }).waitFor();
  await missing.getByRole('button', { name: 'Use automatic price', exact: true }).click();
  await missing.waitFor({ state: 'hidden' });
  await queue('Needs online price').click();
  await missing.getByText('Not live', { exact: true }).waitFor();
  await queue('Shipping excluded').click();
  assert.equal(await page.getByRole('article').count(), 1);
  await page.getByText('Excluded packages pay normal shipping.', { exact: true }).waitFor();
  await queue('All available').click();
  await price.fill('24.95'); await price.blur();
  assert.equal(writes.length, 2, 'Blur must not save a price');
  await first.getByRole('button', { name: 'Save price', exact: true }).click();
  assert.equal(await first.getByRole('switch', { name: 'Feature A Preview Adventure', exact: true }).isDisabled(), true, 'Other writes are disabled while saving');
  await first.getByText('$24.95', { exact: true }).waitFor();
  assert.equal(items[0].storefront_price, 24.95);
  assert.equal(writes.length, 3);
  await first.getByRole('button', { name: 'Use automatic price', exact: true }).click();
  await first.getByText('$30.00', { exact: true }).waitFor();
  assert.equal(items[0].storefront_price, null);
  await first.getByText('Automatic condition price', { exact: true }).waitFor();
  await price.fill('0');
  await first.getByRole('button', { name: 'Save price', exact: true }).click();
  await first.getByRole('alert').waitFor();
  assert.equal(writes.length, 4, 'Invalid price must not reach database');
  await first.getByRole('switch', { name: 'Feature A Preview Adventure', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Feature A Preview Adventure"]')?.getAttribute('aria-checked') === 'false');
  assert.equal(items[0].storefront_featured, false);
  await first.getByRole('combobox', { name: 'Shipping offer for A Preview Adventure', exact: true }).selectOption('excluded');
  await page.waitForFunction(() => document.querySelector('[aria-label="Shipping offer for A Preview Adventure"]')?.value === 'excluded');
  await first.getByText('Excluded packages pay normal shipping.', { exact: true }).waitFor();
  saveFailure = true;
  await price.fill('40.00');
  await first.getByRole('button', { name: 'Save price', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This storefront change could not be confirmed.' }).waitFor();
  assert.equal(items[0].storefront_price, null);
  await first.getByText('$30.00', { exact: true }).waitFor();
  saveFailure = false; saveMissingRow = true;
  await first.getByRole('switch', { name: 'Feature A Preview Adventure', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This storefront change could not be confirmed.' }).waitFor();
  assert.equal(items[0].storefront_featured, false, 'A response with no updated row is not success');
  saveMissingRow = false; catalogError = true;
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Retry storefront inventory', exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 0, 'Catalog failures hide stale live data');
  assert.equal(await page.getByRole('navigation', { name: 'Publishing queues' }).count(), 0);
  catalogError = false;
  await page.getByRole('button', { name: 'Retry storefront inventory', exact: true }).click();
  await first.waitFor();
  await page.getByRole('textbox', { name: 'Search publishing inventory', exact: true }).fill('not a real item');
  await page.getByRole('heading', { name: 'No items in this view.', exact: true }).waitFor();
  await page.goto(`${base}/business/inventory`);
  await page.getByRole('link', { name: 'A Preview Adventure', exact: false }).first().waitFor();
  await assertFits('inventory');
  const search = page.getByPlaceholder('Search name, UPC, ISBN, author, platform...');
  assert.equal(await search.count(), 1);
  await search.fill('Preview find 1001');
  const last = page.getByRole('link').filter({ hasText: 'Preview find 1001' });
  await last.waitFor();
  assert.match(await last.getAttribute('href'), /\/business\/inventory\//);
  collectionError = true;
  await page.reload();
  await page.getByRole('button', { name: 'Retry collections', exact: true }).waitFor();
  collectionError = false;
  await page.getByRole('button', { name: 'Retry collections', exact: true }).click();
  await page.getByRole('button', { name: 'Retry collections', exact: true }).waitFor({ state: 'hidden' });
  inventoryError = true;
  await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Retry inventory', exact: true }).waitFor();
  assert.equal(await page.getByRole('link').filter({ hasText: 'A Preview Adventure' }).count(), 0);
  assert.equal(await page.getByText('Matching records', { exact: true }).count(), 0);
  inventoryError = false;
  await page.getByRole('button', { name: 'Retry inventory', exact: true }).click();
  await page.getByRole('link').filter({ hasText: 'A Preview Adventure' }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 8, 'Only the eight explicitly requested fixture updates are allowed');
  console.log('Inventory/publishing browser checks passed: 1002-row paging, live/unpriced/photo/shipping queues, 24-row presentation, 320-1448px layouts, explicit price saves/reset/validation, feature/shipping updates, save-denial and catalog/inventory/collection error recovery. All records and writes are local fixtures.');
} catch (error) {
  console.error({ url: page.url(), errors, dialogs: await page.getByRole('dialog').allTextContents(), body: (await page.locator('body').innerText()).slice(-2200) });
  throw error;
} finally { await browser.close(); }
