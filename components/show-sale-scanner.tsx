'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Barcode, CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/supabase';

const ACTIVE_STATUSES = ['available', 'ready_to_list', 'listed', 'reserved'];

const SALE_CHANNELS = [
  { value: 'whatnot', label: 'Whatnot' },
  { value: 'ebay', label: 'eBay' },
  { value: 'store', label: 'Store' },
  { value: 'shopify', label: 'Shopify' },
] as const;

type SaleChannel = (typeof SALE_CHANNELS)[number]['value'];

type ScannedItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  barcode: string | null;
  sku: string | null;
  status: string;
  sell_price: number | null;
  sold_at: string | null;
  sold_via: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
};

type ShowSaleScannerProps = {
  accountId: string;
  showId: string;
  showName: string;
  showItemIds: string[];
  onSaleComplete: () => void;
};

export function ShowSaleScanner({
  accountId,
  showId,
  showName,
  showItemIds,
  onSaleComplete,
}: ShowSaleScannerProps) {
  const scanInputRef = useRef<HTMLInputElement>(null);
  const soldCheckboxRef = useRef<HTMLButtonElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const scannerBufferRef = useRef('');
  const scannerStartedAtRef = useRef(0);
  const scannerLastKeyAtRef = useRef(0);
  const lookupSequenceRef = useRef(0);
  const lookupRef = useRef<(code: string) => void>(() => undefined);
  const [scanCode, setScanCode] = useState('');
  const [item, setItem] = useState<ScannedItem | null>(null);
  const [markedSold, setMarkedSold] = useState(false);
  const [channel, setChannel] = useState<SaleChannel | ''>('');
  const [price, setPrice] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  const armScanner = useCallback(() => {
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  }, []);

  const clearSale = useCallback(() => {
    setScanCode('');
    setItem(null);
    setMarkedSold(false);
    setChannel('');
    setPrice('');
    scannerBufferRef.current = '';
    armScanner();
  }, [armScanner]);

  const lookupItem = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || saving) return;

    const lookupSequence = ++lookupSequenceRef.current;
    setLookingUp(true);
    setScanCode(code);
    setItem(null);
    setMarkedSold(false);
    setChannel('');
    setPrice('');

    try {
      const fields = 'id, product_name, console, condition, barcode, sku, status, sell_price, sold_at, sold_via, image_url, thumbnail_url';
      let { data, error } = await supabase
        .from('inventory_items')
        .select(fields)
        .eq('user_id', accountId)
        .eq('barcode', code)
        .in('status', ACTIVE_STATUSES)
        .limit(20);

      if (error) throw error;

      if (!data?.length) {
        const skuResult = await supabase
          .from('inventory_items')
          .select(fields)
          .eq('user_id', accountId)
          .eq('sku', code)
          .in('status', ACTIVE_STATUSES)
          .limit(20);
        if (skuResult.error) throw skuResult.error;
        data = skuResult.data;
      }

      if (lookupSequence !== lookupSequenceRef.current) return;

      const matches = (data || []) as ScannedItem[];
      const match = matches.find((candidate) => showItemIds.includes(candidate.id)) || matches[0];
      if (!match) {
        toast.error(`No active inventory item found for ${code}`);
        armScanner();
        return;
      }

      setItem(match);
      window.setTimeout(() => soldCheckboxRef.current?.focus(), 0);
    } catch (error: any) {
      if (lookupSequence !== lookupSequenceRef.current) return;
      toast.error(error.message || 'Could not look up that item');
      armScanner();
    } finally {
      if (lookupSequence === lookupSequenceRef.current) setLookingUp(false);
    }
  }, [accountId, armScanner, saving, showItemIds]);

  useEffect(() => {
    lookupRef.current = (code: string) => void lookupItem(code);
  }, [lookupItem]);

  useEffect(() => {
    armScanner();

    const handleScannerKeys = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

      const now = performance.now();
      if (event.key === 'Enter') {
        const bufferedCode = scannerBufferRef.current;
        const duration = now - scannerStartedAtRef.current;
        const wasHardwareScan = bufferedCode.length >= 8 && duration <= Math.max(700, bufferedCode.length * 80);
        scannerBufferRef.current = '';

        if (wasHardwareScan) {
          event.preventDefault();
          event.stopPropagation();
          lookupRef.current(bufferedCode);
        }
        return;
      }

      if (event.key.length !== 1) return;
      if (now - scannerLastKeyAtRef.current > 120) {
        scannerBufferRef.current = '';
        scannerStartedAtRef.current = now;
      }
      scannerBufferRef.current += event.key;
      scannerLastKeyAtRef.current = now;
    };

    window.addEventListener('keydown', handleScannerKeys, true);
    return () => window.removeEventListener('keydown', handleScannerKeys, true);
  }, [armScanner]);

  const handleMarkedSold = (checked: boolean) => {
    setMarkedSold(checked);
    if (!checked) return;
    window.setTimeout(() => {
      const firstChannel = document.querySelector<HTMLButtonElement>('[data-show-sale-channel="whatnot"]');
      firstChannel?.focus();
    }, 0);
  };

  const handleChannelChange = (value: string) => {
    setChannel(value as SaleChannel);
    window.setTimeout(() => priceInputRef.current?.focus(), 0);
  };

  const completeSale = async () => {
    if (!item || !markedSold || !channel || saving) return;
    const salePrice = Number(price);
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      toast.error('Enter a valid sale price');
      priceInputRef.current?.focus();
      return;
    }

    setSaving(true);
    const soldAt = new Date().toISOString();
    const channelLabel = SALE_CHANNELS.find((option) => option.value === channel)?.label || channel;

    try {
      const { data: updatedItem, error: updateError } = await supabase
        .from('inventory_items')
        .update({
          status: 'sold',
          sell_price: salePrice,
          sold_at: soldAt,
          sold_via: channel,
          updated_at: soldAt,
        })
        .eq('id', item.id)
        .eq('user_id', accountId)
        .in('status', ACTIVE_STATUSES)
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedItem) throw new Error('This item is no longer in active inventory');

      const financeSource = channel === 'whatnot' ? 'whatnot' : channel === 'ebay' ? 'ebay' : 'show';
      const { error: financeError } = await supabase.from('financial_transactions').insert({
        user_id: accountId,
        date: soldAt.slice(0, 10),
        description: `Sale: ${item.product_name}${item.console ? ` - ${item.console}` : ''}`,
        amount: salePrice,
        type: 'income',
        category: `Sales - ${channelLabel}`,
        source: financeSource,
        platform: channel,
        reference_id: `inv_sale_${item.id}`,
        merchant_name: channelLabel,
        notes: `Recorded from ${showName} continuous scan station (${showId})`,
        is_reconciled: false,
      });

      if (financeError) {
        await supabase
          .from('inventory_items')
          .update({
            status: item.status,
            sell_price: item.sell_price,
            sold_at: item.sold_at,
            sold_via: item.sold_via,
          })
          .eq('id', item.id)
          .eq('user_id', accountId);
        throw financeError;
      }

      toast.success(`${item.product_name} sold for $${salePrice.toFixed(2)}`);
      clearSale();
      onSaleComplete();
    } catch (error: any) {
      toast.error(error.message || 'Could not complete the sale');
      priceInputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-y border-border/60 bg-card/40 px-4 py-5 sm:px-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ScanLine className="h-4 w-4 text-primary" />
            Continuous Sale Scanner
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scanner ready. A new barcode replaces the current unsaved item.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Ready
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (item) void completeSale();
          else void lookupItem(scanCode);
        }}
        className="space-y-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="show-sale-barcode">Barcode or SKU</Label>
          <div className="relative">
            <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={scanInputRef}
              id="show-sale-barcode"
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              placeholder="Scan now"
              autoComplete="off"
              className="h-11 pl-10 font-mono"
              disabled={lookingUp || saving}
            />
            {lookingUp && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" />}
          </div>
        </div>

        {item ? (
          <div className="space-y-5">
            <div className="flex min-h-20 items-center gap-4 border-l-2 border-primary bg-secondary/25 px-4 py-3">
              {(item.thumbnail_url || item.image_url) ? (
                <img
                  src={item.thumbnail_url || item.image_url || ''}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-secondary">
                  <Barcode className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{item.product_name}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {[item.console, item.condition].filter(Boolean).join(' - ')}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {showItemIds.includes(item.id) ? 'In this show' : 'Active inventory'}
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
              <Checkbox
                ref={soldCheckboxRef}
                checked={markedSold}
                onCheckedChange={(checked) => handleMarkedSold(checked === true)}
                className="h-5 w-5"
              />
              Mark this item sold
            </label>

            <fieldset disabled={!markedSold || saving} className="space-y-2 disabled:opacity-45">
              <legend className="text-sm font-medium">Sold on</legend>
              <RadioGroup
                value={channel}
                onValueChange={handleChannelChange}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {SALE_CHANNELS.map((option) => (
                  <Label
                    key={option.value}
                    htmlFor={`sale-channel-${option.value}`}
                    className="flex h-10 cursor-pointer items-center gap-2 border border-border/70 px-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10"
                  >
                    <RadioGroupItem
                      id={`sale-channel-${option.value}`}
                      value={option.value}
                      data-show-sale-channel={option.value}
                    />
                    {option.label}
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="show-sale-price">Sale price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    ref={priceInputRef}
                    id="show-sale-price"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    disabled={!markedSold || !channel || saving}
                    className="h-11 pl-7 text-base"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="h-11 min-w-28"
                disabled={!markedSold || !channel || price === '' || saving}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Sold
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center border border-dashed border-border/70 text-sm text-muted-foreground">
            Scan an inventory label to begin
          </div>
        )}
      </form>
    </section>
  );
}
