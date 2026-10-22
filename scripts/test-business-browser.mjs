import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-business-browser.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const base = process.argv[2] || 'http://127.0.0.1:3218';
const screenshots = process.argv[3];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 } });
const owner = '10000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001';
const user = { id: owner, email: 'staff@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, email_confirmed_at: '2026-01-01T00:00:00Z' };
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: owner, exp: 4102444800 }))}.fixture`;
const session = { access_token: token, refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const product = { id: 'game-1', slug: 'game-1', title: 'Preview game', category: 'Games', platform: 'Nintendo DS', condition: 'CIB', price: 44.07, quantity: 3, featured: true, shippingPromotion: 'eligible' };
const order = { id, kind: 'checkout', status: 'paid', created_at: '2026-10-22T12:00:00Z', items: [{ title: 'Preview game', quantity: 1, unit_amount: 4407 }], subtotal_cents: 4407, total_cents: 4407, tax_cents: 0, shipping_cents: 0, refunded_cents: 0, customer: null, tracking: null,
  shipping_quote: { customer: { name: 'Preview customer', email: 'customer@example.invalid', address: { line1: '1 Preview Street', city: 'Test City', state: 'FL', postal_code: '32092', country: 'US' } }, rate: { name: 'USPS Ground Advantage', amount: 0, carrierAmount: 573, discount: 573 }, parcels: 1 } };
let accountRole = 'admin', accessStatus = 200, rejectLogin = false, inviteStatus = 200, passwordUpdates = 0;
let overviewMode = 'ok', overviewCalls = 0, inventoryFailure = false;
const inventoryOffsets = [];
const inventory = Array.from({ length: 1002 }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  product_name: index === 0 ? 'Preview item needing a price' : `Preview inventory ${index}`,
  console: 'Nintendo DS', condition: 'CIB', quantity: index === 3 ? 0 : 1,
  status: ({ 1: 'sold', 2: 'reserved', 4: 'archived', 5: 'deleted' })[index] || 'available',
  purchase_price: index === 0 ? 0 : 10, selected_market_value: index === 0 ? 0 : 30,
  created_at: new Date(Date.now() - (index === 0 ? 90 : 1) * 86400000).toISOString(),
  storefront_enabled: index === 6, pricing_data: [],
}));
const overview = { readyToShip: 61, awaitingPayment: 7, shipped: 123, openRequests: 2,
  orders: [
    { id, createdAt: '2026-10-20T12:00:00Z', shippingService: 'USPS Ground Advantage' },
    { id: '40000000-0000-4000-8000-000000000002', createdAt: '2026-10-21T12:00:00Z', shippingService: null },
  ] };
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { localStorage.setItem('retroloot-theme', 'apple'); });
await page.route('**/api/storefront/catalog', route => route.fulfill({ json: { success: true, products: [product] } }));
await page.route('**/api/business/session', route => route.fulfill({ status: accessStatus, json: accessStatus === 200
  ? { success: true, accountId: owner, accountRole, membership: { id: owner, account_owner_id: owner, user_id: owner, role: accountRole, status: 'active' } }
  : { success: false, message: accessStatus === 403 ? 'This login does not have active Pixel & Page team access.' : 'Team access could not be verified. Please retry.' } }));
await page.route('**/api/business/overview', async route => {
  overviewCalls++;
  await new Promise(resolve => setTimeout(resolve, 120));
  return route.fulfill({ status: overviewMode === 'error' ? 503 : 200, json: overviewMode === 'error'
    ? { success: false, message: 'Order activity could not be loaded. Please retry.' }
    : { success: true, overview: overviewMode === 'empty' ? { readyToShip: 0, awaitingPayment: 0, shipped: 0, openRequests: 0, orders: [] } : overviewMode === 'malformed' ? { ...overview, readyToShip: null } : overview } });
});
await page.route('**/api/storefront/manage*', route => {
  assert.equal(route.request().method(), 'GET', 'Preview must not mutate orders');
  const url = new URL(route.request().url());
  const status = url.searchParams.get('status');
  const orderId = url.searchParams.get('order');
  return route.fulfill({ json: { success: true, requests: [], orders: (!status || status === 'all' || status === order.status) && (!orderId || orderId === id) ? [order] : [], shippingRates: [], carrierShipping: true } });
});
await page.route('**/api/storefront/labels*', route => route.fulfill({ json: { success: true, labels: [] } }));
await page.route('**/api/team/accept-invite', route => route.fulfill({ status: inviteStatus, json: inviteStatus === 200 ? { success: true } : { success: false, message: 'Invitation could not be accepted. Please contact an owner.' } }));
await page.route('**/auth/v1/**', route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/token')) return route.fulfill(rejectLogin
    ? { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }
    : { json: session });
  if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
  if (url.pathname.endsWith('/user') && route.request().method() === 'PUT') passwordUpdates++;
  return route.fulfill({ json: user });
});
await page.route('**/rest/v1/**', route => {
  if (!['GET', 'HEAD'].includes(route.request().method())) {
    writes.push(route.request().url());
    return route.fulfill({ status: 403, json: { message: 'Preview data is read-only.' } });
  }
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  if (table === 'inventory_items') {
    const offset = Number(url.searchParams.get('offset') || 0);
    inventoryOffsets.push(offset);
    return route.fulfill(inventoryFailure ? { status: 503, json: { message: 'Preview database unavailable' } } : { json: inventory.slice(offset, offset + Number(url.searchParams.get('limit') || 1000)) });
  }
  return route.fulfill({ json: table === 'account_security_settings' ? null : [] });
});
try {
  await page.goto(base);
  await page.getByRole('region', { name: 'Featured finds' }).locator('article').waitFor();
  assert.equal(new URL(page.url()).pathname, '/', 'Public home must remain the shop');
  await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Welcome back.' }).count(), 0);
  await page.getByRole('textbox', { name: 'Search products' }).fill('Preview');
  await page.getByRole('textbox', { name: 'Search products' }).press('Enter');
  assert.equal(new URL(page.url()).pathname, '/');
  assert.match(page.url(), /q=Preview/);
  await page.reload();
  await page.getByRole('textbox', { name: 'Search products' }).waitFor();
  await page.getByText('Search: Preview', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Search products' }).inputValue(), 'Preview');
  for (const path of ['/shop', '/shop/request', '/shop/pages/shipping', '/shop/product/game-1', '/shop/checkout']) {
    await page.goto(`${base}${path}`);
    await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
  }
  for (const path of ['/business/deal-scanner?embedded=1', '/business/design-preview']) {
    await page.goto(`${base}${path}`);
    await page.waitForURL('**/login?next=**');
    await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
  }
  await page.goto(`${base}/inventory?platform=DS#pricing`);
  await page.waitForURL('**/login?next=**');
  assert.match(new URL(page.url()).searchParams.get('next'), /^\/business\/inventory\?platform=DS/);
  await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Create account/i }).count(), 0);
  for (const width of [1448, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Login fits ${width}px`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
    if (screenshots && [1448, 390].includes(width)) await page.screenshot({ path: `${screenshots}-login-${width}.png`, fullPage: true });
  }
  await page.goto(`${base}/login?next=/business/orders`);
  await page.getByLabel('Work email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-only-password');
  rejectLogin = true;
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Invalid login credentials/ }).waitFor();
  rejectLogin = false;
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await page.waitForURL('**/business/orders');
  const card = page.getByRole('article', { name: `Order ${id.slice(0, 8)}`, exact: true });
  await card.waitFor();
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Orders fit ${width}px`);
    assert.equal(await page.getByRole('heading', { name: 'Shop requests & orders', exact: true }).count(), 1);
    if (screenshots && [1448, 390].includes(width)) {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: `${screenshots}-orders-${width}.png`, animations: 'disabled' });
      await card.getByText('Customer-selected shipping', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshots}-shipping-${width}.png`, animations: 'disabled' });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  await page.getByRole('button', { name: 'Open business menu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace menu' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Administration', exact: true }).click();
  assert.equal(await dialog.getByRole('link', { name: 'Team', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Open business menu', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.goto(base);
  await page.getByRole('link', { name: 'Business workspace', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/', 'Staff can browse the storefront without being redirected');
  accountRole = 'user';
  await page.goto(`${base}/business/help`);
  await page.getByRole('heading', { name: 'Help / User Manual', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open business menu', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Administration', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  accessStatus = 403;
  await page.reload();
  await page.getByRole('heading', { name: 'Team access required', exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  accessStatus = 503;
  await page.getByRole('button', { name: 'Retry access check', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Team access could not be verified' }).waitFor();
  accessStatus = 200; accountRole = 'admin';
  await page.getByRole('button', { name: 'Retry access check', exact: true }).click();
  await page.getByRole('heading', { name: 'Help / User Manual', exact: true }).waitFor();
  await page.goto(`${base}/business/orders`);
  await card.waitFor();
  await page.getByRole('button', { name: 'Open business menu', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/login');
  await page.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
  await page.evaluate(session => localStorage.setItem('sb-storefront-test-auth-token', JSON.stringify(session)), session);
  await page.goto(`${base}/auth/callback?invite=1&next=/business/orders`);
  await page.getByLabel('New password', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/auth/callback');
  await page.getByLabel('New password', { exact: true }).fill('a-fixture-only-password');
  await page.getByRole('button', { name: 'Save password & open workspace', exact: true }).click();
  await page.waitForURL('**/business/orders');
  await card.waitFor();
  assert.equal(passwordUpdates, 1);
  inviteStatus = 403;
  await page.goto(`${base}/auth/callback?invite=1&next=/business/orders`);
  await page.getByText('Invitation could not be accepted. Please contact an owner.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('New password', { exact: true }).count(), 0);
  await page.goto(`${base}/business`);
  await page.getByRole('heading', { name: "Let's make today a good one.", exact: true }).waitFor();
  const activity = page.getByRole('region', { name: 'Keep every order moving.', exact: true });
  const ready = activity.getByRole('link', { name: /Ready to ship/ });
  await ready.waitFor();
  assert.match(await ready.innerText(), /61/);
  await page.getByText('1,002 total inventory rows', { exact: true }).waitFor();
  assert(inventoryOffsets.includes(500) && inventoryOffsets.includes(1000), 'Inventory reads beyond the default database row limit');
  assert.equal(await page.getByText('997', { exact: true }).count(), 0, 'Unavailable stock does not inflate priced records');
  await page.getByText('996', { exact: true }).waitFor();
  await page.getByText('997 available records without an eBay, Amazon or Whatnot listing', { exact: true }).waitFor();
  await page.getByText('1 aging / 1 missing price', { exact: true }).waitFor();
  const reviewCard = page.getByRole('link').filter({ hasText: 'Needs review' });
  assert.equal(await reviewCard.locator('.text-2xl').innerText(), '1', 'An item needing both price and age review is counted once');
  await page.getByText('Shipping service needs review', { exact: true }).waitFor();
  assert.match(await page.getByRole('link').filter({ hasText: 'Estimated gross spread' }).innerText(), /19,920/);
  if (screenshots) await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'));
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.business-overview *')).filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80), width: element.getBoundingClientRect().width })).slice(0, 12));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overview fits ${width}px: ${JSON.stringify(overflow)}`);
    if (screenshots && [1448, 390].includes(width)) {
      await page.screenshot({ path: `${screenshots}-overview-${width}.png`, animations: 'disabled' });
      await activity.getByRole('heading', { name: 'Pack & ship next', exact: true }).evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 24, behavior: 'instant' }));
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: `${screenshots}-queue-${width}.png`, animations: 'disabled' });
      await page.getByRole('heading', { name: 'Give your inventory its next chapter.', exact: true }).evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 24, behavior: 'instant' }));
      await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: `${screenshots}-inventory-${width}.png`, animations: 'disabled' });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }
  }
  await activity.getByRole('link', { name: 'Review & pack', exact: true }).first().click();
  await page.waitForURL(url => url.pathname === '/business/orders' && url.searchParams.get('order') === id);
  await card.waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Order status', exact: true }).inputValue(), 'paid');
  await page.getByRole('link', { name: 'Return to all orders', exact: true }).click();
  await card.waitFor();
  await page.goto(`${base}/business`);
  await activity.getByRole('link', { name: /Customer requests/ }).click();
  await page.getByRole('button', { name: 'Customer requests (0)', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Customer requests (0)', exact: true }).getAttribute('aria-pressed'), 'true');
  overviewMode = 'error';
  await page.goto(`${base}/business`);
  await page.getByRole('button', { name: 'Retry order activity', exact: true }).waitFor();
  assert.equal(await ready.count(), 0, 'Unavailable order counts must not show zeros');
  await page.getByText('1,002 total inventory rows', { exact: true }).waitFor();
  overviewMode = 'malformed';
  await page.getByRole('button', { name: 'Retry order activity', exact: true }).click();
  await page.getByRole('button', { name: 'Retry order activity', exact: true }).waitFor();
  assert.equal(await ready.count(), 0, 'Invalid count responses must not show zeros');
  overviewMode = 'empty';
  await page.getByRole('button', { name: 'Retry order activity', exact: true }).click();
  await page.getByText('No paid orders waiting to ship. A good time to prepare your next listings.', { exact: true }).waitFor();
  overviewMode = 'ok'; inventoryFailure = true;
  await page.reload();
  await ready.waitFor();
  await page.getByRole('button', { name: 'Retry inventory activity', exact: true }).waitFor();
  assert.equal(await page.getByText('1,002 total inventory rows', { exact: true }).count(), 0, 'Failed inventory loads never show stale or empty estimates');
  inventoryFailure = false;
  await page.getByRole('button', { name: 'Retry inventory activity', exact: true }).click();
  await page.getByText('1,002 total inventory rows', { exact: true }).waitFor();
  accountRole = 'user';
  const callsBeforeEmployee = overviewCalls;
  await page.reload();
  await page.getByText(/Order management is currently limited to store administrators/).waitFor();
  await page.getByText('1,002 total inventory rows', { exact: true }).waitFor();
  assert.equal(overviewCalls, callsBeforeEmployee, 'Employee overview must not fetch administrator-only order data');
  assert.equal(writes.length, 0, 'No membership bootstrap or business writes');
  assert.deepEqual(errors, []);
  console.log('Business foundation and overview browser checks passed: public root, shop Login links, private/embedded routes, invitation setup, admin/employee navigation, 320-1448px layouts, order-first overview, exact count display, shipping and order deep links, >1000 inventory rows, deduplicated review counts, estimate labels, independent failure/retry and empty states. All identity and business APIs use local fixtures.');
} catch (error) {
  console.error({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(-1600) });
  throw error;
} finally { await browser.close(); }
