import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve } from 'node:path';

const bin = process.env.PATH.split(delimiter).find(path => existsSync(resolve(path, '../playwright/package.json')));
if (!bin) throw new Error('Run with npm exec --package=playwright -- node scripts/test-finance-browser.mjs');
const { chromium } = createRequire(resolve(bin, '../playwright/package.json'))('playwright');
const base = process.argv[2] || 'http://127.0.0.1:3218', screenshots = process.argv[3];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1448, height: 1050 }, timezoneId: 'America/Los_Angeles' });
const account = '10000000-0000-4000-8000-000000000001';
const user = { id: account, email: 'staff@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: account, exp: 4102444800 }))}.fixture`;
const session = { access_token: token, refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const { year, month } = await page.evaluate(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 }));
const date = `${year}-${String(month).padStart(2, '0')}-15`;
const transactions = Array.from({ length: 1002 }, (_, i) => ({
  id: `tx-${String(i).padStart(4, '0')}`, user_id: account, date, created_at: `${date}T12:00:00Z`,
  type: 'income', amount: 10, description: i === 1001 ? '=Sample formula, "quoted"' : `Sample book sale ${i}`,
  category: 'Sales', subcategory: null, platform: 'Local', source: 'manual', reference_id: null, is_reconciled: false,
}));
transactions.push(
  { ...transactions[0], id: 'online', description: 'Sample shop payment', amount: 35, platform: 'Stripe', subcategory: 'Online', reference_id: 'sample-order' },
  { ...transactions[0], id: 'refund', description: 'Sample refund', amount: -5, type: 'refund' },
  { ...transactions[0], id: 'expense', description: 'Sample recorded fee', amount: -12, type: 'expense', category: 'Fees' },
  { ...transactions[0], id: 'stripe-fee', description: 'Confirmed Stripe fee', amount: 1.25, type: 'expense', category: 'Payment Processing Fees', platform: 'Stripe' },
  { ...transactions[0], id: 'postage', description: 'Confirmed Shippo postage', amount: 5.73, type: 'expense', category: 'Shipping', platform: 'Shippo' },
);
const inventory = Array.from({ length: 1002 }, (_, i) => ({
  id: `item-${String(i).padStart(4, '0')}`, user_id: account, status: 'sold', product_name: `Sample sold book ${i}`,
  sell_price: 20, purchase_price: i === 1001 ? 0 : 5, sold_at: `${date}T23:59:59.999Z`, sold_via: 'Local',
}));
const orders = [
  { id: 'order-known', account_id: account, items: [{ quantity: 2, unit_amount: 1000, unit_cost_cents: 250 }], accounting_started_at: `${date}T10:00:00Z`, cost_snapshot_version: 1, stripe_fee_status: 'recorded' },
  { id: 'order-missing', account_id: account, items: [{ quantity: 1, unit_amount: 1200, unit_cost_cents: null }], accounting_started_at: `${date}T11:00:00Z`, cost_snapshot_version: 1, stripe_fee_status: 'pending' },
];
const postageLabels = [{ id: 'label-pending', account_id: account, status: 'success', accounting_status: 'pending', created_at: `${date}T12:00:00Z` }];
const errors = [], offsets = {};
let failReport = false, failRecent = false, failCosts = false, failTransactions = false, allMissing = false, delayPeriod = false;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(session => localStorage.setItem('sb-storefront-test-auth-token', JSON.stringify(session)), session);
await page.route('**/api/**', route => { throw new Error(`Unexpected fixture API: ${route.request().url()}`); });
await page.route('**/api/business/session', route => route.fulfill({ json: { success: true, accountId: account, accountRole: 'admin',
  membership: { id: account, user_id: account, account_owner_id: account, role: 'admin', status: 'active' } } }));
await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
await page.route('**/rest/v1/**', async route => {
  const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
  if (url.pathname.endsWith('/rpc/storefront_pending_label_accounting')) return route.fulfill({ json: postageLabels.length });
  assert(['GET', 'HEAD'].includes(request.method()), `Unexpected fixture write: ${request.method()} ${table}`);
  if (!['inventory_items', 'financial_transactions', 'storefront_orders', 'storefront_labels'].includes(table)) return route.fulfill({ json: table === 'account_security_settings' ? null : [] });
  const accountField = ['storefront_orders', 'storefront_labels'].includes(table) ? 'account_id' : 'user_id';
  assert.equal(url.searchParams.get(accountField), `eq.${account}`);
  const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 500);
  (offsets[table] ||= []).push(offset);
  const costQueue = table === 'inventory_items' && url.searchParams.get('select')?.includes('product_name');
  const report = !costQueue && (url.searchParams.has('date') || url.searchParams.has('sold_at') || url.searchParams.has('accounting_started_at') || url.searchParams.has('created_at'));
  if ((failReport && report) || (failCosts && costQueue) || (failRecent && limit === 8) || (failTransactions && !report && limit !== 8))
    return route.fulfill({ status: 503, json: { message: 'Fixture financial read unavailable' } });
  if (delayPeriod && report) await new Promise(resolve => setTimeout(resolve, url.searchParams.getAll('date').some(value => value === `gte.${year - 1}-01-01`) ? 900 : 150));
  let rows = table === 'financial_transactions' ? transactions
    : table === 'inventory_items' ? inventory.map(item => ({ ...item, purchase_price: allMissing ? 0 : item.purchase_price }))
    : table === 'storefront_orders' ? orders : postageLabels;
  for (const key of ['date', 'sold_at', 'accounting_started_at', 'created_at', 'type', 'category', 'status', 'accounting_status', 'cost_snapshot_version']) for (const filter of url.searchParams.getAll(key)) {
    const separator = filter.indexOf('.'), operator = filter.slice(0, separator), value = filter.slice(separator + 1);
    rows = rows.filter(row => operator === 'eq' ? row[key] === value : operator === 'gte' ? row[key] >= value : operator === 'lte' ? row[key] <= value : operator === 'lt' ? row[key] < value : true);
  }
  const search = url.searchParams.get('description');
  if (search) rows = rows.filter(row => row.description.toLowerCase().includes(search.slice(7, -1).toLowerCase()));
  return route.fulfill({ json: rows.slice(offset, offset + limit) });
});
const finance = page.getByRole('navigation', { name: 'Finance sections', exact: true });
const tab = name => finance.getByRole('button', { name, exact: true });
const text = (value) => page.getByText(value, { exact: true }).waitFor();
const downloadCsv = async button => {
  const pending = page.waitForEvent('download'); await button.click(); const download = await pending;
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};
const fits = async name => {
  await page.mouse.move(0, 0);
  for (const width of [1448, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflows at ${width}`);
    const selected = finance.locator('[aria-current="page"]');
    const [bounds, button] = await Promise.all([finance.boundingBox(), selected.boundingBox()]);
    assert(button.x >= bounds.x - 1 && button.x + button.width <= bounds.x + bounds.width + 1, `Selected finance section is hidden at ${width}`);
    if (screenshots && [1448, 390].includes(width)) await page.screenshot({ path: `${screenshots}-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1448, height: 1050 });
};
const captureResults = async (name, target) => {
  if (!screenshots) return;
  for (const width of [1448, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.waitForTimeout(200);
    await target.evaluate(element => scrollTo(0, scrollY + element.getBoundingClientRect().top - 110));
    await page.screenshot({ path: `${screenshots}-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1448, height: 1050 }); await page.evaluate(() => scrollTo(0, 0));
};
try {
  await page.goto(`${base}/business/finance`);
  await text('Know what the books actually say.');
  const monthly = page.getByRole('region', { name: 'This month recorded results', exact: true });
  await monthly.getByText('$30,090.00', { exact: true }).waitFor();
  await monthly.getByText('$5,010.00', { exact: true }).waitFor();
  await monthly.getByText('$25,061.02', { exact: true }).waitFor();
  await page.getByText('1 unit(s) in new storefront orders have no positive cost snapshot, covering $12.00 in merchandise sales. Order costs are missing; results may be overstated.', { exact: true }).waitFor();
  await page.getByText('1 new storefront order(s) are awaiting a confirmed Stripe processing fee. Review Stripe reconciliation before relying on this period.', { exact: true }).waitFor();
  await page.getByText('1 confirmed Shippo label(s) are awaiting a Finance posting. Refresh reconciliation before relying on this period.', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'This year recorded results', exact: true }).getByText('$25,061.02', { exact: true }).waitFor();
  assert(offsets.financial_transactions.includes(1000)); assert(offsets.inventory_items.includes(1000));
  await fits('overview');
  await captureResults('overview-results', monthly);

  failReport = true;
  await page.getByRole('button', { name: 'Refresh finance', exact: true }).click();
  await page.getByText('Recorded results could not be loaded.', { exact: false }).waitFor();
  assert.equal(await monthly.count(), 0);
  await text('Sample book sale 0');
  failReport = false; failRecent = true;
  await page.getByRole('button', { name: 'Retry recorded results' }).click();
  await monthly.getByText('$30,090.00', { exact: true }).waitFor();
  await page.getByText('Recent transactions could not be loaded.', { exact: false }).waitFor();
  failRecent = false;
  await page.getByRole('button', { name: 'Retry recent transactions' }).click();
  await text('Sample book sale 0');

  await tab('P&L').click();
  await page.getByRole('button', { name: 'Export CSV' }).waitFor({ state: 'visible' });
  await text('Recorded P&L · provisional');
  assert.equal(await page.getByRole('button', { name: 'Export CSV' }).isEnabled(), true);
  await fits('report');
  await captureResults('report-results', page.getByText('Recorded P&L · provisional', { exact: true }));
  let csv = await downloadCsv(page.getByRole('button', { name: 'Export CSV' }));
  assert(csv.includes('"Recorded revenue less refunds","30090"'));
  assert(csv.includes('"Known cost of goods","5010"'));
  assert(csv.includes('"Sample sold book 1001","Local"'));
  assert(csv.includes('"New storefront order COGS","5"'));
  assert(csv.includes('"New storefront orders awaiting Stripe fee","1"'));
  assert(csv.includes('"Confirmed Shippo labels awaiting Finance posting","1"'));

  failReport = true; delayPeriod = true;
  await page.getByRole('combobox', { name: 'Report year' }).click();
  await page.getByRole('option', { name: String(year - 1), exact: true }).click();
  await page.getByText('This period could not be loaded.', { exact: false }).waitFor();
  assert.equal(await page.getByText('Recorded P&L · provisional', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Export CSV' }).isEnabled(), false);
  failReport = false;
  await page.getByRole('button', { name: 'Retry period report' }).click();
  await text('Recorded P&L · provisional');
  await page.getByRole('combobox', { name: 'Report year' }).click();
  await page.getByRole('option', { name: String(year), exact: true }).click();
  await page.getByRole('combobox', { name: 'Report month' }).click();
  const otherMonth = month === 1 ? 'February' : 'January';
  await page.getByRole('option', { name: otherMonth, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button')?.disabled);
  await text(`${otherMonth} ${year}`);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Export CSV') && !button.disabled));
  csv = await downloadCsv(page.getByRole('button', { name: 'Export CSV' }));
  assert(csv.includes('"Recorded revenue less refunds","0"'));
  await page.getByRole('combobox', { name: 'Report month' }).click();
  failCosts = true;
  await page.getByRole('option', { name: 'Full Year', exact: true }).click();
  await page.getByText('Missing cost-basis records could not be loaded.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Export CSV' }).isEnabled(), false);
  failCosts = false; allMissing = true; delayPeriod = false;
  await page.getByRole('button', { name: 'Retry cost queue' }).click();
  await page.getByText('1002 sold inventory record(s),', { exact: false }).waitFor();
  csv = await downloadCsv(page.getByRole('button', { name: 'Export CSV' }));
  assert.equal(csv.split('\r\n').filter(row => row.startsWith('"Sample sold book ')).length, 1002);
  allMissing = false;
  delayPeriod = true;
  await page.getByRole('combobox', { name: 'Report year' }).click();
  await page.getByRole('option', { name: String(year - 1), exact: true }).click();
  await page.getByRole('combobox', { name: 'Report year' }).click();
  await page.getByRole('option', { name: String(year), exact: true }).click();
  await text('Recorded P&L · provisional');
  await page.waitForTimeout(1100);
  csv = await downloadCsv(page.getByRole('button', { name: 'Export CSV' }));
  assert(csv.includes(`"Period","Full calendar year ${year}"`));
  assert(csv.includes('"Recorded revenue less refunds","30090"'));
  delayPeriod = false;

  await tab('Transactions').click();
  await text('Entries 1–50 of 1007');
  assert.equal(await page.locator('tbody tr').count(), 50);
  await page.locator('tbody tr').first().getByText(`${new Date(date + 'T12:00:00').toLocaleString('en-US', { month: 'short' })} 15, ${year}`, { exact: true }).waitFor();
  await fits('transactions');
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('button', { name: 'Add Transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Transaction', exact: true });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
  const cancel = await dialog.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
  assert(cancel.y >= 0 && cancel.y + cancel.height <= 700);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 1448, height: 1050 });
  await page.getByRole('navigation', { name: 'Transaction pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  await text('Entries 51–100 of 1007');
  csv = await downloadCsv(page.getByRole('button', { name: 'CSV', exact: true }));
  assert.equal(csv.split('\r\n').length, 1008);
  assert(csv.includes('"\'=Sample formula, ""quoted"""'));
  assert(csv.includes('"-12","expense"'));
  failTransactions = true;
  await page.getByRole('textbox', { name: 'Search transactions' }).fill('Book');
  await page.getByText('Transactions could not be loaded.', { exact: false }).waitFor();
  assert.equal(await page.getByText('Ledger-entry difference', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'CSV', exact: true }).isEnabled(), false);
  failTransactions = false;
  await page.getByRole('button', { name: 'Retry transactions' }).click();
  await text('Entries 1–50 of 1001');
  await tab('Overview').click();
  await page.waitForURL('**/business/finance?tab=overview');
  await text('Know what the books actually say.');
  assert(new URL(page.url()).pathname === '/business/finance');
  await page.goBack();
  await page.waitForURL('**/business/finance?tab=transactions');
  await text('Entries 1–50 of 1007');
  await page.reload();
  await text('Entries 1–50 of 1007');
  await page.goto(`${base}/business/finance?tab=not-a-tab`);
  await text('Know what the books actually say.');
  assert.equal(await tab('Overview').getAttribute('aria-current'), 'page');
  assert.deepEqual(errors, []);
  console.log('Finance fixture passed: full-company reads, exact totals, provisional warnings, independent errors/retry, period/export safety, full CSV rows, transaction pagination, URL history and 320–1448px layouts.');
} finally { await browser.close(); }
