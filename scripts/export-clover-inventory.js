const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const outDir = path.join(rootDir, 'work', 'clover-inventory-export');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath, headers, rows) {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0.00';
  return numeric.toFixed(2);
}

function quantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '1';
  return String(Math.max(1, Math.floor(numeric)));
}

function firstPositiveMoney(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function retailLabelPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const whole = Math.floor(numeric);
  const cents = numeric - whole;
  if (cents < 0.5) {
    return Math.max(0, whole - 0.01);
  }
  return Math.max(0, whole + 1 - 0.01);
}

function labelBasePrice(item) {
  return firstPositiveMoney(
    item.sell_price,
    item.selected_market_value,
    item.price_cib,
    item.price_loose,
    item.price_new,
    item.price_graded,
    item.purchase_price,
  );
}

function categoryFor(item) {
  const itemType = String(item.item_type || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  const platform = String(item.console || '').toLowerCase();

  if (itemType.includes('book') || category.includes('book') || category.includes('manga')) return 'Books & Media';
  if (itemType.includes('console') || category.includes('console')) return 'Consoles';
  if (itemType.includes('accessory') || category.includes('accessory')) return 'Accessories';
  if (itemType.includes('collect') || category.includes('collect')) return 'Collectibles';
  if (platform || itemType.includes('game') || category.includes('game')) return 'Video Games';
  return 'RetroLootPro';
}

function itemName(item) {
  const title = String(item.product_name || 'Untitled Item').trim();
  const parts = [item.console, item.condition]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return parts.length ? `${title} (${parts.join(' - ')})` : title;
}

function skuFor(item) {
  const id = String(item.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  return id ? `RLP-${id}` : '';
}

async function main() {
  const env = { ...process.env, ...loadEnv(envPath) };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, product_name, console, condition, barcode, quantity, sell_price, selected_market_value, price_cib, price_loose, price_new, price_graded, purchase_price, status, category, item_type')
    .order('product_name', { ascending: true });

  if (error) throw error;

  const items = (data || []).filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return !['sold', 'shipped', 'returned', 'dead stock', 'dead_stock'].includes(status);
  });

  fs.mkdirSync(outDir, { recursive: true });

  const basicHeaders = ['Name', 'Price', 'SKU', 'Code', 'Category', 'Taxable', 'Quantity'];
  const basicRows = items.map((item) => {
    const price = retailLabelPrice(labelBasePrice(item));
    return {
      Name: itemName(item),
      Price: money(price),
      SKU: skuFor(item),
      Code: item.barcode || '',
      Category: categoryFor(item),
      Taxable: 'TRUE',
      Quantity: quantity(item.quantity),
    };
  });

  const referenceHeaders = [
    'RetroLootPro ID',
    'Name',
    'Platform',
    'Condition',
    'Barcode',
    'Sell Price',
    'Market Value',
    'Label Price',
    'Cost Basis',
    'Quantity',
    'Status',
    'Category',
    'Item Type',
    'Clover Category',
  ];
  const referenceRows = items.map((item) => ({
    'RetroLootPro ID': item.id || '',
    Name: item.product_name || '',
    Platform: item.console || '',
    Condition: item.condition || '',
    Barcode: item.barcode || '',
    'Sell Price': money(item.sell_price),
    'Market Value': money(item.selected_market_value),
    'Label Price': money(retailLabelPrice(labelBasePrice(item))),
    'Cost Basis': money(item.purchase_price),
    Quantity: quantity(item.quantity),
    Status: item.status || '',
    Category: item.category || '',
    'Item Type': item.item_type || '',
    'Clover Category': categoryFor(item),
  }));

  writeCsv(path.join(outDir, 'clover-basic-inventory-import.csv'), basicHeaders, basicRows);
  writeCsv(path.join(outDir, 'retrolootpro-inventory-reference.csv'), referenceHeaders, referenceRows);

  const reviewRows = referenceRows
    .map((row) => {
      const issues = [];
      if (Number(row['Sell Price']) === 0 && Number(row['Market Value']) === 0 && Number(row['Cost Basis']) === 0) issues.push('missing price');
      if (!row.Barcode) issues.push('missing barcode');
      return { ...row, Issues: issues.join('; ') };
    })
    .filter((row) => row.Issues);
  writeCsv(path.join(outDir, 'clover-review-needed.csv'), [...referenceHeaders, 'Issues'], reviewRows);

  const missingPrice = basicRows.filter((row) => Number(row.Price) === 0).length;
  const missingBarcode = basicRows.filter((row) => !row.Code).length;

  console.log(`Exported ${items.length} active inventory item(s).`);
  console.log(`Clover import: ${path.join(outDir, 'clover-basic-inventory-import.csv')}`);
  console.log(`Reference file: ${path.join(outDir, 'retrolootpro-inventory-reference.csv')}`);
  console.log(`Review file: ${path.join(outDir, 'clover-review-needed.csv')}`);
  console.log(`Missing price: ${missingPrice}`);
  console.log(`Missing barcode: ${missingBarcode}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
