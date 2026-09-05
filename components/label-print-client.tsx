'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DashboardLayout } from '@/components/dashboard-layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { inventoryLabelPrice } from '@/lib/label-pricing';
import { toast } from 'sonner';

const LABEL_QUEUE_KEY = 'retroloot-label-queue';
const LOGO_SRC = '/labels/pixel-page-logo.png';
const LABEL_FONT_FAMILY = '"Press Start 2P", monospace';

type LabelItem = {
  id: string;
  product_name: string;
  console?: string | null;
  barcode?: string | null;
  sku?: string | null;
  purchase_price?: number | null;
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
};

type PrintableLabel = {
  id: string;
  title: string;
  price: string;
  barcode: string;
  inventoryId?: string;
};

type LabelSizeKey = '1x2' | '1x4';

const LABEL_SIZES: Record<LabelSizeKey, {
  label: string;
  widthIn: number;
  heightIn: number;
  canvasWidth: number;
  canvasHeight: number;
}> = {
  '1x2': {
    label: '1 x 2',
    widthIn: 2,
    heightIn: 1,
    canvasWidth: 600,
    canvasHeight: 300,
  },
  '1x4': {
    label: '1 x 4',
    widthIn: 4,
    heightIn: 1,
    canvasWidth: 1200,
    canvasHeight: 300,
  },
};

const CODE_128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100',
  '10011001000', '10011000100', '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110',
  '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010',
  '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110',
  '11101011000', '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', '10010110000',
  '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010',
  '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110',
  '11110101110', '11010000100', '11010010000', '11010011100', '1100011101011',
];

function readQueue() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LABEL_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeQueue(ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LABEL_QUEUE_KEY, JSON.stringify(Array.from(new Set(ids))));
  window.dispatchEvent(new CustomEvent('retroloot-label-queue-change'));
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function labelTitle(item: LabelItem) {
  const productName = item.product_name?.trim();
  const consoleName = item.console?.trim();

  if (productName && consoleName && productName.toLowerCase() !== consoleName.toLowerCase()) {
    return `${productName} - ${consoleName}`;
  }

  return productName || consoleName || 'Inventory Item';
}

function labelTextStyle(title: string, price: string, labelSize: LabelSizeKey): CSSProperties {
  const titleLength = title.length;
  const priceLength = price.length;
  const titleSize = labelSize === '1x4'
    ? titleLength <= 22 ? 13 : titleLength <= 38 ? 11 : titleLength <= 58 ? 9.5 : 8
    : titleLength <= 12 ? 11 : titleLength <= 22 ? 9 : titleLength <= 34 ? 7.8 : titleLength <= 48 ? 6.8 : 6.2;
  const priceSize = labelSize === '1x4'
    ? priceLength <= 5 ? 20 : priceLength <= 6 ? 18 : priceLength <= 7 ? 16 : 14
    : priceLength <= 5 ? 18 : priceLength <= 6 ? 15.5 : priceLength <= 7 ? 13 : 11.5;

  return {
    '--label-title-size': `${titleSize}px`,
    '--label-price-size': `${priceSize}px`,
    '--label-width': `${LABEL_SIZES[labelSize].widthIn}in`,
    '--label-height': `${LABEL_SIZES[labelSize].heightIn}in`,
  } as CSSProperties;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load label logo'));
    image.src = src;
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length > 0 ? lines : [text.slice(0, 24)];
}

async function waitForPressStartFont() {
  if (typeof document === 'undefined') return;
  try {
    await document.fonts?.load(`16px ${LABEL_FONT_FAMILY}`);
    await document.fonts?.ready;
  } catch {
    // Fall back to monospace if the browser cannot report font readiness.
  }
}

function code128Modules(value: string) {
  const sanitizedValue = value.trim().replace(/[^\x20-\x7e]/g, '').slice(0, 48);
  const encodedValue = sanitizedValue || 'RLP-MANUAL';
  const codes = [104, ...Array.from(encodedValue, (character) => character.charCodeAt(0) - 32)];
  const checksum = codes[0] + codes.slice(1).reduce((sum, code, index) => sum + code * (index + 1), 0);
  return [...codes, checksum % 103, 106].map((code) => CODE_128_PATTERNS[code]).join('');
}

function drawBarcode(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number) {
  const modules = code128Modules(value);
  const moduleWidth = width / modules.length;
  ctx.fillStyle = '#000';
  Array.from(modules).forEach((bit, index) => {
    if (bit === '1') ctx.fillRect(x + index * moduleWidth, y, Math.max(moduleWidth, 1), height);
  });
}

async function renderLabelJpeg(label: PrintableLabel, labelSize: LabelSizeKey) {
  const size = LABEL_SIZES[labelSize];
  const canvas = document.createElement('canvas');
  canvas.width = size.canvasWidth;
  canvas.height = size.canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create label print job');
  await waitForPressStartFont();

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const safe = 32;
  const logo = await loadImage(LOGO_SRC);
  const logoSize = labelSize === '1x4' ? 180 : 148;
  ctx.drawImage(logo, safe, (canvas.height - logoSize) / 2, logoSize, logoSize);

  const titleLength = label.title.length;
  let titleSize = labelSize === '1x4'
    ? titleLength <= 22 ? 38 : titleLength <= 38 ? 32 : titleLength <= 58 ? 26 : 22
    : titleLength <= 12 ? 26 : titleLength <= 22 ? 21 : titleLength <= 34 ? 17 : titleLength <= 48 ? 14 : 12;
  const priceLength = label.price.length;
  const priceSize = labelSize === '1x4'
    ? priceLength <= 5 ? 50 : priceLength <= 6 ? 44 : priceLength <= 7 ? 38 : 32
    : priceLength <= 5 ? 46 : priceLength <= 6 ? 38 : priceLength <= 7 ? 32 : 27;
  const textX = labelSize === '1x4' ? 250 : 205;
  const textRight = canvas.width - safe - 18;
  const barcodeHeight = labelSize === '1x4' ? 70 : 54;
  const barcodeTop = canvas.height - safe - barcodeHeight - 24;
  const textWidth = labelSize === '1x4'
    ? textRight - textX
    : textRight - textX;
  const textLeft = labelSize === '1x4' ? textX : textRight - textWidth;

  ctx.fillStyle = '#000';
  ctx.textAlign = labelSize === '1x4' ? 'left' : 'right';
  ctx.textBaseline = 'top';
  ctx.font = `${titleSize}px ${LABEL_FONT_FAMILY}`;
  if (labelSize === '1x4') {
    while (ctx.measureText(label.title).width > textWidth && titleSize > 18) {
      titleSize -= 2;
      ctx.font = `${titleSize}px ${LABEL_FONT_FAMILY}`;
    }
  }
  const lines = wrapCanvasText(ctx, label.title, textWidth, labelSize === '1x4' ? 2 : 2);
  const titleLineHeight = Math.round(titleSize * 1.35);
  lines.forEach((line, index) => {
    ctx.fillText(line, labelSize === '1x4' ? textLeft : textRight, 34 + index * titleLineHeight);
  });

  ctx.textBaseline = 'top';
  ctx.font = `${priceSize}px ${LABEL_FONT_FAMILY}`;
  const titleBottom = 34 + lines.length * titleLineHeight;
  const priceTop = labelSize === '1x4'
    ? canvas.height - safe - priceSize
    : 88;
  ctx.fillText(label.price, labelSize === '1x4' ? textLeft : textRight, priceTop);

  const barcodeLeft = labelSize === '1x4' ? Math.floor(canvas.width * 0.58) : textX;
  const barcodeWidth = textRight - barcodeLeft;
  drawBarcode(ctx, label.barcode, barcodeLeft, barcodeTop, barcodeWidth, barcodeHeight);
  ctx.font = `${labelSize === '1x4' ? 18 : 13}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label.barcode, barcodeLeft + barcodeWidth / 2, barcodeTop + barcodeHeight + 7);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function base64ToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function stringBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatPdfParts(parts: Array<string | Uint8Array>) {
  const encoded = parts.map((part) => typeof part === 'string' ? stringBytes(part) : part);
  const total = encoded.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of encoded) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function buildLabelPdf(labels: PrintableLabel[], labelSize: LabelSizeKey) {
  const size = LABEL_SIZES[labelSize];
  const images = await Promise.all(labels.map((label) => renderLabelJpeg(label, labelSize)));
  const parts: Array<string | Uint8Array> = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets: number[] = [0];
  let byteLength = stringBytes(parts[0] as string).length;
  const pageObjectIds: number[] = [];
  let objectId = 1;

  const addObject = (body: Array<string | Uint8Array>) => {
    const id = objectId;
    objectId += 1;
    offsets[id] = byteLength;
    const objectParts: Array<string | Uint8Array> = [`${id} 0 obj\n`, ...body, '\nendobj\n'];
    parts.push(...objectParts);
    byteLength += objectParts.reduce((sum, part) => sum + (typeof part === 'string' ? stringBytes(part).length : part.length), 0);
    return id;
  };

  const catalogId = addObject(['<< /Type /Catalog /Pages 2 0 R >>']);
  const pagesId = 2;
  objectId = 3;

  images.forEach((dataUrl, index) => {
    const imageBytes = base64ToBytes(dataUrl);
    const imageId = addObject([
      `<< /Type /XObject /Subtype /Image /Width ${size.canvasWidth} /Height ${size.canvasHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
      imageBytes,
      '\nendstream',
    ]);
    const pageWidth = size.widthIn * 72;
    const pageHeight = size.heightIn * 72;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im${index} Do\nQ\n`;
    const contentId = addObject([`<< /Length ${content.length} >>\nstream\n${content}endstream`]);
    const pageId = addObject([
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ]);
    pageObjectIds.push(pageId);
  });

  offsets[pagesId] = byteLength;
  const pagesObject = `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`;
  parts.push(pagesObject);
  byteLength += stringBytes(pagesObject).length;

  const xrefOffset = byteLength;
  const objectCount = objectId;
  const xref = [
    `xref\n0 ${objectCount}\n`,
    '0000000000 65535 f \n',
    ...Array.from({ length: objectCount - 1 }, (_, index) => `${String(offsets[index + 1] || 0).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objectCount} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  parts.push(xref);

  return new Blob([concatPdfParts(parts)], { type: 'application/pdf' });
}

async function waitForLabelAssets() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    await document.fonts?.ready;
  } catch {
    // If the browser does not expose font readiness, keep printing.
  }

  await new Promise<void>((resolve) => {
    const image = new Image();
    const done = () => resolve();
    image.onload = done;
    image.onerror = done;
    image.src = LOGO_SRC;
    if (image.complete) resolve();
    window.setTimeout(done, 1200);
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function LabelMarkup({ label, fontClassName, labelSize }: { label: PrintableLabel; fontClassName: string; labelSize: LabelSizeKey }) {
  return (
    <div className={`price-label price-label-${labelSize} ${fontClassName}`} style={labelTextStyle(label.title, label.price, labelSize)}>
      <div className="price-label-logo">
        <img src={LOGO_SRC} alt="Pixel & Page" />
      </div>
      <div className="price-label-copy">
        <div className="price-label-name">{label.title}</div>
        <div className="price-label-price">{label.price}</div>
      </div>
      <div className="price-label-barcode" aria-label={`Barcode ${label.barcode}`}>
        <BarcodeSvg value={label.barcode} />
        <span>{label.barcode}</span>
      </div>
    </div>
  );
}

function BarcodeSvg({ value }: { value: string }) {
  const modules = code128Modules(value);

  return (
    <svg viewBox={`0 0 ${modules.length} 40`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from(modules).map((bit, index) => (
        bit === '1' ? <rect key={index} x={index} y="0" width="1" height="40" fill="currentColor" /> : null
      ))}
    </svg>
  );
}

export function LabelPrintClient({ fontClassName }: { fontClassName: string }) {
  const { user, accountId } = useAuth();
  const searchParams = useSearchParams();
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [labelSize, setLabelSize] = useState<LabelSizeKey>('1x2');
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [printingLabels, setPrintingLabels] = useState(false);
  const autoPrintStartedRef = useRef(false);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const queryIds = useMemo(() => (
    searchParams.get('ids')?.split(',').map((id) => id.trim()).filter(Boolean) || []
  ), [searchParams]);
  const autoPrintRequested = searchParams.get('autoprint') === '1';
  const activeIds = queryIds.length > 0 ? queryIds : queueIds;
  const printableLabels: PrintableLabel[] = useMemo(() => items.map((item) => ({
    id: item.id,
    inventoryId: item.id,
    title: labelTitle(item),
    price: money(inventoryLabelPrice(item)),
    barcode: item.barcode?.trim() || item.sku?.trim() || item.id,
  })), [items]);

  useEffect(() => {
    const syncQueue = () => setQueueIds(readQueue());
    syncQueue();
    window.addEventListener('storage', syncQueue);
    window.addEventListener('retroloot-label-queue-change', syncQueue);
    return () => {
      window.removeEventListener('storage', syncQueue);
      window.removeEventListener('retroloot-label-queue-change', syncQueue);
    };
  }, []);

  const loadItems = useCallback(async () => {
    if (!user || !accountId) return;
    if (activeIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, product_name, console, barcode, sku, purchase_price, sell_price, selected_market_value, price_loose, price_cib, price_new, price_graded')
      .eq('user_id', accountId)
      .in('id', activeIds);

    if (error) {
      toast.error(error.message || 'Failed to load labels');
      setItems([]);
      setLoading(false);
      return;
    }

    const byId = new Map((data || []).map((item) => [item.id, item as LabelItem]));
    setItems(activeIds.map((id) => byId.get(id)).filter(Boolean) as LabelItem[]);
    setLoading(false);
  }, [accountId, activeIds, user]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (searchParams.get('manual') === '1') {
      setManualOpen(true);
    }
  }, [searchParams]);

  const removeItem = (id: string) => {
    if (queryIds.length > 0) {
      setItems((current) => current.filter((item) => item.id !== id));
      return;
    }
    writeQueue(queueIds.filter((queueId) => queueId !== id));
  };

  const clearQueue = () => {
    writeQueue([]);
    setItems([]);
  };

  const startBrowserPrint = useCallback(async (labels: PrintableLabel[]) => {
    if (labels.length === 0) {
      toast.info('No labels queued');
      return;
    }

    setPrintingLabels(true);
    let url = '';
    try {
      await waitForLabelAssets();
      const blob = await buildLabelPdf(labels, labelSize);
      url = URL.createObjectURL(blob);
      const frame = printFrameRef.current;

      if (!frame) {
        window.open(url, '_blank', 'noopener,noreferrer');
        toast.info('Label print job opened in a new tab');
        return;
      }

      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        frame.onload = finish;
        frame.src = url;
        window.setTimeout(finish, 1500);
      });

      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(url, '_blank', 'noopener,noreferrer');
          toast.info('Label print job opened in a new tab');
        }
      }, 150);

      window.setTimeout(() => {
        if (url) URL.revokeObjectURL(url);
      }, 60000);
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      toast.error(error instanceof Error ? error.message : 'Could not create label print job');
    } finally {
      window.setTimeout(() => setPrintingLabels(false), 1000);
    }
  }, [labelSize]);

  const printLabels = () => {
    startBrowserPrint(printableLabels);
  };

  const printManualLabel = () => {
    const title = manualName.trim();
    const price = Number(manualPrice);
    if (!title) {
      toast.error('Enter a label name');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error('Enter a valid label price');
      return;
    }

    startBrowserPrint([{
      id: `manual-${Date.now()}`,
      title,
      price: money(price),
      barcode: manualBarcode.trim() || `RLP-${Date.now()}`,
    }]);
    setManualOpen(false);
    setManualName('');
    setManualPrice('');
    setManualBarcode('');
  };

  useEffect(() => {
    if (!autoPrintRequested || autoPrintStartedRef.current || loading || printableLabels.length === 0) return;
    let cancelled = false;
    autoPrintStartedRef.current = true;

    const printWhenReady = async () => {
      await waitForLabelAssets();
      if (!cancelled) startBrowserPrint(printableLabels);
    };

    printWhenReady();
    return () => { cancelled = true; };
  }, [autoPrintRequested, loading, printableLabels, startBrowserPrint]);

  return (
    <DashboardLayout>
      <div className="label-screen min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
        <iframe
          ref={printFrameRef}
          title="Label PDF Print Frame"
          aria-hidden="true"
          style={{ position: 'fixed', right: 0, bottom: 0, width: 1, height: 1, border: 0, opacity: 0, pointerEvents: 'none' }}
        />
        <img className="label-logo-preload label-controls" src={LOGO_SRC} alt="" aria-hidden="true" />
        <div className="label-controls mx-auto mb-6 flex max-w-5xl flex-col gap-3 rounded-xl border border-border/50 bg-card p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Link href="/inventory" className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Inventory
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Print Labels</h1>
            <p className="text-sm text-muted-foreground">
              Choose 1 x 2 or 1 x 4 inch labels before printing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-background p-1">
              {(Object.keys(LABEL_SIZES) as LabelSizeKey[]).map((sizeKey) => (
                <Button
                  key={sizeKey}
                  type="button"
                  size="sm"
                  variant={labelSize === sizeKey ? 'default' : 'ghost'}
                  onClick={() => setLabelSize(sizeKey)}
                  aria-pressed={labelSize === sizeKey}
                >
                  {LABEL_SIZES[sizeKey].label}
                </Button>
              ))}
            </div>
            <Button variant="outline" onClick={() => setManualOpen(true)}>
              Manual Label
            </Button>
            {queryIds.length === 0 && (
              <Button variant="outline" onClick={clearQueue} disabled={queueIds.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Queue
              </Button>
            )}
            <Button onClick={printLabels} disabled={items.length === 0 || printingLabels}>
              <Printer className="mr-2 h-4 w-4" />
              {printingLabels ? 'Preparing...' : `Print ${items.length || ''}`}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mx-auto max-w-5xl rounded-xl border border-border/50 bg-card p-8 text-center text-muted-foreground">
            Loading labels...
          </div>
        ) : printableLabels.length === 0 ? (
          <div className="mx-auto max-w-5xl rounded-xl border border-dashed border-border/60 bg-card/50 p-8 text-center">
            <p className="font-semibold">No labels queued</p>
            <p className="mt-1 text-sm text-muted-foreground">Select items in Inventory, then choose Print Labels or Add to Label Queue.</p>
          </div>
        ) : (
          <div className="label-sheet mx-auto flex max-w-5xl flex-wrap gap-4">
            {printableLabels.map((label, index) => {
              const title = label.title;
              const price = label.price;
              return (
              <div key={`${label.id}-${index}`} className="label-card-wrap">
                {label.inventoryId && (
                  <button
                    type="button"
                    className="label-remove label-controls"
                    onClick={() => removeItem(label.inventoryId!)}
                    aria-label={`Remove ${label.title}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <LabelMarkup label={label} fontClassName={fontClassName} labelSize={labelSize} />
              </div>
              );
            })}
          </div>
        )}

        <Dialog open={manualOpen} onOpenChange={setManualOpen}>
          <DialogContent className="label-controls">
            <DialogHeader>
              <DialogTitle>Manual Label</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="manual-label-name">Name</Label>
                <Input
                  id="manual-label-name"
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="Xbox 360 Fat AC Adapter"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manual-label-price">Price</Label>
                <Input
                  id="manual-label-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.target.value)}
                  placeholder="49.99"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manual-label-barcode">Barcode / SKU</Label>
                <Input
                  id="manual-label-barcode"
                  value={manualBarcode}
                  onChange={(event) => setManualBarcode(event.target.value)}
                  placeholder="012345678905"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
              <Button onClick={printManualLabel} disabled={printingLabels}>
                <Printer className="mr-2 h-4 w-4" />
                {printingLabels ? 'Preparing...' : 'Print Label'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

          @page {
            size: ${LABEL_SIZES[labelSize].widthIn}in ${LABEL_SIZES[labelSize].heightIn}in;
            margin: 0;
          }

          .press-start-label-font {
            font-family: 'Press Start 2P', monospace;
          }

          .label-logo-preload {
            position: absolute;
            height: 1px;
            width: 1px;
            opacity: 0;
            pointer-events: none;
          }

          .price-label {
            width: var(--label-width);
            height: var(--label-height);
            display: grid;
            grid-template-columns: 34% 66%;
            grid-template-rows: 1fr 0.3in;
            align-items: center;
            overflow: hidden;
            background: white;
            color: black;
            border: 0.01in solid transparent;
            box-sizing: border-box;
          }

          .price-label-1x4 {
            position: relative;
            grid-template-columns: 18% 82%;
            grid-template-rows: 1fr;
          }

          .price-label-logo {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            grid-row: 1 / span 2;
            padding: 0.04in;
            box-sizing: border-box;
          }

          .price-label-1x4 .price-label-logo {
            grid-row: auto;
          }

          .price-label-logo img {
            width: 0.56in;
            height: 0.56in;
            object-fit: contain;
            display: block;
          }

          .price-label-1x4 .price-label-logo img {
            width: 0.62in;
            height: 0.62in;
          }

          .price-label-copy {
            height: 100%;
            display: grid;
            grid-template-rows: 1fr auto;
            align-items: stretch;
            min-width: 0;
            padding: 0.075in 0.075in 0.06in 0.015in;
            text-align: right;
            box-sizing: border-box;
          }

          .price-label-1x4 .price-label-copy {
            grid-column: 2 / 3;
            padding: 0.09in 0.08in 0.09in 0.04in;
            text-align: left;
          }

          .price-label-name {
            width: 100%;
            max-width: 100%;
            margin-left: auto;
            font-size: var(--label-title-size, 8px);
            line-height: 1.35;
            overflow-wrap: anywhere;
            word-break: break-word;
            overflow: hidden;
            text-align: right;
            align-self: start;
          }

          .price-label-1x4 .price-label-name {
            text-align: left;
            overflow-wrap: normal;
            word-break: normal;
            white-space: nowrap;
          }

          .price-label-price {
            width: 100%;
            max-width: 100%;
            margin-left: auto;
            font-size: var(--label-price-size, 16px);
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-align: right;
            align-self: end;
          }

          .price-label-1x4 .price-label-price {
            text-align: left;
          }

          .price-label-barcode {
            min-width: 0;
            padding: 0 0.075in 0.045in 0.015in;
            text-align: center;
            box-sizing: border-box;
          }

          .price-label-1x4 .price-label-barcode {
            position: absolute;
            right: 0.08in;
            bottom: 0.06in;
            width: 1.55in;
            padding: 0;
          }

          .price-label-barcode svg {
            display: block;
            width: 100%;
            height: 0.19in;
            color: black;
          }

          .price-label-1x4 .price-label-barcode svg {
            height: 0.42in;
          }

          .price-label-barcode span {
            display: block;
            margin-top: 0.025in;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: Arial, sans-serif;
            font-size: 0.07in;
            font-weight: 700;
            line-height: 1;
          }

          .label-card-wrap {
            position: relative;
            padding: 0.12in;
            border-radius: 8px;
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
          }

          .label-remove {
            position: absolute;
            right: -8px;
            top: -8px;
            z-index: 2;
            display: flex;
            height: 24px;
            width: 24px;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            border: 1px solid hsl(var(--border));
            background: hsl(var(--background));
            color: hsl(var(--foreground));
          }

          @media print {
            @page {
              size: ${LABEL_SIZES[labelSize].widthIn}in ${LABEL_SIZES[labelSize].heightIn}in;
              margin: 0;
            }

            html,
            body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
              width: var(--label-width) !important;
              min-width: var(--label-width) !important;
              height: auto !important;
              overflow: hidden !important;
            }

            .label-screen {
              width: auto !important;
              min-height: auto !important;
              padding: 0 !important;
              margin: 0 !important;
              background: white !important;
            }

            .label-controls,
            aside,
            nav,
            .fixed,
            [href='/pos'],
            iframe {
              display: none !important;
            }

            body * {
              visibility: hidden !important;
            }

            .label-sheet,
            .label-sheet *,
            .price-label,
            .price-label * {
              visibility: visible !important;
            }

            .label-sheet {
              display: block !important;
              width: var(--label-width) !important;
              max-width: var(--label-width) !important;
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
            }

            .label-sheet {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
            }

            .label-card-wrap {
              width: var(--label-width) !important;
              height: var(--label-height) !important;
              margin: 0 !important;
              padding: 0 !important;
              border: 0 !important;
              border-radius: 0 !important;
              background: white !important;
              overflow: hidden !important;
              break-inside: avoid;
              page-break-inside: avoid;
              break-after: page;
              page-break-after: always;
            }

            .label-card-wrap:last-child {
              break-after: auto;
              page-break-after: auto;
            }

            .price-label {
              width: var(--label-width) !important;
              height: var(--label-height) !important;
              border: 0.01in solid transparent !important;
            }
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}
