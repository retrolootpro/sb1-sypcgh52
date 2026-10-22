import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-intake-browser.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const base = process.argv[2] || 'http://127.0.0.1:3218', screenshots = process.argv[3];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 } });
const account = '10000000-0000-4000-8000-000000000001';
const user = { id: account, email: 'staff@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: account, exp: 4102444800 }))}.fixture`;
const session = { access_token: token, refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const lots = Array.from({ length: 1002 }, (_, id) => ({
  id: `30000000-0000-4000-8000-${String(id).padStart(12, '0')}`, name: `Sample receiving lot ${id}`,
  received_at: '2026-10-01T12:00:00Z', total_paid: 0, total_market_value: 0, allocation_status: null, cost_allocated_at: null,
}));
const inventory = lots.map((lot, id) => ({ id: `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`, lot_id: lot.id, quantity: 1, purchase_price: 0, selected_market_value: 20, console: 'Book', condition: 'Loose', product_name: `Already saved ${id}` }));
const employees = lots.map((lot, id) => ({ id: lot.id, name: `Sample employee ${id}`, is_active: true }));
const transactions = lots.map((lot, id) => ({ id: `tx-${id}`, reference_id: `lot_purchase_${lot.id}`, amount: 0 }));
const saved = [], writes = [], deletes = [], offsets = {}, errors = [];
let referencesFail = false, duplicateFail = false, gameLookup = false, saveMode = 'ok', undoMode = 'ok';
const pricingHistory = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(session => localStorage.setItem('sb-storefront-test-auth-token', JSON.stringify(session)), session);
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture camera access denied', 'NotAllowedError'); };
});
await page.route('**/api/**', route => { throw new Error(`Unexpected fixture API: ${route.request().url()}`); });
await page.route('**/api/business/session', route => route.fulfill({ json: { success: true, accountId: account, accountRole: 'admin',
  membership: { id: account, user_id: account, account_owner_id: account, role: 'admin', status: 'active' } } }));
await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
await page.route('**/api/local-upc-lookup', route => {
  const { barcode, lookupMode } = route.request().postDataJSON();
  if (gameLookup) {
    assert.equal(lookupMode, 'auto');
    return route.fulfill({ json: { success: true, title: 'Mario Kart DS', platform: 'Nintendo DS', category: 'Video Games', brand: 'Nintendo', source: 'fixture' } });
  }
  assert.equal(lookupMode, 'book');
  return route.fulfill({ json: { success: true, title: `Sample book ${barcode}`, platform: 'Book', category: 'Books', source: 'fixture',
    bookMetadata: { title: `Sample book ${barcode}`, authors: ['Sample Author'], retailPrice: 20, categories: ['Books'], source: 'fixture' } } });
});
await page.route('**/api/local-market-prices', route => route.fulfill({ json: {
  success: true, diagnostics: { refreshStatus: 'success', missingConditions: [], warnings: [], pcApiUsed: true },
  pcMatch: { productId: 'preview-game', productName: 'Mario Kart DS', platform: 'Nintendo DS', strategy: 'fixture' },
  prices: Object.fromEntries([['loose', 20], ['cib', 30], ['new', 50], ['graded', 0]].map(([condition, value]) => [condition, { value, source: 'pricecharting_api', sampleCount: 1 }])),
} }));
await page.route('**/rest/v1/**', async route => {
  const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
  if (table === 'inventory_items' && request.method() === 'POST') {
    const patch = request.postDataJSON();
    assert.equal(patch.user_id, account); writes.push(patch);
    await new Promise(resolve => setTimeout(resolve, 200));
    if (saveMode === 'denied') return route.fulfill({ status: 403, json: { message: 'Fixture save denied' } });
    if (saveMode === 'missing') return route.fulfill({ json: null });
    const item = { ...patch, id: `50000000-0000-4000-8000-${String(saved.length).padStart(12, '0')}`, status: 'available' };
    saved.push(item); return route.fulfill({ json: item });
  }
  if (table === 'pricing_data' && request.method() === 'POST') {
    pricingHistory.push(request.postDataJSON());
    return route.fulfill({ status: 403, json: { message: 'Fixture pricing history unavailable' } });
  }
  if (request.method() === 'DELETE' && table === 'inventory_items') {
    assert.equal(url.searchParams.get('user_id'), `eq.${account}`);
    assert.equal(url.searchParams.get('status'), 'eq.available');
    assert.equal(url.searchParams.get('sold_at'), 'is.null');
    assert.equal(url.searchParams.get('lot_id'), 'is.null');
    assert.equal(url.searchParams.has('barcode'), false);
    const id = url.searchParams.get('id')?.slice(3); assert(id); deletes.push(id);
    if (undoMode === 'denied') return route.fulfill({ status: 403, json: { message: 'Fixture undo denied' } });
    if (undoMode === 'missing') return route.fulfill({ json: null });
    const index = saved.findIndex(item => item.id === id);
    assert(index >= 0); saved.splice(index, 1);
    return route.fulfill({ json: { id } });
  }
  assert(['GET', 'HEAD'].includes(request.method()), `Unexpected fixture write: ${request.method()} ${table}`);
  if (['lots', 'inventory_items', 'financial_transactions', 'employees'].includes(table)) {
    assert.equal(url.searchParams.get('user_id'), `eq.${account}`);
    const offset = Number(url.searchParams.get('offset') || 0);
    (offsets[table] ||= []).push(offset);
    if (table === 'lots' && referencesFail && offset === 500) return route.fulfill({ status: 503, json: { message: 'Fixture later page unavailable' } });
    if (table === 'inventory_items' && (url.searchParams.has('barcode') || url.searchParams.has('normalized_title'))) {
      if (duplicateFail) return route.fulfill({ status: 503, json: { message: 'Fixture duplicate check unavailable' } });
      return route.fulfill({ json: [{ id: inventory[0].id, product_name: 'An existing copy', console: 'Book', condition: 'Loose', created_at: '2026-10-01T12:00:00Z' }] });
    }
    const rows = { lots, inventory_items: inventory, financial_transactions: transactions, employees }[table];
    return route.fulfill({ json: rows.slice(offset, offset + Number(url.searchParams.get('limit') || 500)) });
  }
  return route.fulfill({ json: table === 'account_security_settings' ? null : [] });
});
const ready = async () => { await page.getByRole('button', { name: 'Start Intake', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled); };
const barcode = page.getByLabel('Barcode / UPC');
const submit = page.getByRole('button', { name: 'Process Barcode', exact: true });
const dialog = page.getByRole('dialog', { name: 'Confirm Item Details', exact: true });
const selectBooks = async () => {
  await page.getByRole('combobox', { name: 'Intake type' }).click();
  await page.getByRole('option', { name: 'Books / Manga', exact: true }).click();
};
const fits = async name => {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0);
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
  await page.goto(`${base}/business/scan`);
  await ready();
  for (const table of ['lots', 'employees', 'inventory_items', 'financial_transactions']) assert(offsets[table].includes(1000), `Read all ${table} pages`);
  await fits('intake');
  if (screenshots) {
    await page.setViewportSize({ width: 390, height: 1050 });
    await page.getByRole('group', { name: 'Scan and manual intake' }).evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 20, behavior: 'instant' }));
    await page.screenshot({ path: `${screenshots}-tools-390.png`, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Start Scanner', exact: true }).click();
  await page.getByText('Scan Intake', { exact: true }).waitFor();
  await page.getByText('Fixture camera access denied', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop barcode scanner', exact: true }).click();
  await page.getByText('Scan Intake', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Start Intake', exact: true }).click();
  await selectBooks();
  for (const code of ['9780123456789', '9780123456789', '9780123456790']) { await barcode.fill(code); await submit.click(); }
  assert.equal(writes.length, 0, 'Queuing does not create inventory');
  await page.getByRole('button', { name: 'Process All', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByText('Possible duplicate in inventory', { exact: true }).waitFor();
  await fits('confirmation');
  for (const [width, height] of [[390, 700], [320, 640]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(button => {
      const bounds = button.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    }, await dialog.getByRole('button', { name: 'Save Item', exact: true }).elementHandle());
    const footer = await dialog.getByRole('button', { name: 'Save Item', exact: true }).boundingBox();
    assert(footer && footer.y >= 0 && footer.y + footer.height <= height, `Confirmation save stays visible at ${width}x${height}: ${JSON.stringify(footer)}`);
  }
  const beforeClose = writes.length;
  await dialog.getByLabel('Book title', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes.length, beforeClose, 'Escape must not save inventory');
  await page.getByRole('article', { name: 'Sample book 9780123456789', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await dialog.getByLabel('Cost override', { exact: true }).fill('1e3');
  await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
  await dialog.getByText('Enter a nonnegative amount with up to two decimals.').waitFor();
  assert.equal(writes.length, 0);
  await dialog.getByLabel('Cost override', { exact: true }).fill('5.00');
  await dialog.getByLabel('Asking price', { exact: true }).fill('24.95');
  await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] input[aria-label="Book title"]')?.value === 'Sample book 9780123456790');
  assert.equal(saved[0].quantity, 2, 'Repeated barcode creates one row with two copies');
  assert.equal(saved[0].purchase_price, 5); assert.equal(saved[0].sell_price, 24.95);
  await dialog.getByLabel('Book title', { exact: true }).fill('Sample book 9780123456790 — reviewed title');
  await dialog.getByRole('button', { name: 'Save for review', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  assert.equal(saved.length, 2); assert.equal(saved[1].needs_review, true);
  assert.equal(saved[1].product_name, 'Sample book 9780123456790 — reviewed title', 'Save for review preserves edited metadata');
  await fits('queue');
  undoMode = 'denied';
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Undo could not be confirmed' }).waitFor();
  assert.equal(saved.length, 2);
  undoMode = 'missing';
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Undo')?.disabled);
  assert.equal(saved.length, 2);
  undoMode = 'ok';
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('article', { name: 'Sample book 9780123456790 — reviewed title', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(saved.length, 1); assert.equal(deletes.length, 3);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'retroloot-intake-session') throw new DOMException('Fixture storage full', 'QuotaExceededError'); return original.call(this, key, value); };
  });
  await page.getByRole('button', { name: 'Save & Close', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'could not be saved in this browser' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save & Close', exact: true }).count(), 1, 'Failed draft save must keep intake open');
  await page.reload();
  await page.getByRole('article', { name: 'Sample book 9780123456789', exact: true }).waitFor();
  assert.equal(saved.length, 1); assert.equal(writes.length, 2, 'Restore never creates duplicate inventory');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('article').waitFor({ state: 'hidden' });
  assert.equal(saved.length, 1, 'Clear queue leaves saved inventory alone');
  await page.evaluate(() => localStorage.setItem('retroloot-intake-session', '{"unverified":"legacy"}'));
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'saved intake could not be verified' }).waitFor();
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('retroloot-intake-session')), '{"unverified":"legacy"}', 'Do not overwrite unverified drafts');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Discard saved browser draft', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  referencesFail = true;
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Receiving lots and employee choices could not be loaded' }).waitFor();
  assert.equal(await submit.isDisabled(), true);
  referencesFail = false;
  await page.getByRole('button', { name: 'Retry receiving data', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  await selectBooks();
  duplicateFail = true;
  await barcode.fill('9780123456700'); await submit.click();
  await page.getByRole('alert').filter({ hasText: 'Duplicate check failed' }).waitFor();
  assert.equal(writes.length, 2, 'Duplicate check failure never permits automatic saving');
  duplicateFail = false;
  for (const mode of ['denied', 'missing']) {
    saveMode = mode;
    await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
    await barcode.fill(mode === 'denied' ? '9780123456701' : '9780123456702'); await submit.click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
    await page.getByRole('article', { name: mode === 'denied' ? 'Sample book 9780123456701' : 'Sample book 9780123456702', exact: true }).getByRole('alert').waitFor();
    assert.equal(saved.length, 1, 'Failed/no-row inventory save remains a failed queue entry');
  }
  saveMode = 'ok';
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill('A manual sample book');
  await page.getByRole('button', { name: 'Add Manual Search Item', exact: true }).click();
  await page.getByRole('button', { name: 'Continue Manually', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('textbox', { name: 'Pages', exact: true }).fill('1.5');
  await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Page count must be' }).waitFor();
  await dialog.getByRole('textbox', { name: 'Pages', exact: true }).fill('120');
  await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  assert.equal(saved.at(-1).book_page_count, 120);
  assert.equal(saved.at(-1).product_name, 'A manual sample book');
  gameLookup = true;
  await page.getByRole('combobox', { name: 'Intake type' }).click();
  await page.getByRole('option', { name: 'Games / Consoles', exact: true }).click();
  await barcode.fill('045496735906'); await submit.click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Console or platform', { exact: true }).inputValue(), 'Nintendo DS');
  await dialog.getByLabel('Cost override', { exact: true }).fill('8.00');
  await dialog.getByLabel('Asking price', { exact: true }).fill('35.00');
  await fits('game-confirmation');
  await dialog.getByRole('button', { name: 'Save Item', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  assert.equal(saved.at(-1).product_name, 'Mario Kart DS');
  assert.equal(saved.at(-1).purchase_price, 8);
  assert.equal(saved.at(-1).selected_market_value, 35);
  assert.equal(saved.at(-1).price_cib, 30);
  assert.equal(pricingHistory.length, 1);
  assert.equal(pricingHistory[0].item_id, saved.at(-1).id);
  await page.getByText('Inventory saved, but pricing history could not be recorded.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('article', { name: 'Mario Kart DS', exact: true }).getByRole('link', { name: 'Mario Kart DS', exact: true }).getAttribute('href'), `/business/inventory/${saved.at(-1).id}`);
  assert.equal(await page.getByRole('button', { name: /^Print Labels/ }).isDisabled(), false);
  assert.deepEqual(errors, []);
  console.log('Intake browser checks passed: full receiving data, camera denial/recovery, book and game saves/pricing/label handoff, secondary-history failure, batch copies/confirmation, Escape without writes, strict prices/metadata, explicit review saves, exact undo denial/no-row/success, browser draft save failure/reload/isolation, reference/duplicate/save failures and 320–1448px layouts. All writes use fixtures.');
} finally { await browser.close(); }
