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
].map((item) => ({ ...item, shippingPromotion:item.id==='book'?'excluded':item.id==='accessory'?'free':'eligible', quantity: item.id === 'game-1' ? 25 : item.quantity, slug: item.id, condition: 'Good', featured: item.id === 'game-0', image_url: `/storefront/category-${item.art}.png` }));
const largeCatalog = Array.from({ length: 73 }, (_, index) => ({
  ...products[0], id: `large-${index}`, slug: `large-${index}`,
  title: `Catalog Game ${String(index).padStart(2, '0')}`,
  platform: `Platform ${index % 20}`, condition: index % 2 ? 'CIB' : 'Loose',
  price: index + 1, compare_at_price: index === 2 ? 100 : null,
  created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), featured: false,
}));
let mode = 'success';
let paymentStatus = 'paid';
let paymentReady = true;
let carrierShipping = false;
let shippingFails = false;
let promotionScenario = 'none';
let requestFails = false;
const submissions = [];
const checkoutActions = [];
const orderId = '30000000-0000-4000-8000-000000000001';
const catalog = () => page.locator('#catalog');
const featured = () => page.getByRole('region', { name: 'Featured finds' });
await page.route('**/api/storefront/catalog', (route) => {
  if (mode === 'error') return route.fulfill({ status: 503, json: { success: false, message: 'Preview catalog unavailable' } });
  return route.fulfill({ json: { success: true, products: mode === 'empty' ? [] : mode === 'large' ? largeCatalog : products } });
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
      : { success: true, url: `${baseUrl}/shop/checkout?session_id=cs_test_preview${checkoutActions.length}` } });
  }
  return route.fulfill({ json: new URL(route.request().url()).searchParams.has('session_id')
    ? { success: true, status: paymentStatus, paymentStatus: 'paid', purchased: paymentStatus === 'paid' ? [{ id: 'game-0', quantity: 1 }] : [] }
    : { success: true, paymentReady, carrierShipping, ...(!paymentReady ? { message: 'Online payment is not configured yet.' } : {}) } });
});
await page.route('**/api/storefront/shipping', route => route.fulfill(shippingFails
  ? { status: 503, json: { success: false, message: 'Carrier rates unavailable. Please retry.' } }
  : { json: { success: true, token: 'signed-fixture-quote', expires: Date.now() + 900000, parcels: 2,
    rates: [{ id: 'usps-fixture', name: 'USPS Ground Advantage', amount: 1050, estimatedDays: 4,
      ...({
        threshold:{amount:800,carrierAmount:800,discount:0,promotionGoal:5334},
        free:{amount:0,carrierAmount:750,discount:750,promotionGoal:5000},
        blocked:{amount:1050,carrierAmount:1050,discount:0,promotionGoal:null},
        partial:{amount:650,carrierAmount:1050,discount:400,promotionGoal:null},
      }[promotionScenario] || {}) },
      { id: 'ups-fixture', name: 'UPS Ground', amount: 1620, estimatedDays: 3 }] } }));

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
  assert.match(await page.getByRole('region',{name:'Free shipping progress'}).innerText(),/no minimum purchase/);
  assert.equal(await catalog().locator('.shipping-eligibility').first().innerText(),'Free shipping eligible');
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
  assert.equal(await page.getByRole('button', { name: 'Online payments unavailable', exact: true }).isDisabled(), true);
  await page.getByRole('status').filter({ hasText: 'Online checkout is not open yet' }).waitFor();
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
  carrierShipping = true;
  await page.reload();
  await page.getByRole('region', { name: 'Delivery and carrier rates' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).isDisabled(), true);
  for (const [label, value] of [['Recipient name', 'Guest Customer'], ['Email for receipt', 'guest@example.invalid'],
    ['Delivery address', '1 Test St'], ['City', 'Test'], ['State (2 letters)', 'FL'], ['ZIP code', '32114']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  shippingFails = true;
  await page.getByRole('button', { name: 'Get shipping options', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Carrier rates unavailable' }).waitFor();
  shippingFails = false;
  await page.getByRole('button', { name: 'Get shipping options', exact: true }).click();
  await page.getByLabel('Delivery service', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).isDisabled(), false);
  await page.getByLabel('ZIP code', { exact: true }).fill('10001');
  assert.equal(await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).isDisabled(), true, 'Changing delivery address invalidates shipping');
  await page.getByRole('button', { name: 'Get shipping options', exact: true }).click();
  await page.getByLabel('Delivery service', { exact: true }).selectOption('ups-fixture');
  const summary = page.getByRole('region', { name: 'Order summary', exact: true });
  assert.match(await summary.innerText(), /\$16\.20/);
  assert.match(await summary.innerText(), /\$32\.20/);
  for (const theme of ['dark', 'light', 'apple']) {
    await page.evaluate(theme => {
      document.documentElement.classList.toggle('light', theme === 'light');
      document.documentElement.classList.toggle('apple', theme === 'apple');
      document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    }, theme);
    for (const control of await page.locator('.shipping-quote input,.shipping-quote select').all()) {
      const styles = await control.evaluate(e => {
        const s = getComputedStyle(e);
        return { background: s.backgroundColor, color: s.color, fill: s.webkitTextFillColor, scheme: s.colorScheme };
      });
      assert.deepEqual(styles, { background: 'rgb(255, 255, 255)', color: 'rgb(9, 45, 64)', fill: 'rgb(9, 45, 64)', scheme: 'light' }, `Readable checkout fields in ${theme} theme`);
    }
  }
  for (const width of [1448, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Carrier quote fits ${width}px`);
    if (process.argv[4] && [1448, 390].includes(width)) await page.screenshot({ path: `${process.argv[4]}-checkout-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Continue to Stripe checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment confirmed', exact: true }).waitFor();
  assert.equal(checkoutActions.at(-1).shippingToken, 'signed-fixture-quote');
  assert.equal(checkoutActions.at(-1).shippingRate, 'ups-fixture');

  await page.evaluate(()=>localStorage.setItem('pixel-page-cart',JSON.stringify({console:1})));
  await page.goto(`${baseUrl}/shop/checkout`);
  const progress=page.getByRole('region',{name:'Free shipping progress'});
  await progress.getByRole('status').filter({hasText:'no minimum purchase'}).waitFor();
  for (const [label,value] of [['Recipient name','Guest Customer'],['Email for receipt','guest@example.invalid'],
    ['Delivery address','1 Test St'],['City','Test'],['State (2 letters)','FL'],['ZIP code','32114']]) await page.getByLabel(label,{exact:true}).fill(value);
  promotionScenario='threshold';
  await page.getByRole('button',{name:'Get shipping options',exact:true}).click();
  await progress.getByRole('status').filter({hasText:'Add $8.34'}).waitFor();
  assert.equal(await progress.getByRole('progressbar').getAttribute('max'),'5334');
  await page.evaluate(()=>localStorage.setItem('pixel-page-cart',JSON.stringify({console:1,'game-0':1})));
  await page.reload();
  await page.getByRole('heading',{name:'Item subtotal: $55.00',exact:true}).waitFor();
  for (const [label,value] of [['Recipient name','Guest Customer'],['Email for receipt','guest@example.invalid'],
    ['Delivery address','1 Test St'],['City','Test'],['State (2 letters)','FL'],['ZIP code','32114']]) await page.getByLabel(label,{exact:true}).fill(value);
  promotionScenario='free';
  await page.getByRole('button',{name:'Get shipping options',exact:true}).click();
  await progress.getByRole('status').filter({hasText:'Free standard shipping confirmed'}).waitFor();
  assert.match(await summary.innerText(),/Shipping savings[\s\S]*\$7.50/);
  assert.match(await page.getByLabel('Delivery service',{exact:true}).locator('option').first().innerText(),/Free/);
  await page.getByLabel('Delivery service',{exact:true}).selectOption('ups-fixture');
  await progress.getByRole('status').filter({hasText:'No free-shipping offer is applied'}).waitFor();
  await page.getByLabel('Delivery service',{exact:true}).selectOption('usps-fixture');
  await progress.getByRole('status').filter({hasText:'Free standard shipping confirmed'}).waitFor();
  await page.getByLabel('ZIP code',{exact:true}).fill('10001');
  await progress.getByRole('status').filter({hasText:'no minimum purchase'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continue to Stripe checkout',exact:true}).isDisabled(),true);
  promotionScenario='blocked';
  await page.getByRole('button',{name:'Get shipping options',exact:true}).click();
  await progress.getByRole('status').filter({hasText:'Standard shipping applies'}).waitFor();
  assert.equal(await progress.getByRole('progressbar').count(),0);
  promotionScenario='partial';
  await page.getByRole('button',{name:'Get shipping options',exact:true}).click();
  await progress.getByRole('status').filter({hasText:'Some items have free standard shipping'}).waitFor();
  assert.match(await summary.innerText(),/\$6.50/);
  promotionScenario='none';
  carrierShipping = false;
  await page.goto(`${baseUrl}/shop/checkout`);
  await page.getByRole('button', { name: 'Clear cart', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await page.evaluate(()=>localStorage.setItem('pixel-page-cart',JSON.stringify({book:2})));
  await page.reload();
  await page.getByRole('region',{name:'Free shipping progress'}).getByRole('status').filter({hasText:'excluded from the whole-order'}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Free shipping progress'}).getByRole('progressbar').count(),0);
  await page.getByRole('button',{name:'Clear cart',exact:true}).click();
  await page.evaluate(()=>localStorage.setItem('pixel-page-cart',JSON.stringify({accessory:1})));
  await page.reload();
  await page.getByRole('region',{name:'Free shipping progress'}).getByText(/Individual offers use the same postage limits/).waitFor();
  await page.getByRole('button',{name:'Clear cart',exact:true}).click();
  await page.goto(`${baseUrl}/shop/product/accessory`);
  await page.locator('.shipping-eligibility').filter({hasText:'Free shipping eligible'}).waitFor();
  assert.doesNotMatch(await page.locator('.shipping-eligibility').innerText(),/\$50|\$8/);
  await page.goto(`${baseUrl}/shop/product/book`);
  await page.getByRole('button',{name:'Add to cart',exact:true}).waitFor();
  assert.equal(await page.locator('.shipping-eligibility').count(),0);

  await page.goto(`${baseUrl}/shop`);
  await featured().locator('article').first().waitFor();
  if (process.argv[3]) {
    await page.setViewportSize({ width: 1448, height: 1050 });
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: process.argv[3], fullPage: true, animations: 'disabled' });
  }

  mode = 'large';
  await page.goto(`${baseUrl}/shop#catalog`);
  await page.reload();
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('article').count(), 24);
  assert.match(await catalog().getByRole('status').innerText(), /Showing 1-24 of 73 items/);
  assert.equal(await catalog().locator('.commerce-product-title').first().innerText(), 'Catalog Game 02', 'Discounted products lead the default order');
  assert.equal(await catalog().locator('.commerce-product-title').nth(1).innerText(), 'Catalog Game 72', 'Newest arrivals follow discounted products');
  assert.equal(await catalog().getByLabel('Platform', { exact: true }).locator('option').count(), 21, 'All platforms remain filterable beyond the old 16-platform limit');
  await page.getByRole('navigation', { name: 'Inventory pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  assert.equal(await catalog().locator('article').count(), 24);
  assert.match(page.url(), /page=2/);
  assert.match(await catalog().getByRole('status').innerText(), /Showing 25-48 of 73 items/);
  const secondPageFirst = await catalog().locator('.commerce-product-title').first().innerText();
  await page.reload();
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('.commerce-product-title').first().innerText(), secondPageFirst);
  const productLink = catalog().locator('.commerce-product-title').first();
  await productLink.click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).waitFor();
  await page.goBack();
  await catalog().locator('article').first().waitFor();
  assert.match(page.url(), /page=2/);
  assert.equal(await catalog().locator('.commerce-product-title').first().innerText(), secondPageFirst, 'Back from a product keeps the current page');
  await page.getByRole('button', { name: 'Page 4', exact: true }).click();
  assert.equal(await catalog().locator('article').count(), 1);
  assert.equal(await page.getByRole('navigation', { name: 'Inventory pages' }).getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
  await catalog().getByLabel('Items per page', { exact: true }).selectOption('48');
  assert.equal(await catalog().locator('article').count(), 48);
  assert.doesNotMatch(page.url(), /page=/, 'Changing page size returns to page one');
  await catalog().getByLabel('Items per page', { exact: true }).selectOption('96');
  assert.equal(await catalog().locator('article').count(), 73);
  await catalog().getByLabel('Items per page', { exact: true }).selectOption('24');
  await catalog().getByLabel('Category', { exact: true }).selectOption('Games');
  await catalog().getByLabel('Platform', { exact: true }).selectOption('Platform 2');
  await catalog().getByLabel('Condition', { exact: true }).selectOption('Loose');
  await catalog().getByLabel('Minimum price ($)', { exact: true }).fill('3');
  await catalog().getByLabel('Maximum price ($)', { exact: true }).fill('3');
  await catalog().getByLabel('On sale only', { exact: true }).check();
  assert.equal(await catalog().locator('article').count(), 1);
  assert.equal(await catalog().locator('.commerce-product-title').innerText(), 'Catalog Game 02');
  await page.reload();
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().getByLabel('On sale only', { exact: true }).isChecked(), true);
  assert.equal(await catalog().getByLabel('Platform', { exact: true }).inputValue(), 'Platform 2');
  await catalog().getByLabel('Minimum price ($)', { exact: true }).fill('10');
  await catalog().getByRole('alert').filter({ hasText: 'Minimum price' }).waitFor();
  await page.getByRole('heading', { name: 'No matching inventory', exact: true }).waitFor();
  await catalog().getByRole('button', { name: 'Clear filters', exact: true }).click();
  assert.equal(await catalog().locator('article').count(), 24);
  assert.equal(await catalog().getByLabel('Condition', { exact: true }).inputValue(), 'All');
  assert.equal(await catalog().getByLabel('On sale only', { exact: true }).isChecked(), false);
  await catalog().getByLabel('Condition', { exact: true }).selectOption('CIB');
  await catalog().getByRole('button', { name: 'Remove filter: CIB', exact: true }).click();
  assert.equal(await catalog().getByLabel('Condition', { exact: true }).inputValue(), 'All');
  await page.goto(`${baseUrl}/shop?category=Games&q=Catalog%20Game%2002&page=999#catalog`);
  await catalog().locator('article').first().waitFor();
  assert.equal(await catalog().locator('article').count(), 1, 'Category and search combine in shared links');
  assert.doesNotMatch(page.url(), /page=999/, 'Out-of-range page is corrected after inventory loads');
  await catalog().getByRole('button', { name: 'Clear filters', exact: true }).click();
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Filtered catalog fits ${width}px`);
    for (const select of await catalog().locator('select').all()) {
      const box = await select.boundingBox();
      assert.ok(box && box.width >= 80 && box.height >= 44, `Filter controls stay usable at ${width}px`);
    }
    if (process.argv[4] && [1448, 390].includes(width)) {
      await catalog().evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: `${process.argv[4]}-${width}.png`, animations: 'disabled' });
    }
  }
  await page.goto(`${baseUrl}/shop`);
  await featured().locator('article').first().waitFor();
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
  console.log('Storefront browser checks passed: homepage controls, all linked shop pages, 73-product pagination at 24/48/96, newest/deal ordering, every platform, combined filters, URL/reload/product-back state, removable filters, mobile control sizes and overflow, cart, guest requests, checkout confirmation/cancellation, and catalog errors/retry. Stripe/API responses use local fixtures; no live payments or production data are changed.');
} catch (error) {
  console.error('Browser failure context:', { url: page.url(), errors, text: (await page.locator('body').innerText()).slice(-2500) });
  throw error;
} finally {
  await browser.close();
}
