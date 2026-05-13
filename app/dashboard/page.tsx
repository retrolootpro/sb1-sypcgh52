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
      <div className="p-6 sm:p-8 lg:p-10 max-w-6xl space-y-10">

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="label-caps">Daily Command</div>
            <ContextHelp href="/help#daily-workflow" label="Open daily workflow help">
              Start here each day: review cash, tasks, aging inventory, priority listing work, and sales.
            </ContextHelp>
          </div>
          <div className="flex items-end gap-4">
            <div className="heading-display text-[52px] stat-number text-foreground">
              ${stats.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {stats.totalSpent > 0 && (
              <div className={`flex items-center gap-1 text-base font-semibold mb-2 ${profitPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {profitPositive ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                {roi.toFixed(1)}% ROI
              </div>
            )}
          </div>
          <p className="text-base text-muted-foreground">
            {stats.itemCount} items &middot; ${stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested
            {stats.totalProfit !== 0 && (
              <span className={` ml-1 ${profitPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                &middot; {profitPositive ? '+' : ''}${stats.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} profit
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Inventory Needing Action', value: agingAlerts.count, detail: agingAlerts.count > 0 ? `Past ${agingThresholds.reviewDays} days` : 'No aging alerts', href: '/inventory?age=stale' },
            { label: 'Items To List Today', value: items.filter((item) => !item.listed_ebay_at && !item.listed_amazon_at && !item.listed_whatnot_at && (item.status || 'available') !== 'sold').length, detail: 'Unlisted inventory', href: '/inventory' },
            { label: 'Show Prep Status', value: topDeals.length, detail: 'High-score candidates', href: '/shows' },
            { label: 'Safe Buying Check', value: profitPositive ? 'Review' : 'Hold', detail: 'Open finance before buying', href: '/finance' },
          ].map((card) => (
            <Link key={card.label} href={card.href} className="rounded-2xl border border-border/40 bg-card p-4 transition-colors hover:border-primary/25 hover:bg-primary/[0.04]">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="mt-2 text-2xl font-bold text-white/90">{card.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{card.detail}</div>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <div className="label-caps mb-3">Total Invested</div>
            <div className="text-[28px] font-bold stat-number">${stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="text-sm text-muted-foreground mt-1">{stats.itemCount} items</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <div className="label-caps mb-3">Unrealized Profit</div>
            <div className={`text-[28px] font-bold stat-number ${profitPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {profitPositive ? '+' : ''}${stats.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {stats.totalSpent > 0 ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% return` : 'No data'}
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <div className="label-caps mb-3">Avg Deal Score</div>
            <div className="text-[28px] font-bold stat-number text-primary">{stats.avgDealScore}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {stats.avgDealScore >= 70 ? 'Excellent picks' : stats.avgDealScore >= 40 ? 'Good collection' : stats.itemCount > 0 ? 'Below average' : 'No data'}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <div>
                <div className="font-semibold text-base tracking-tight">Hot Deals</div>
                <div className="text-sm text-muted-foreground mt-0.5">Ranked by deal score</div>
              </div>
              <Link href="/inventory">
                <Button variant="ghost" size="sm" className="h-9 text-sm text-muted-foreground hover:text-foreground -mr-1">
                  All items <ChevronRight className="w-4 h-4 ml-0.5" />
                </Button>
              </Link>
            </div>
            <div className="divide-y divide-border/30">
              {topDeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14">
                  <Package className="w-9 h-9 mb-3 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground mb-3">No priced items yet</p>
                  <Link href="/scan">
                    <Button size="sm" className="h-9 text-sm rounded-lg">
                      <ScanBarcode className="w-4 h-4 mr-1.5" />
                      Scan your first item
                    </Button>
                  </Link>
                </div>
              ) : (
                topDeals.map((item, i) => {
                  const profit = item.marketValue - item.purchase_price;
                  return (
                    <Link
                      key={item.id}
                      href={`/inventory/${item.id}`}
                      className="flex items-center justify-between px-6 py-4 hover:bg-secondary/30 transition-colors group"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="text-sm font-mono text-muted-foreground/40 w-5 text-center flex-shrink-0">{i + 1}</div>
                        <div className="min-w-0">
                          <div className="font-medium text-base truncate">{item.product_name}</div>
                          <div className="text-sm text-muted-foreground mt-0.5">{item.console} &middot; {item.condition}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                        <div className="text-right hidden sm:block">
                          <div className="text-base font-semibold stat-number">${item.marketValue.toFixed(2)}</div>
                          <div className={`text-sm stat-number ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-sm px-2.5 py-1 font-bold ${
                            item.dealScore.score >= 70 ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                            item.dealScore.score >= 40 ? 'border-primary/30 text-primary bg-primary/10' :
                            'border-red-500/30 text-red-400 bg-red-500/10'
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

          <div className="space-y-3">
            <div className={`rounded-xl border p-4 ${
              agingAlerts.count > 0
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-border/40 bg-card'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2 ${agingAlerts.count > 0 ? 'bg-red-500/10' : 'bg-secondary/40'}`}>
                  <Bell className={`h-4 w-4 ${agingAlerts.count > 0 ? 'text-red-300' : 'text-muted-foreground'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold">Aging Inventory</div>
                    <ContextHelp href="/help#dashboard-overview" label="Open aging inventory help">
                      Aging alerts remind you to revise price, photos, sales channel, or bundle strategy.
                    </ContextHelp>
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {agingAlerts.count > 0
                      ? `${agingAlerts.count} item${agingAlerts.count === 1 ? '' : 's'} past ${agingThresholds.reviewDays} days`
                      : `No items past ${agingThresholds.reviewDays} days`}
                  </div>
                </div>
              </div>
              {agingAlerts.count > 0 && (
                <div className="mt-3 space-y-2">
                  {agingAlerts.items.slice(0, 3).map((item) => (
                    <Link key={item.id} href={`/inventory/${item.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-black/10 px-3 py-2 hover:bg-red-500/10">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.product_name}</div>
                        <div className="text-xs text-muted-foreground">{item.console} &middot; {item.condition}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-red-500/30 text-red-300">
                        <Clock className="mr-1 h-3 w-3" />
                        {item.ageDays}d
                      </Badge>
                    </Link>
                  ))}
                  <Link href="/inventory?age=stale">
                    <Button variant="outline" size="sm" className="mt-1 h-9 w-full border-red-500/30 text-red-100 hover:bg-red-500/10">
                      Review aging items
                    </Button>
                  </Link>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '30d', watchDays: 21, reviewDays: 30 },
                      { label: '60d', watchDays: 45, reviewDays: 60 },
                      { label: '90d', watchDays: 75, reviewDays: 90 },
                    ].map((preset) => (
                      <Button
                        key={preset.label}
                        variant="outline"
                        size="sm"
                        className="h-8 border-red-500/20 px-2 text-xs text-red-100 hover:bg-red-500/10"
                        onClick={() => saveAgingThresholds(preset)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="label-caps px-1 mb-3">Quick Actions</div>
            {[
              { href: '/scan', icon: ScanBarcode, label: 'Scan Items', sub: 'Add via barcode' },
              { href: '/inventory?action=add', icon: Package, label: 'Add Manually', sub: 'Enter item details' },
              { href: '/shows', icon: ListChecks, label: 'Show Builder', sub: 'Plan Whatnot shows' },
              { href: '/inventory', icon: TrendingUp, label: 'View Inventory', sub: `${stats.itemCount} items` },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.href} href={action.href}>
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card hover:border-border/60 hover:bg-card/80 transition-all cursor-pointer group">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-base font-medium">{action.label}</div>
                      <div className="text-sm text-muted-foreground">{action.sub}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 ml-auto group-hover:text-muted-foreground/60 transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
