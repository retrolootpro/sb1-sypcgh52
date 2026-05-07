'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Lightbulb, TrendingUp, TrendingDown, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, DollarSign, Package, Target, CalendarClock, ArrowUpRight, ArrowDownRight, Minus, BookOpen, ShieldCheck, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { getPLStatement, getTaxProfile, formatCurrency } from '@/lib/finance-services';
import { format, differenceInDays, startOfYear, endOfYear } from 'date-fns';

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  sell_price: number | null;
  status: string;
  created_at: string;
  sold_at: string | null;
};

type CategoryStat = {
  console: string;
  totalSold: number;
  totalCost: number;
  totalRevenue: number;
  roi: number;
  avgDaysToSell: number;
};

type Recommendation = {
  type: 'success' | 'warning' | 'info' | 'action';
  title: string;
  body: string;
};

const QUARTERLY_DEADLINES: { label: string; date: string; month: number; day: number }[] = [
  { label: 'Q1', date: 'April 15', month: 3, day: 15 },
  { label: 'Q2', date: 'June 16', month: 5, day: 16 },
  { label: 'Q3', date: 'September 15', month: 8, day: 15 },
  { label: 'Q4', date: 'January 15', month: 0, day: 15 },
];

function healthLabel(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 75) return { label: 'Strong', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
  if (score >= 50) return { label: 'Healthy', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' };
  if (score >= 30) return { label: 'Developing', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  return { label: 'Just Starting', color: 'text-white/50', bg: 'bg-white/5', border: 'border-white/10' };
}

function MetricCard({ label, value, sub, trend, icon: Icon, color = 'neutral' }: {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ElementType;
  color?: 'emerald' | 'red' | 'amber' | 'sky' | 'neutral';
}) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    sky: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
    neutral: 'bg-white/5 border-white/10 text-white/40',
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-white/90 tracking-tight">{value}</div>
        {sub && (
          <div className={`flex items-center gap-1 mt-1 text-xs ${
            trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-white/40'
          }`}>
            {trend === 'up' && <ArrowUpRight className="w-3 h-3" />}
            {trend === 'down' && <ArrowDownRight className="w-3 h-3" />}
            {trend === 'neutral' && <Minus className="w-3 h-3" />}
            <span>{sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const styles = {
    success: { icon: CheckCircle, iconClass: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/15' },
    warning: { icon: AlertTriangle, iconClass: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/15' },
    info: { icon: BookOpen, iconClass: 'text-sky-400', bg: 'bg-sky-500/5 border-sky-500/15' },
    action: { icon: Zap, iconClass: 'text-primary', bg: 'bg-primary/5 border-primary/15' },
  };
  const s = styles[rec.type];
  const Icon = s.icon;
  return (
    <div className={`rounded-xl border p-4 ${s.bg}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.iconClass}`} />
        <div>
          <div className="text-sm font-semibold text-white/80 mb-0.5">{rec.title}</div>
          <div className="text-xs text-muted-foreground leading-relaxed">{rec.body}</div>
        </div>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const { user, accountId } = useAuth();
  const now = new Date();
  const year = now.getFullYear();

  const [loading, setLoading] = useState(true);
  const [ytdPL, setYtdPL] = useState<Awaited<ReturnType<typeof getPLStatement>> | null>(null);
  const [taxProfile, setTaxProfile] = useState<Awaited<ReturnType<typeof getTaxProfile>> | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    setLoading(true);
    try {
      const [pl, tax, inv] = await Promise.all([
        getPLStatement(year),
        getTaxProfile(),
        supabase
          .from('inventory_items')
          .select('id, product_name, console, condition, purchase_price, sell_price, status, created_at, sold_at')
      .eq('user_id', accountId)
          .order('created_at', { ascending: false }),
      ]);
      setYtdPL(pl);
      setTaxProfile(tax);
      setInventoryItems((inv.data as InventoryItem[]) || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user, year]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-4">
          <div className="h-8 w-48 rounded-lg bg-white/5 animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card h-28 animate-pulse" />
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card h-48 animate-pulse" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const soldItems = inventoryItems.filter(i => i.status === 'sold' && i.sell_price != null);
  const unsoldItems = inventoryItems.filter(i => i.status === 'available');
  const ytdSoldItems = soldItems.filter(i => {
    if (!i.sold_at) return false;
    const soldDate = new Date(i.sold_at);
    return soldDate >= startOfYear(now) && soldDate <= endOfYear(now);
  });

  const totalInventoryValue = unsoldItems.reduce((s, i) => s + (i.purchase_price || 0), 0);
  const staleItems30 = unsoldItems.filter(i => differenceInDays(now, new Date(i.created_at)) > 30);
  const staleItems60 = unsoldItems.filter(i => differenceInDays(now, new Date(i.created_at)) > 60);

  const avgRoi = ytdSoldItems.length > 0
    ? ytdSoldItems.reduce((s, i) => {
        const roi = i.purchase_price > 0 ? ((i.sell_price! - i.purchase_price) / i.purchase_price) * 100 : 0;
        return s + roi;
      }, 0) / ytdSoldItems.length
    : 0;

  const avgDaysToSell = ytdSoldItems.length > 0
    ? ytdSoldItems.reduce((s, i) => {
        const days = i.sold_at ? differenceInDays(new Date(i.sold_at), new Date(i.created_at)) : 0;
        return s + Math.max(0, days);
      }, 0) / ytdSoldItems.length
    : 0;

  const netProfit = ytdPL?.netProfit ?? 0;
  const revenue = ytdPL?.revenue ?? 0;
  const netMargin = ytdPL?.netMargin ?? 0;
  const taxRate = taxProfile?.effective_tax_rate ?? 25;
  const estimatedTaxOwed = Math.max(0, netProfit * (taxRate / 100));
  const taxSetAsidePerMonth = estimatedTaxOwed / 12;

  const healthScore = (() => {
    let score = 0;
    if (netMargin >= 30) score += 30;
    else if (netMargin >= 15) score += 20;
    else if (netMargin >= 5) score += 10;
    else if (revenue > 0) score += 5;

    if (avgRoi >= 75) score += 25;
    else if (avgRoi >= 40) score += 18;
    else if (avgRoi >= 20) score += 10;
    else if (ytdSoldItems.length > 0) score += 5;

    if (avgDaysToSell > 0 && avgDaysToSell < 21) score += 20;
    else if (avgDaysToSell < 45) score += 14;
    else if (avgDaysToSell < 90) score += 7;

    if (inventoryItems.length > 0) score += 10;
    if (ytdSoldItems.length > 0) score += 10;
    if (taxProfile) score += 5;

    return Math.min(100, score);
  })();

  const health = healthLabel(healthScore);

  const categoryStats: CategoryStat[] = (() => {
    const map: Record<string, { totalSold: number; totalCost: number; totalRevenue: number; daysSum: number; daysCount: number }> = {};
    for (const item of ytdSoldItems) {
      const key = item.console || 'Unknown';
      if (!map[key]) map[key] = { totalSold: 0, totalCost: 0, totalRevenue: 0, daysSum: 0, daysCount: 0 };
      map[key].totalSold += 1;
      map[key].totalCost += item.purchase_price || 0;
      map[key].totalRevenue += item.sell_price || 0;
      if (item.sold_at) {
        const d = differenceInDays(new Date(item.sold_at), new Date(item.created_at));
        if (d >= 0) { map[key].daysSum += d; map[key].daysCount += 1; }
      }
    }
    return Object.entries(map)
      .map(([console, s]) => ({
        console,
        totalSold: s.totalSold,
        totalCost: s.totalCost,
        totalRevenue: s.totalRevenue,
        roi: s.totalCost > 0 ? ((s.totalRevenue - s.totalCost) / s.totalCost) * 100 : 0,
        avgDaysToSell: s.daysCount > 0 ? Math.round(s.daysSum / s.daysCount) : 0,
      }))
      .sort((a, b) => b.roi - a.roi);
  })();

  const nextDeadline = (() => {
    for (const q of QUARTERLY_DEADLINES) {
      const deadlineYear = q.label === 'Q4' ? year + 1 : year;
      const d = new Date(deadlineYear, q.month, q.day);
      if (d >= now) return { ...q, date_obj: d, daysUntil: differenceInDays(d, now) };
    }
    return null;
  })();

  const recommendations: Recommendation[] = (() => {
    const recs: Recommendation[] = [];

    if (inventoryItems.length === 0) {
      recs.push({ type: 'action', title: 'Add your first inventory', body: 'Use the Scan or Inventory page to add your first item. Once you have items tracked, insights become much more powerful.' });
    }

    if (staleItems60.length > 0) {
      recs.push({ type: 'warning', title: `${staleItems60.length} item${staleItems60.length > 1 ? 's' : ''} sitting 60+ days`, body: `Items that don't sell tie up your cash. Consider lowering prices or bundling them at shows to recover your investment and free up buying power.` });
    } else if (staleItems30.length > 0) {
      recs.push({ type: 'warning', title: `${staleItems30.length} item${staleItems30.length > 1 ? 's' : ''} over 30 days old`, body: 'These items are starting to age. Review their pricing against current market values — a small price drop often means a faster sale.' });
    }

    if (estimatedTaxOwed > 0 && nextDeadline) {
      recs.push({
        type: nextDeadline.daysUntil <= 30 ? 'warning' : 'info',
        title: `Set aside ${formatCurrency(taxSetAsidePerMonth)}/month for taxes`,
        body: `Based on your ${taxRate}% effective tax rate, your estimated annual tax is ${formatCurrency(estimatedTaxOwed)}. Your next quarterly payment is due ${nextDeadline.date} (${nextDeadline.daysUntil} days away).`,
      });
    } else if (!taxProfile) {
      recs.push({ type: 'info', title: 'Configure your tax profile', body: 'Go to Finance → Taxes and set your effective tax rate. This lets Insights estimate your quarterly obligations so you\'re never caught off guard.' });
    }

    if (avgRoi > 0 && categoryStats.length > 0) {
      const best = categoryStats[0];
      recs.push({ type: 'success', title: `${best.console} is your most profitable category`, body: `You're averaging ${best.roi.toFixed(0)}% ROI on ${best.console} items this year. Consider allocating more of your buying budget here.` });
    }

    if (netMargin < 10 && revenue > 0) {
      recs.push({ type: 'warning', title: 'Margins are thin — track all expenses', body: 'Make sure platform fees, shipping costs, and supplies are entered as transactions. Low margins often mean uncategorized expenses rather than a real profitability problem.' });
    } else if (netMargin >= 25) {
      recs.push({ type: 'success', title: `Strong ${netMargin.toFixed(0)}% net margin`, body: 'This is solid profitability for a resale business. As you grow, reinvesting 50–60% of profits into new inventory is a common strategy to scale up.' });
    }

    if (totalInventoryValue > 1000) {
      recs.push({ type: 'info', title: `${formatCurrency(totalInventoryValue)} tied up in unsold inventory`, body: 'This is your working capital at risk. A healthy rule of thumb is to have enough cash reserves to cover 1–2 months of inventory cost, even if nothing sells.' });
    }

    if (recs.length === 0) {
      recs.push({ type: 'action', title: 'Keep building momentum', body: 'Add more inventory and sales data to unlock deeper insights. The more you track, the more this page can help you make smarter buying and pricing decisions.' });
    }

    return recs.slice(0, 5);
  })();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 max-w-5xl">
        <div>
          <h1 className="text-xl font-bold text-white/90 tracking-tight">Business Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">Your business performance at a glance — updated in real time</p>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Business Health Score</div>
              <div className="flex items-end gap-3">
                <span className="text-5xl font-black text-white/90 tracking-tighter">{healthScore}</span>
                <span className="text-xl text-white/30 font-light mb-1">/100</span>
              </div>
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${health.bg} ${health.border} ${health.color}`}>
                <ShieldCheck className="w-3 h-3" />
                {health.label}
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="h-2.5 rounded-full bg-white/5 border border-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${healthScore}%`,
                    background: healthScore >= 75
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : healthScore >= 50
                      ? 'linear-gradient(90deg, #0ea5e9, #38bdf8)'
                      : healthScore >= 30
                      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                      : 'linear-gradient(90deg, #6b7280, #9ca3af)',
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                <div>Profit Margin: <span className="text-white/60">{netMargin.toFixed(1)}%</span></div>
                <div>Avg ROI: <span className="text-white/60">{avgRoi.toFixed(0)}%</span></div>
                <div>Avg Days to Sell: <span className="text-white/60">{avgDaysToSell > 0 ? `${Math.round(avgDaysToSell)}d` : '—'}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="YTD Net Profit"
            value={formatCurrency(netProfit)}
            sub={`${netMargin.toFixed(1)}% margin`}
            trend={netProfit >= 0 ? 'up' : 'down'}
            icon={DollarSign}
            color={netProfit >= 0 ? 'emerald' : 'red'}
          />
          <MetricCard
            label="Avg Item ROI"
            value={`${avgRoi.toFixed(0)}%`}
            sub={`${ytdSoldItems.length} items sold YTD`}
            trend={avgRoi >= 30 ? 'up' : avgRoi >= 0 ? 'neutral' : 'down'}
            icon={TrendingUp}
            color={avgRoi >= 50 ? 'emerald' : avgRoi >= 20 ? 'sky' : 'amber'}
          />
          <MetricCard
            label="Inventory Value"
            value={formatCurrency(totalInventoryValue)}
            sub={`${unsoldItems.length} items in stock`}
            trend="neutral"
            icon={Package}
            color="sky"
          />
          <MetricCard
            label="Avg Days to Sell"
            value={avgDaysToSell > 0 ? `${Math.round(avgDaysToSell)}d` : '—'}
            sub={staleItems30.length > 0 ? `${staleItems30.length} over 30 days` : 'No aging items'}
            trend={avgDaysToSell > 0 && avgDaysToSell < 30 ? 'up' : avgDaysToSell > 60 ? 'down' : 'neutral'}
            icon={Clock}
            color={avgDaysToSell === 0 ? 'neutral' : avgDaysToSell < 30 ? 'emerald' : avgDaysToSell < 60 ? 'amber' : 'red'}
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-white/80">Quarterly Tax Tracker</span>
            </div>

            {nextDeadline && (
              <div className={`rounded-xl p-4 border ${nextDeadline.daysUntil <= 30 ? 'bg-amber-500/8 border-amber-500/20' : 'bg-sky-500/8 border-sky-500/15'}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Next Quarterly Payment</div>
                <div className={`text-lg font-bold ${nextDeadline.daysUntil <= 30 ? 'text-amber-400' : 'text-sky-400'}`}>
                  {nextDeadline.label} — Due {nextDeadline.date}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{nextDeadline.daysUntil} days away</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                <div className="text-[10px] text-muted-foreground mb-1">Est. Annual Tax</div>
                <div className="text-base font-bold text-white/80">{estimatedTaxOwed > 0 ? formatCurrency(estimatedTaxOwed) : '—'}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">at {taxRate}% rate</div>
              </div>
              <div className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                <div className="text-[10px] text-muted-foreground mb-1">Set Aside / Month</div>
                <div className="text-base font-bold text-emerald-400">{taxSetAsidePerMonth > 0 ? formatCurrency(taxSetAsidePerMonth) : '—'}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">recommended</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{year} Quarterly Deadlines</div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUARTERLY_DEADLINES.map(q => {
                  const deadlineYear = q.label === 'Q4' ? year + 1 : year;
                  const d = new Date(deadlineYear, q.month, q.day);
                  const past = d < now;
                  return (
                    <div key={q.label} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs border ${
                      past ? 'border-white/5 bg-white/[0.02] text-white/20' : 'border-white/10 bg-white/[0.04] text-white/60'
                    }`}>
                      <span className="font-medium">{q.label}</span>
                      <span>{q.date}</span>
                      {past && <span className="text-[9px] text-white/20">paid</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/30 pt-3">
              As a self-employed business owner, the IRS generally requires quarterly estimated tax payments if you expect to owe $1,000+ for the year. These are separate from your annual return. Configure your rate in Finance → Taxes.
            </p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-white/80">Category Performance (YTD)</span>
            </div>
            {categoryStats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                <Package className="w-8 h-8 text-white/10" />
                <p className="text-sm text-muted-foreground">No sold items yet this year</p>
                <p className="text-xs text-muted-foreground/70">Sell items and mark them as sold to see which categories drive your profits</p>
              </div>
            ) : (
              <div className="space-y-2.5 overflow-y-auto max-h-64 pr-1">
                {categoryStats.map((cat, idx) => {
                  const profit = cat.totalRevenue - cat.totalCost;
                  const isPositive = profit >= 0;
                  return (
                    <div key={cat.console} className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
                      <div className="text-[10px] text-muted-foreground w-4 text-right shrink-0">#{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-medium text-white/75 truncate">{cat.console}</span>
                          <span className={`text-xs font-bold tabular-nums shrink-0 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {cat.roi.toFixed(0)}% ROI
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-white/5">
                          <div
                            className={`h-full rounded-full ${isPositive ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                            style={{ width: `${Math.min(100, Math.abs(cat.roi) / 1.5)}%` }}
                          />
                        </div>
                        <div className="flex gap-3 mt-1 text-[9px] text-muted-foreground">
                          <span>{cat.totalSold} sold</span>
                          <span>{formatCurrency(profit)} profit</span>
                          {cat.avgDaysToSell > 0 && <span>~{cat.avgDaysToSell}d to sell</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white/80">Recommendations</span>
            <span className="text-[10px] text-muted-foreground ml-auto">Based on your data</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-sky-400" />
            <span className="text-sm font-semibold text-white/80">New Owner Essentials</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              {
                title: 'Separate Your Finances',
                body: 'Open a dedicated business checking account and keep all business income and expenses separate from personal spending. This makes taxes dramatically easier.',
              },
              {
                title: 'Track Every Expense',
                body: 'Platform fees, shipping costs, tape, bubble wrap, mileage to shows — it all counts. Every dollar of business expense reduces your taxable income.',
              },
              {
                title: 'Understand Self-Employment Tax',
                body: 'As a sole proprietor you pay both employer and employee Social Security/Medicare taxes (~15.3%). Budget for this on top of your income tax rate.',
              },
              {
                title: 'Keep Receipts for 3+ Years',
                body: 'The IRS has 3 years to audit ordinary returns. Keep digital copies of all purchase receipts, invoices, and records in case you need to prove deductions.',
              },
              {
                title: 'Price with Fees in Mind',
                body: 'eBay takes ~12-15%, Amazon ~15%, Whatnot ~8%. Always factor platform fees and shipping into your target sell price before listing, not after.',
              },
              {
                title: 'Consider an LLC or S-Corp',
                body: 'Once your net profit consistently exceeds $40K/year, talk to an accountant about entity structure. An S-Corp election can reduce self-employment tax significantly.',
              },
            ].map((tip, i) => (
              <div key={i} className="rounded-xl border border-border/30 bg-secondary/20 p-4 space-y-1.5">
                <div className="text-xs font-semibold text-white/75">{tip.title}</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">{tip.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
