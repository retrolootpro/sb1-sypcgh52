'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { TrendingUp, DollarSign, ReceiptText, ChartBar as BarChart3 } from 'lucide-react';
import { getTransactions, getPLStatement, formatCurrency, type Transaction, type PLStatement } from '@/lib/finance-services';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { format } from 'date-fns';

function StatCard({ label, value, sub, icon: Icon }: {
  label: string; value: number; sub: string; icon: React.ElementType;
}) {
  return <div className="finance-stat rounded-2xl border bg-card p-4 space-y-3">
    <div className="flex items-start justify-between gap-2"><span className="text-xs text-muted-foreground">{label}</span><Icon className="h-4 w-4 shrink-0 text-teal-800"/></div>
    <strong className={`block text-2xl tracking-tight tabular-nums ${value < 0 ? 'text-red-800' : 'text-foreground'}`}>{formatCurrency(value)}</strong>
    <p className="text-xs leading-5 text-muted-foreground">{sub}</p>
  </div>;
}

export function FinanceReportNotice({ report }: { report: PLStatement }) {
  return <section className="finance-report-notice" aria-label="Report scope and completeness">
    <strong>Recorded results, not spendable cash.</strong>
    <p>These figures combine ledger income/refunds, sold-inventory costs, saved unit costs for new online orders, and recorded operating expenses. Inventory purchases and owner-loan principal are not operating expenses here. Stripe fees and Shippo postage reduce results after the providers confirm them. Reconcile source entries before making decisions.</p>
    {report.missingCogsItemCount > 0 && <p role="status" className="font-semibold text-amber-900">{report.missingCogsItemCount} sold inventory record(s), covering {formatCurrency(report.missingCogsRevenue)} in sales, have no positive unit cost. Results may be overstated. <Link className="underline" href="/business/finance?tab=pl">Review missing cost basis</Link>.</p>}
    {report.onlineOrderCount > 0 && <p>Online payments include collected shipping but exclude sales tax. New storefront orders use saved unit-cost snapshots; confirmed Stripe fees and Shippo label purchases post as expenses.</p>}
    {report.onlineOrderUnitsMissingCost > 0 && <p role="status" className="font-semibold text-amber-900">{report.onlineOrderUnitsMissingCost} unit(s) in new storefront orders have no positive cost snapshot, covering {formatCurrency(report.onlineOrderMissingCostRevenue)} in merchandise sales. Order costs are missing; results may be overstated.</p>}
    {report.onlineOrdersMissingStripeFeeCount > 0 && <p role="status" className="font-semibold text-amber-900">{report.onlineOrdersMissingStripeFeeCount} new storefront order(s) are awaiting a confirmed Stripe processing fee. Review Stripe reconciliation before relying on this period.</p>}
    {report.onlineLabelsMissingPostageCount > 0 && <p role="status" className="font-semibold text-amber-900">{report.onlineLabelsMissingPostageCount} confirmed Shippo label(s) are awaiting a Finance posting. Refresh reconciliation before relying on this period.</p>}
    <p className="text-xs">Historical storefront orders are not backfilled. Cost coverage measures sold-inventory records and new order snapshots only; it does not certify every expense, label refund or bank reconciliation.</p>
  </section>;
}

export function OverviewTab() {
  const { accountId } = useAuth();
  const [now] = useState(() => new Date());
  const [reports, setReports] = useState<{ month: PLStatement; year: PLStatement } | null>(null);
  const [recent, setRecent] = useState<Transaction[] | null>(null);
  const [reportError, setReportError] = useState('');
  const [recentError, setRecentError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef({});

  useEffect(() => {
    const current = {}; generation.current = current;
    setReports(null); setRecent(null); setReportError(''); setRecentError('');
    if (!accountId) return;
    void Promise.all([getPLStatement(now.getFullYear(), now.getMonth() + 1), getPLStatement(now.getFullYear())])
      .then(([month, year]) => { if (generation.current === current) setReports({ month, year }); })
      .catch(cause => {
        console.error('Finance overview reports:', cause);
        if (generation.current === current) setReportError('Recorded results could not be loaded. No totals are shown until both periods can be verified.');
      });
    void getTransactions({ limit: 8 }).then(data => { if (generation.current === current) setRecent(data); })
      .catch(cause => {
        console.error('Finance recent transactions:', cause);
        if (generation.current === current) setRecentError('Recent transactions could not be loaded. This is not an empty ledger.');
      });
    return () => { generation.current = {}; };
  }, [accountId, now, refresh]);
  const retry = useCallback(() => setRefresh(value => value + 1), []);

  const cards = (report: PLStatement) => <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
    <StatCard label="Recorded revenue, less refunds" value={report.revenue} icon={DollarSign} sub="Ledger income plus unmatched sold records"/>
    <StatCard label="Known cost of goods" value={report.cogs} icon={ReceiptText} sub={`Sold-record cost coverage ${report.cogsCoverage.toFixed(1)}%; new storefront costs tracked separately`}/>
    <StatCard label="Gross result" value={report.grossProfit} icon={TrendingUp} sub="Revenue less known sold-inventory costs"/>
    <StatCard label="After recorded expenses" value={report.netProfit} icon={BarChart3} sub="Provisional result, before unrecorded costs"/>
  </div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Know what the books actually say.</h2><Button variant="outline" onClick={retry}>Refresh finance</Button></div>
    {reportError ? <section className="business-overview-message"><p role="alert">{reportError}</p><Button variant="outline" onClick={retry}>Retry recorded results</Button></section>
      : !reports ? <div role="status" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Loading recorded results…</div>
      : <>
        <FinanceReportNotice report={reports.year}/>
        <section aria-label="This month recorded results"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider">{format(now, 'MMMM yyyy')}</h3>{cards(reports.month)}</section>
        <section aria-label="This year recorded results"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider">{now.getFullYear()} calendar year · includes any future-dated entries</h3>{cards(reports.year)}</section>
        <section className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Recorded revenue by platform · this month</h3>
            {Object.keys(reports.month.revenueByPlatform).length === 0 ? <p className="text-sm text-muted-foreground">No recorded revenue in this period.</p> : <div className="space-y-3">
              {Object.entries(reports.month.revenueByPlatform).sort(([, a], [, b]) => b - a).map(([platform, amount]) => <div key={platform} className="flex flex-wrap justify-between gap-2 text-xs"><span>{platform}</span><strong className={amount < 0 ? 'text-red-800' : ''}>{formatCurrency(amount)}</strong></div>)}
            </div>}
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Recorded operating expenses · this month</h3>
            {Object.keys(reports.month.expensesByCategory).length === 0 ? <p className="text-sm text-muted-foreground">No operating expenses recorded. This does not confirm that no costs were incurred.</p> : <div className="space-y-3">
              {Object.entries(reports.month.expensesByCategory).sort(([, a], [, b]) => b - a).map(([category, amount]) => <div key={category} className="flex flex-wrap justify-between gap-2 text-xs"><span>{category}</span><strong>{formatCurrency(amount)}</strong></div>)}
            </div>}
          </div>
        </section>
      </>}
    <section className="rounded-2xl border bg-card p-5" aria-label="Recent finance transactions">
      <div className="flex flex-wrap justify-between gap-3 mb-4"><h3 className="text-sm font-semibold">Latest eight ledger entries · all dates</h3><Link className="text-xs underline text-teal-800" href="/business/finance?tab=transactions">Open all transactions</Link></div>
      {recentError ? <div><p role="alert" className="text-sm">{recentError}</p><Button className="mt-3" variant="outline" onClick={retry}>Retry recent transactions</Button></div>
        : recent === null ? <p role="status" className="text-sm text-muted-foreground">Loading ledger entries…</p>
        : recent.length === 0 ? <p className="text-sm text-muted-foreground">No ledger entries recorded.</p>
        : <ul className="divide-y">{recent.map(tx => <li key={tx.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0"><p className="text-sm break-words">{tx.description}</p><p className="text-xs text-muted-foreground mt-1">{tx.date.slice(0, 10)} · {tx.category} · {tx.is_reconciled ? 'Reconciled' : 'Needs reconciliation'}</p></div>
          <span className={`text-sm font-semibold shrink-0 tabular-nums ${tx.type === 'income' ? 'text-emerald-800' : tx.type === 'transfer' ? 'text-blue-800' : 'text-red-800'}`}>{tx.type === 'income' ? '+' : tx.type === 'transfer' && Number(tx.amount) >= 0 ? '' : '-'}{formatCurrency(Math.abs(tx.amount))}</span>
        </li>)}</ul>}
    </section>
  </div>;
}
