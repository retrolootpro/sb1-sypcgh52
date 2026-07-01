'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { TrendingUp, Package, DollarSign, ArrowUpRight, ArrowDownRight, ChevronRight, ScanBarcode, ListChecks, Bell, Clock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAgeStatus, getInventoryAgeDays, normalizeAgingThresholds, readAgingThresholds, writeAgingThresholds, type AgingThresholds } from '@/lib/inventory-aging';
import { toast } from 'sonner';
import { ContextHelp } from '@/components/context-help';

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  quantity: number;
  status?: string | null;
  created_at: string;
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  selected_market_value?: number;
  estimated_profit?: number;
  deal_score?: number;
  deal_score_label?: string;
  pricing_data?: {
    loose_price: number;
    cib_price: number;
    new_price: number;
  }[];
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
};

function getDashboardMarketValue(item: InventoryItem) {
  const pricing = item.pricing_data?.[0];
  const savedMarketValue = Number(item.selected_market_value) || 0;
  if (savedMarketValue > 0) return savedMarketValue;

  const loosePrice = Number(item.price_loose) || Number(pricing?.loose_price) || 0;
  const cibPrice = Number(item.price_cib) || Number(pricing?.cib_price) || 0;
  const newPrice = Number(item.price_new) || Number(pricing?.new_price) || 0;
  const gradedPrice = Number(item.price_graded) || 0;

  return getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
}

export default function DashboardPage() {
  const { user, accountId } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [agingThresholds, setAgingThresholds] = useState<AgingThresholds>({ watchDays: 45, reviewDays: 60 });

  const loadDashboardData = useCallback(async () => {
    if (!user || !accountId) return;
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select(`*, pricing_data (*)`)
        .eq('user_id', accountId);

      if (error) throw error;
      setItems(data as InventoryItem[]);
    } catch (error) {
      console.error('[Dashboard] Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [user, accountId]);

  useEffect(() => {
    if (user && accountId) {
      loadDashboardData();
    }
  }, [user, accountId, loadDashboardData]);

  useEffect(() => {
    const syncThreshold = () => setAgingThresholds(readAgingThresholds());
    syncThreshold();
    window.addEventListener('storage', syncThreshold);
    window.addEventListener('retroloot-stale-threshold-change', syncThreshold);
    return () => {
      window.removeEventListener('storage', syncThreshold);
      window.removeEventListener('retroloot-stale-threshold-change', syncThreshold);
    };
  }, []);

  const saveAgingThresholds = (thresholds: Partial<AgingThresholds>) => {
    const next = normalizeAgingThresholds({ ...agingThresholds, ...thresholds });
    setAgingThresholds(next);
    writeAgingThresholds(next);
    toast.success(`Aging alerts set: watch ${next.watchDays}d, review ${next.reviewDays}d`);
  };

  const stats = useMemo(() => {
    let totalValue = 0;
    let totalSpent = 0;
    let totalScores = 0;
    let itemsWithScores = 0;

    items.forEach((item) => {
      const spent = item.purchase_price * item.quantity;
      totalSpent += spent;

      const marketValue = getDashboardMarketValue(item);
      if (marketValue > 0) {
        totalValue += marketValue * item.quantity;

        const inventoryAgeDays = Math.floor(
          (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        const dealScore = calculateDealScore(item.purchase_price, marketValue, 0, 0, inventoryAgeDays);
        totalScores += dealScore.score;
        itemsWithScores++;
      }
    });

    return {
      totalValue,
      totalSpent,
      totalProfit: totalValue - totalSpent,
      avgDealScore: itemsWithScores > 0 ? Math.round(totalScores / itemsWithScores) : 0,
      itemCount: items.length,
    };
  }, [items]);

  const topDeals = useMemo(() => {
    return items
      .map((item) => {
        const marketValue = getDashboardMarketValue(item);
        const inventoryAgeDays = Math.floor(
          (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        const dealScore = calculateDealScore(item.purchase_price, marketValue, 0, 0, inventoryAgeDays);
        return { ...item, dealScore, marketValue };
      })
      .filter((item) => item.marketValue > 0)
      .sort((a, b) => b.dealScore.score - a.dealScore.score)
      .slice(0, 6);
  }, [items]);

  const agingAlerts = useMemo(() => {
    const rows = items
      .filter((item) => (item.status || 'available') !== 'sold')
      .map((item) => ({
        ...item,
        ageDays: getInventoryAgeDays(item.created_at),
        ageStatus: getAgeStatus(getInventoryAgeDays(item.created_at), agingThresholds),
      }))
      .filter((item) => item.ageStatus === 'stale')
      .sort((a, b) => b.ageDays - a.ageDays);

    return {
      items: rows.slice(0, 5),
      count: rows.length,
      oldestAge: rows[0]?.ageDays || 0,
      oldestName: rows[0]?.product_name || '',
    };
  }, [items, agingThresholds]);

  useEffect(() => {
    if (loading || agingAlerts.count === 0) return;
    const key = `retroloot-aging-toast-${new Date().toISOString().slice(0, 10)}-${agingThresholds.reviewDays}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
    toast.warning(`${agingAlerts.count} item${agingAlerts.count === 1 ? '' : 's'} past ${agingThresholds.reviewDays} days in stock`);
  }, [agingAlerts.count, agingThresholds.reviewDays, loading]);

  const profitPositive = stats.totalProfit >= 0;
  const roi = stats.totalSpent > 0 ? ((stats.totalProfit / stats.totalSpent) * 100) : 0;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full min-h-[300px]">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.55fr)]">
          <div className="overflow-hidden rounded-[28px] border border-border bg-card p-5 shadow-[0_24px_70px_-54px_hsl(148_100%_50%/0.45)] dark:bg-[linear-gradient(135deg,hsl(0_0%_100%/0.06),hsl(0_0%_100%/0.025))] sm:p-7">
            <div className="flex items-center gap-2">
              <div className="label-caps">Daily Command</div>
              <ContextHelp href="/help#daily-workflow" label="Open daily workflow help">
                Start here each day: review cash, tasks, aging inventory, priority listing work, and sales.
              </ContextHelp>
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <h1 className="max-w-2xl text-[34px] font-semibold leading-tight tracking-tight text-foreground sm:text-[44px]">
                  Today&apos;s business command center
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Inventory value, aging pressure, listing work, and buying confidence in one place.
                </p>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.08] p-4 lg:min-w-[260px]">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/70">Portfolio value</div>
                <div className="mt-2 text-[34px] font-bold leading-none text-primary sm:text-[40px]">
                  ${stats.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div className={`mt-2 flex items-center gap-1 text-sm font-semibold ${profitPositive ? 'text-emerald-300' : 'text-red-300'}`}>
                  {profitPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {roi.toFixed(1)}% ROI
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {[
                { label: 'Items', value: stats.itemCount.toLocaleString(), detail: 'Active catalog', icon: Package, href: '/inventory' },
                { label: 'Invested', value: `$${stats.totalSpent.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, detail: 'Cost basis', icon: DollarSign, href: '/finance' },
                { label: 'Profit', value: `${profitPositive ? '+' : ''}$${stats.totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, detail: 'Unrealized', icon: TrendingUp, href: '/finance', tone: profitPositive ? 'text-emerald-300' : 'text-red-300' },
                { label: 'Deal Score', value: String(stats.avgDealScore), detail: 'Average', icon: ListChecks, href: '/insights' },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <Link key={metric.label} href={metric.href} className="group rounded-2xl border border-border bg-secondary/45 p-4 transition hover:border-primary/25 hover:bg-primary/[0.055]">
                    <div className="flex items-center justify-between gap-3">
                      <Icon className="h-4 w-4 text-primary" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground/45 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <div className={`mt-4 text-2xl font-bold ${metric.tone || 'text-foreground'}`}>{metric.value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{metric.label} · {metric.detail}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3">
            {[
              { href: '/scan', icon: ScanBarcode, label: 'Scan intake', sub: 'Add purchases fast' },
              { href: '/inventory?age=stale', icon: Bell, label: 'Review aging', sub: `${agingAlerts.count} need action`, alert: agingAlerts.count > 0 },
              { href: '/shows', icon: ListChecks, label: 'Build a show', sub: `${topDeals.length} strong candidates` },
              { href: '/finance', icon: DollarSign, label: 'Buying check', sub: profitPositive ? 'Review cash position' : 'Hold and review' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={`group flex items-center gap-3 rounded-2xl border p-4 transition ${
                    action.alert
                      ? 'border-red-500/30 bg-red-500/10 hover:bg-red-500/15'
                      : 'border-border bg-card hover:border-primary/25 hover:bg-primary/[0.055]'
                  }`}
                >
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${action.alert ? 'bg-red-500/10' : 'bg-primary/10'}`}>
                    <Icon className={`h-5 w-5 ${action.alert ? 'text-red-300' : 'text-primary'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">{action.label}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{action.sub}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/45 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-[24px] border border-border/40 bg-card/80">
            <div className="flex items-center justify-between gap-3 border-b border-border/35 px-5 py-4">
              <div>
                <div className="text-base font-semibold tracking-tight">Best resale opportunities</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Highest score inventory with current market values.</div>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/inventory">Inventory <ChevronRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
            <div className="divide-y divide-border/30">
              {topDeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14">
                  <Package className="mb-3 h-9 w-9 text-muted-foreground/25" />
                  <p className="mb-3 text-sm text-muted-foreground">No priced items yet</p>
                  <Button asChild size="sm">
                    <Link href="/scan"><ScanBarcode className="mr-1.5 h-4 w-4" />Scan your first item</Link>
                  </Button>
                </div>
              ) : (
                topDeals.map((item, i) => {
                  const profit = item.marketValue - item.purchase_price;
                  return (
                    <Link key={item.id} href={`/inventory/${item.id}`} className="grid gap-3 px-5 py-4 transition hover:bg-white/[0.035] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary/70 text-sm font-bold text-muted-foreground">
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-foreground">{item.product_name}</div>
                        <div className="mt-0.5 text-sm text-muted-foreground">{item.console} · {item.condition}</div>
                      </div>
                      <div className="flex items-center justify-between gap-4 sm:justify-end">
                        <div className="text-right">
                          <div className="text-base font-semibold">${item.marketValue.toFixed(2)}</div>
                          <div className={`text-sm ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`px-2.5 py-1 text-sm font-bold ${
                            item.dealScore.score >= 70 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                            item.dealScore.score >= 40 ? 'border-primary/30 bg-primary/10 text-primary' :
                            'border-red-500/30 bg-red-500/10 text-red-400'
                          }`}
                        >
                          {item.dealScore.score}
                        </Badge>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={`rounded-[24px] border p-5 ${agingAlerts.count > 0 ? 'border-red-500/30 bg-red-500/10' : 'border-border/40 bg-card/80'}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2.5 ${agingAlerts.count > 0 ? 'bg-red-500/10' : 'bg-secondary/50'}`}>
                  <Bell className={`h-5 w-5 ${agingAlerts.count > 0 ? 'text-red-300' : 'text-muted-foreground'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold">Aging inventory</div>
                    <ContextHelp href="/help#dashboard-overview" label="Open aging inventory help">
                      Aging alerts remind you to revise price, photos, sales channel, or bundle strategy.
                    </ContextHelp>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {agingAlerts.count > 0
                      ? `${agingAlerts.count} item${agingAlerts.count === 1 ? '' : 's'} past ${agingThresholds.reviewDays} days`
                      : `No items past ${agingThresholds.reviewDays} days`}
                  </div>
                </div>
              </div>
              {agingAlerts.count > 0 && (
                <div className="mt-4 space-y-2">
                  {agingAlerts.items.slice(0, 3).map((item) => (
                    <Link key={item.id} href={`/inventory/${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5 transition hover:bg-red-500/10">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.product_name}</div>
                        <div className="text-xs text-muted-foreground">{item.console} · {item.condition}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-red-500/30 text-red-300">
                        <Clock className="mr-1 h-3 w-3" />
                        {item.ageDays}d
                      </Badge>
                    </Link>
                  ))}
                  <Button asChild variant="outline" size="sm" className="mt-1 h-9 w-full border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-100">
                    <Link href="/inventory?age=stale">Review aging items</Link>
                  </Button>
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: '30d', watchDays: 21, reviewDays: 30 },
                  { label: '60d', watchDays: 45, reviewDays: 60 },
                  { label: '90d', watchDays: 75, reviewDays: 90 },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => saveAgingThresholds(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-border/40 bg-card/80 p-5">
              <div className="label-caps mb-3">Next actions</div>
              <div className="space-y-2">
                {[
                  `${items.filter((item) => !item.listed_ebay_at && !item.listed_amazon_at && !item.listed_whatnot_at && (item.status || 'available') !== 'sold').length} unlisted items`,
                  `${topDeals.length} items with strong resale scores`,
                  profitPositive ? 'Cash outlook ready for review' : 'Profit below cost basis; review finance',
                ].map((line) => (
                  <div key={line} className="rounded-xl border border-border bg-secondary/45 px-3 py-2 text-sm text-muted-foreground">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
