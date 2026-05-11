'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, DollarSign, ReceiptText, ChartBar as BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getTransactions, getPLStatement, formatCurrency, type Transaction } from '@/lib/finance-services';
import { format } from 'date-fns';

function StatCard({ label, value, sub, trend, icon: Icon, color = 'primary' }: {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ElementType;
  color?: 'primary' | 'emerald' | 'red' | 'amber';
}) {
  const colorMap = {
    primary: 'bg-primary/10 border-primary/20 text-primary',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
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
        <div className="stat-number text-2xl font-bold text-white/90 tracking-tight">{value}</div>
        {sub && (
          <div className={`flex items-center gap-1 mt-1 text-xs ${
            trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-muted-foreground'
          }`}>
            {trend === 'up' && <ArrowUpRight className="w-3 h-3" />}
            {trend === 'down' && <ArrowDownRight className="w-3 h-3" />}
            <span>{sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewTab() {
  const now = new Date();
  const [pl, setPL] = useState<Awaited<ReturnType<typeof getPLStatement>> | null>(null);
  const [ytdPL, setYtdPL] = useState<Awaited<ReturnType<typeof getPLStatement>> | null>(null);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [monthly, yearly, recent] = await Promise.all([
        getPLStatement(now.getFullYear(), now.getMonth() + 1),
        getPLStatement(now.getFullYear()),
        getTransactions({ limit: 8 }),
      ]);
      setPL(monthly);
      setYtdPL(yearly);
      setRecentTxns(recent);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/40 bg-card h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const monthName = format(now, 'MMMM yyyy');

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">{monthName}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Revenue" value={formatCurrency(pl?.revenue ?? 0)} icon={DollarSign} color="emerald"
            sub={`${pl?.grossMargin?.toFixed(1)}% gross margin`} trend="neutral" />
          <StatCard label="COGS" value={formatCurrency(pl?.cogs ?? 0)} icon={ReceiptText} color="amber"
            sub="Cost of goods sold" />
          <StatCard label="Gross Profit" value={formatCurrency(pl?.grossProfit ?? 0)} icon={TrendingUp}
            color={(pl?.grossProfit ?? 0) >= 0 ? 'emerald' : 'red'}
            sub={`${pl?.grossMargin?.toFixed(1)}% margin`}
            trend={(pl?.grossProfit ?? 0) >= 0 ? 'up' : 'down'} />
          <StatCard label="Net Profit" value={formatCurrency(pl?.netProfit ?? 0)} icon={BarChart3}
            color={(pl?.netProfit ?? 0) >= 0 ? 'emerald' : 'red'}
            sub={`${pl?.netMargin?.toFixed(1)}% margin`}
            trend={(pl?.netProfit ?? 0) >= 0 ? 'up' : 'down'} />
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">Year to Date {now.getFullYear()}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="YTD Revenue" value={formatCurrency(ytdPL?.revenue ?? 0)} icon={DollarSign} color="primary" />
          <StatCard label="YTD COGS" value={formatCurrency(ytdPL?.cogs ?? 0)} icon={ReceiptText} color="amber" />
          <StatCard label="YTD Gross Profit" value={formatCurrency(ytdPL?.grossProfit ?? 0)} icon={TrendingUp}
            color={(ytdPL?.grossProfit ?? 0) >= 0 ? 'emerald' : 'red'}
            trend={(ytdPL?.grossProfit ?? 0) >= 0 ? 'up' : 'down'} />
          <StatCard label="YTD Net Profit" value={formatCurrency(ytdPL?.netProfit ?? 0)} icon={BarChart3}
            color={(ytdPL?.netProfit ?? 0) >= 0 ? 'emerald' : 'red'}
            trend={(ytdPL?.netProfit ?? 0) >= 0 ? 'up' : 'down'} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/40 bg-card p-5">
          <div className="text-sm font-semibold text-white/80 mb-4">Revenue by Platform (This Month)</div>
          {Object.keys(pl?.revenueByPlatform ?? {}).length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No sales data this month</div>
          ) : (
            <div className="space-y-3">
              {Object.entries(pl?.revenueByPlatform ?? {})
                .sort(([, a], [, b]) => b - a)
                .map(([platform, amount]) => {
                  const total = pl?.revenue || 1;
                  const pct = (amount / total) * 100;
                  return (
                    <div key={platform}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-white/60 capitalize">{platform}</span>
                        <span className="text-white/80 font-medium">{formatCurrency(amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary/60">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-5">
          <div className="text-sm font-semibold text-white/80 mb-4">Recent Transactions</div>
          {recentTxns.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No transactions yet</div>
          ) : (
            <div className="space-y-2">
              {recentTxns.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0">
                    <div className="text-xs text-white/70 truncate max-w-[200px]">{tx.description}</div>
                    <div className="text-[10px] text-muted-foreground">{format(new Date(tx.date), 'MMM d')} · {tx.category}</div>
                  </div>
                  <span className={`text-xs font-medium tabular-nums ml-3 shrink-0 ${
                    tx.type === 'income' ? 'text-emerald-400' : tx.type === 'transfer' ? 'text-blue-400' : 'text-red-400'
                  }`}>
                    {tx.type === 'income' ? '+' : tx.type === 'transfer' && Number(tx.amount) >= 0 ? '' : '-'}{formatCurrency(Math.abs(tx.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {Object.keys(pl?.expensesByCategory ?? {}).length > 0 && (
        <div className="rounded-2xl border border-border/40 bg-card p-5">
          <div className="text-sm font-semibold text-white/80 mb-4">Expenses by Category (This Month)</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(pl?.expensesByCategory ?? {})
              .sort(([, a], [, b]) => b - a)
              .map(([cat, amt]) => (
                <div key={cat} className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">{cat}</div>
                  <div className="text-sm font-semibold text-red-400 tabular-nums">{formatCurrency(amt)}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
