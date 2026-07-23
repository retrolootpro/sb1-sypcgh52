'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Banknote,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  GitMerge,
  ListChecks,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatCurrency,
  applyLedgerReviewAction,
  autoReconcileLedger,
  getLedgerAutomationSummary,
  markLedgerTransactionReconciled,
  syncLedgerSources,
  type LedgerAutoReconcileResult,
  type LedgerAutomationRule,
  type LedgerAutomationSummary,
  type LedgerReviewItem,
  type LedgerSourceSyncResult,
} from '@/lib/finance-services';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const confidenceStyles = {
  high: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  medium: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  review: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
};

function StepCard({
  number,
  title,
  body,
  href,
  action,
  complete,
}: {
  number: number;
  title: string;
  body: string;
  href: string;
  action: string;
  complete?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-start gap-3">
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold',
          complete ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-primary/25 bg-primary/10 text-primary'
        )}>
          {complete ? <CheckCircle2 className="h-4 w-4" /> : number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/85">{title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
          <Button asChild variant="outline" size="sm" className="mt-3 h-8 text-xs">
            <Link href={href}>
              {action}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-2 text-2xl font-bold tracking-tight',
        tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-white/90'
      )}>
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function RuleCard({ rule }: { rule: LedgerAutomationRule }) {
  return (
    <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white/85">{rule.label}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{rule.match}</div>
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-[9px]', confidenceStyles[rule.confidence])}>
          {rule.confidence}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border/40 bg-background/50 px-2 py-1 text-muted-foreground">{rule.type}</span>
        <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-primary">{rule.category}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{rule.reason}</p>
    </div>
  );
}

export function LedgerTab() {
  const [summary, setSummary] = useState<LedgerAutomationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [hiddenReviewIds, setHiddenReviewIds] = useState<Set<string>>(() => new Set());
  const [lastSync, setLastSync] = useState<LedgerSourceSyncResult | null>(null);
  const [lastReconcile, setLastReconcile] = useState<LedgerAutoReconcileResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getLedgerAutomationSummary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncSources = async () => {
    setSyncing(true);
    try {
      const result = await syncLedgerSources();
      setLastSync(result);
      await load();
      const errors = [result.bank.error, result.ebay.error, result.whatnot.error, result.ledgerOrders.error].filter(Boolean);
      if (errors.length > 0) {
        toast.warning(`Sync finished with ${errors.length} item${errors.length === 1 ? '' : 's'} needing setup`);
      } else {
        toast.success('Bank, eBay, and Whatnot sync complete');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ledger sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleAutoReconcile = async () => {
    setReconciling(true);
    try {
      const result = await autoReconcileLedger();
      setLastReconcile(result);
      await load();
      toast.success(`Auto reconciliation complete: ${result.categorized} categorized, ${result.reconciled} reconciled, ${result.payoutMatches} payout matched`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Auto reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const handleApplySuggestion = async (item: LedgerReviewItem) => {
    setBusyItemId(item.id);
    try {
      await applyLedgerReviewAction({
        transactionId: item.id,
        category: item.suggestedCategory,
        type: item.suggestedType,
        reason: item.reason,
      });
      toast.success(`Applied ${item.suggestedCategory}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not apply suggestion');
    } finally {
      setBusyItemId(null);
    }
  };

  const handleApplyAndReconcile = async (item: LedgerReviewItem) => {
    setBusyItemId(item.id);
    try {
      await applyLedgerReviewAction({
        transactionId: item.id,
        category: item.suggestedCategory,
        type: item.suggestedType,
        reason: item.reason,
        markReconciled: true,
      });
      toast.success('Suggestion applied and transaction reconciled');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not close review item');
    } finally {
      setBusyItemId(null);
    }
  };

  const handleMarkReconciled = async (item: LedgerReviewItem) => {
    setBusyItemId(item.id);
    try {
      await markLedgerTransactionReconciled(item.id);
      toast.success('Transaction marked reconciled');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark transaction reconciled');
    } finally {
      setBusyItemId(null);
    }
  };

  const handleSkipReviewItem = (item: LedgerReviewItem) => {
    setHiddenReviewIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    toast.message('Hidden until the next refresh');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-44 rounded-2xl border border-border/40 bg-card animate-pulse" />
        <div className="grid gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="h-28 rounded-2xl border border-border/40 bg-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">
        Ledger automation could not load. Try refreshing Finance.
      </div>
    );
  }

  const connected = summary.connectedInstitutions > 0;
  const scoreTone = summary.readyForExportScore >= 80 ? 'good' : summary.readyForExportScore >= 55 ? 'neutral' : 'warn';
  const visibleReviewItems = summary.reviewItems.filter((item) => !hiddenReviewIds.has(item.id));

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-primary/25 bg-card">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Ledger Automation
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-white/90">A reseller bookkeeper built into RetroLootPro</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              This takes the useful parts of QuickBooks, Seller Ledger, and My Reseller Genie: bank feeds, marketplace imports,
              COGS awareness, review queues, and tax-ready exports. The goal is simple: connect accounts, review exceptions,
              close the month, and hand clean numbers to your CPA.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="h-9" onClick={handleSyncSources} disabled={syncing}>
                <RefreshCw className={cn('mr-2 h-4 w-4', syncing && 'animate-spin')} />
                {syncing ? 'Syncing...' : 'Sync bank, eBay, Whatnot'}
              </Button>
              <Button size="sm" variant="outline" className="h-9" onClick={handleAutoReconcile} disabled={reconciling}>
                <Sparkles className={cn('mr-2 h-4 w-4', reconciling && 'animate-pulse')} />
                {reconciling ? 'Reconciling...' : 'Auto reconcile safe matches'}
              </Button>
              <Button asChild size="sm" variant="outline" className="h-9">
                <Link href="/finance?tab=banks">
                  <Building2 className="mr-2 h-4 w-4" />
                  Connect accounts
                </Link>
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-secondary/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CPA Readiness</div>
                <div className={cn(
                  'mt-2 text-4xl font-bold',
                  scoreTone === 'good' ? 'text-emerald-400' : scoreTone === 'warn' ? 'text-amber-400' : 'text-primary'
                )}>
                  {summary.readyForExportScore}%
                </div>
              </div>
              <BookOpenCheck className={cn(
                'h-10 w-10',
                scoreTone === 'good' ? 'text-emerald-400' : scoreTone === 'warn' ? 'text-amber-400' : 'text-primary'
              )} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              This score improves as bank feeds connect, transactions are reconciled, expenses are reviewed, and lots have allocated COGS.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatusMetric
          label="Connected accounts"
          value={String(summary.connectedBankAccounts)}
          detail={`${summary.connectedInstitutions} institution${summary.connectedInstitutions === 1 ? '' : 's'} connected`}
          tone={connected ? 'good' : 'warn'}
        />
        <StatusMetric
          label="YTD ledger lines"
          value={String(summary.transactionsYtd)}
          detail={summary.lastSyncedAt ? `Last bank sync ${new Date(summary.lastSyncedAt).toLocaleDateString()}` : 'Add bank sync or import files'}
        />
        <StatusMetric
          label="Needs review"
          value={String(summary.needsReviewCount)}
          detail={`${summary.unreconciledCount} unreconciled, ${summary.uncategorizedCount} uncategorized`}
          tone={summary.needsReviewCount === 0 ? 'good' : 'warn'}
        />
        <StatusMetric
          label="COGS checks"
          value={String(summary.lotReviewCount)}
          detail="Lots needing cost allocation review"
          tone={summary.lotReviewCount === 0 ? 'good' : 'warn'}
        />
      </div>

      {(lastSync || lastReconcile) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {lastSync && (
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                <RefreshCw className="h-4 w-4 text-primary" />
                Last Source Sync
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <SyncLine label="Bank" value={`${lastSync.bank.added} added / ${lastSync.bank.modified} updated`} error={lastSync.bank.error} />
                <SyncLine label="eBay" value={`${lastSync.ebay.imported} orders`} error={lastSync.ebay.error} />
                <SyncLine label="Whatnot" value={`${lastSync.whatnot.imported} orders`} error={lastSync.whatnot.error} />
                <SyncLine label="Ledger lines" value={`${lastSync.ledgerOrders.imported} imported`} error={lastSync.ledgerOrders.error} />
              </div>
            </div>
          )}
          {lastReconcile && (
            <div className="rounded-2xl border border-border/40 bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Last Auto Reconcile
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                <ResultPill label="Categorized" value={lastReconcile.categorized} />
                <ResultPill label="Reconciled" value={lastReconcile.reconciled} />
                <ResultPill label="Payout matches" value={lastReconcile.payoutMatches} />
                <ResultPill label="Left for review" value={lastReconcile.reviewed} />
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Exact payout matches are closed automatically. Fee-adjusted or bundled payouts stay in review until the app can prove the match.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        <StepCard
          number={1}
          title="Connect money accounts"
          body="Connect your business checking, credit card, PayPal, or other money accounts so expenses and deposits appear automatically."
          href="/finance?tab=banks"
          action="Open Banks"
          complete={connected}
        />
        <StepCard
          number={2}
          title="Bring in platform activity"
          body="Import eBay, Whatnot, Amazon, POS, and show sales so payout deposits can be matched instead of double-counted."
          href="/finance?tab=transactions"
          action="Import Sales"
          complete={summary.transactionsYtd > 0}
        />
        <StepCard
          number={3}
          title="Review exceptions"
          body="Work the review queue: uncategorized transactions, transfers, inventory buys, and anything not confidently matched."
          href="/finance?tab=transactions"
          action="Review Queue"
          complete={summary.needsReviewCount === 0}
        />
        <StepCard
          number={4}
          title="Close the month"
          body="Check P&L, COGS, tax reserve, and export clean summaries for your CPA or outside accounting app."
          href="/finance?tab=pl"
          action="Open P&L"
          complete={summary.readyForExportScore >= 80}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-2xl border border-border/40 bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                <ListChecks className="h-4 w-4 text-primary" />
                Review Queue
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Start here each week. These are the ledger lines automation would ask you to confirm.</p>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          <div className="divide-y divide-border/30">
            {visibleReviewItems.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                <div className="mt-3 text-sm font-semibold text-white/80">Nothing obvious needs review</div>
                <p className="mt-1 text-xs text-muted-foreground">You can still open Transactions for a manual reconciliation pass.</p>
              </div>
            ) : visibleReviewItems.map((item) => {
              const isBusy = busyItemId === item.id;
              const hasSuggestion = item.suggestedCategory !== 'Uncategorized' || item.suggestedType !== item.type;
              const canCloseWithSuggestion = hasSuggestion && !item.is_reconciled && item.confidence !== 'review';

              return (
                <div key={item.id} className={cn('p-4 transition-colors', isBusy && 'bg-primary/5')}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-white/85">{item.description}</div>
                        {!item.is_reconciled && (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-400">
                            unreconciled
                          </Badge>
                        )}
                        {item.category === 'Uncategorized' && (
                          <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[9px] text-red-400">
                            uncategorized
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(item.date).toLocaleDateString()} / {item.source} / current: {item.category}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <GitMerge className="h-3.5 w-3.5 text-primary" />
                        <span className="text-muted-foreground">Suggested:</span>
                        <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-primary">{item.suggestedCategory}</span>
                        <Badge variant="outline" className={cn('text-[9px]', confidenceStyles[item.confidence])}>{item.confidence}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</p>
                    </div>
                    <div className="shrink-0 text-left md:w-56 md:text-right">
                      <div className={cn(
                        'text-sm font-bold tabular-nums',
                        item.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {item.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(item.amount))}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{item.type}</div>
                      <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={isBusy || !hasSuggestion}
                          onClick={() => handleApplySuggestion(item)}
                        >
                          Apply
                        </Button>
                        {canCloseWithSuggestion ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={isBusy}
                            onClick={() => handleApplyAndReconcile(item)}
                          >
                            Apply + close
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={isBusy || item.is_reconciled}
                            onClick={() => handleMarkReconciled(item)}
                          >
                            Close
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground"
                          disabled={isBusy}
                          onClick={() => handleSkipReviewItem(item)}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border/40 bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              What This Replaces
            </div>
            <div className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">
              <div className="flex gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span><b className="text-white/80">QuickBooks:</b> keep the accountant-ready exports, skip forcing item-level reseller logic into a generic ledger.</span>
              </div>
              <div className="flex gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span><b className="text-white/80">Seller Ledger:</b> borrow payout matching, COGS awareness, and transaction-based pricing tiers.</span>
              </div>
              <div className="flex gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span><b className="text-white/80">My Reseller Genie:</b> borrow the guided reseller workflow, tax reports, and easy bank expense review.</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
              <Banknote className="h-4 w-4 text-primary" />
              Automation Rules
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">These are the first reseller-specific rules. Later, this can become editable rules with one-click apply.</p>
            <div className="mt-4 grid gap-3">
              {summary.rules.map((rule) => <RuleCard key={rule.id} rule={rule} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SyncLine({ label, value, error }: { label: string; value: string; error?: string | null }) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      error ? 'border-amber-500/25 bg-amber-500/5' : 'border-border/40 bg-secondary/20'
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-white/80">{label}</span>
        {error ? <CircleAlert className="h-3.5 w-3.5 text-amber-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
      </div>
      <div className="mt-1 text-muted-foreground">{error || value}</div>
    </div>
  );
}

function ResultPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold text-white/90">{value}</div>
    </div>
  );
}
