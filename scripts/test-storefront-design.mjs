import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find((path) => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-storefront-design.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const baseUrl = process.argv[2] || 'http://127.0.0.1:3218';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch(existsSync(chrome) ? { executablePath: chrome, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const products = [
  ...Array.from({ length: 6 }, (_, index) => ({ id: `game-${index}`, title: `Retro Game ${index}`, category: 'Games', platform: index % 2 ? 'SNES' : 'Playstation 3', price: 10 + index, quantity: index ? 3 : 1, art: 'games' })),
  { id: 'book', title: 'The Next Chapter', category: 'Books', platform: 'Paperback', price: 8, quantity: 2, art: 'books' },
  { id: 'collectible', title: 'Fox Figure', category: 'Collectibles', platform: 'Figure', price: 9, quantity: 1, art: 'collectibles' },
  { id: 'console', title: 'Handheld Console', category: 'Consoles', platform: 'Handheld', price: 45, quantity: 1, art: 'consoles' },
  { id: 'accessory', title: 'Wireless Controller', category: 'Collectibles', platform: 'SNES', price: 22, quantity: 3, art: 'accessories' },
  { id: 'apparel', title: 'Pixel Hoodie', category: 'Games', platform: 'Apparel', price: 35, quantity: 1, art: 'apparel' },
].map((item) => ({ ...item, quantity: item.id === 'game-1' ? 25 : item.quantity, slug: item.id, condition: 'Good', featured: item.id === 'game-0', image_url: `/storefront/category-${item.art}.png` }));
let mode = 'success';
let paymentStatus = 'paid';
let paymentReady = true;
let requestFails = false;
const submissions = [];
const checkoutActions = [];
const orderId = '30000000-0000-4000-8000-000000000001';
const catalog = () => page.locator('#catalog');
const featured = () => page.getByRole('region', { name: 'Featured finds' });
await page.route('**/api/storefront/catalog', (route) => {
  if (mode === 'error') return route.fulfill({ status: 503, json: { success: false, message: 'Preview catalog unavailable' } });
  return route.fulfill({ json: { success: true, products: mode === 'empty' ? [] : products } });
});
await page.route('**/api/storefront/requests', (route) => {
  submissions.push(route.request().postDataJSON());
  return route.fulfill(requestFails
    ? { status: 503, json: { success: false, message: 'Request service temporarily unavailable. Please retry.' } }
    : { json: { success: true, message: 'We will email you after reviewing availability. No payment has been taken.' } });
});
await page.route('**/api/storefront/checkout*', (route) => {
  if (route.request().method() === 'POST') {
    const input = route.request().postDataJSON();
    checkoutActions.push(input);
    return route.fulfill({ json: input.action === 'cancel'
      ? { success: true, cancelled: true }
      : { success: true, url: `${baseUrl}/shop/checkout?session_id=cs_test_preview` } });
  }
  return route.fulfill({ json: new URL(route.request().url()).searchParams.has('session_id')
    ? { success: true, status: paymentStatus, paymentStatus: 'paid', purchased: paymentStatus === 'paid' ? [{ id: 'game-0', quantity: 1 }] : [] }
    : { success: true, paymentReady, ...(!paymentReady ? { message: 'Online payment is not configured yet.' } : {}) } });
});

try {
  await page.goto(`${baseUrl}/shop`);
  await featured().locator('article').first().waitFor();
  assert.equal(await featured().locator('article').count(), 6);
  assert.equal(await page.locator('.commerce-footer-brand img').evaluate((image) => getComputedStyle(image).filter), 'none');
  assert.equal(await page.getByRole('region', { name: 'Browse categories' }).getByRole('button').count(), 7);
  assert.equal(await page.locator('.commerce-product-title').filter({ hasText: 'Retro Game 0' }).getAttribute('href'), '/shop/product/game-0');
  await page.getByRole('button', { name: 'Next highlight', exact: true }).click();
  await page.getByRole('heading', { name: /Level up your next adventure/ }).waitFor();
  await page.getByRole('button', { name: 'Show highlight 3', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Show highlight 3', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Shop Books', exact: true }).first().click();
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('article').count(), 1);
  assert.equal(await catalog().locator('.commerce-product-title').filter({ hasText: 'The Next Chapter' }).count(), 1);

  await page.getByRole('region', { name: 'Browse categories' }).getByRole('button', { name: 'Accessories', exact: true }).click();
  assert.equal(await catalog().locator('.commerce-product-title').filter({ hasText: 'Wireless Controller' }).count(), 1);
  await page.getByRole('region', { name: 'Browse categories' }).getByRole('button', { name: 'Apparel', exact: true }).click();
  assert.equal(await catalog().locator('.commerce-product-title').filter({ hasText: 'Pixel Hoodie' }).count(), 1);
  await page.getByRole('region', { name: 'Browse categories' }).getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search products' }).fill('Retro Game 2');
  await page.getByRole('textbox', { name: 'Search products' }).press('Enter');
  assert.equal(await catalog().locator('article').count(), 1);
  await page.getByRole('textbox', { name: 'Search products' }).fill('nothing matches this');
  await page.getByRole('heading', { name: 'No matching inventory' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  assert.equal(await catalog().locator('article').count(), products.length);
  await catalog().getByLabel('Sort by').selectOption('price-high');
  assert.equal(await catalog().locator('.commerce-product-title').first().innerText(), 'Handheld Console');
  await catalog().getByLabel('Platform').selectOption('Paperback');
  assert.equal(await catalog().locator('article').count(), 1);
  await catalog().getByLabel('Platform').selectOption('All');
  await page.getByRole('button', { name: 'Add Retro Game 0 to cart', exact: true }).click();
  await page.getByRole('complementary', { name: 'Shopping cart' }).waitFor();
  await page.getByRole('button', { name: 'Add one Retro Game 0', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))['game-0']), 1);
  await page.getByRole('button', { name: 'Close shopping cart', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open cart, 1 items', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open cart, 1 items', exact: true }).click();
  assert.match(await page.getByRole('complementary', { name: 'Shopping cart' }).innerText(), /Secure payment with Stripe/);
  await page.getByRole('button', { name: 'Remove one Retro Game 0', exact: true }).click();
  await page.getByRole('heading', { name: 'Your cart is empty', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close shopping cart', exact: true }).click();

  await page.goto(`${baseUrl}/shop#catalog`);
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('article').count(), products.length);
  await page.getByRole('navigation', { name: 'Shop categories' }).getByRole('button', { name: 'Home', exact: true }).click();
  await featured().locator('article').first().waitFor();
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal overflow at ${width}px`);
    const tiles = await page.getByRole('region', { name: 'Browse categories' }).getByRole('button').all();
    for (const tile of tiles) {
      const box = await tile.boundingBox();
      assert.ok(box && box.width > 40 && box.height > 40, `Category targets remain usable at ${width}px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Shop categories' }).getByRole('button', { name: 'Books', exact: true }).click();
  assert.equal(await catalog().locator('article').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Open menu', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.goto(`${baseUrl}/shop?category=Books#catalog`);
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('article').count(), 1);
  await page.goto(`${baseUrl}/shop?q=Retro%20Game%202`);
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('.commerce-product-title').innerText(), 'Retro Game 2');

  await page.goto(`${baseUrl}/shop`);
  await featured().locator('article').first().waitFor();
  const destinations = new Set(await page.locator('a[href^="/shop"]').evaluateAll((links) => links.map((link) => link.getAttribute('href'))));
  destinations.add('/shop/checkout');
  destinations.add('/shop/pages/trade-ins');
  for (const destination of destinations) {
    const response = await page.goto(`${baseUrl}${destination}`);
    assert.equal(response.status(), 200, `${destination} loads successfully`);
    await page.locator('main h1').first().waitFor();
    assert.equal(await page.locator('.commerce-reference').count(), 1, `${destination} uses the shared theme`);
    assert.equal(await page.getByText('404', { exact: true }).count(), 0, `${destination} is not a missing page`);
    for (const width of [1448, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${destination} fits ${width}px`);
    }
  }
  await page.goto(`${baseUrl}/shop/product/game-0`);
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.getByRole('link', { name: 'Review cart & checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Item subtotal: $10.00', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();

  await page.evaluate(() => localStorage.setItem('pixel-page-cart', JSON.stringify({ 'game-1': 19 })));
  await page.goto(`${baseUrl}/shop`);
  await page.getByRole('button', { name: 'Add Retro Game 1 to cart', exact: true }).click();
  await page.getByRole('button', { name: 'Add one Retro Game 1', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))['game-1']), 20, 'Homepage cart respects the checkout quantity limit');
  await page.goto(`${baseUrl}/shop/product/game-1`);
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))['game-1']), 20, 'Product page respects the same checkout quantity limit');
  await page.goto(`${baseUrl}/shop/checkout`);
  await page.getByRole('heading', { name: 'Item subtotal: $220.00', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();

  await page.goto(`${baseUrl}/shop/pages/shipping`);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Shop categories' }).getByRole('link', { name: 'Books', exact: true }).click();
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('.commerce-product-title').innerText(), 'The Next Chapter');

  await page.goto(`${baseUrl}/shop/request?item=Missing%20favorite`);
  assert.equal(await page.getByLabel('Item title', { exact: true }).inputValue(), 'Missing favorite');
  for (const [label, value] of [
    ['Your name', 'Guest Customer'], ['Email', 'guest@example.invalid'], ['Platform / format', 'SNES'],
    ['Address line 1', '1 Test St'], ['City', 'Test'], ['State / province', 'FL'], ['Postal code', '32114'], ['Country code', 'US'],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  requestFails = true;
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Request service temporarily unavailable' }).waitFor();
  assert.equal(await page.getByLabel('Item title', { exact: true }).inputValue(), 'Missing favorite');
  requestFails = false;
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await page.getByRole('heading', { name: 'Request received', exact: true }).waitFor();
  assert.equal(submissions.at(-1).address.country, 'US');
  assert.equal(submissions.at(-1).item, 'Missing favorite');

  await page.evaluate(() => localStorage.setItem('pixel-page-cart', JSON.stringify({ 'game-0': 1, book: 2 })));
  paymentReady = false;
  await page.goto(`${baseUrl}/shop/checkout`);
  await page.getByRole('heading', { name: 'Item subtotal: $26.00', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).isDisabled(), true);
  paymentReady = true;
  await page.reload();
  await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment confirmed', exact: true }).waitFor();
  assert.deepEqual(checkoutActions.at(-1).items, [{ id: 'game-0', quantity: 1 }, { id: 'book', quantity: 2 }]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))), { book: 2 });
  await page.reload();
  await page.getByRole('heading', { name: 'Payment confirmed', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))), { book: 2 }, 'Receipt reload must not remove more stock from the cart');
  paymentStatus = 'processing';
  await page.goto(`${baseUrl}/shop/checkout?session_id=cs_test_unconfirmed`);
  await page.getByRole('heading', { name: 'Confirming your payment', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pixel-page-cart'))), { book: 2 }, 'A redirect without server confirmation must not clear the cart');
  paymentStatus = 'paid';
  await page.evaluate((id) => sessionStorage.setItem('pixel-page-checkout', JSON.stringify({ orderId: id, items: [{ id: 'book', quantity: 2 }] })), orderId);
  await page.goto(`${baseUrl}/shop/checkout?cancelled=1`);
  await page.getByRole('heading', { name: 'Previous checkout', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Cancel previous checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pixel-page-checkout')), null);
  assert.equal(checkoutActions.at(-1).action, 'cancel');
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();

  await page.goto(`${baseUrl}/shop`);
  await featured().locator('article').first().waitFor();
  if (process.argv[3]) {
    await page.setViewportSize({ width: 1448, height: 1050 });
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: process.argv[3], fullPage: true, animations: 'disabled' });
  }

  mode = 'error';
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Preview catalog unavailable' }).waitFor();
  mode = 'success';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await featured().locator('article').first().waitFor();
  mode = 'empty';
  await page.reload();
  await page.getByRole('heading', { name: 'The shelves are being refreshed.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Storefront browser checks passed: homepage controls, all linked shop pages at desktop/tablet/mobile widths, product-to-cart navigation, guest request errors/retry/submission, checkout availability, payment confirmation, receipt idempotency, cancellation, catalog errors/retry, and empty inventory. Stripe/API responses use local fixtures; no live payments or production data are changed.');
} finally {
  await browser.close();
}
