import { Buffer } from 'buffer';
import { inflateRawSync } from 'zlib';

export type InventoryExportItem = {
  id: string;
  product_name: string | null;
  console?: string | null;
  condition?: string | null;
  barcode?: string | null;
  sku?: string | null;
  description?: string | null;
  quantity?: number | null;
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_cib?: number | null;
  price_loose?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  purchase_price?: number | null;
  status?: string | null;
  category?: string | null;
  item_type?: string | null;
};

export const CLOVER_ITEM_HEADERS = ['Name', 'Price', 'SKU', 'Code', 'Category', 'Taxable', 'Quantity'];

type CloverExistingItem = {
  cloverId: string;
  name?: string;
  description?: string;
  price?: string;
  sku: string;
  productCode: string;
  category?: string;
  quantity?: string;
};

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function money(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0.00';
  return numeric.toFixed(2);
}

function quantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '1';
  return String(Math.max(1, Math.floor(numeric)));
}

function firstPositiveMoney(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function retailLabelPrice(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const whole = Math.floor(numeric);
  const cents = numeric - whole;
  return cents < 0.5 ? Math.max(0, whole - 0.01) : Math.max(0, whole + 1 - 0.01);
}

function labelBasePrice(item: InventoryExportItem) {
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

function categoryFor(item: InventoryExportItem) {
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

function itemName(item: InventoryExportItem) {
  const title = String(item.product_name || 'Untitled Item').trim();
  const parts = [item.console, item.condition].map((part) => String(part || '').trim()).filter(Boolean);
  return parts.length ? `${title} (${parts.join(' - ')})` : title;
}

function skuFor(item: InventoryExportItem) {
  const barcodeSku = item.barcode?.trim();
  if (barcodeSku) return barcodeSku;
  const explicitSku = item.sku?.trim();
  if (explicitSku) return explicitSku;
  const id = String(item.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  return id ? `RLP-${id}` : '';
}

function normalizeMatchKey(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function buildCloverItemRows(items: InventoryExportItem[]) {
  return items
    .filter((item) => !['sold', 'shipped', 'returned', 'archived', 'deleted', 'dead stock', 'dead_stock'].includes(String(item.status || '').toLowerCase()))
    .map((item) => ({
      Name: itemName(item),
      Price: money(retailLabelPrice(labelBasePrice(item))),
      SKU: skuFor(item),
      Code: item.barcode || '',
      Category: categoryFor(item),
      Taxable: 'TRUE',
      Quantity: quantity(item.quantity),
    }));
}

export function writeCsv(headers: string[], rows: Record<string, unknown>[]) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\r\n');
}

function columnIndex(ref: string) {
  const letters = ref.replace(/[0-9]/g, '');
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, index - 1);
}

function columnName(index: number) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function worksheetXml(rows: unknown[][], numericColumns = new Set<string>()) {
  const header = rows[0] || [];
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      const headerName = String(header[columnIndex] || '');
      const numeric = rowIndex > 0 && numericColumns.has(headerName) && Number.isFinite(Number(value));
      if (numeric) return `<c r="${ref}"><v>${Number(value)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function workbookXml(sheetNames: string[]) {
  const sheets = sheetNames
    .map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount: number) {
  const rels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypesXml(sheetCount: number) {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets}
</Types>`;
}

function packageRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = crcTable[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzip(buffer: Buffer) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid Clover export workbook.');

  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const files = new Map<string, Buffer>();
  let offset = centralDirectoryOffset;

  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid Clover export workbook entry.');
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = compressionMethod === 0 ? compressed : inflateRawSync(compressed);
    files.set(fileName, data);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function parseSharedStrings(xml: string) {
  const values: string[] = [];
  const items = xml.match(/<si[\s\S]*?<\/si>/g) || [];
  for (const item of items) {
    const parts = Array.from(item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => xmlUnescape(match[1]));
    values.push(parts.join(''));
  }
  return values;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  const rowMatches = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) || [];
    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/\br="([^"]+)"/);
      if (!refMatch) continue;
      const typeMatch = cellXml.match(/\bt="([^"]+)"/);
      const type = typeMatch?.[1] || '';
      const index = columnIndex(refMatch[1]);
      let value = '';
      if (type === 'inlineStr') {
        const text = Array.from(cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => xmlUnescape(match[1])).join('');
        value = text;
      } else {
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const rawValue = valueMatch ? xmlUnescape(valueMatch[1]) : '';
        value = type === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
      }
      cells[index] = value;
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    rows.push(cells);
  }
  return rows;
}

function parseWorkbookSheetTargets(workbookXmlText: string, workbookRelsXmlText: string) {
  const rels = new Map<string, string>();
  for (const match of Array.from(workbookRelsXmlText.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g))) {
    rels.set(match[1], match[2]);
  }
  return Array.from(workbookXmlText.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)).map((match) => ({
    name: xmlUnescape(match[1]),
    target: rels.get(match[2]) || '',
  }));
}

export function parseCloverItemsFromWorkbook(buffer: Buffer) {
  const files = unzip(buffer);
  const workbookXmlText = files.get('xl/workbook.xml')?.toString('utf8');
  const workbookRelsXmlText = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbookXmlText || !workbookRelsXmlText) throw new Error('Could not read Clover workbook structure.');

  const sharedStrings = files.has('xl/sharedStrings.xml')
    ? parseSharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8'))
    : [];
  const sheets = parseWorkbookSheetTargets(workbookXmlText, workbookRelsXmlText);
  const itemsSheet = sheets.find((sheet) => sheet.name === 'Items');
  if (!itemsSheet?.target) throw new Error('The Clover export is missing the Items sheet.');

  const normalizedTarget = itemsSheet.target.replace(/^\.?\//, '');
  const sheetXmlText = files.get(`xl/${normalizedTarget}`)?.toString('utf8');
  if (!sheetXmlText) throw new Error('Could not read the Items sheet from the Clover export.');

  const rows = parseWorksheetRows(sheetXmlText, sharedStrings);
  const headers = rows[0] || [];
  const cloverIdIndex = headers.indexOf('Clover ID');
  const skuIndex = headers.indexOf('SKU');
  const productCodeIndex = headers.indexOf('Product Code');
  const categoryIndex = headers.indexOf('Categories');
  const nameIndex = headers.indexOf('Name');
  const descriptionIndex = headers.indexOf('Description');
  const priceIndex = headers.indexOf('Price');
  const quantityIndex = headers.indexOf('Quantity');

  if (cloverIdIndex < 0 || skuIndex < 0 || productCodeIndex < 0) {
    throw new Error('The Clover export is missing expected Items columns.');
  }

  const matches = new Map<string, CloverExistingItem>();
  for (const row of rows.slice(1)) {
    const cloverId = String(row[cloverIdIndex] || '').trim();
    if (!cloverId) continue;
    const item: CloverExistingItem = {
      cloverId,
      name: nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '',
      description: descriptionIndex >= 0 ? String(row[descriptionIndex] || '').trim() : '',
      price: priceIndex >= 0 ? String(row[priceIndex] || '').trim() : '',
      sku: String(row[skuIndex] || '').trim(),
      productCode: String(row[productCodeIndex] || '').trim(),
      category: categoryIndex >= 0 ? String(row[categoryIndex] || '').trim() : '',
      quantity: quantityIndex >= 0 ? String(row[quantityIndex] || '').trim() : '',
    };
    const keys = [normalizeMatchKey(item.sku), normalizeMatchKey(item.productCode)].filter(Boolean);
    for (const key of keys) {
      if (!matches.has(key)) matches.set(key, item);
    }
  }

  return matches;
}

export function parseCloverWorkbookRows(buffer: Buffer) {
  const files = unzip(buffer);
  const workbookXmlText = files.get('xl/workbook.xml')?.toString('utf8');
  const workbookRelsXmlText = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbookXmlText || !workbookRelsXmlText) throw new Error('Could not read Clover workbook structure.');

  const sharedStrings = files.has('xl/sharedStrings.xml')
    ? parseSharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8'))
    : [];
  const sheets = parseWorkbookSheetTargets(workbookXmlText, workbookRelsXmlText);
  const itemsSheet = sheets.find((sheet) => sheet.name === 'Items');
  if (!itemsSheet?.target) throw new Error('The Clover export is missing the Items sheet.');

  const normalizedTarget = itemsSheet.target.replace(/^\.?\//, '');
  const sheetXmlText = files.get(`xl/${normalizedTarget}`)?.toString('utf8');
  if (!sheetXmlText) throw new Error('Could not read the Items sheet from the Clover export.');

  const rows = parseWorksheetRows(sheetXmlText, sharedStrings);
  const headers = rows[0] || [];
  const nameIndex = headers.indexOf('Name');
  const descriptionIndex = headers.indexOf('Description');
  const priceIndex = headers.indexOf('Price');
  const cloverIdIndex = headers.indexOf('Clover ID');
  const skuIndex = headers.indexOf('SKU');
  const productCodeIndex = headers.indexOf('Product Code');
  const categoryIndex = headers.indexOf('Categories');
  const quantityIndex = headers.indexOf('Quantity');

  if (cloverIdIndex < 0 || skuIndex < 0 || productCodeIndex < 0) {
    throw new Error('The Clover export is missing expected Items columns.');
  }

  return rows.slice(1).map((row) => ({
    cloverId: String(row[cloverIdIndex] || '').trim(),
    name: nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '',
    description: descriptionIndex >= 0 ? String(row[descriptionIndex] || '').trim() : '',
    price: priceIndex >= 0 ? String(row[priceIndex] || '').trim() : '',
    sku: String(row[skuIndex] || '').trim(),
    productCode: String(row[productCodeIndex] || '').trim(),
    category: categoryIndex >= 0 ? String(row[categoryIndex] || '').trim() : '',
    quantity: quantityIndex >= 0 ? String(row[quantityIndex] || '').trim() : '',
  }));
}

function buildCloverWorkbookBundle(rows: Array<{
  cloverId?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  code?: unknown;
  sku?: unknown;
  quantity?: unknown;
  category?: unknown;
}>) {
  const categories = Array.from(new Set(rows.map((row) => String(row.category || '')).filter(Boolean))).sort();
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
    '',
  ];
  const modifierHeaders = [
    'Modifier Group ID',
    'Modifier Group Name',
    'Pop up Automatically?',
    'Modifier',
    'Price',
    'Required Quantity',
    'Max Quantity',
  ];
  const categoryHeaders = ['Category ID', 'Category Name', 'Subcategory Name', 'Item Sort Order'];
  const taxHeaders = ['Tax Rate ID', 'Name', 'Tax Rate', 'Tax Amount', 'Default?'];
  const sheets = [
    {
      name: 'Items',
      rows: [
        itemHeaders,
        ...rows.map((row) => [
          row.cloverId || '',
          row.name || '',
          '',
          row.description || '',
          Number(row.price) || '',
          Number(row.price) ? 'Fixed' : 'Variable',
          '',
          '',
          row.code || '',
          row.sku || '',
          Number(row.quantity) || 1,
          'No',
          'Yes',
          'No',
          '',
          '',
          row.category || '',
          '',
          '',
          '',
          '',
        ]),
      ],
      numericColumns: new Set(['Price', 'Quantity', 'Cost']),
    },
    { name: 'Modifier Groups', rows: [modifierHeaders], numericColumns: new Set(['Price', 'Required Quantity', 'Max Quantity']) },
    { name: 'Categories', rows: [categoryHeaders, ...categories.map((name) => ['', name, '', ''])], numericColumns: new Set<string>() },
    { name: 'Tax Rates', rows: [taxHeaders], numericColumns: new Set(['Tax Rate', 'Tax Amount']) },
  ];

  return zip([
    { name: '[Content_Types].xml', data: contentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: packageRelsXml() },
    { name: 'xl/workbook.xml', data: workbookXml(sheets.map((sheet) => sheet.name)) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(sheets.length) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: worksheetXml(sheet.rows, sheet.numericColumns),
    })),
  ]);
}

function zip(files: { name: string; data: string | Buffer }[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function buildCloverWorkbook(rows: Record<string, unknown>[]) {
  return buildCloverWorkbookBundle(rows.map((row) => ({
    name: row.Name,
    description: '',
    price: row.Price,
    code: row.Code,
    sku: row.SKU,
    quantity: row.Quantity,
    category: row.Category,
  })));
}

export function buildCloverNewItemsWorkbook(rows: Record<string, unknown>[], existingItems: Map<string, CloverExistingItem>) {
  const newRows = rows.filter((row) => {
    const skuKey = normalizeMatchKey(row.SKU);
    const codeKey = normalizeMatchKey(row.Code);
    return !existingItems.has(skuKey) && !existingItems.has(codeKey);
  });

  if (newRows.length === 0) {
    throw new Error('Every RetroLoot inventory item already exists in the Clover export by SKU or barcode.');
  }

  return {
    created: newRows.length,
    skipped: rows.length - newRows.length,
    total: rows.length,
    workbook: buildCloverWorkbookBundle(newRows.map((row) => ({
      name: row.Name,
      description: '',
      price: row.Price,
      code: row.Code,
      sku: row.SKU,
      quantity: row.Quantity,
      category: row.Category || row.ExistingCategory,
    }))),
  };
}

export function buildCloverRepairWorkbook(rows: Record<string, unknown>[], existingRows: CloverExistingItem[]) {
  const retroByKey = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    const keys = [normalizeMatchKey(row.SKU), normalizeMatchKey(row.Code)].filter(Boolean);
    for (const key of keys) {
      if (!retroByKey.has(key)) retroByKey.set(key, row);
    }
  });

  const repairRows = existingRows
    .map((row) => {
      const match = retroByKey.get(normalizeMatchKey(row.sku)) || retroByKey.get(normalizeMatchKey(row.productCode));
      if (!match) return null;

      const nextSku = String(row.sku || '').trim() || String(match.SKU || '').trim();
      const nextCode = String(row.productCode || '').trim() || String(match.Code || '').trim();
      const changedSku = !String(row.sku || '').trim() && Boolean(String(match.SKU || '').trim());
      const changedCode = !String(row.productCode || '').trim() && Boolean(String(match.Code || '').trim());

      if (!changedSku && !changedCode) return null;

      return {
        cloverId: row.cloverId,
        name: row.name || match.Name || '',
        description: row.description || '',
        price: row.price || match.Price || '',
        code: nextCode,
        sku: nextSku,
        quantity: row.quantity || match.Quantity || 1,
        category: row.category || match.Category || '',
      };
    })
    .filter(Boolean) as Array<{
    cloverId: string;
    name: unknown;
    description: unknown;
    price: unknown;
    code: unknown;
    sku: unknown;
    quantity: unknown;
    category: unknown;
  }>;

  if (repairRows.length === 0) {
    throw new Error('No matched Clover items are missing SKU or Product Code values that RetroLoot can fill.');
  }

  return {
    repaired: repairRows.length,
    skipped: existingRows.length - repairRows.length,
    total: existingRows.length,
    workbook: buildCloverWorkbookBundle(repairRows),
  };
}
