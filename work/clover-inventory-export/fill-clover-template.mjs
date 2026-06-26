import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const templatePath = 'C:/Users/JoshuaPhillips/OneDrive - MMI/Downloads/inventory-export-v2.xlsx';
const basicCsvPath = path.join(dir, 'clover-basic-inventory-import.csv');
const referenceCsvPath = path.join(dir, 'retrolootpro-inventory-reference.csv');
const outPath = path.join(dir, 'clover-inventory-template-filled.xlsx');

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
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
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
    } else {
      value += char;
    }
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

function numberOrBlank(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

const basic = records(parseCsv(await fs.readFile(basicCsvPath, 'utf8')));
const reference = records(parseCsv(await fs.readFile(referenceCsvPath, 'utf8')));
const referenceBySku = new Map(reference.map((row) => [String(row['RetroLootPro ID'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase(), row]));

const input = await FileBlob.load(templatePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const itemsSheet = workbook.worksheets.getItem('Items');
const categoriesSheet = workbook.worksheets.getItem('Categories');
const modifierSheet = workbook.worksheets.getItem('Modifier Groups');
const taxSheet = workbook.worksheets.getItem('Tax Rates');

const itemHeaders = [
  'Clover ID',
  'Name',
  'Alternate Name',
  'Description',
  'Price',
  'Price Type',
  'Price Unit',
  'Cost',
  'Product Code',
  'SKU',
  'Quantity',
  'Hidden?',
  'Default tax rates?',
  'Non-revenue item?',
  'Printer Labels',
  'Modifier Groups',
  'Categories',
  'Tax Rates',
  'Variant Attribute',
  'Variant Option',
  null,
];

const itemRows = basic.map((row) => {
  const skuKey = String(row.SKU || '').replace(/^RLP-/, '');
  const ref = referenceBySku.get(skuKey) || {};
  const platform = ref.Platform ? String(ref.Platform) : '';
  const condition = ref.Condition ? String(ref.Condition) : '';
  const description = [platform, condition, ref.Status ? `Status: ${ref.Status}` : ''].filter(Boolean).join(' | ');
  const price = numberOrBlank(row.Price);
  return [
    '',
    row.Name || ref.Name || 'Untitled Item',
    '',
    description,
    price,
    price ? 'Fixed' : 'Variable',
    '',
    numberOrBlank(ref['Cost Basis']),
    row.Code || '',
    row.SKU || '',
    Number(row.Quantity) || 1,
    'No',
    'Yes',
    'No',
    '',
    '',
    row.Category || ref['Clover Category'] || 'RetroLootPro',
    '',
    '',
    '',
    '',
  ];
});

const categories = [...new Set(basic.map((row) => row.Category).filter(Boolean))].sort();
const categoryRows = [
  ['Category ID', 'Category Name', 'Subcategory Name', 'Item Sort Order'],
  ...categories.map((name) => ['', name, '', '']),
];

itemsSheet.getRange(`A1:U1000`).clear({ applyTo: 'contents' });
itemsSheet.getRangeByIndexes(0, 0, itemRows.length + 1, itemHeaders.length).values = [itemHeaders, ...itemRows];

modifierSheet.getRange('A1:G100').clear({ applyTo: 'contents' });
modifierSheet.getRange('A1:G1').values = [['Modifier Group ID', 'Modifier Group Name', 'Pop up Automatically?', 'Modifier', 'Price', 'Required Quantity', 'Max Quantity']];

categoriesSheet.getRange('A1:D100').clear({ applyTo: 'contents' });
categoriesSheet.getRangeByIndexes(0, 0, categoryRows.length, 4).values = categoryRows;

taxSheet.getRange('A1:E100').clear({ applyTo: 'contents' });
taxSheet.getRange('A1:E2').values = [
  ['Tax Rate ID', 'Name', 'Tax Rate', 'Tax Amount', 'Default?'],
  ['', 'Default Sales Tax', 0.065, '', 'Yes'],
];

itemsSheet.getRange(`E2:E${itemRows.length + 1}`).format.numberFormat = '$#,##0.00';
itemsSheet.getRange(`H2:H${itemRows.length + 1}`).format.numberFormat = '$#,##0.00';
itemsSheet.getRange(`K2:K${itemRows.length + 1}`).format.numberFormat = '#,##0';
taxSheet.getRange('C2:C2').format.numberFormat = '0.000%';

for (const sheetName of ['Items', 'Modifier Groups', 'Categories', 'Tax Rates']) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  used.format.autofitColumns();
  used.format.autofitRows();
}

const inspect = await workbook.inspect({
  kind: 'sheet,table',
  maxChars: 4000,
  tableMaxRows: 4,
  tableMaxCols: 24,
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
await fs.writeFile(path.join(dir, 'clover-inventory-template-filled.preview.png'), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outPath);
console.log(`Saved ${outPath}`);
