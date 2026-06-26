import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

const files = [
  { csv: 'clover-basic-inventory-import.csv', xlsx: 'clover-basic-inventory-import.xlsx', sheet: 'Clover Import' },
  { csv: 'retrolootpro-inventory-reference.csv', xlsx: 'retrolootpro-inventory-reference.xlsx', sheet: 'RLP Reference' },
  { csv: 'clover-review-needed.csv', xlsx: 'clover-review-needed.xlsx', sheet: 'Review Needed' },
];

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

async function convert({ csv, xlsx, sheet }) {
  const csvText = await fs.readFile(path.join(dir, csv), 'utf8');
  const workbook = await Workbook.fromCSV(csvText, { sheetName: sheet });
  const ws = workbook.worksheets.getItem(sheet);
  const used = ws.getUsedRange();
  const values = used.values;
  const rowCount = values.length;
  const colCount = values[0]?.length || 1;
  const lastCol = colName(colCount - 1);

  ws.showGridLines = false;
  ws.freezePanes.freezeRows(1);

  const header = ws.getRange(`A1:${lastCol}1`);
  header.format = {
    fill: '#111827',
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
  };
  header.format.rowHeight = 24;

  const body = ws.getRange(`A2:${lastCol}${Math.max(rowCount, 2)}`);
  body.format = {
    borders: {
      insideHorizontal: { style: 'thin', color: '#E5E7EB' },
      top: { style: 'thin', color: '#D1D5DB' },
    },
  };

  const headers = values[0] || [];
  for (let i = 0; i < headers.length; i++) {
    const name = String(headers[i] || '').toLowerCase();
    const col = colName(i);
    const range = ws.getRange(`${col}2:${col}${Math.max(rowCount, 2)}`);
    if (name.includes('price') || name.includes('cost') || name.includes('value')) {
      range.format.numberFormat = '$#,##0.00';
      range.format.horizontalAlignment = 'right';
    } else if (name.includes('quantity')) {
      range.format.numberFormat = '#,##0';
      range.format.horizontalAlignment = 'right';
    } else if (name === 'taxable') {
      range.format.horizontalAlignment = 'center';
    } else {
      range.format.horizontalAlignment = 'left';
    }
  }

  const table = ws.tables.add(`A1:${lastCol}${Math.max(rowCount, 1)}`, true, `${sheet.replace(/[^A-Za-z0-9]/g, '')}Table`);
  table.style = 'TableStyleMedium2';
  table.showFilterButton = true;

  used.format.autofitColumns();
  used.format.autofitRows();

  const summary = await workbook.inspect({
    kind: 'table',
    sheetId: sheet,
    range: `A1:${lastCol}${Math.min(rowCount, 8)}`,
    tableMaxRows: 8,
    tableMaxCols: Math.min(colCount, 12),
    maxChars: 3000,
  });
  console.log(summary.ndjson);

  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 50 },
    maxChars: 1000,
  });
  console.log(errors.ndjson);

  const preview = await workbook.render({ sheetName: sheet, range: `A1:${lastCol}${Math.min(rowCount, 12)}`, scale: 1, format: 'png' });
  await fs.writeFile(path.join(dir, xlsx.replace(/\.xlsx$/, '.preview.png')), new Uint8Array(await preview.arrayBuffer()));

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(path.join(dir, xlsx));
  console.log(`Saved ${xlsx}`);
}

for (const file of files) {
  await convert(file);
}
