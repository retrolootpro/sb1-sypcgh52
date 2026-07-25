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
  const availableItems = items.filter((item) => (item.status || 'available') !== 'sold');
  const unlistedItems = availableItems.filter((item) => !item.listed_ebay_at && !item.listed_amazon_at && !item.listed_whatnot_at);
  const missingPriceItems = availableItems.filter((item) => getDashboardMarketValue(item) <= 0);
  const readyToSellItems = availableItems.filter((item) => getDashboardMarketValue(item) > 0 && Number(item.purchase_price) > 0);
  const urgentWorkCount = agingAlerts.count + missingPriceItems.length;

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
      <div className="space-y-5 p-4 sm:p-6 lg:p-7">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[24px] border border-border/50 bg-card/90 p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="label-caps">Today</div>
                  <ContextHelp href="/help#daily-workflow" label="Open daily workflow help">
                    Start with the few items that change your day: price gaps, aging inventory, ready-to-list items, and cash position.
                  </ContextHelp>
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">What needs attention</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  A quieter daily view focused on the work that helps you list, price, sell, and buy with confidence.
                </p>
              </div>
              <Button asChild className="h-11 shrink-0">
                <Link href="/scan"><ScanBarcode className="mr-2 h-4 w-4" />Scan item</Link>
              </Button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                {
                  href: urgentWorkCount > 0 ? '/review' : '/inventory',
                  label: 'Needs review',
                  value: urgentWorkCount,
                  detail: `${agingAlerts.count} aging / ${missingPriceItems.length} missing price`,
                  icon: Bell,
                  urgent: urgentWorkCount > 0,
                },
                {
                  href: '/inventory',
                  label: 'Ready to sell',
                  value: readyToSellItems.length,
                  detail: `${unlistedItems.length} not listed yet`,
                  icon: Package,
                },
                {
                  href: '/finance',
                  label: 'Money read',
                  value: `${profitPositive ? '+' : ''}$${stats.totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
                  detail: `${roi.toFixed(1)}% ROI / $${stats.totalSpent.toLocaleString('en-US', { maximumFractionDigits: 0 })} invested`,
                  icon: DollarSign,
                  tone: profitPositive ? 'text-emerald-400' : 'text-red-400',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 ${
                      item.urgent
                        ? 'border-red-500/30 bg-red-500/10 hover:bg-red-500/15'
                        : 'border-border bg-secondary/35 hover:border-primary/25 hover:bg-primary/[0.055]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.urgent ? 'bg-red-500/10' : 'bg-primary/10'}`}>
                        <Icon className={`h-5 w-5 ${item.urgent ? 'text-red-300' : 'text-primary'}`} />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/45 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <div className={`mt-4 text-2xl font-bold ${item.tone || 'text-foreground'}`}>{item.value}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{item.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="rounded-[24px] border border-border/50 bg-card/90 p-5 shadow-sm">
            <div className="label-caps">Quick actions</div>
            <div className="mt-4 space-y-2">
              {[
                { href: '/inventory?age=stale', icon: Clock, label: 'Review aging inventory', sub: agingAlerts.count ? `${agingAlerts.count} item${agingAlerts.count === 1 ? '' : 's'} past ${agingThresholds.reviewDays} days` : 'Nothing stale right now' },
                { href: '/review/data-issues', icon: ListChecks, label: 'Fix missing data', sub: `${missingPriceItems.length} missing market value` },
                { href: '/shows', icon: TrendingUp, label: 'Build from best items', sub: `${topDeals.length} strong candidates` },
                { href: '/assistant', icon: Bell, label: 'Ask the assistant', sub: 'Inventory and pricing questions' },
              ].map((action) => {
                const Icon = action.icon;
                return (
                  <Link key={action.href} href={action.href} className="group flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-3 transition hover:border-primary/25 hover:bg-primary/[0.055]">
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{action.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{action.sub}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-[24px] border border-border/50 bg-card/90 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/35 px-5 py-4">
              <div>
                <div className="text-base font-semibold tracking-tight">Opportunity queue</div>
                <div className="mt-0.5 text-xs text-muted-foreground">A short list of items most worth acting on today.</div>
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
            <div className={`rounded-[24px] border p-5 shadow-sm ${agingAlerts.count > 0 ? 'border-red-500/30 bg-red-500/10' : 'border-border/50 bg-card/90'}`}>
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

            <div className="rounded-[24px] border border-border/50 bg-card/90 p-5 shadow-sm">
              <div className="label-caps mb-3">Business snapshot</div>
              <div className="space-y-2">
                {[
                  `${stats.itemCount.toLocaleString()} total inventory rows`,
                  `$${stats.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} estimated market value`,
                  `${unlistedItems.length} available items not listed`,
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
