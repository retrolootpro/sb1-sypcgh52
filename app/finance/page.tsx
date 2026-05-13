'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { OverviewTab } from './overview-tab';
import { TransactionsTab } from './transactions-tab';
import { PLTab } from './pl-tab';
import { TaxesTab } from './taxes-tab';
import { BanksTab } from './banks-tab';
import { LotsTab } from './lots-tab';
import { LoansTab } from './loans-tab';
import { cn } from '@/lib/utils';
import { LayoutDashboard, ReceiptText, TrendingUp, FileText, Building2, Layers, WalletCards } from 'lucide-react';
import { ContextHelp } from '@/components/context-help';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'lots', label: 'Lots', icon: Layers },
  { id: 'loans', label: 'Loans', icon: WalletCards },
  { id: 'pl', label: 'P&L', icon: TrendingUp },
  { id: 'taxes', label: 'Taxes', icon: FileText },
  { id: 'banks', label: 'Banks', icon: Building2 },
];

export default function FinancePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    router.replace(`/finance?tab=${id}`, { scroll: false });
  };

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="heading-xl text-white/90">Finance</h1>
            <ContextHelp href="/help#finance-overview" label="Open finance help">
              Finance should answer cash available, inventory cash lock, break-even, debt, tax reserve, and true profit.
            </ContextHelp>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Money in, money out, lot break-even, loans, tax guidance, and bank reconciliation.</p>
        </div>

        <div className="flex gap-0.5 border-b border-border/40 overflow-x-auto no-scrollbar">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
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
        </div>

        <div>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'transactions' && <TransactionsTab />}
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
