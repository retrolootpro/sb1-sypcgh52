import { Buffer } from 'buffer';

export type InventoryExportItem = {
  id: string;
  product_name: string | null;
  console?: string | null;
  condition?: string | null;
  barcode?: string | null;
  sku?: string | null;
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
  const explicitSku = item.sku?.trim();
  if (explicitSku) return explicitSku;
  const id = String(item.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  return id ? `RLP-${id}` : '';
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
  const categories = Array.from(new Set(rows.map((row) => String(row.Category || '')).filter(Boolean))).sort();
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
          '',
          row.Name || '',
          '',
          '',
          Number(row.Price) || '',
          Number(row.Price) ? 'Fixed' : 'Variable',
          '',
          '',
          row.Code || '',
          row.SKU || '',
          Number(row.Quantity) || 1,
          'No',
          'Yes',
          'No',
          '',
          '',
          row.Category || '',
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
