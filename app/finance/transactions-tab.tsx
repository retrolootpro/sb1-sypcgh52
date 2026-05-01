'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Trash2, RefreshCw, Download, Filter, CircleCheck as CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  getTransactions, createTransaction, deleteTransaction, updateTransaction,
  importPlatformSales, formatCurrency,
  TRANSACTION_CATEGORIES, INCOME_CATEGORIES, type Transaction,
} from '@/lib/finance-services';
import { toast } from 'sonner';
import { format } from 'date-fns';

const TYPE_COLORS: Record<string, string> = {
  income: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
  expense: 'border-red-500/30 text-red-400 bg-red-500/10',
  transfer: 'border-blue-500/30 text-blue-400 bg-blue-500/10',
  refund: 'border-amber-500/30 text-amber-400 bg-amber-500/10',
};

const SOURCE_COLORS: Record<string, string> = {
  manual: 'text-white/30',
  plaid: 'text-sky-400',
  ebay: 'text-yellow-400',
  amazon: 'text-orange-400',
  whatnot: 'text-cyan-400',
  show: 'text-primary',
  import: 'text-white/40',
};

function AddTransactionDialog({ open, onOpenChange, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    type: 'expense' as Transaction['type'],
    category: 'Uncategorized',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const categories = form.type === 'income' ? INCOME_CATEGORIES : TRANSACTION_CATEGORIES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    setSaving(true);
    try {
      const amt = parseFloat(form.amount);
      await createTransaction({
        date: form.date,
        description: form.description.trim(),
        amount: form.type === 'expense' ? -Math.abs(amt) : Math.abs(amt),
        type: form.type,
        category: form.category,
        source: 'manual',
        is_reconciled: false,
        notes: form.notes || null,
      });
      toast.success('Transaction added');
      onOpenChange(false);
      onAdded();
      setForm({ date: new Date().toISOString().slice(0, 10), description: '', amount: '', type: 'expense', category: 'Uncategorized', notes: '' });
    } catch { toast.error('Failed to add transaction'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-xs text-white/50">Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="h-9 text-sm bg-secondary/40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-white/50">Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as Transaction['type'], category: 'Uncategorized' }))}>
                <SelectTrigger className="h-9 text-sm bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="refund">Refund</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-white/50">Description</Label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What was this for?" className="h-9 text-sm bg-secondary/40" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-xs text-white/50">Amount ($)</Label>
              <Input type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" className="h-9 text-sm bg-secondary/40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-white/50">Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="h-9 text-sm bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-white/50">Notes (optional)</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional notes..." className="h-9 text-sm bg-secondary/40" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || !form.description.trim() || !form.amount}>
              {saving ? 'Saving...' : 'Add Transaction'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TransactionsTab() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTransactions({ type: typeFilter, category: categoryFilter, search });
      setTxns(data);
    } catch { toast.error('Failed to load transactions'); }
    finally { setLoading(false); }
  }, [typeFilter, categoryFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importPlatformSales();
      toast.success(`Imported ${result.imported} sales from inventory`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally { setImporting(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTransaction(id);
      setTxns(prev => prev.filter(t => t.id !== id));
    } catch { toast.error('Failed to delete'); }
  };

  const handleToggleReconciled = async (tx: Transaction) => {
    try {
      await updateTransaction(tx.id, { is_reconciled: !tx.is_reconciled });
      setTxns(prev => prev.map(t => t.id === tx.id ? { ...t, is_reconciled: !t.is_reconciled } : t));
    } catch { toast.error('Failed to update'); }
  };

  const handleExport = () => {
    const header = 'Date,Description,Amount,Type,Category,Source,Reconciled\n';
    const rows = txns.map(t =>
      `${t.date},"${t.description}",${t.amount},${t.type},"${t.category}",${t.source},${t.is_reconciled}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = txns.reduce((acc, t) => {
    if (t.type === 'income' || t.type === 'refund') acc.income += Math.abs(t.amount);
    else if (t.type === 'expense') acc.expense += Math.abs(t.amount);
    return acc;
  }, { income: 0, expense: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search transactions..." className="h-8 pl-8 text-xs w-52 bg-secondary/40" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-32 bg-secondary/40">
              <Filter className="w-3 h-3 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
              <SelectItem value="refund">Refund</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleImport} disabled={importing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${importing ? 'animate-spin' : ''}`} />
            {importing ? 'Importing...' : 'Import Sales'}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport} disabled={txns.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            CSV
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Transaction
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Total Income</div>
          <div className="text-sm font-semibold text-emerald-400 tabular-nums">{formatCurrency(totals.income)}</div>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Total Expenses</div>
          <div className="text-sm font-semibold text-red-400 tabular-nums">{formatCurrency(totals.expense)}</div>
        </div>
        <div className={`rounded-xl border p-3 ${(totals.income - totals.expense) >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
          <div className="text-[10px] text-muted-foreground mb-1">Net</div>
          <div className={`text-sm font-semibold tabular-nums ${(totals.income - totals.expense) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(totals.income - totals.expense)}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                <th className="text-left py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                <th className="text-left py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Category</th>
                <th className="text-left py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Source</th>
                <th className="text-right py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="text-center py-3 px-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="py-3 px-4 w-16" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">Loading...</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No transactions found. Add one or import your sales.</td></tr>
              ) : txns.map(tx => (
                <tr key={tx.id} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                  <td className="py-3 px-4 text-white/50 whitespace-nowrap">{format(new Date(tx.date), 'MMM d, yyyy')}</td>
                  <td className="py-3 px-4">
                    <div className="text-white/80 truncate max-w-[200px]">{tx.description}</div>
                    {tx.merchant_name && tx.merchant_name !== tx.description && (
                      <div className="text-[10px] text-muted-foreground truncate">{tx.merchant_name}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-white/50 hidden sm:table-cell">{tx.category}</td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <span className={`capitalize text-[11px] ${SOURCE_COLORS[tx.source] || 'text-muted-foreground'}`}>{tx.source}</span>
                  </td>
                  <td className={`py-3 px-4 text-right font-medium tabular-nums ${
                    tx.type === 'income' || tx.type === 'refund' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {tx.type === 'income' || tx.type === 'refund' ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0.5 capitalize ${TYPE_COLORS[tx.type] || ''}`}>
                      {tx.type}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => handleToggleReconciled(tx)}
                        className="text-muted-foreground hover:text-primary transition-colors p-0.5"
                        title={tx.is_reconciled ? 'Mark unreconciled' : 'Mark reconciled'}>
                        {tx.is_reconciled
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          : <Circle className="w-3.5 h-3.5" />}
                      </button>
                      {tx.source === 'manual' && (
                        <button onClick={() => handleDelete(tx.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-0.5">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AddTransactionDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
    </div>
  );
}
