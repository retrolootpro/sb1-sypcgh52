'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Camera, CircleDollarSign, ExternalLink, FileImage, FileText, Plus, Receipt, Search, Trash2, Upload, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  createBusinessExpense,
  deleteBusinessExpense,
  formatCurrency,
  getBusinessExpenses,
  getExpenseReceiptUrl,
  getExpensePeople,
  IRS_WRITE_OFF_CATEGORIES,
  updateBusinessExpense,
  uploadExpenseReceipt,
  type BusinessExpense,
  type ExpensePerson,
} from '@/lib/finance-services';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'disallowed', label: 'Do Not Claim' },
];

const emptyForm = {
  expense_date: new Date().toISOString().slice(0, 10),
  merchant: '',
  description: '',
  amount: '',
  irs_category: 'Supplies',
  business_purpose: '',
  payment_method: '',
  receipt_url: '',
  incurred_by_email: '',
  incurred_by_name: '',
  status: 'ready',
  notes: '',
};

function StatCard({ label, value, sub, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground font-medium">{label}</div>
          <div className="text-xl font-bold text-white/90 mt-1 tabular-nums">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
        </div>
        <div className="w-9 h-9 rounded-lg border border-primary/20 bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function statusClasses(status: BusinessExpense['status']) {
  if (status === 'reviewed') return 'border-emerald-500/25 text-emerald-300 bg-emerald-500/10';
  if (status === 'disallowed') return 'border-red-500/25 text-red-300 bg-red-500/10';
  if (status === 'draft') return 'border-amber-500/25 text-amber-300 bg-amber-500/10';
  return 'border-primary/25 text-primary bg-primary/10';
}

export function ExpensesTab() {
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [people, setPeople] = useState<ExpensePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [openingReceiptId, setOpeningReceiptId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ category: 'all', person: 'all', status: 'all', search: '' });
  const [form, setForm] = useState(emptyForm);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseRows, personRows] = await Promise.all([
        getBusinessExpenses(filters),
        getExpensePeople(),
      ]);
      setExpenses(expenseRows);
      setPeople(personRows);
      setForm((current) => current.incurred_by_email ? current : {
        ...current,
        incurred_by_email: personRows[0]?.email || '',
        incurred_by_name: personRows[0]?.name || '',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  const totals = useMemo(() => {
    const claimable = expenses.filter((expense) => expense.status !== 'disallowed');
    const total = claimable.reduce((sum, expense) => sum + Math.abs(Number(expense.amount) || 0), 0);
    const byPerson = new Map<string, number>();
    const byCategory = new Map<string, number>();
    for (const expense of claimable) {
      const person = expense.incurred_by_email || 'Unassigned';
      byPerson.set(person, (byPerson.get(person) || 0) + Math.abs(Number(expense.amount) || 0));
      byCategory.set(expense.irs_category, (byCategory.get(expense.irs_category) || 0) + Math.abs(Number(expense.amount) || 0));
    }
    return {
      total,
      count: claimable.length,
      people: byPerson.size,
      topCategory: Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])[0],
    };
  }, [expenses]);

  const handlePersonChange = (email: string) => {
    const person = people.find((entry) => entry.email === email);
    setForm((current) => ({
      ...current,
      incurred_by_email: email,
      incurred_by_name: person?.name || email,
    }));
  };

  const handleReceiptFile = (file?: File | null) => {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    const selected = file || null;
    setReceiptFile(selected);
    setReceiptPreviewUrl(selected?.type.startsWith('image/') ? URL.createObjectURL(selected) : null);
    if (!selected) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleCreate = async () => {
    if (!form.description.trim()) {
      toast.error('Add a description for the expense.');
      return;
    }
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      toast.error('Enter an expense amount greater than zero.');
      return;
    }

    setSaving(true);
    setUploadingReceipt(Boolean(receiptFile));
    try {
      const uploadedReceipt = receiptFile ? await uploadExpenseReceipt(receiptFile) : null;
      await createBusinessExpense({
        expense_date: form.expense_date,
        merchant: form.merchant.trim() || null,
        description: form.description.trim(),
        amount: Number(form.amount),
        irs_category: form.irs_category,
        business_purpose: form.business_purpose.trim() || null,
        payment_method: form.payment_method.trim() || null,
        receipt_url: uploadedReceipt?.receiptUrl || form.receipt_url.trim() || null,
        receipt_storage_path: uploadedReceipt?.storagePath || null,
        receipt_file_name: uploadedReceipt?.fileName || null,
        receipt_mime_type: uploadedReceipt?.mimeType || null,
        source_transaction_id: null,
        incurred_by_email: form.incurred_by_email || people[0]?.email || null,
        incurred_by_name: form.incurred_by_name || form.incurred_by_email || null,
        status: form.status as BusinessExpense['status'],
        notes: form.notes.trim() || null,
      });
      toast.success('Expense saved');
      setForm({ ...emptyForm, incurred_by_email: people[0]?.email || '', incurred_by_name: people[0]?.name || '' });
      handleReceiptFile(null);
      setShowForm(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save expense');
    } finally {
      setUploadingReceipt(false);
      setSaving(false);
    }
  };

  const handleStatusChange = async (expense: BusinessExpense, status: BusinessExpense['status']) => {
    try {
      await updateBusinessExpense(expense.id, { status });
      setExpenses((rows) => rows.map((row) => row.id === expense.id ? { ...row, status } : row));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    }
  };

  const handleDelete = async (expense: BusinessExpense) => {
    if (!window.confirm(`Delete expense "${expense.description}"?`)) return;
    try {
      await deleteBusinessExpense(expense.id);
      setExpenses((rows) => rows.filter((row) => row.id !== expense.id));
      toast.success('Expense deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete expense');
    }
  };

  const handleOpenReceipt = async (expense: BusinessExpense) => {
    setOpeningReceiptId(expense.id);
    try {
      const url = await getExpenseReceiptUrl(expense);
      if (!url) {
        toast.error('No receipt is attached to this expense.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open receipt');
    } finally {
      setOpeningReceiptId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Potential Write-Offs" value={formatCurrency(totals.total)} sub={`${totals.count} claimable expense${totals.count === 1 ? '' : 's'}`} icon={CircleDollarSign} />
        <StatCard label="People Tracking" value={String(totals.people)} sub="Expense owners in this view" icon={Users} />
        <StatCard label="Top Category" value={totals.topCategory?.[0] || 'None'} sub={totals.topCategory ? formatCurrency(totals.topCategory[1]) : 'Add expenses to rank categories'} icon={FileText} />
        <StatCard label="Tax Prep" value="Records" sub="Keep receipts and business purpose notes" icon={Receipt} />
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white/85">Expense Manager</h3>
            <p className="text-xs text-muted-foreground mt-1">Track deductible business expenses by person, IRS category, receipt, and review status.</p>
          </div>
          <Button onClick={() => setShowForm((value) => !value)} className="h-9 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Expense
          </Button>
        </div>

        {showForm && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Date</Label>
                <Input type="date" value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Amount</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Person</Label>
                <Select value={form.incurred_by_email} onValueChange={handlePersonChange}>
                  <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue placeholder="Who paid?" /></SelectTrigger>
                  <SelectContent>
                    {people.map((person) => (
                      <SelectItem key={person.email} value={person.email}>{person.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Write-Off Category</Label>
                <Select value={form.irs_category} onValueChange={(v) => setForm((f) => ({ ...f, irs_category: v }))}>
                  <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IRS_WRITE_OFF_CATEGORIES.map((category) => (
                      <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Description</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Boxes, labels, promoted listings..." className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Merchant / Source</Label>
                <Input value={form.merchant} onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))} placeholder="USPS, eBay, Walmart, CPA..." className="h-9 text-xs bg-secondary/40" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Payment Method</Label>
                <Input value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))} placeholder="Card, cash, bank..." className="h-9 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-xl border border-border/40 bg-secondary/20 p-3 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Label className="text-[11px] text-white/50">Receipt</Label>
                  <div className="text-xs text-muted-foreground mt-1">Attach a photo, upload a file, or paste an existing receipt link.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,application/pdf"
                    className="hidden"
                    onChange={(event) => handleReceiptFile(event.target.files?.[0])}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(event) => handleReceiptFile(event.target.files?.[0])}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload receipt
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()}>
                    <Camera className="w-3.5 h-3.5 mr-1.5" />
                    Take photo
                  </Button>
                </div>
              </div>

              {receiptFile && (
                <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/50 p-2">
                  {receiptPreviewUrl ? (
                    <img src={receiptPreviewUrl} alt="Receipt preview" className="h-14 w-14 rounded-md object-cover border border-border/40" />
                  ) : (
                    <div className="h-14 w-14 rounded-md border border-border/40 bg-secondary/50 flex items-center justify-center">
                      <FileImage className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-white/80">{receiptFile.name}</div>
                    <div className="text-[11px] text-muted-foreground">{(receiptFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleReceiptFile(null)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Receipt URL fallback</Label>
                <Input value={form.receipt_url} onChange={(e) => setForm((f) => ({ ...f, receipt_url: e.target.value }))} placeholder="Optional link if the receipt is already online" className="h-9 text-xs bg-secondary/40" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Business Purpose</Label>
                <Textarea value={form.business_purpose} onChange={(e) => setForm((f) => ({ ...f, business_purpose: e.target.value }))} placeholder="Why this expense was ordinary and necessary for the business..." className="min-h-20 text-xs bg-secondary/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-white/50">Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Receipt details, mileage route, shipment, platform, or tax-prep note..." className="min-h-20 text-xs bg-secondary/40" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving}>
                {uploadingReceipt ? 'Uploading receipt...' : saving ? 'Saving...' : 'Save Expense'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="p-4 border-b border-border/40 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Search description or merchant"
                className="h-9 pl-8 text-xs bg-secondary/40"
              />
            </div>
            <Select value={filters.category} onValueChange={(v) => setFilters((f) => ({ ...f, category: v }))}>
              <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {IRS_WRITE_OFF_CATEGORIES.map((category) => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.person} onValueChange={(v) => setFilters((f) => ({ ...f, person: v }))}>
              <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue placeholder="Person" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All People</SelectItem>
                {people.map((person) => <SelectItem key={person.email} value={person.email}>{person.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-9 text-xs bg-secondary/40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : expenses.length === 0 ? (
          <div className="py-14 text-center space-y-3">
            <Receipt className="w-10 h-10 text-white/10 mx-auto" />
            <div>
              <div className="text-sm font-semibold text-white/75">No expenses found</div>
              <div className="text-xs text-muted-foreground mt-1">Add receipts, fees, mileage notes, supplies, and other business costs here so tax prep is not a scavenger hunt.</div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {expenses.map((expense) => {
              const category = IRS_WRITE_OFF_CATEGORIES.find((entry) => entry.value === expense.irs_category);
              const hasReceipt = Boolean(expense.receipt_storage_path || expense.receipt_url);
              return (
                <div key={expense.id} className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between hover:bg-secondary/15">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white/85 truncate">{expense.description}</span>
                      <Badge variant="outline" className={cn('text-[10px]', statusClasses(expense.status))}>
                        {STATUS_OPTIONS.find((status) => status.value === expense.status)?.label || expense.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{format(new Date(expense.expense_date), 'MMM d, yyyy')}</span>
                      <span>{category?.label || expense.irs_category}</span>
                      {expense.merchant && <span>{expense.merchant}</span>}
                      {expense.incurred_by_email && <span>{expense.incurred_by_email}</span>}
                      {hasReceipt && (
                        <span className="inline-flex items-center gap-1 text-emerald-300/80">
                          <Receipt className="w-3 h-3" />
                          Receipt attached
                        </span>
                      )}
                    </div>
                    {expense.business_purpose && (
                      <div className="text-[11px] text-white/45 line-clamp-2 max-w-2xl">{expense.business_purpose}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 lg:justify-end">
                    <div className="text-right mr-2">
                      <div className="text-base font-bold text-red-300 tabular-nums">{formatCurrency(Math.abs(Number(expense.amount) || 0))}</div>
                      <div className="text-[10px] text-muted-foreground">{category?.scheduleC || 'Schedule C'}</div>
                    </div>
                    <Select value={expense.status} onValueChange={(v) => handleStatusChange(expense, v as BusinessExpense['status'])}>
                      <SelectTrigger className="h-8 w-32 text-[11px] bg-secondary/40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {hasReceipt && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[11px]"
                        onClick={() => handleOpenReceipt(expense)}
                        disabled={openingReceiptId === expense.id}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        {openingReceiptId === expense.id ? 'Opening...' : 'Receipt'}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-white/35 hover:text-red-300" onClick={() => handleDelete(expense)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
