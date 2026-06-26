import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const existingExportPath = 'C:/Users/JoshuaPhillips/OneDrive - MMI/Downloads/inventory-export-v2 (1).xlsx';
const basicCsvPath = path.join(dir, 'clover-basic-inventory-import.csv');
const referenceCsvPath = path.join(dir, 'retrolootpro-inventory-reference.csv');
const outPath = path.join(dir, 'clover-inventory-update-label-prices.xlsx');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else value += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell || '').trim()));
}

function records(rows) {
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])));
}

function normalizeSku(value) {
  return String(value || '').trim().toUpperCase();
}

function numberOrBlank(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

const basic = records(parseCsv(await fs.readFile(basicCsvPath, 'utf8')));
const reference = records(parseCsv(await fs.readFile(referenceCsvPath, 'utf8')));
const referenceBySku = new Map(
  reference.map((row) => [`RLP-${String(row['RetroLootPro ID'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase()}`, row]),
);

const input = await FileBlob.load(existingExportPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const itemsSheet = workbook.worksheets.getItem('Items');
const categoriesSheet = workbook.worksheets.getItem('Categories');

const existingRows = itemsSheet.getUsedRange().values;
const headers = existingRows[0];
const skuIndex = headers.indexOf('SKU');
const cloverIdIndex = headers.indexOf('Clover ID');
const existingBySku = new Map();

for (const row of existingRows.slice(1)) {
  const sku = normalizeSku(row[skuIndex]);
  if (sku.startsWith('RLP-')) existingBySku.set(sku, row);
}

const updateRows = basic.map((row) => {
  const sku = normalizeSku(row.SKU);
  const existing = existingBySku.get(sku) || Array(headers.length).fill('');
  const ref = referenceBySku.get(sku) || {};
  const platform = ref.Platform ? String(ref.Platform) : '';
  const condition = ref.Condition ? String(ref.Condition) : '';
  const description = [platform, condition, ref.Status ? `Status: ${ref.Status}` : ''].filter(Boolean).join(' | ');
  const output = Array(headers.length).fill('');

  for (let i = 0; i < headers.length; i += 1) {
    output[i] = existing[i] ?? '';
  }

  output[cloverIdIndex] = existing[cloverIdIndex] || '';
  output[headers.indexOf('Name')] = row.Name || ref.Name || existing[headers.indexOf('Name')] || 'Untitled Item';
  output[headers.indexOf('Alternate Name')] = existing[headers.indexOf('Alternate Name')] || '';
  output[headers.indexOf('Description')] = description;
  output[headers.indexOf('Price')] = numberOrBlank(row.Price);
  output[headers.indexOf('Price Type')] = numberOrBlank(row.Price) ? 'Fixed' : 'Variable';
  output[headers.indexOf('Price Unit')] = '';
  output[headers.indexOf('Cost')] = numberOrBlank(ref['Cost Basis']);
  output[headers.indexOf('Product Code')] = row.Code || '';
  output[headers.indexOf('SKU')] = sku;
  output[headers.indexOf('Quantity')] = Number(row.Quantity) || 1;
  output[headers.indexOf('Hidden?')] = 'No';
  output[headers.indexOf('Default tax rates?')] = 'Yes';
  output[headers.indexOf('Non-revenue item?')] = 'No';
  output[headers.indexOf('Categories')] = row.Category || ref['Clover Category'] || 'RetroLootPro';
  output[headers.indexOf('Tax Rates')] = '';

  return output;
});

const finalRows = [headers, ...updateRows];
itemsSheet.getRange(`A1:U2000`).clear({ applyTo: 'contents' });
itemsSheet.getRangeByIndexes(0, 0, finalRows.length, headers.length).values = finalRows;
itemsSheet.getRange(`E2:E${finalRows.length}`).format.numberFormat = '$#,##0.00';
itemsSheet.getRange(`H2:H${finalRows.length}`).format.numberFormat = '$#,##0.00';
itemsSheet.getRange(`K2:K${finalRows.length}`).format.numberFormat = '#,##0';

const categories = [...new Set(basic.map((row) => row.Category).filter(Boolean))].sort();
const existingCategoryRows = categoriesSheet.getUsedRange().values;
const categoryHeaders = existingCategoryRows[0];
const categoryByName = new Map();
for (const row of existingCategoryRows.slice(1)) {
  const name = String(row[1] || '').trim();
  if (name) categoryByName.set(name, row);
}
const categoryRows = [
  categoryHeaders,
  ...categories.map((name) => {
    const existing = categoryByName.get(name) || Array(categoryHeaders.length).fill('');
    existing[1] = name;
    return existing;
  }),
];
categoriesSheet.getRange('A1:D1000').clear({ applyTo: 'contents' });
categoriesSheet.getRangeByIndexes(0, 0, categoryRows.length, categoryHeaders.length).values = categoryRows;

for (const sheetName of ['Items', 'Categories']) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  used.format.autofitColumns();
  used.format.autofitRows();
}

const taxSheet = workbook.worksheets.getItem('Tax Rates');
const taxValues = taxSheet.getUsedRange().values;
const taxHeaders = taxValues[0] || [];
const taxAmountIndex = taxHeaders.indexOf('Tax Amount');
if (taxAmountIndex >= 0 && taxValues.length > 1) {
  const cleaned = taxValues.map((row, index) => {
    if (index === 0) return row;
    const output = [...row];
    output[taxAmountIndex] = '';
    return output;
  });
  taxSheet.getRangeByIndexes(0, 0, cleaned.length, taxHeaders.length).values = cleaned;
}

const inspect = await workbook.inspect({
  kind: 'table',
  sheetId: 'Items',
  range: 'A1:U8',
  tableMaxRows: 8,
  tableMaxCols: 21,
  maxChars: 5000,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 50 },
  maxChars: 1000,
});
console.log(errors.ndjson);

const preview = await workbook.render({ sheetName: 'Items', range: 'A1:U12', scale: 1, format: 'png' });
await fs.writeFile(path.join(dir, 'clover-inventory-update-label-prices.preview.png'), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outPath);

const updates = updateRows.filter((row) => row[cloverIdIndex]).length;
const creates = updateRows.length - updates;
console.log(`Saved ${outPath}`);
console.log(`RetroLootPro rows with Clover IDs for update: ${updates}`);
console.log(`RetroLootPro rows without Clover IDs for create: ${creates}`);
