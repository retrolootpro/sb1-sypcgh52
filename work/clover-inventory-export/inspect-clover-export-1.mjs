import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const input = await FileBlob.load('C:/Users/JoshuaPhillips/OneDrive - MMI/Downloads/inventory-export-v2 (1).xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const overview = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 8000, tableMaxRows: 8, tableMaxCols: 24 });
console.log(overview.ndjson);
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  const vals = used.values;
  console.log('SHEET', sheet.name, 'ROWS', vals.length, 'COLS', vals[0]?.length || 0);
  console.log(JSON.stringify(vals.slice(0, 5)));
}
