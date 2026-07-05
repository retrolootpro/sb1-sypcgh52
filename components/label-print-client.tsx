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
const LABEL_PRINT_JOB_KEY = 'retroloot-label-print-job';
const LOGO_SRC = '/labels/pixel-page-logo.png';

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

function readPrintJob() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(LABEL_PRINT_JOB_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePrintJob(labels: PrintableLabel[]) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(LABEL_PRINT_JOB_KEY, JSON.stringify(labels));
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

async function waitForLabelAssets() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    await document.fonts?.ready;
  } catch {
    // Ignore when unsupported.
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

function LabelStyles() {
  return (
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
        width: 1.9in;
        height: 0.9in;
        margin: 0.05in;
        display: grid;
        grid-template-columns: 40% 60%;
        align-items: center;
        overflow: hidden;
        background: white;
        color: black;
        border: 0.003in solid transparent;
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
        padding: 0.07in 0.055in 0.055in 0.015in;
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

      .label-sheet-print {
        width: 2in;
        margin: 0;
        padding: 0;
      }

      .label-sheet-print .label-card-wrap {
        width: 2in;
        height: 1in;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: white;
        overflow: hidden;
        break-inside: avoid;
        page-break-inside: avoid;
        break-after: page;
        page-break-after: always;
      }

      .label-sheet-print .label-card-wrap:last-child {
        break-after: auto;
        page-break-after: auto;
      }

      @media print {
        html,
        body {
          width: 2in !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          overflow: hidden !important;
        }

        .label-screen-print {
          width: 2in !important;
          min-height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }

        .label-screen {
          width: auto !important;
          min-height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }

        .label-controls,
        aside,
        nav,
        .fixed,
        [href='/pos'] {
          display: none !important;
        }

        body * {
          visibility: hidden !important;
        }

        .label-sheet-print,
        .label-sheet-print *,
        .price-label,
        .price-label * {
          visibility: visible !important;
        }

        .label-sheet-print {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
        }
      }
    `}</style>
  );
}

function LabelsMarkup({
  labels,
  fontClassName,
  printMode,
  onRemove,
}: {
  labels: PrintableLabel[];
  fontClassName: string;
  printMode: boolean;
  onRemove: (id: string) => void;
}) {
  if (labels.length === 0) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl border border-dashed border-border/60 bg-card/50 p-8 text-center">
        <p className="font-semibold">No labels queued</p>
        <p className="mt-1 text-sm text-muted-foreground">Select items in Inventory, then choose Print Labels or Add to Label Queue.</p>
      </div>
    );
  }

  return (
    <div className={printMode ? 'label-sheet-print' : 'label-sheet mx-auto flex max-w-5xl flex-wrap gap-4'}>
      {labels.map((label, index) => {
        const title = label.title;
        const price = label.price;
        return (
          <div key={`${label.id}-${index}`} className="label-card-wrap">
            {!printMode && label.inventoryId && (
              <button
                type="button"
                className="label-remove label-controls"
                onClick={() => onRemove(label.inventoryId!)}
                aria-label={`Remove ${label.title}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className={`price-label ${fontClassName}`} style={labelTextStyle(title, price)}>
              <div className="price-label-logo">
                <img src={LOGO_SRC} alt="Pixel & Page" />
              </div>
              <div className="price-label-copy">
                <div className="price-label-name">{title}</div>
                <div className="price-label-price">{price}</div>
              </div>
            </div>
          </div>
        );
      })}
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
  const [manualLabels, setManualLabels] = useState<PrintableLabel[]>([]);
  const autoPrintStartedRef = useRef(false);

  const queryIds = useMemo(() => (
    searchParams.get('ids')?.split(',').map((id) => id.trim()).filter(Boolean) || []
  ), [searchParams]);
  const autoPrintRequested = searchParams.get('autoprint') === '1';
  const printMode = searchParams.get('print') === '1';
  const manualJob = searchParams.get('manualJob') === '1';
  const activeIds = queryIds.length > 0 ? queryIds : queueIds;

  const itemLabels: PrintableLabel[] = items.map((item) => ({
    id: item.id,
    inventoryId: item.id,
    title: labelTitle(item),
    price: money(inventoryLabelPrice(item)),
  }));
  const printableLabels = manualLabels.length > 0 ? manualLabels : itemLabels;

  useEffect(() => {
    if (printMode) return;
    const syncQueue = () => setQueueIds(readQueue());
    syncQueue();
    window.addEventListener('storage', syncQueue);
    window.addEventListener('retroloot-label-queue-change', syncQueue);
    return () => {
      window.removeEventListener('storage', syncQueue);
      window.removeEventListener('retroloot-label-queue-change', syncQueue);
    };
  }, [printMode]);

  const loadItems = useCallback(async () => {
    if (manualJob) {
      setItems([]);
      setLoading(false);
      return;
    }
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
  }, [accountId, activeIds, manualJob, user]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (searchParams.get('manual') === '1' && !printMode) {
      setManualOpen(true);
    }
  }, [printMode, searchParams]);

  useEffect(() => {
    if (!manualJob) {
      setManualLabels([]);
      return;
    }
    setManualLabels(readPrintJob() as PrintableLabel[]);
  }, [manualJob]);

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

  const openPrintRoute = useCallback((labels?: PrintableLabel[]) => {
    if (labels && labels.length > 0) {
      writePrintJob(labels);
      window.location.assign('/labels?print=1&manualJob=1');
      return;
    }

    const ids = activeIds.length > 0 ? activeIds : queueIds;
    if (ids.length === 0) {
      toast.info('No labels queued');
      return;
    }
    window.location.assign(`/labels?ids=${encodeURIComponent(ids.join(','))}&print=1`);
  }, [activeIds, queueIds]);

  const printLabels = () => {
    openPrintRoute();
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

    openPrintRoute([{
      id: `manual-${Date.now()}`,
      title,
      price: money(price),
    }]);
    setManualOpen(false);
    setManualName('');
    setManualPrice('');
  };

  useEffect(() => {
    if (!printMode || !autoPrintRequested || autoPrintStartedRef.current || loading || printableLabels.length === 0) return;
    let cancelled = false;
    autoPrintStartedRef.current = true;

    const printWhenReady = async () => {
      await waitForLabelAssets();
      if (!cancelled) window.print();
    };

    printWhenReady();
    return () => { cancelled = true; };
  }, [autoPrintRequested, loading, printableLabels, printMode]);

  const pageBody = (
    <div className={printMode ? 'label-screen-print' : 'label-screen min-h-screen bg-background px-4 py-6 text-foreground sm:px-8'}>
      <LabelStyles />
      <img className="label-logo-preload label-controls" src={LOGO_SRC} alt="" aria-hidden="true" />

      {printMode && (
        <div className="label-controls mx-auto mb-3 flex max-w-5xl flex-col gap-2 rounded-xl border border-border/50 bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Ready to print labels</div>
            <div className="text-muted-foreground">In Chrome on Mac, press Cmd + Option + P to open the system dialog, then choose 2x1 paper.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/labels">Back</Link>
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Browser Print
            </Button>
          </div>
        </div>
      )}

      {!printMode && (
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
            <Button onClick={printLabels} disabled={itemLabels.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Print {itemLabels.length || ''}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mx-auto max-w-5xl rounded-xl border border-border/50 bg-card p-8 text-center text-muted-foreground">
          Loading labels...
        </div>
      ) : (
        <LabelsMarkup labels={printableLabels} fontClassName={fontClassName} printMode={printMode} onRemove={removeItem} />
      )}

      {!printMode && (
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
              <Button onClick={printManualLabel}>
                <Printer className="mr-2 h-4 w-4" />
                Print Label
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );

  if (printMode) return pageBody;
  return <DashboardLayout>{pageBody}</DashboardLayout>;
}
