'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { ArrowLeft, Gamepad2, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp, CircleAlert as AlertCircle, CircleCheck as CheckCircle2, CircleDot } from 'lucide-react';
import { PrepStageBar } from '@/components/prep-stage-bar';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  getCanonicalPricing,
  sourceLabel,
  type CanonicalPricingResult,
  type ConditionSource,
} from '@/lib/pricing-service';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  quantity: number;
  notes: string;
  barcode: string;
  created_at: string;
  brand?: string;
  description?: string;
  genre?: string;
  category?: string;
  confidence_score?: number;
  pricing_confidence?: number;
  image_url?: string;
  thumbnail_url?: string;
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  pricing_status?: string;
  pricing_matched_title?: string;
  pricing_matched_platform?: string;
  pricing_source?: string;
  pricing_last_checked_at?: string;
  pc_source_product_id?: string;
  pricing_diagnostics?: Record<string, unknown>;
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConditionStyle(condition: string) {
  switch (condition) {
    case 'Graded': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'New':    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'CIB':    return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    default:       return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
  }
}

function getDealBadgeStyle(label: string): string {
  const styles: Record<string, string> = {
    Steal: 'bg-green-500/15 text-green-400 border-green-500/30',
    Great: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Good:  'bg-sky-500/15 text-sky-400 border-sky-500/30',
    Fair:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    Risky: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    Avoid: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return styles[label] ?? 'bg-muted text-muted-foreground border-border';
}

function SourceBadge({ source, sampleCount }: { source: ConditionSource; sampleCount: number }) {
  if (source === 'none') return null;
  const label = sourceLabel(source, sampleCount);
  const style =
    source === 'pricecharting_api'
      ? 'text-emerald-400/70'
      : source === 'pricecharting_web'
      ? 'text-emerald-300/70'
      : source === 'ebay_90d' || source === 'ebay_web'
      ? 'text-sky-400/70'
      : 'text-muted-foreground/50';
  return <div className={`text-[9px] mt-0.5 ${style}`}>{label}</div>;
}

function RefreshStatusIcon({ status }: { status: 'success' | 'partial' | 'failed' | null }) {
  if (!status) return null;
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  if (status === 'partial')  return <CircleDot className="w-3.5 h-3.5 text-amber-400" />;
  return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function ItemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiag, setShowDiag]     = useState(false);

  // Live canonical pricing state (null = not yet refreshed this session)
  const [canonical, setCanonical] = useState<CanonicalPricingResult | null>(null);

  const loadItem = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('id', params.id as string)
        .eq('user_id', user!.id)
        .single();
      if (error) throw error;
      setItem(data as InventoryItem);
    } catch {
      router.push('/inventory');
    } finally {
      setLoading(false);
    }
  }, [user, params.id, router]);

  useEffect(() => {
    if (user && params.id) loadItem();
  }, [user, params.id, loadItem]);

  // ── Refresh handler ───────────────────────────────────────────────────────

  const handleRefreshPricing = useCallback(async () => {
    if (!item || !user) return;
    setRefreshing(true);
    try {
      const result = await getCanonicalPricing(item.product_name, item.console, {
        upc:               item.barcode || null,
        storedPcProductId: item.pc_source_product_id || null,
        forceRefresh:      true,
      });

      setCanonical(result);

      if (result.status === 'api_error') {
        toast.error(result.error || 'Could not fetch market prices. Try again shortly.');
        return;
      }

      const p = result.prices;

      // ── CRITICAL FIX: Only write a price column when the new value is > 0.
      //    This prevents a partial refresh (e.g., eBay blocked for CIB) from
      //    zeroing out a previously good PriceCharting API value.
      const dbUpdates: Record<string, unknown> = {
        pricing_status:           'found',
        pricing_last_checked_at:  new Date().toISOString(),
        pricing_diagnostics:      {
          refreshStatus:     result.diagnostics.refreshStatus,
          missingConditions: result.diagnostics.missingConditions,
          warnings:          result.diagnostics.warnings,
          pcApiUsed:         result.diagnostics.pcApiUsed,
          refreshedAt:       new Date().toISOString(),
        },
      };

      if (p.loose.value  > 0) dbUpdates.price_loose  = p.loose.value;
      if (p.cib.value    > 0) dbUpdates.price_cib    = p.cib.value;
      if (p.new.value    > 0) dbUpdates.price_new    = p.new.value;
      if (p.graded.value > 0) dbUpdates.price_graded = p.graded.value;

      const mergedPrices = {
        loose:  p.loose.value  > 0 ? p.loose.value  : Number(item.price_loose)  || 0,
        cib:    p.cib.value    > 0 ? p.cib.value    : Number(item.price_cib)    || 0,
        new:    p.new.value    > 0 ? p.new.value    : Number(item.price_new)    || 0,
        graded: p.graded.value > 0 ? p.graded.value : Number(item.price_graded) || 0,
      };
      const selectedMarketValue = getMarketValueByCondition(
        item.condition,
        mergedPrices.loose,
        mergedPrices.cib,
        mergedPrices.new,
        mergedPrices.graded
      );
      const estimatedProfit = selectedMarketValue > 0 ? selectedMarketValue - item.purchase_price : 0;
      const estimatedMarginPercent =
        selectedMarketValue > 0 && item.purchase_price > 0
          ? (estimatedProfit / item.purchase_price) * 100
          : 0;
      const itemAgeDays = Math.floor(
        (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
      );
      const refreshedDealScore = selectedMarketValue > 0
        ? calculateDealScore(item.purchase_price, selectedMarketValue, 0, 0, itemAgeDays)
        : null;

      dbUpdates.selected_market_value = selectedMarketValue;
      dbUpdates.estimated_profit = estimatedProfit;
      dbUpdates.estimated_margin_percent = estimatedMarginPercent;
      dbUpdates.deal_score = refreshedDealScore?.score ?? 0;
      dbUpdates.deal_score_label = refreshedDealScore?.label ?? '';

      // Store resolved PC product ID so future refreshes skip the search step
      if (result.pcMatch?.productId) {
        dbUpdates.pc_source_product_id = result.pcMatch.productId;
        dbUpdates.pricing_matched_title    = result.pcMatch.productName;
        dbUpdates.pricing_matched_platform = result.pcMatch.platform;
      }

      const sourceParts: string[] = [];
      if (result.diagnostics.pcApiUsed)          sourceParts.push('PriceCharting');
      if (result.diagnostics.warnings.some(w => w.includes('eBay'))) sourceParts.push('eBay');
      if (sourceParts.length === 0)              sourceParts.push(result.source || 'multi');
      dbUpdates.pricing_source = sourceParts.join(', ');

      const { error: updateErr } = await supabase
        .from('inventory_items')
        .update(dbUpdates)
        .eq('id', item.id)
        .eq('user_id', user.id);

      if (updateErr) throw updateErr;

      await loadItem();

      const { refreshStatus, missingConditions, warnings } = result.diagnostics;
      if (refreshStatus === 'success') {
        toast.success('All condition prices updated successfully');
      } else if (refreshStatus === 'partial') {
        const missing = missingConditions.join(', ');
        toast.warning(`Prices updated — no data for: ${missing}`);
      } else {
        toast.error(warnings[0] || 'Could not fetch market prices. Try again shortly.');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh pricing');
    } finally {
      setRefreshing(false);
    }
  }, [item, user, loadItem]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!item) return null;

  // Price values — prefer live canonical result, fall back to DB values
  const loosePrice  = canonical ? (canonical.prices.loose.value  || Number(item.price_loose)  || 0) : (Number(item.price_loose)  || 0);
  const cibPrice    = canonical ? (canonical.prices.cib.value    || Number(item.price_cib)    || 0) : (Number(item.price_cib)    || 0);
  const newPrice    = canonical ? (canonical.prices.new.value    || Number(item.price_new)    || 0) : (Number(item.price_new)    || 0);
  const gradedPrice = canonical ? (canonical.prices.graded.value || Number(item.price_graded) || 0) : (Number(item.price_graded) || 0);

  const marketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
  const profit      = marketValue - item.purchase_price;
  const profitMargin = item.purchase_price > 0 ? (profit / item.purchase_price) * 100 : 0;

  const inventoryAgeDays = Math.floor(
    (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
  );

  const dealScore = marketValue > 0
    ? calculateDealScore(item.purchase_price, marketValue, 0, 0, inventoryAgeDays)
    : { score: 0, label: 'No Data', emoji: '', color: 'text-gray-400', breakdown: undefined };

  const hasPricing = marketValue > 0;
  const imageUrl   = item.image_url || item.thumbnail_url;

  // Has the user ever refreshed? (either this session or previously saved)
  const hasEverRefreshed = !!canonical || !!item.pricing_last_checked_at;

  const allConditions = [
    { key: 'loose'  as const, label: 'Loose',  value: loosePrice,  active: item.condition === 'Loose' },
    { key: 'cib'    as const, label: 'CIB',    value: cibPrice,    active: item.condition === 'CIB'   },
    { key: 'new'    as const, label: 'New',     value: newPrice,    active: item.condition === 'New'   },
    { key: 'graded' as const, label: 'Graded',  value: gradedPrice, active: item.condition === 'Graded'},
  ];

  // Diagnostics to display — prefer live result, fall back to DB snapshot
  const diagData = canonical?.diagnostics ?? (
    item.pricing_diagnostics
      ? {
          refreshStatus:     item.pricing_diagnostics.refreshStatus as string,
          missingConditions: (item.pricing_diagnostics.missingConditions as string[]) ?? [],
          warnings:          (item.pricing_diagnostics.warnings as string[]) ?? [],
          pcApiUsed:         item.pricing_diagnostics.pcApiUsed as boolean,
        }
      : null
  );

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-5xl">
        <Link href="/inventory">
          <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </Link>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* ── Left column: image + UPC ───────────────────────────────── */}
          <div className="space-y-4">
            <div className="aspect-square rounded-xl overflow-hidden bg-secondary/30 border border-border/40 flex items-center justify-center">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={item.product_name}
                  className="w-full h-full object-contain p-2"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <Gamepad2 className="w-16 h-16 text-muted-foreground/20" />
              )}
            </div>

            {item.barcode && (
              <div className="p-3 rounded-lg bg-secondary/20 border border-border/30">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">UPC</div>
                <div className="font-mono text-sm">{item.barcode}</div>
              </div>
            )}
          </div>

          {/* ── Right column: details ──────────────────────────────────── */}
          <div className="space-y-5">

            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <h1 className="text-2xl font-bold tracking-tight">{item.product_name}</h1>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshPricing}
                  disabled={refreshing}
                  className="shrink-0 h-8 px-3 text-xs border-border/50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Refreshing...' : 'Refresh Pricing'}
                </Button>
              </div>
              {item.description && (
                <p className="text-sm text-muted-foreground/70 mb-2.5 leading-relaxed line-clamp-3">
                  {item.description}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="border-border/50 text-xs">{item.console}</Badge>
                <Badge variant="outline" className={`text-xs ${getConditionStyle(item.condition)}`}>
                  {item.condition}
                </Badge>
                {item.genre && (
                  <Badge variant="outline" className="border-border/50 text-xs text-muted-foreground">
                    {item.genre}
                  </Badge>
                )}
                {hasPricing && dealScore.label !== 'No Data' && (
                  <Badge variant="outline" className={`text-xs font-semibold ${getDealBadgeStyle(dealScore.label)}`}>
                    {dealScore.label} {dealScore.score}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground/60 ml-1">
                  Added {format(new Date(item.created_at), 'MMM d, yyyy')}
                </span>
              </div>
            </div>

            {/* Prep stage */}
            <PrepStageBar
              itemId={item.id}
              fields={item}
              onUpdate={(updates) => setItem(prev => prev ? { ...prev, ...updates } as InventoryItem : null)}
            />

            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Cost</div>
                <div className="text-xl font-bold">${item.purchase_price.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Market Value</div>
                <div className="text-xl font-bold text-primary">
                  {hasPricing ? `$${marketValue.toFixed(2)}` : '--'}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Profit</div>
                <div className={`text-xl font-bold flex items-center gap-1 ${profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : ''}`}>
                  {hasPricing ? (
                    <>
                      {profit > 0 ? <TrendingUp className="w-4 h-4" /> : profit < 0 ? <TrendingDown className="w-4 h-4" /> : null}
                      {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                    </>
                  ) : '--'}
                </div>
                {hasPricing && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">{profitMargin.toFixed(0)}% margin</div>
                )}
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Quantity</div>
                <div className="text-xl font-bold">{item.quantity}</div>
                {hasPricing && item.quantity > 1 && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Total: ${(marketValue * item.quantity).toFixed(2)}
                  </div>
                )}
              </div>
            </div>

            {/* ── Market Value card ─────────────────────────────────────── */}
            <Card className="border-border/40 bg-card/40">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">Current Market Value</CardTitle>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {diagData?.pcApiUsed
                      ? 'Sourced from PriceCharting API + eBay fallback'
                      : 'Aggregated from eBay completed listings'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {diagData && (
                    <RefreshStatusIcon status={diagData.refreshStatus as 'success' | 'partial' | 'failed'} />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshPricing}
                    disabled={refreshing}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Fetching...' : 'Refresh'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {hasPricing || hasEverRefreshed ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {allConditions.map((c) => {
                        const condData = canonical?.prices[c.key];
                        const src: ConditionSource = condData?.source ?? 'none';
                        const samples = condData?.sampleCount ?? 0;
                        const noDataAfterRefresh = hasEverRefreshed && c.value === 0;

                        return (
                          <div
                            key={c.label}
                            className={`p-2.5 rounded-lg text-center transition-colors ${
                              c.active
                                ? 'bg-primary/10 border border-primary/30 ring-1 ring-primary/20'
                                : 'bg-secondary/20 border border-transparent'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                              {c.label}
                            </div>
                            {c.value > 0 ? (
                              <>
                                <div className={`text-sm font-bold ${c.active ? 'text-primary' : ''}`}>
                                  ${c.value.toFixed(2)}
                                </div>
                                <SourceBadge source={src} sampleCount={samples} />
                                {c.active && (
                                  <div className="text-[9px] text-primary/70 mt-0.5">Selected</div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-bold text-muted-foreground/30">--</div>
                                {noDataAfterRefresh ? (
                                  <div className="text-[9px] text-amber-500/60 mt-0.5">No verified data</div>
                                ) : (
                                  <div className="text-[9px] text-muted-foreground/30 mt-0.5">Not fetched</div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Fallback notice */}
                    {marketValue > 0 && (() => {
                      const activeConditionValue = allConditions.find(c => c.active)?.value ?? 0;
                      if (activeConditionValue > 0 || marketValue === 0) return null;
                      const fallbackCond = allConditions.find(c => c.value === marketValue && !c.active);
                      return (
                        <p className="text-[10px] text-amber-500/70 mt-2">
                          No {item.condition} price — using {fallbackCond?.label ?? 'available'} price as display fallback only
                        </p>
                      );
                    })()}

                    {/* Timestamps */}
                    <div className="flex items-center justify-between mt-3">
                      <div>
                        {diagData?.warnings && diagData.warnings.length > 0 && (
                          <button
                            onClick={() => setShowDiag(v => !v)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          >
                            {showDiag ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {showDiag ? 'Hide' : 'Show'} diagnostics ({diagData.warnings.length})
                          </button>
                        )}
                      </div>
                      {item.pricing_last_checked_at && (
                        <div className="text-[10px] text-muted-foreground/40">
                          Updated {format(new Date(item.pricing_last_checked_at), 'MMM d, yyyy')}
                        </div>
                      )}
                    </div>

                    {/* Diagnostics drawer */}
                    {showDiag && diagData && (
                      <div className="mt-3 p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                          Pricing Diagnostics
                        </div>
                        {(canonical?.pcMatch || item.pricing_matched_title) && (
                          <div className="flex items-start justify-between text-[11px]">
                            <span className="text-muted-foreground/60">PC Match</span>
                            <span className="font-mono text-right text-muted-foreground/80 max-w-[60%]">
                              {canonical?.pcMatch?.productName || item.pricing_matched_title}
                              {(canonical?.pcMatch?.productId || item.pc_source_product_id) && (
                                <span className="text-muted-foreground/40 ml-1">
                                  #{canonical?.pcMatch?.productId || item.pc_source_product_id}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {(canonical?.pcMatch?.strategy) && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground/60">Resolution</span>
                            <span className="font-mono text-muted-foreground/80">{canonical.pcMatch.strategy}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground/60">Status</span>
                          <span className={`font-medium ${
                            diagData.refreshStatus === 'success' ? 'text-green-400' :
                            diagData.refreshStatus === 'partial' ? 'text-amber-400' : 'text-red-400'
                          }`}>{diagData.refreshStatus}</span>
                        </div>
                        {diagData.missingConditions.length > 0 && (
                          <div className="flex items-start justify-between text-[11px]">
                            <span className="text-muted-foreground/60">Missing</span>
                            <span className="text-amber-400/80">{diagData.missingConditions.join(', ')}</span>
                          </div>
                        )}
                        {diagData.warnings && diagData.warnings.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-border/20">
                            {(diagData.warnings as string[]).map((w, i) => (
                              <div key={i} className="text-[10px] text-muted-foreground/50 leading-snug">
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <p className="text-sm text-muted-foreground">No pricing data yet.</p>
                    <p className="text-xs text-muted-foreground/60">
                      Click Refresh to fetch current market prices from PriceCharting and eBay.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Deal Score */}
            {hasPricing && dealScore.breakdown && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Deal Score Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Profit Margin</span>
                    <span className="font-semibold">+{dealScore.breakdown.profitMargin}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Rarity Bonus</span>
                    <span className={`font-semibold ${dealScore.breakdown.rarityBonus >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dealScore.breakdown.rarityBonus >= 0 ? '+' : ''}{dealScore.breakdown.rarityBonus}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Liquidity</span>
                    <span className={`font-semibold ${dealScore.breakdown.liquidityScore >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dealScore.breakdown.liquidityScore >= 0 ? '+' : ''}{dealScore.breakdown.liquidityScore}
                    </span>
                  </div>
                  {dealScore.breakdown.ageScore !== 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Age ({inventoryAgeDays}d)</span>
                      <span className="font-semibold text-red-400">{dealScore.breakdown.ageScore}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-border/30 flex items-center justify-between">
                    <span className="text-sm font-medium">Total Score</span>
                    <Badge variant="outline" className={`font-bold ${getDealBadgeStyle(dealScore.label)}`}>
                      {dealScore.score} / 100
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {item.notes && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
                </CardContent>
              </Card>
            )}

            {/* Item details */}
            {(item.brand || item.pricing_matched_title || item.pricing_source || item.pricing_confidence) && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Item Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {item.brand && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Publisher / Brand</span>
                      <span className="font-medium">{item.brand}</span>
                    </div>
                  )}
                  {item.category && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Category</span>
                      <span className="font-medium">{item.category}</span>
                    </div>
                  )}
                  {item.pricing_matched_title && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">PriceCharting Match</span>
                      <span className="font-medium text-right max-w-[60%] truncate">{item.pricing_matched_title}</span>
                    </div>
                  )}
                  {item.pricing_matched_platform && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Matched Platform</span>
                      <span className="font-medium">{item.pricing_matched_platform}</span>
                    </div>
                  )}
                  {item.pc_source_product_id && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">PC Product ID</span>
                      <span className="font-mono text-xs text-muted-foreground/70">{item.pc_source_product_id}</span>
                    </div>
                  )}
                  {item.pricing_source && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Pricing Source</span>
                      <span className="font-medium">{item.pricing_source}</span>
                    </div>
                  )}
                  {!!item.pricing_confidence && item.pricing_confidence > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Match Confidence</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-secondary rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              item.pricing_confidence >= 85 ? 'bg-green-400' :
                              item.pricing_confidence >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                            }`}
                            style={{ width: `${item.pricing_confidence}%` }}
                          />
                        </div>
                        <span className="font-medium">{item.pricing_confidence}%</span>
                      </div>
                    </div>
                  )}
                  {item.pricing_last_checked_at && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Price Check</span>
                      <span className="font-medium">{format(new Date(item.pricing_last_checked_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
