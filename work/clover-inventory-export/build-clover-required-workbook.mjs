import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const csvPath = path.join(dir, 'clover-basic-inventory-import.csv');
const outPath = path.join(dir, 'clover-inventory-four-sheet-import.xlsx');

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

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
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

function colName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function styleSheet(sheet, rowCount, colCount) {
  const lastCol = colName(colCount - 1);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const header = sheet.getRange(`A1:${lastCol}1`);
  header.format = {
    fill: '#111827',
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
  };
  header.format.rowHeight = 24;
  if (rowCount > 1) {
    const body = sheet.getRange(`A2:${lastCol}${rowCount}`);
    body.format.borders = {
      insideHorizontal: { style: 'thin', color: '#E5E7EB' },
      top: { style: 'thin', color: '#D1D5DB' },
    };
  }
  sheet.getRange(`A1:${lastCol}${Math.max(rowCount, 1)}`).format.autofitColumns();
}

const rows = parseCsv(await fs.readFile(csvPath, 'utf8'));
const headers = rows[0];
const dataRows = rows.slice(1);
const categoryIndex = headers.indexOf('Category');
const categories = [...new Set(dataRows.map((row) => row[categoryIndex]).filter(Boolean))].sort();

const workbook = Workbook.create();

const items = workbook.worksheets.add('Items');
items.getRangeByIndexes(0, 0, rows.length, headers.length).values = rows;
styleSheet(items, rows.length, headers.length);
items.getRange(`B2:B${rows.length}`).format.numberFormat = '$#,##0.00';
items.getRange(`G2:G${rows.length}`).format.numberFormat = '#,##0';

const modifierGroups = workbook.worksheets.add('Modifier Groups');
modifierGroups.getRange('A1:C1').values = [['Name', 'Modifier Name', 'Price']];
styleSheet(modifierGroups, 1, 3);

const categoriesSheet = workbook.worksheets.add('Categories');
categoriesSheet.getRangeByIndexes(0, 0, Math.max(categories.length + 1, 1), 1).values = [
  ['Name'],
  ...categories.map((name) => [name]),
];
styleSheet(categoriesSheet, categories.length + 1, 1);

const taxRates = workbook.worksheets.add('Tax Rates');
taxRates.getRange('A1:B1').values = [['Name', 'Rate']];
styleSheet(taxRates, 1, 2);

const itemTable = items.tables.add(`A1:${colName(headers.length - 1)}${rows.length}`, true, 'CloverItemsTable');
itemTable.style = 'TableStyleMedium2';
itemTable.showFilterButton = true;

const categoryTable = categoriesSheet.tables.add(`A1:A${categories.length + 1}`, true, 'CloverCategoriesTable');
categoryTable.style = 'TableStyleMedium2';
categoryTable.showFilterButton = true;

for (const sheetName of ['Items', 'Modifier Groups', 'Categories', 'Tax Rates']) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  used.format.autofitColumns();
  used.format.autofitRows();
}

const inspect = await workbook.inspect({
  kind: 'sheet',
  include: 'name',
  maxChars: 2000,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 50 },
  maxChars: 1000,
});
console.log(errors.ndjson);

const preview = await workbook.render({ sheetName: 'Items', range: `A1:G12`, scale: 1, format: 'png' });
await fs.writeFile(path.join(dir, 'clover-inventory-four-sheet-import.preview.png'), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outPath);
console.log(`Saved ${outPath}`);
