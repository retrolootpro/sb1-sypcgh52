'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DashboardLayout } from '@/components/dashboard-layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

const LABEL_QUEUE_KEY = 'retroloot-label-queue';
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

function labelPrice(item: LabelItem) {
  return Number(item.sell_price)
    || Number(item.selected_market_value)
    || Number(item.price_cib)
    || Number(item.price_loose)
    || Number(item.price_new)
    || Number(item.purchase_price)
    || 0;
}

function retailLabelPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.floor(value);
  const cents = value - whole;
  if (cents < 0.5) {
    return Math.max(0, whole - 0.01);
  }
  return Math.max(0, whole + 1 - 0.01);
}

function labelTitle(item: LabelItem) {
  return item.product_name || item.console || 'Inventory Item';
}

export function LabelPrintClient({ fontClassName }: { fontClassName: string }) {
  const { user, accountId } = useAuth();
  const searchParams = useSearchParams();
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const queryIds = useMemo(() => (
    searchParams.get('ids')?.split(',').map((id) => id.trim()).filter(Boolean) || []
  ), [searchParams]);
  const activeIds = queryIds.length > 0 ? queryIds : queueIds;

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

  const printLabels = () => {
    if (items.length === 0) {
      toast.info('No labels queued');
      return;
    }
    window.print();
  };

  return (
    <DashboardLayout>
      <div className="label-screen min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
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
            {queryIds.length === 0 && (
              <Button variant="outline" onClick={clearQueue} disabled={queueIds.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Queue
              </Button>
            )}
            <Button onClick={printLabels} disabled={items.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Print {items.length || ''}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mx-auto max-w-5xl rounded-xl border border-border/50 bg-card p-8 text-center text-muted-foreground">
            Loading labels...
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-5xl rounded-xl border border-dashed border-border/60 bg-card/50 p-8 text-center">
            <p className="font-semibold">No labels queued</p>
            <p className="mt-1 text-sm text-muted-foreground">Select items in Inventory, then choose Print Labels or Add to Label Queue.</p>
          </div>
        ) : (
          <div className="label-sheet mx-auto flex max-w-5xl flex-wrap gap-4">
            {items.map((item) => (
              <div key={item.id} className="label-card-wrap">
                <button
                  type="button"
                  className="label-remove label-controls"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.product_name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className={`price-label ${fontClassName}`}>
                  <div className="price-label-logo">
                    <img src={LOGO_SRC} alt="Pixel & Page" />
                  </div>
                  <div className="price-label-copy">
                    <div className="price-label-name">{labelTitle(item)}</div>
                    <div className="price-label-price">{money(retailLabelPrice(labelPrice(item)))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

          @page {
            size: 2in 1in;
            margin: 0;
          }

          .press-start-label-font {
            font-family: 'Press Start 2P', monospace;
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
            border: 1px solid #111;
            box-sizing: border-box;
          }

          .price-label-logo {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.07in;
            box-sizing: border-box;
          }

          .price-label-logo img {
            width: 0.76in;
            height: 0.76in;
            object-fit: contain;
            display: block;
          }

          .price-label-copy {
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: flex-end;
            gap: 0.07in;
            padding: 0.08in 0.09in 0.08in 0.02in;
            text-align: right;
            box-sizing: border-box;
          }

          .price-label-name {
            max-width: 100%;
            font-size: clamp(8px, 0.115in, 11px);
            line-height: 1.28;
            overflow-wrap: anywhere;
          }

          .price-label-price {
            max-width: 100%;
            font-size: clamp(17px, 0.28in, 27px);
            line-height: 1;
            white-space: nowrap;
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
            html,
            body {
              width: 2in;
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
            }

            .label-screen {
              min-height: auto !important;
              padding: 0 !important;
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

            main,
            .label-sheet {
              display: block !important;
              width: 2in !important;
              max-width: 2in !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .label-card-wrap {
              width: 2in !important;
              height: 1in !important;
              margin: 0 !important;
              padding: 0 !important;
              border: 0 !important;
              border-radius: 0 !important;
              background: white !important;
              break-after: page;
              page-break-after: always;
            }

            .price-label {
              border: 0 !important;
            }
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}
