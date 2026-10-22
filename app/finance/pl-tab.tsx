'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getMissingCogsItems, getPLStatement, formatCurrency, type MissingCogsItem, type PLStatement } from '@/lib/finance-services';
import { useAuth } from '@/lib/auth-context';
import { financeCsv } from '@/lib/finance-reporting';
import { FinanceReportNotice } from './overview-tab';

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
  const { accountId } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>('all');
  const [pl, setPL] = useState<PLStatement | null>(null);
  const [missingCogsItems, setMissingCogsItems] = useState<MissingCogsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [costError, setCostError] = useState('');
  const generation = useRef({});

  const load = useCallback(async () => {
    const current = {}; generation.current = current;
    setLoading(true); setPL(null); setMissingCogsItems([]); setLoadError(''); setCostError('');
    if (!accountId) { setLoading(false); return; }
    try {
      const selectedMonth = month !== 'all' ? parseInt(month) : undefined;
      const [report, costs] = await Promise.allSettled([
        getPLStatement(parseInt(year), selectedMonth), getMissingCogsItems(parseInt(year), selectedMonth),
      ]);
      if (generation.current !== current) return;
      if (report.status === 'fulfilled') setPL(report.value);
      else { console.error('P&L report:', report.reason); setLoadError('This period could not be loaded. Previous totals and exports are hidden until the report is verified.'); }
      if (costs.status === 'fulfilled') setMissingCogsItems(costs.value);
      else { console.error('P&L cost queue:', costs.reason); setCostError('Missing cost-basis records could not be loaded. This does not mean costs are complete. Export is disabled until the queue can be verified.'); }
    } catch (cause) {
      console.error('P&L loading:', cause);
      if (generation.current === current) setLoadError('This period could not be loaded. Retry the report.');
    }
    finally { if (generation.current === current) setLoading(false); }
  }, [year, month, accountId]);

  useEffect(() => { void load(); return () => { generation.current = {}; }; }, [load]);

  const handleExport = () => {
    if (!pl || loading || loadError || costError) return;
    const rows: (string | number)[][] = [
      ['Pixel & Page — recorded P&L (provisional)'],
      ['Period', `${month !== 'all' ? MONTHS[parseInt(month) - 1] : 'Full calendar year'} ${year}`],
      ['Scope', 'Not bank balance or verified net profit. Includes only recorded income/refunds, sold inventory cost and operating expenses. Review missing costs and reconcile entries.'],
      ['Online payments in ledger', pl.onlineOrderCount],
      ['Historical online orders', 'Not backfilled; order cost snapshots and fee reconciliation apply only to new storefront orders.'],
      ['New storefront order COGS', pl.onlineOrderCogs],
      ['New storefront units missing cost snapshot', pl.onlineOrderUnitsMissingCost],
      ['Merchandise sales with missing order cost', pl.onlineOrderMissingCostRevenue],
      ['New storefront orders awaiting Stripe fee', pl.onlineOrdersMissingStripeFeeCount],
      ['Confirmed Shippo labels awaiting Finance posting', pl.onlineLabelsMissingPostageCount],
      ['Sold-inventory cost coverage (%)', pl.cogsCoverage],
      ['Sold inventory records missing cost', pl.missingCogsItemCount],
      ['Sales with missing cost', pl.missingCogsRevenue],
      ['Recorded revenue less refunds', pl.revenue],
      ['Known cost of goods', pl.cogs],
      ['Gross result', pl.grossProfit],
      ['Gross margin (%)', pl.grossMargin],
      ['Operating expenses', pl.operatingExpenses],
      ...Object.entries(pl.expensesByCategory).map(([category, amount]) => [category, amount]),
      ['After recorded expenses (provisional)', pl.netProfit],
      ['Recorded net margin (%)', pl.netMargin],
      [],
      ['MISSING COST BASIS'],
      ['Item', 'Platform', 'Sold date', 'Sale price'],
      ...missingCogsItems.map(item => [item.product_name, item.sold_via || 'Other', item.sold_at || '', item.sell_price]),
    ];
    const blob = new Blob([financeCsv(rows)], { type: 'text/csv;charset=utf-8' });
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
            <SelectTrigger aria-label="Report year" className="h-8 text-xs w-24 bg-secondary/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger aria-label="Report month" className="h-8 text-xs w-36 bg-secondary/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Full Year</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport} disabled={!pl || loading || !!loadError || !!costError}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {costError && <section className="business-overview-message"><p role="alert">{costError}</p><Button variant="outline" onClick={load} disabled={loading}>Retry cost queue</Button></section>}
      {loadError ? <section className="business-overview-message"><p role="alert">{loadError}</p><Button variant="outline" onClick={load}>Retry period report</Button></section> : loading ? (
        <div className="rounded-2xl border border-border/40 bg-card h-96 animate-pulse" />
      ) : pl && (
        <>
        <FinanceReportNotice report={pl}/>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border border-border/40 bg-card p-6 space-y-1">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white/80">Recorded P&amp;L · provisional</h3>
              <span className="text-xs text-muted-foreground">
                {month !== 'all' ? `${MONTHS[parseInt(month) - 1]} ` : ''}{year}
              </span>
            </div>

            {pl?.cogsStatus === 'needs_review' && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <div className="text-sm font-semibold text-amber-200">P&amp;L needs COGS cleanup</div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/80">
                      {pl.missingCogsItemCount} sold item{pl.missingCogsItemCount === 1 ? '' : 's'} have no purchase price,
                      covering {formatCurrency(pl.missingCogsRevenue)} of sales. Results may be overstated until cost basis is confirmed.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <PLDivider label="Revenue" />
            <PLRow label="Recorded revenue, less refunds" value={pl.revenue} />
            <PLRow label="Known cost of goods" value={-(pl?.cogs ?? 0)} indent highlight="neutral" />
            <PLRow label="Gross result" value={pl.grossProfit} bold highlight="green" />
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

            <PLDivider label="After recorded expenses" />
            <PLRow label="Provisional result" value={pl.netProfit} bold highlight="green" />
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
                  { label: 'Sold-record cost coverage', value: pl.cogsCoverage, color: pl.cogsStatus === 'complete' ? 'text-emerald-400' : 'text-amber-400', percent: true },
                  { label: 'Gross result', value: pl.grossProfit, color: pl.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Operating Exp.', value: pl?.operatingExpenses ?? 0, color: 'text-red-400' },
                  { label: 'Provisional result', value: pl.netProfit, color: pl.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    <span className={`text-xs font-semibold tabular-nums ${row.color}`}>
                      {'percent' in row && row.percent ? `${row.value.toFixed(1)}%` : formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {missingCogsItems.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-card p-5">
                <h3 className="text-sm font-semibold text-white/80 mb-3">Missing COGS Queue</h3>
                <div className="space-y-2">
                  {missingCogsItems.slice(0, 8).map((item) => (
                    <Link
                      key={item.id}
                      href={`/business/inventory/${item.id}`}
                      className="block rounded-xl border border-border/30 bg-secondary/20 p-3 transition hover:border-amber-500/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-white/80">{item.product_name}</div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {item.sold_via || 'Other'} · {item.sold_at ? item.sold_at.slice(0, 10) : 'No sold date'}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs font-semibold tabular-nums text-emerald-400">
                          {formatCurrency(item.sell_price)}
                        </div>
                      </div>
                    </Link>
                  ))}
                  {missingCogsItems.length > 8 && (
                    <div className="text-xs text-muted-foreground">
                      {missingCogsItems.length - 8} more item{missingCogsItems.length - 8 === 1 ? '' : 's'} need cost basis.
                    </div>
                  )}
                </div>
              </div>
            )}

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
        </>
      )}
    </div>
  );
}
