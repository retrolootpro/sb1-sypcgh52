'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPLStatement, formatCurrency, type PLStatement } from '@/lib/finance-services';
import { toast } from 'sonner';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function PLRow({ label, value, indent = false, bold = false, highlight }: {
  label: string;
  value: number;
  indent?: boolean;
  bold?: boolean;
  highlight?: 'green' | 'red' | 'neutral';
}) {
  const valueColor = highlight === 'green'
    ? value >= 0 ? 'text-emerald-400' : 'text-red-400'
    : highlight === 'red'
    ? 'text-red-400'
    : highlight === 'neutral'
    ? 'text-white/60'
    : value >= 0 ? 'text-white/80' : 'text-red-400';

  return (
    <div className={`flex items-center justify-between py-2 border-b border-border/20 last:border-0 ${bold ? 'bg-secondary/20 rounded-lg px-3 -mx-3 my-1' : ''}`}>
      <span className={`text-sm ${indent ? 'pl-4 text-white/50' : bold ? 'font-semibold text-white/90' : 'text-white/70'}`}>{label}</span>
      <span className={`text-sm font-medium tabular-nums ${bold ? 'font-bold' : ''} ${valueColor}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function PLDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-3">
      <div className="flex-1 h-px bg-border/40" />
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}

export function PLTab() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>('all');
  const [pl, setPL] = useState<PLStatement | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPLStatement(parseInt(year), month !== 'all' ? parseInt(month) : undefined);
      setPL(data);
    } catch { toast.error('Failed to load P&L data'); }
    finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const handleExport = () => {
    if (!pl) return;
    const lines = [
      `Profit & Loss Statement`,
      `Period: ${month !== 'all' ? MONTHS[parseInt(month) - 1] : 'Full Year'} ${year}`,
      ``,
      `REVENUE`,
      `  Gross Revenue,${formatCurrency(pl.revenue)}`,
      `  Cost of Goods Sold,(${formatCurrency(pl.cogs)})`,
      `  Gross Profit,${formatCurrency(pl.grossProfit)}`,
      `  Gross Margin,${pl.grossMargin.toFixed(1)}%`,
      ``,
      `EXPENSES`,
      ...Object.entries(pl.expensesByCategory).map(([cat, amt]) => `  ${cat},${formatCurrency(amt)}`),
      `  Total Operating Expenses,(${formatCurrency(pl.operatingExpenses)})`,
      ``,
      `NET PROFIT / LOSS,${formatCurrency(pl.netProfit)}`,
      `Net Margin,${pl.netMargin.toFixed(1)}%`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pl-${year}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="h-8 text-xs w-24 bg-secondary/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 text-xs w-36 bg-secondary/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Full Year</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport} disabled={!pl}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border/40 bg-card h-96 animate-pulse" />
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border border-border/40 bg-card p-6 space-y-1">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white/80">Profit & Loss Statement</h3>
              <span className="text-xs text-muted-foreground">
                {month !== 'all' ? `${MONTHS[parseInt(month) - 1]} ` : ''}{year}
              </span>
            </div>

            <PLDivider label="Revenue" />
            <PLRow label="Gross Revenue" value={pl?.revenue ?? 0} />
            <PLRow label="Cost of Goods Sold" value={-(pl?.cogs ?? 0)} indent highlight="neutral" />
            <PLRow label="Gross Profit" value={pl?.grossProfit ?? 0} bold highlight="green" />
            <div className="text-xs text-muted-foreground pl-3 pb-2">
              Gross Margin: {pl?.grossMargin?.toFixed(1)}%
            </div>

            {Object.keys(pl?.expensesByCategory ?? {}).length > 0 && (
              <>
                <PLDivider label="Operating Expenses" />
                {Object.entries(pl?.expensesByCategory ?? {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, amt]) => (
                    <PLRow key={cat} label={cat} value={-amt} indent highlight="neutral" />
                  ))}
                <PLRow label="Total Operating Expenses" value={-(pl?.operatingExpenses ?? 0)} bold highlight="neutral" />
              </>
            )}

            <PLDivider label="Net Profit / Loss" />
            <PLRow label="Net Profit / Loss" value={pl?.netProfit ?? 0} bold highlight="green" />
            <div className="text-xs text-muted-foreground pl-3">
              Net Margin: {pl?.netMargin?.toFixed(1)}%
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white/80">Summary</h3>
              <div className="space-y-3">
                {[
                  { label: 'Revenue', value: pl?.revenue ?? 0, color: 'text-emerald-400' },
                  { label: 'COGS', value: pl?.cogs ?? 0, color: 'text-amber-400' },
                  { label: 'Gross Profit', value: pl?.grossProfit ?? 0, color: (pl?.grossProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Operating Exp.', value: pl?.operatingExpenses ?? 0, color: 'text-red-400' },
                  { label: 'Net Profit', value: pl?.netProfit ?? 0, color: (pl?.netProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    <span className={`text-xs font-semibold tabular-nums ${row.color}`}>{formatCurrency(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {Object.keys(pl?.revenueByPlatform ?? {}).length > 0 && (
              <div className="rounded-2xl border border-border/40 bg-card p-5">
                <h3 className="text-sm font-semibold text-white/80 mb-3">Revenue by Platform</h3>
                <div className="space-y-2">
                  {Object.entries(pl?.revenueByPlatform ?? {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([platform, amount]) => (
                      <div key={platform} className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground capitalize">{platform}</span>
                        <span className="text-xs font-medium text-emerald-400 tabular-nums">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
