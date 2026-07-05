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
  inventoryId?: string;
};

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

function labelTextStyle(title: string, price: string): CSSProperties {
  const titleLength = title.length;
  const priceLength = price.length;
  const titleSize = titleLength <= 12 ? 12 : titleLength <= 22 ? 10 : titleLength <= 34 ? 8.5 : titleLength <= 48 ? 7.4 : 6.6;
  const priceSize = priceLength <= 5 ? 20 : priceLength <= 6 ? 17 : priceLength <= 7 ? 14.5 : 12.5;

  return {
    '--label-title-size': `${titleSize}px`,
    '--label-price-size': `${priceSize}px`,
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

async function renderLabelJpeg(label: PrintableLabel) {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create label print job');
  await waitForPressStartFont();

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const safe = 32;
  const logo = await loadImage(LOGO_SRC);
  ctx.drawImage(logo, safe + 8, 38, 210, 210);

  const titleLength = label.title.length;
  const titleSize = titleLength <= 12 ? 31 : titleLength <= 22 ? 26 : titleLength <= 34 ? 22 : titleLength <= 48 ? 18 : 16;
  const priceLength = label.price.length;
  const priceSize = priceLength <= 5 ? 64 : priceLength <= 6 ? 54 : priceLength <= 7 ? 45 : 38;
  const textX = 245;
  const textRight = canvas.width - safe - 18;
  const textWidth = textRight - textX;

  ctx.fillStyle = '#000';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `${titleSize}px ${LABEL_FONT_FAMILY}`;
  const lines = wrapCanvasText(ctx, label.title, textWidth, 4);
  lines.forEach((line, index) => {
    ctx.fillText(line, textRight, 38 + index * Math.round(titleSize * 1.35));
  });

  ctx.textBaseline = 'alphabetic';
  ctx.font = `${priceSize}px ${LABEL_FONT_FAMILY}`;
  ctx.fillText(label.price, textRight, canvas.height - safe - 12);

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

async function buildLabelPdf(labels: PrintableLabel[]) {
  const images = await Promise.all(labels.map(renderLabelJpeg));
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
      `<< /Type /XObject /Subtype /Image /Width 600 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
      imageBytes,
      '\nendstream',
    ]);
    const content = `q\n144 0 0 72 0 0 cm\n/Im${index} Do\nQ\n`;
    const contentId = addObject([`<< /Length ${content.length} >>\nstream\n${content}endstream`]);
    const pageId = addObject([
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 144 72] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
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

function LabelMarkup({ label, fontClassName }: { label: PrintableLabel; fontClassName: string }) {
  return (
    <div className={`price-label ${fontClassName}`} style={labelTextStyle(label.title, label.price)}>
      <div className="price-label-logo">
        <img src={LOGO_SRC} alt="Pixel & Page" />
      </div>
      <div className="price-label-copy">
        <div className="price-label-name">{label.title}</div>
        <div className="price-label-price">{label.price}</div>
      </div>
    </div>
  );
}

export function LabelPrintClient({ fontClassName }: { fontClassName: string }) {
  const { user, accountId } = useAuth();
  const searchParams = useSearchParams();
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
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
      .select('id, product_name, console, purchase_price, sell_price, selected_market_value, price_loose, price_cib, price_new, price_graded')
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
      const blob = await buildLabelPdf(labels);
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
  }, []);

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
    }]);
    setManualOpen(false);
    setManualName('');
    setManualPrice('');
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
              2 x 1 inch labels with logo left, item name and price right.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
                <LabelMarkup label={label} fontClassName={fontClassName} />
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
            size: 2in 1in;
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
            width: 2in;
            height: 1in;
            display: grid;
            grid-template-columns: 40% 60%;
            align-items: center;
            overflow: hidden;
            background: white;
            color: black;
            border: 0.01in solid transparent;
            box-sizing: border-box;
          }

          .price-label-logo {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.035in;
            box-sizing: border-box;
          }

          .price-label-logo img {
            width: 0.77in;
            height: 0.77in;
            object-fit: contain;
            display: block;
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
              size: 2in 1in;
              margin: 0;
            }

            html,
            body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
              width: 2in !important;
              min-width: 2in !important;
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
              width: 2in !important;
              max-width: 2in !important;
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
              width: 2in !important;
              height: 1in !important;
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
              width: 2in !important;
              height: 1in !important;
              border: 0.01in solid transparent !important;
            }
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}
