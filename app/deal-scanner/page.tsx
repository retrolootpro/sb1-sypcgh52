'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { lookupUPC, type UPCLookupResult } from '@/lib/api-services';
import { getCanonicalPricing, sourceLabel, type CanonicalPricingResult } from '@/lib/pricing-service';
import { calculateSimpleDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { CONDITIONS, CONSOLES, REGIONS } from '@/lib/constants';
import { classifyItem, extractPlatform, normalizeTitle } from '@/lib/barcode-lookup';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Barcode,
  Camera,
  CircleAlert,
  DollarSign,
  Gamepad2,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

type DealLookup = {
  barcode: string;
  title: string;
  platform: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  pcProductId?: string;
  pricing: CanonicalPricingResult;
};

type LookupStatus = 'idle' | 'looking_up' | 'pricing' | 'ready' | 'error';

const conditionKeys: Record<string, 'loose' | 'cib' | 'new' | 'graded'> = {
  Loose: 'loose',
  Used: 'cib',
  CIB: 'cib',
  New: 'new',
  Sealed: 'new',
  Graded: 'graded',
  Damaged: 'loose',
  Untested: 'loose',
};

function money(value: number) {
  return value > 0 ? `$${value.toFixed(2)}` : '--';
}

function cleanBarcode(value: string) {
  return value.replace(/\D/g, '').slice(0, 18);
}

function recommendation(score: number, marketValue: number, askingPrice: number) {
  if (!marketValue || !askingPrice) {
    return {
      label: 'Price Needed',
      tone: 'border-white/10 bg-white/[0.04] text-white/75',
      body: 'Enter the asking price to calculate the deal.',
    };
  }
  if (score >= 70) {
    return {
      label: 'Buy',
      tone: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
      body: 'Strong spread against current market value.',
    };
  }
  if (score >= 45) {
    return {
      label: 'Watch',
      tone: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
      body: 'Potential deal, but the margin is thinner.',
    };
  }
  return {
    label: 'Pass',
    tone: 'border-red-500/35 bg-red-500/10 text-red-300',
    body: 'The spread is too tight for a clean buy.',
  };
}

export default function DealScannerPage() {
  const { user, accountId } = useAuth();
  const searchParams = useSearchParams();
  const embedded = searchParams.get('embedded') === '1';
  const [scannerActive, setScannerActive] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [titleQuery, setTitleQuery] = useState('');
  const [platformHint, setPlatformHint] = useState('Nintendo Switch');
  const [askingPrice, setAskingPrice] = useState('');
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>('CIB');
  const [region, setRegion] = useState('US');
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [deal, setDeal] = useState<DealLookup | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const recentScansRef = useRef<Set<string>>(new Set());

  const price = Number(askingPrice) || 0;
  const conditionPrice = deal?.pricing.prices[conditionKeys[condition]];
  const marketValue = deal
    ? getMarketValueByCondition(
        condition,
        deal.pricing.prices.loose.value,
        deal.pricing.prices.cib.value,
        deal.pricing.prices.new.value,
        deal.pricing.prices.graded.value
      )
    : 0;
  const profit = marketValue && price ? marketValue - price : 0;
  const margin = marketValue && price ? (profit / price) * 100 : 0;
  const dealScore = useMemo(
    () => calculateSimpleDealScore(price, marketValue, deal?.pricing.pcMatch ? 95 : 80),
    [price, marketValue, deal?.pricing.pcMatch]
  );
  const verdict = recommendation(dealScore.score, marketValue, price);

  const localLookupUPC = useCallback(async (code: string): Promise<(UPCLookupResult & { platform?: string; pcProductId?: string }) | null> => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.access_token) return null;

    const response = await fetch('/api/local-upc-lookup', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ barcode: code }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.message || 'Local UPC lookup failed');
    }

    return {
      barcode: code,
      title: data.title,
      brand: data.brand,
      category: data.category,
      imageUrl: data.imageUrl,
      thumbnailUrl: data.thumbnailUrl,
      platform: data.platform,
      pcProductId: data.pcProductId,
    };
  }, []);

  const lookupDeal = useCallback(async (rawBarcode = barcode) => {
    if (!user) return;
    const code = cleanBarcode(rawBarcode);
    if (!code) {
      toast.error('Enter or scan a UPC first');
      return;
    }

    setBarcode(code);
    setStatus('looking_up');
    setError('');
    setDeal(null);

    try {
      let product: (UPCLookupResult & { platform?: string; pcProductId?: string }) | null = null;

      if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        try {
          product = await localLookupUPC(code);
        } catch (localError) {
          console.warn('[Deal Scanner] Local UPC lookup failed, falling back to Supabase function:', localError);
        }
      }

      if (!product) {
      product = await lookupUPC(code, accountId || user.id);
      }

      if (!product?.title) throw new Error('No product found for this UPC');

      const platform = product.platform || extractPlatform(product.title) || 'Unknown';
      setStatus('pricing');

      const pricing = await getCanonicalPricing(product.title, platform, {
        upc: code,
        storedPcProductId: product.pcProductId ?? null,
        forceRefresh: true,
      });

      if (pricing.status === 'api_error') {
        throw new Error(pricing.error || 'Pricing lookup failed');
      }

      setDeal({
        barcode: code,
        title: pricing.pcMatch?.productName || product.title,
        platform: pricing.pcMatch?.platform || platform,
        brand: product.brand,
        category: product.category,
        imageUrl: product.imageUrl,
        thumbnailUrl: product.thumbnailUrl,
        pcProductId: pricing.pcMatch?.productId || product.pcProductId,
        pricing,
      });
      setStatus('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deal lookup failed';
      setError(message);
      setStatus('error');
      toast.error(message);
    }
  }, [barcode, localLookupUPC, user]);

  const lookupByName = useCallback(async () => {
    if (!user) return;
    const title = titleQuery.trim();
    if (!title) {
      toast.error('Enter a title or scan a UPC first');
      return;
    }

    setStatus('pricing');
    setError('');
    setDeal(null);

    try {
      const pricing = await getCanonicalPricing(title, platformHint, {
        forceRefresh: true,
      });

      if (pricing.status === 'api_error') {
        throw new Error(pricing.error || 'Pricing lookup failed');
      }

      setDeal({
        barcode: '',
        title: pricing.pcMatch?.productName || title,
        platform: pricing.pcMatch?.platform || platformHint,
        brand: platformHint,
        category: 'Video Games',
        imageUrl: '',
        thumbnailUrl: '',
        pcProductId: pricing.pcMatch?.productId || '',
        pricing,
      });
      setStatus('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Name lookup failed';
      setError(message);
      setStatus('error');
      toast.error(message);
    }
  }, [platformHint, titleQuery, user]);

  const handleQuickLookup = useCallback(() => {
    if (barcode.trim()) {
      lookupDeal();
      return;
    }
    lookupByName();
  }, [barcode, lookupByName, lookupDeal]);

  const handleScan = useCallback((result: { barcode: string; format: string; timestamp: number }) => {
    const code = cleanBarcode(result.barcode);
    if (!code) return;
    if (recentScansRef.current.has(code)) return;
    recentScansRef.current.add(code);
    setScannerActive(false);
    lookupDeal(code);
  }, [lookupDeal]);

  const saveToInventory = async () => {
    if (!user || !deal || !marketValue || !price) return;
    setSaving(true);
    try {
      const classification = classifyItem(deal.title, deal.category || '', deal.brand || '');
      const estimatedProfit = marketValue - price;
      const estimatedMarginPercent = price > 0 ? (estimatedProfit / price) * 100 : 0;

      const { data: inventoryItem, error: inventoryError } = await supabase
        .from('inventory_items')
        .insert({
          user_id: accountId || user.id,
          product_name: deal.title,
          console: deal.platform,
          condition,
          region,
          purchase_price: price,
          quantity: 1,
          barcode: deal.barcode,
          raw_scanned_title: deal.title,
          normalized_title: normalizeTitle(deal.title),
          platform_raw: deal.platform,
          platform_normalized: deal.platform,
          category: deal.category || 'Video Games',
          item_type: classification.itemType || 'game',
          brand: deal.brand || null,
          confidence_score: 95,
          source_upc_provider: deal.barcode ? 'deal_scanner' : 'manual_name_search',
          source_metadata_provider: deal.pricing.pcMatch ? 'pricecharting' : null,
          source_image_provider: deal.imageUrl ? 'pricecharting' : null,
          description: '',
          scan_created_at: new Date().toISOString(),
          image_url: deal.imageUrl || null,
          thumbnail_url: deal.thumbnailUrl || deal.imageUrl || null,
          pricing_source: deal.pricing.source,
          pricing_status: deal.pricing.status === 'failed' ? 'missing' : 'found',
          pricing_attempted_at: new Date().toISOString(),
          pricing_last_checked_at: new Date().toISOString(),
          pricing_confidence: deal.pricing.pcMatch ? 95 : 80,
          pricing_matched_title: deal.pricing.pcMatch?.productName || deal.title,
          pricing_matched_platform: deal.pricing.pcMatch?.platform || deal.platform,
          pc_source_product_id: deal.pricing.pcMatch?.productId || deal.pcProductId || null,
          pricing_diagnostics: deal.pricing.diagnostics,
          price_loose: deal.pricing.prices.loose.value,
          price_cib: deal.pricing.prices.cib.value,
          price_new: deal.pricing.prices.new.value,
          price_graded: deal.pricing.prices.graded.value,
          selected_market_value: marketValue,
          estimated_profit: estimatedProfit,
          estimated_margin_percent: estimatedMarginPercent,
          deal_score: dealScore.score,
          deal_score_label: dealScore.label,
          needs_review: false,
        })
        .select()
        .single();

      if (inventoryError) throw inventoryError;

      if (inventoryItem) {
        await supabase.from('pricing_data').insert({
          item_id: inventoryItem.id,
          loose_price: deal.pricing.prices.loose.value,
          cib_price: deal.pricing.prices.cib.value,
          new_price: deal.pricing.prices.new.value,
          graded_price: deal.pricing.prices.graded.value,
          source: deal.pricing.source,
          price_date: new Date().toISOString(),
          raw_response: deal.pricing,
        });
      }

      toast.success('Added to inventory');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const isBusy = status === 'looking_up' || status === 'pricing';

  const content = (
    <>
      <div className={cn('min-h-[calc(100vh-48px)] bg-background', embedded ? 'min-h-screen' : 'lg:min-h-screen')}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-4 sm:px-6 lg:px-10 lg:pb-10 lg:pt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="label-caps mb-1">Field Tool</div>
              <h1 className="heading-lg text-[24px] sm:text-[28px]">Quick Deal Scanner</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Scan a UPC or search by title, enter the asking price, and compare it against current market values by condition.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
              Mobile optimized
            </Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
            <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-12 rounded-lg text-sm"
                  onClick={() => {
                    recentScansRef.current.clear();
                    setScannerActive(true);
                  }}
                  disabled={isBusy}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Scan UPC
                </Button>
                <Button
                  variant="outline"
                  className="h-12 rounded-lg text-sm"
                  onClick={handleQuickLookup}
                  disabled={isBusy}
                >
                  {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Look Up
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deal-upc" className="text-xs text-muted-foreground">UPC</Label>
                <div className="relative">
                  <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="deal-upc"
                    inputMode="numeric"
                    autoComplete="off"
                    value={barcode}
                    onChange={(event) => setBarcode(cleanBarcode(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') lookupDeal();
                    }}
                    placeholder="Scan or type UPC"
                    className="h-12 rounded-lg pl-10 text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deal-title" className="text-xs text-muted-foreground">Quick Name Search</Label>
                <div className="relative">
                  <Gamepad2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="deal-title"
                    autoComplete="off"
                    value={titleQuery}
                    onChange={(event) => setTitleQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') lookupByName();
                    }}
                    placeholder="Mario Party 8"
                    className="h-12 rounded-lg pl-10 text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Platform for Name Search</Label>
                <Select value={platformHint} onValueChange={setPlatformHint}>
                  <SelectTrigger className="h-12 rounded-lg text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONSOLES.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="asking-price" className="text-xs text-muted-foreground">Asking Price</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="asking-price"
                      inputMode="decimal"
                      value={askingPrice}
                      onChange={(event) => setAskingPrice(event.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      className="h-12 rounded-lg pl-10 text-base"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Condition</Label>
                  <Select value={condition} onValueChange={(value) => setCondition(value as typeof condition)}>
                    <SelectTrigger className="h-12 rounded-lg text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Region / TV Standard</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="h-12 rounded-lg text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((value) => (
                      <SelectItem key={value.value} value={value.value}>{value.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Fast check rules
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Buy signals favor larger dollar profit and margin. Always sanity-check condition, completeness, and disc quality before purchasing.
                </p>
              </div>
            </section>

            <section className="min-h-[420px] rounded-lg border border-border/60 bg-card">
              {!deal && !isBusy && status !== 'error' && (
                <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                    <Package className="h-6 w-6 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold">Ready to check a deal</h2>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Scan a barcode, type a UPC, or search by title. Pricing will appear here with a condition-by-condition breakdown.
                  </p>
                </div>
              )}

              {isBusy && (
                <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                  <Loader2 className="mb-4 h-9 w-9 animate-spin text-primary" />
                  <h2 className="text-lg font-semibold">
                    {status === 'looking_up' ? 'Finding product...' : 'Checking market values...'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">Pulling product match and condition prices.</p>
                </div>
              )}

              {status === 'error' && !isBusy && (
                <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                  <CircleAlert className="mb-4 h-10 w-10 text-red-400" />
                  <h2 className="text-lg font-semibold">Could not check this deal</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">{error}</p>
                  <Button className="mt-5" onClick={handleQuickLookup}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try Again
                  </Button>
                </div>
              )}

              {deal && !isBusy && (
                <div className="p-4 sm:p-5">
                  <div className="flex gap-4">
                    <div className="h-24 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 bg-secondary">
                      {deal.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={deal.imageUrl} alt={deal.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Package className="h-7 w-7 text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="label-caps mb-1">{deal.platform}</div>
                      <h2 className="line-clamp-2 text-lg font-semibold leading-tight sm:text-xl">{deal.title}</h2>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {deal.barcode ? (
                          <Badge variant="outline" className="border-white/10 text-muted-foreground">UPC {deal.barcode}</Badge>
                        ) : (
                          <Badge variant="outline" className="border-white/10 text-muted-foreground">Name search</Badge>
                        )}
                        {conditionPrice?.source && (
                          <Badge variant="outline" className="border-primary/25 text-primary">
                            {sourceLabel(conditionPrice.source, conditionPrice.sampleCount)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={cn('mt-5 rounded-lg border p-4', verdict.tone)}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-80">Recommendation</div>
                        <div className="mt-1 text-3xl font-bold">{verdict.label}</div>
                        <p className="mt-1 text-sm opacity-80">{verdict.body}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-[0.12em] opacity-70">Score</div>
                        <div className="mt-1 text-3xl font-bold stat-number">{dealScore.score}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-[11px] text-muted-foreground">Market</div>
                      <div className="mt-1 text-xl font-bold stat-number">{money(marketValue)}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-[11px] text-muted-foreground">Profit</div>
                      <div className={cn('mt-1 text-xl font-bold stat-number', profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                        {price && marketValue ? `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)}` : '--'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-[11px] text-muted-foreground">Margin</div>
                      <div className={cn('mt-1 text-xl font-bold stat-number', margin >= 50 ? 'text-emerald-300' : margin > 0 ? 'text-amber-300' : 'text-red-300')}>
                        {price && marketValue ? `${margin.toFixed(0)}%` : '--'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CONDITIONS.map((value) => {
                      const key = conditionKeys[value];
                      const priceInfo = deal.pricing.prices[key];
                      const active = value === condition;
                      return (
                        <button
                          key={value}
                          onClick={() => setCondition(value)}
                          className={cn(
                            'rounded-lg border p-3 text-left transition-colors',
                            active
                              ? 'border-primary/45 bg-primary/10'
                              : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                          )}
                        >
                          <div className="text-[11px] text-muted-foreground">{value}</div>
                          <div className="mt-1 text-lg font-bold stat-number">{money(priceInfo.value)}</div>
                          <div className="mt-1 truncate text-[10px] text-muted-foreground">
                            {sourceLabel(priceInfo.source, priceInfo.sampleCount) || 'No data'}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Button className="h-11 rounded-lg" onClick={() => setScannerActive(true)}>
                      <Camera className="mr-2 h-4 w-4" />
                      Scan Another
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 rounded-lg"
                      disabled={!price || !marketValue || saving}
                      onClick={saveToInventory}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add to Inventory
                    </Button>
                  </div>

                  {deal.pricing.diagnostics.warnings.length > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                      {deal.pricing.diagnostics.warnings[0]}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/90 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
            <Button className="h-12 rounded-lg" onClick={() => setScannerActive(true)} disabled={isBusy}>
              <Camera className="mr-2 h-4 w-4" />
              Scan
            </Button>
            <Button variant="outline" className="h-12 rounded-lg" onClick={handleQuickLookup} disabled={isBusy}>
              {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
              Check Deal
            </Button>
          </div>
        </div>
      </div>

      <BarcodeScannerView
        isActive={scannerActive}
        onScan={handleScan}
        onStop={() => setScannerActive(false)}
        variant="compact"
        title="Deal Scanner"
      />
    </>
  );

  if (embedded) return content;

  return (
    <DashboardLayout>
      {content}
    </DashboardLayout>
  );
}
