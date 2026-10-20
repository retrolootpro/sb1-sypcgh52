'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BarChart3, Camera, CheckCircle2, CircleAlert, CreditCard, DollarSign, PackageCheck, ScanLine, ShoppingBag, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { lookupUPC } from '@/lib/api-services';
import { supabase } from '@/lib/supabase';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';

export type QuickScanState =
  | {
      source: 'inventory';
      id: string;
      barcode: string;
      title: string;
      purchasePrice: number;
      askingPrice: number;
      status: string;
      soldAt?: string | null;
      sellPrice?: number | null;
    }
  | {
      source: 'lookup';
      barcode: string;
      title: string;
      productImage?: string | null;
      brand?: string | null;
      category?: string | null;
    }
  | {
      source: 'not_found';
      barcode: string;
      title: string;
    };

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0);
}

export function ShowFloorScanner() {
  const { user } = useAuth();
  const [scannerActive, setScannerActive] = useState(false);
  const [activeItem, setActiveItem] = useState<QuickScanState | null>(null);
  const [askingPrice, setAskingPrice] = useState('0');
  const [recentSold, setRecentSold] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSoldList = useCallback(async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, barcode, product_name, purchase_price, sell_price, sold_at, status')
      .eq('user_id', user.id)
      .eq('status', 'sold')
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: false })
      .limit(12);

    if (!error) {
      setRecentSold(data || []);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadSoldList();
    }
  }, [loadSoldList, user]);

  const handleScan = useCallback(async (rawBarcode: string) => {
    const normalized = rawBarcode.replace(/\D/g, '').slice(0, 18);
    if (!normalized || !user) return;

    setLoading(true);
    try {
      const { data: inventoryItem, error } = await supabase
        .from('inventory_items')
        .select('id, barcode, product_name, purchase_price, sell_price, status, sold_at')
        .eq('user_id', user.id)
        .eq('barcode', normalized)
        .maybeSingle();

      if (!error && inventoryItem) {
        const asking = Number(inventoryItem.sell_price || inventoryItem.purchase_price || 0);
        setActiveItem({
          source: 'inventory',
          id: inventoryItem.id,
          barcode: inventoryItem.barcode,
          title: inventoryItem.product_name,
          purchasePrice: Number(inventoryItem.purchase_price || 0),
          askingPrice: asking,
          status: inventoryItem.status || 'available',
          soldAt: inventoryItem.sold_at,
          sellPrice: inventoryItem.sell_price,
        });
        setAskingPrice(String(asking));
        return;
      }

      const lookup = await lookupUPC(normalized, user.id);
      if (lookup?.title) {
        setActiveItem({
          source: 'lookup',
          barcode: normalized,
          title: lookup.title,
          productImage: lookup.imageUrl || null,
          brand: lookup.brand || null,
          category: lookup.category || null,
        });
        setAskingPrice('0');
        return;
      }

      setActiveItem({
        source: 'not_found',
        barcode: normalized,
        title: `Barcode ${normalized} is not in your inventory`,
      });
      setAskingPrice('0');
    } catch (error) {
      console.error('Quick show scan failed', error);
      setActiveItem({
        source: 'not_found',
        barcode: normalized,
        title: `Barcode ${normalized} is not in your inventory`,
      });
      setAskingPrice('0');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const markSold = useCallback(async () => {
    if (!activeItem || activeItem.source !== 'inventory' || !user) return;

    const salePrice = Number(askingPrice) || 0;
    const soldAt = new Date().toISOString();

    const { error } = await supabase
      .from('inventory_items')
      .update({
        status: 'sold',
        sell_price: salePrice,
        sold_at: soldAt,
        updated_at: soldAt,
      })
      .eq('id', activeItem.id)
      .eq('user_id', user.id);

    if (error) {
      toast.error('Could not mark sold');
      return;
    }

    toast.success(`${activeItem.title} marked sold`);
    setActiveItem(null);
    setAskingPrice('0');
    loadSoldList();
  }, [activeItem, askingPrice, loadSoldList, user]);

  const addToInventory = useCallback(async () => {
    if (!activeItem || !user) return;

    if (activeItem.source !== 'lookup' && activeItem.source !== 'not_found') return;

    const productName = activeItem.title.replace(/^Barcode\s+\d+\s+is\s+not\s+in\s+your\s+inventory$/, 'Unknown Item');

    const { error } = await supabase.from('inventory_items').insert({
      user_id: user.id,
      product_name: productName,
      console: 'Unknown',
      condition: 'CIB',
      purchase_price: 0,
      quantity: 1,
      barcode: activeItem.barcode,
      status: 'available',
      notes: activeItem.source === 'lookup' ? `Added from quick scan for ${activeItem.barcode}` : `Added from quick scan after missing inventory lookup`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      toast.error('Could not add item to inventory');
      return;
    }

    toast.success('Item added to inventory');
    setActiveItem(null);
    setAskingPrice('0');
  }, [activeItem, user]);

  const quickStatus = useMemo(() => {
    if (activeItem?.source === 'inventory') return 'In inventory';
    if (activeItem?.source === 'lookup') return 'Barcode lookup response';
    if (activeItem?.source === 'not_found') return 'Not in inventory';
    return 'Ready';
  }, [activeItem]);

  return (
    <div className="rounded-xl border border-border/40 bg-card p-5 space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-primary" />
          <span className="font-semibold text-[14px] tracking-tight">Quick Show Floor Scanner</span>
        </div>
        <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
          {quickStatus}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3 rounded-lg border border-border/40 bg-secondary/20 p-3">
          <div className="flex gap-2">
            <Button
              onClick={() => setScannerActive((value) => !value)}
              className="flex-1 h-10"
              variant={scannerActive ? 'destructive' : 'default'}
            >
              <Camera className="mr-2 h-4 w-4" />
              {scannerActive ? 'Stop Scan' : 'Start Scan'}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                setActiveItem(null);
                setAskingPrice('0');
              }}
            >
              Clear
            </Button>
          </div>

          {scannerActive && (
            <div className="overflow-hidden rounded-lg border border-primary/20">
              <BarcodeScannerView
                isActive={scannerActive}
                onScan={(result) => {
                  setScannerActive(false);
                  handleScan(result.barcode);
                }}
                onStop={() => setScannerActive(false)}
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">Manual Barcode</div>
            <div className="flex gap-2">
              <Input
                placeholder="scan or type UPC"
                className="h-10"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const target = event.currentTarget.value.trim();
                    if (target) {
                      handleScan(target);
                    }
                  }
                }}
              />
              <Button className="h-10" onClick={() => {
                const input = document.querySelector<HTMLInputElement>('input[placeholder="scan or type UPC"]');
                if (input?.value) {
                  handleScan(input.value);
                }
              }}>
                Lookup
              </Button>
            </div>
          </div>

          {loading && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              Looking up item...
            </div>
          )}

          {activeItem && (
            <div className="rounded-lg border border-border/40 bg-background/50 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Current Item</div>
                  <div className="mt-1 font-semibold text-sm leading-snug">{activeItem.title}</div>
                </div>
                {activeItem.source === 'inventory' && activeItem.status === 'sold' ? (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Sold</Badge>
                ) : activeItem.source === 'not_found' ? (
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">Missing</Badge>
                ) : (
                  <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30">Found</Badge>
                )}
              </div>

              {activeItem.source === 'inventory' && (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md border border-border/40 bg-secondary/20 p-2">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Paid</div>
                      <div className="mt-1 font-semibold">{formatMoney(activeItem.purchasePrice)}</div>
                    </div>
                    <div className="rounded-md border border-border/40 bg-secondary/20 p-2">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Asking</div>
                      <div className="mt-1 font-semibold">{formatMoney(activeItem.askingPrice)}</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] text-muted-foreground">Ask price</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={askingPrice}
                        onChange={(event) => setAskingPrice(event.target.value.replace(/[^0-9.]/g, ''))}
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button className="flex-1 h-9" onClick={markSold}>
                      <PackageCheck className="mr-2 h-4 w-4" />
                      Mark Sold
                    </Button>
                    <Button variant="outline" className="h-9" onClick={() => setActiveItem(null)}>
                      Skip
                    </Button>
                  </div>
                </>
              )}

              {activeItem.source === 'lookup' && (
                <>
                  <div className="rounded-md border border-border/40 bg-secondary/20 p-2 text-sm text-muted-foreground">
                    {activeItem.brand ? `${activeItem.brand} • ` : ''}
                    {activeItem.category || 'Product'}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] text-muted-foreground">Asking price</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={askingPrice}
                        onChange={(event) => setAskingPrice(event.target.value.replace(/[^0-9.]/g, ''))}
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button className="flex-1 h-9" onClick={addToInventory}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add to Inventory
                    </Button>
                    <Button variant="outline" className="h-9" onClick={() => setActiveItem(null)}>
                      Next Item
                    </Button>
                  </div>
                </>
              )}

              {activeItem.source === 'not_found' && (
                <>
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-sm text-amber-200">
                    This barcode was not found in your current inventory.
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] text-muted-foreground">Asking price</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={askingPrice}
                        onChange={(event) => setAskingPrice(event.target.value.replace(/[^0-9.]/g, ''))}
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button className="flex-1 h-9" onClick={addToInventory}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add to Inventory
                    </Button>
                    <Button variant="outline" className="h-9" onClick={() => setActiveItem(null)}>
                      Next Item
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border/40 bg-secondary/20 p-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-primary" />
            <span className="font-semibold text-[14px]">Sold This Show</span>
          </div>

          {recentSold.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 bg-background/40 p-5 text-center text-sm text-muted-foreground">
              No sold items yet.
            </div>
          ) : (
            <div className="space-y-2">
              {recentSold.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.product_name}</div>
                    <div className="text-[11px] text-muted-foreground">{item.barcode}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatMoney(Number(item.sell_price || 0))}</div>
                    <div className="text-[10px] text-muted-foreground">{item.sold_at ? new Date(item.sold_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Sold'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlusCircle(props: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
