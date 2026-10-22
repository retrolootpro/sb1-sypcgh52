'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { OverviewTab } from './overview-tab';
import { TransactionsTab } from './transactions-tab';
import { ExpensesTab } from './expenses-tab';
import { PLTab } from './pl-tab';
import { TaxesTab } from './taxes-tab';
import { BanksTab } from './banks-tab';
import { LotsTab } from './lots-tab';
import { LoansTab } from './loans-tab';
import { LedgerTab } from './ledger-tab';
import { cn } from '@/lib/utils';
import { LayoutDashboard, ReceiptText, TrendingUp, FileText, Building2, Layers, WalletCards, ClipboardList, BookOpenCheck } from 'lucide-react';
import { ContextHelp } from '@/components/context-help';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'ledger', label: 'Ledger', icon: BookOpenCheck },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'expenses', label: 'Expenses', icon: ClipboardList },
  { id: 'lots', label: 'Lots', icon: Layers },
  { id: 'loans', label: 'Loans', icon: WalletCards },
  { id: 'pl', label: 'P&L', icon: TrendingUp },
  { id: 'taxes', label: 'Taxes', icon: FileText },
  { id: 'banks', label: 'Banks', icon: Building2 },
];

export default function FinancePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedTab = searchParams.get('tab');
  const activeTab = TABS.some(tab => tab.id === requestedTab) ? requestedTab : 'overview';
  const sections = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = sections.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !selected) return;
    const reveal = () => {
      const bounds = nav.getBoundingClientRect(), button = selected.getBoundingClientRect();
      if (button.right > bounds.right) nav.scrollLeft += button.right - bounds.right;
      else if (button.left < bounds.left) nav.scrollLeft -= bounds.left - button.left;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeTab]);

  const handleTabChange = (id: string) => {
    router.push(`/business/finance?tab=${id}`, { scroll: false });
  };

  return (
    <DashboardLayout>
      <div className="finance-workspace p-4 sm:p-7 max-w-6xl mx-auto space-y-6">
        <div className="catalog-workspace-header">
          <div>
          <p className="brand-eyebrow">BEHIND EVERY GOOD FIND</p>
          <div className="flex items-center gap-2">
            <h1>A clearer view of the business.</h1>
            <ContextHelp href="/business/help#finance-overview" label="Open finance help">
              Review recorded results, costs and source records. Profit reports are not bank balances; missing costs and unreconciled entries require review.
            </ContextHelp>
          </div>
          <p>Follow recorded income and expenses, check cost basis, and keep the next decision grounded in the books.</p>
          </div>
        </div>
        <nav className="catalog-workflow-strip" aria-label="Finance workflow">
          <Link href="/business/finance?tab=transactions"><ReceiptText size={18}/><span><strong>Review the entries</strong><small>Transactions, refunds and reconciliation</small></span></Link>
          <Link href="/business/finance?tab=lots"><Layers size={18}/><span><strong>Check inventory costs</strong><small>Receiving lots and cost allocation</small></span></Link>
          <Link href="/business/finance?tab=pl"><TrendingUp size={18}/><span><strong>Read the report</strong><small>Period results and missing cost basis</small></span></Link>
        </nav>

        <nav ref={sections} aria-label="Finance sections" className="flex gap-0.5 border-b border-border/40 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all duration-100',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-white/40 hover:text-white/70 hover:border-border/40'
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-primary' : 'text-white/30')} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'ledger' && <LedgerTab />}
          {activeTab === 'transactions' && <TransactionsTab />}
          {activeTab === 'expenses' && <ExpensesTab />}
          {activeTab === 'lots' && <LotsTab />}
          {activeTab === 'loans' && <LoansTab />}
          {activeTab === 'pl' && <PLTab />}
          {activeTab === 'taxes' && <TaxesTab />}
          {activeTab === 'banks' && <BanksTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
