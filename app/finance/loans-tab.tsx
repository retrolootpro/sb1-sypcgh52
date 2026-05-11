'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  addOwnerLoanPayment,
  createOwnerLoan,
  formatCurrency,
  getOwnerLoans,
  getTransactions,
  type OwnerLoanSummary,
  type Transaction,
} from '@/lib/finance-services';
import { cn } from '@/lib/utils';
import { CircleDollarSign, HandCoins, Link2, Loader2, Plus, RefreshCw, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

function LoanStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' | 'amber' }) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      tone === 'green' ? 'border-emerald-500/20 bg-emerald-500/5' :
      tone === 'amber' ? 'border-amber-500/20 bg-amber-500/5' :
      'border-border/40 bg-white/[0.02]'
    )}>
      <div className="mb-1 text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-white/85">{value}</div>
    </div>
  );
}

function AddLoanDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [lender, setLender] = useState('Owner');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [createTx, setCreateTx] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const amountNum = Number(amount);
    if (!lender.trim() || amountNum <= 0) {
      toast.error('Enter a lender and loan amount');
      return;
    }
    setSaving(true);
    try {
      await createOwnerLoan({
        lender_name: lender.trim(),
        loan_date: date,
        original_amount: amountNum,
        purpose: purpose.trim() || null,
        createTransaction: createTx,
      });
      toast.success('Owner loan added');
      onOpenChange(false);
      setAmount('');
      setPurpose('');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add loan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader><DialogTitle>Add Owner Loan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Lender</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} className="h-9 bg-secondary/40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 bg-secondary/40" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Amount Borrowed</Label>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-secondary/40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Purpose</Label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Inventory, shipping cash, startup funds..." className="h-9 bg-secondary/40" />
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-border/40 bg-secondary/20 p-3 text-xs text-muted-foreground">
            <input type="checkbox" checked={createTx} onChange={(e) => setCreateTx(e.target.checked)} className="mt-0.5" />
            <span>Create a matching transfer transaction so this loan appears in the ledger without affecting P&L.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add Loan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPaymentDialog({ loan, open, onOpenChange, onSaved }: {
  loan: OwnerLoanSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'manual' | 'link'>('manual');
  const [transactionId, setTransactionId] = useState('none');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(loan?.balance ? loan.balance.toFixed(2) : '');
    setDate(new Date().toISOString().slice(0, 10));
    setMode('manual');
    setTransactionId('none');
    getTransactions({ limit: 300 })
      .then((rows) => setTransactions(rows.filter((tx) =>
        tx.type === 'transfer' ||
        tx.category === 'Owner Loan Repayment' ||
        tx.description.toLowerCase().includes('loan')
      )))
      .catch(() => setTransactions([]));
  }, [open, loan]);

  const selectedTx = transactions.find((tx) => tx.id === transactionId) || null;

  useEffect(() => {
    if (!selectedTx) return;
    setDate(selectedTx.date);
    setAmount(Math.abs(Number(selectedTx.amount) || 0).toFixed(2));
  }, [selectedTx]);

  const handleSave = async () => {
    if (!loan) return;
    const amountNum = Number(amount);
    if (amountNum <= 0) {
      toast.error('Enter a repayment amount');
      return;
    }
    setSaving(true);
    try {
      await addOwnerLoanPayment({
        loan_id: loan.id,
        payment_date: date,
        amount: amountNum,
        transaction_id: mode === 'link' && transactionId !== 'none' ? transactionId : null,
        createTransaction: mode === 'manual',
        notes: mode === 'link' && selectedTx ? `Linked to transaction: ${selectedTx.description}` : null,
      });
      toast.success('Repayment recorded');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to record repayment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader><DialogTitle>Record Repayment</DialogTitle></DialogHeader>
        {loan && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
              <div className="text-sm font-semibold text-white/85">{loan.lender_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">Current balance {formatCurrency(loan.balance)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant={mode === 'manual' ? 'default' : 'outline'} onClick={() => setMode('manual')}>
                Manual
              </Button>
              <Button type="button" variant={mode === 'link' ? 'default' : 'outline'} onClick={() => setMode('link')}>
                <Link2 className="mr-2 h-4 w-4" />
                Link Tx
              </Button>
            </div>
            {mode === 'link' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Transaction</Label>
                <Select value={transactionId} onValueChange={setTransactionId}>
                  <SelectTrigger className="h-10 bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">Choose a transaction...</SelectItem>
                    {transactions.map((tx) => (
                      <SelectItem key={tx.id} value={tx.id}>
                        {tx.date} / {tx.description.slice(0, 42)} / {formatCurrency(Math.abs(tx.amount))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 bg-secondary/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 bg-secondary/40" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !loan || (mode === 'link' && transactionId === 'none')}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
            Save Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LoansTab() {
  const [loans, setLoans] = useState<OwnerLoanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState<OwnerLoanSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLoans(await getOwnerLoans());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => loans.reduce((acc, loan) => {
    acc.borrowed += Number(loan.original_amount) || 0;
    acc.paid += loan.paidAmount;
    acc.balance += loan.balance;
    return acc;
  }, { borrowed: 0, paid: 0, balance: 0 }), [loans]);

  return (
    <div className="space-y-4">
      <AddLoanDialog open={addOpen} onOpenChange={setAddOpen} onSaved={load} />
      <AddPaymentDialog loan={paymentLoan} open={!!paymentLoan} onOpenChange={(open) => !open && setPaymentLoan(null)} onSaved={load} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white/85">Owner Loan Tracker</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Track money you loaned the business and repayments back to yourself without counting it as sales or operating expense.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Loan
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <LoanStat label="Borrowed" value={formatCurrency(totals.borrowed)} tone="amber" />
        <LoanStat label="Repaid" value={formatCurrency(totals.paid)} tone="green" />
        <LoanStat label="Balance Due" value={formatCurrency(totals.balance)} />
      </div>

      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading loans...</div>
        ) : loans.length === 0 ? (
          <div className="p-8 text-center">
            <WalletCards className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
            <div className="text-sm font-medium text-white/70">No owner loans yet</div>
            <div className="mt-1 text-xs text-muted-foreground">Add the amount you loaned the business to start tracking repayment.</div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {loans.map((loan) => (
              <div key={loan.id} className="p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-white/85">{loan.lender_name}</div>
                      <Badge variant="outline" className={cn(
                        'text-[10px]',
                        loan.balance <= 0.01 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      )}>
                        {loan.balance <= 0.01 ? 'Paid' : 'Open'}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>{format(new Date(loan.loan_date), 'MMM d, yyyy')}</span>
                      {loan.purpose && <span>{loan.purpose}</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 lg:w-[360px]">
                    <LoanStat label="Original" value={formatCurrency(Number(loan.original_amount) || 0)} tone="amber" />
                    <LoanStat label="Paid" value={formatCurrency(loan.paidAmount)} tone="green" />
                    <LoanStat label="Balance" value={formatCurrency(loan.balance)} />
                  </div>

                  <Button size="sm" className="h-8 text-xs lg:w-36" onClick={() => setPaymentLoan(loan)} disabled={loan.balance <= 0.01}>
                    <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
                    Repayment
                  </Button>
                </div>

                {loan.payments.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {loan.payments.slice(0, 6).map((payment) => (
                      <div key={payment.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                        <div className="text-xs font-medium text-white/75">{formatCurrency(Number(payment.amount) || 0)}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {format(new Date(payment.payment_date), 'MMM d, yyyy')}
                          {payment.transaction_id ? ' / linked transaction' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
