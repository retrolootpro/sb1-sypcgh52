'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Search, Trash2, RefreshCw, Download, Filter, CircleCheck as CheckCircle2, Circle, Upload, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

type ParsedStatementTransaction = {
  id: string;
  date: string;
  itemName: string;
  description: string;
  amount: number;
  type: Transaction['type'];
  category: string;
  source: Transaction['source'];
  platform: string | null;
  reference_id: string | null;
  merchant_name: string | null;
  notes: string | null;
};

type DuplicateReviewItem = {
  incoming: ParsedStatementTransaction;
  matches: Transaction[];
  decision: 'add' | 'skip';
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDescription(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractItemNameFromTransaction(tx: Pick<Transaction, 'description' | 'merchant_name' | 'notes'>) {
  const listingMatch = tx.notes?.match(/Listing:\s*([^|]+)/i);
  if (listingMatch?.[1]?.trim()) return listingMatch[1].trim();
  return tx.description || tx.merchant_name || '';
}

function parseCurrency(value: string) {
  const cleaned = value.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateCell(value: string) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cell(cells: string[], index: number) {
  return index >= 0 ? (cells[index] || '').trim() : '';
}

function getReportEndDate(lines: string[]) {
  const reportLine = lines.find((line) => /report for .* to /i.test(line));
  const match = reportLine?.match(/to\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  return match?.[1] ? formatDateCell(match[1]) : new Date().toISOString().slice(0, 10);
}

function parseWhatnotCsv(lines: string[], headers: string[]): ParsedStatementTransaction[] {
  const indexFor = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const completedIndex = indexFor('transactioncompletedatutc');
  const placedIndex = indexFor('orderplacedatutc');
  const transactionTypeIndex = indexFor('transactiontype');
  const messageIndex = indexFor('transactionmessage');
  const orderIdIndex = indexFor('orderid');
  const listingTitleIndex = indexFor('listingtitle');
  const listingDescriptionIndex = indexFor('listingdescription');
  const categoryIndex = indexFor('productcategory');
  const amountIndex = indexFor('transactionamount');
  const buyerPaidIndex = indexFor('buyerpaid');
  const itemPriceIndex = indexFor('originalitemprice');
  const shippingIndex = indexFor('shippingfee');
  const commissionIndex = indexFor('commissionfee');
  const processingIndex = indexFor('paymentprocessingfee');
  const ledgerIdIndex = indexFor('ledgertransactionid');
  const buyerIndex = indexFor('buyername');
  const livestreamIndex = indexFor('livestreamtitle');
  const shipmentIndex = indexFor('shipmentid');
  const cogsIndex = indexFor('costofgoods');

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const transactionType = cell(cells, transactionTypeIndex);
    const amount = parseCurrency(cell(cells, amountIndex));
    const listingTitle = cell(cells, listingTitleIndex);
    const listingDescription = cell(cells, listingDescriptionIndex);
    const message = cell(cells, messageIndex);
    const orderId = cell(cells, orderIdIndex);
    const ledgerId = cell(cells, ledgerIdIndex);
    const itemName = listingTitle || listingDescription || message || `Whatnot item ${orderId || ledgerId || index + 1}`;
    const description = `${itemName}${transactionType ? ` - ${transactionType.replace(/_/g, ' ')}` : ''}`;
    const date = formatDateCell(cell(cells, completedIndex) || cell(cells, placedIndex));
    const type: Transaction['type'] =
      transactionType.includes('REFUND') || amount < 0
        ? 'refund'
        : transactionType.includes('PAYOUT') || transactionType.includes('TRANSFER')
          ? 'transfer'
          : 'income';
    const signedAmount = type === 'refund' ? -Math.abs(amount) : amount;
    const feeDetails = [
      `Order ${orderId || 'n/a'}`,
      `Ledger ${ledgerId || 'n/a'}`,
      `Listing: ${listingTitle || 'n/a'}`,
      `Description: ${listingDescription || 'n/a'}`,
      `Show: ${cell(cells, livestreamIndex) || 'n/a'}`,
      `Buyer paid: ${cell(cells, buyerPaidIndex) || '0.00'}`,
      `Item price: ${cell(cells, itemPriceIndex) || '0.00'}`,
      `Shipping fee: ${cell(cells, shippingIndex) || '0.00'}`,
      `Commission fee: ${cell(cells, commissionIndex) || '0.00'}`,
      `Processing fee: ${cell(cells, processingIndex) || '0.00'}`,
      `COGS: ${cell(cells, cogsIndex) || '0.00'}`,
      `Shipment ${cell(cells, shipmentIndex) || 'n/a'}`,
    ].join(' | ');

    return {
      id: ledgerId || orderId || `whatnot-${Date.now()}-${index}`,
      date,
      itemName,
      description,
      amount: signedAmount,
      type,
      category: type === 'income' ? 'Sales - Whatnot' : type === 'transfer' ? 'Transfer' : 'Refund Received',
      source: 'whatnot' as const,
      platform: 'whatnot',
      reference_id: ledgerId || orderId || null,
      merchant_name: cell(cells, buyerIndex) || 'Whatnot',
      notes: `${transactionType || 'Whatnot transaction'} | ${cell(cells, categoryIndex) || 'Uncategorized'} | ${feeDetails}`,
    };
  }).filter((tx) => tx.date && tx.description && tx.amount !== 0);
}

function parseEbayListingSalesCsv(lines: string[], headers: string[], headerIndex: number): ParsedStatementTransaction[] {
  const indexFor = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const titleIndex = indexFor('listingtitle');
  const itemIdIndex = indexFor('ebayitemid');
  const quantityIndex = indexFor('quantitysold');
  const totalSalesIndex = indexFor('totalsalesincludestaxes');
  const itemSalesIndex = indexFor('itemsales');
  const shippingIndex = indexFor('shippingandhandlingpaidbybuyertoyou');
  const costsIndex = indexFor('totalsellingcosts');
  const finalValueIndex = indexFor('finalvaluefees');
  const promotedIndex = indexFor('promotedlistingsgeneralfees');
  const labelIndex = indexFor('shippinglabelscostamountyoupaidtobuyshippinglabelsonebay');
  const netSalesIndex = indexFor('netsalesnetoftaxesandsellingcosts');
  const averageIndex = indexFor('averagesellingprice');
  const bestOfferIndex = indexFor('quantitysoldviabestoffers');
  const sellerOfferIndex = indexFor('quantitysoldviasellerinitiatedoffers');
  const date = getReportEndDate(lines.slice(0, headerIndex));

  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = splitCsvLine(line);
    const itemName = cell(cells, titleIndex);
    const itemId = cell(cells, itemIdIndex);
    const quantity = cell(cells, quantityIndex) || '1';
    const netSales = parseCurrency(cell(cells, netSalesIndex));
    const amount = netSales;
    const notes = [
      'eBay listing sales report',
      `eBay item ID ${itemId || 'n/a'}`,
      `Quantity sold ${quantity}`,
      `Total sales ${cell(cells, totalSalesIndex) || '0.00'}`,
      `Item sales ${cell(cells, itemSalesIndex) || '0.00'}`,
      `Shipping paid by buyer ${cell(cells, shippingIndex) || '0.00'}`,
      `Total selling costs ${cell(cells, costsIndex) || '0.00'}`,
      `Final value fees ${cell(cells, finalValueIndex) || '0.00'}`,
      `Promoted listing fees ${cell(cells, promotedIndex) || '0.00'}`,
      `Shipping label cost ${cell(cells, labelIndex) || '0.00'}`,
      `Average selling price ${cell(cells, averageIndex) || '0.00'}`,
      `Best offers ${cell(cells, bestOfferIndex) || '0'}`,
      `Seller offers ${cell(cells, sellerOfferIndex) || '0'}`,
    ].join(' | ');

    return {
      id: itemId || `ebay-listing-${Date.now()}-${index}`,
      date,
      itemName,
      description: itemName ? `${itemName} - eBay listing sales` : `eBay listing sales ${itemId || index + 1}`,
      amount,
      type: (amount < 0 ? 'refund' : 'income') as Transaction['type'],
      category: amount < 0 ? 'Refund Received' : 'Sales - eBay',
      source: 'ebay' as const,
      platform: 'ebay',
      reference_id: itemId || null,
      merchant_name: 'eBay',
      notes,
    };
  }).filter((tx) => tx.date && tx.itemName && tx.amount !== 0);
}

function parseStatementCsv(text: string): ParsedStatementTransaction[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headerIndex = lines.findIndex((line) => {
    const headers = splitCsvLine(line).map(normalizeHeader);
    return (
      (headers.includes('ledgertransactionid') && headers.includes('transactiontype') && headers.includes('transactionamount')) ||
      (headers.includes('listingtitle') && headers.includes('ebayitemid') && headers.includes('netsalesnetoftaxesandsellingcosts')) ||
      (headers.some((header) => ['date', 'transactiondate', 'posteddate', 'postingdate'].includes(header)) &&
        headers.some((header) => ['amount', 'transactionamount', 'debit', 'credit'].includes(header)))
    );
  });
  if (headerIndex < 0) {
    throw new Error('CSV needs recognizable transaction columns. Supported uploads include bank CSVs, Whatnot earnings CSVs, and eBay listing sales reports.');
  }

  const headers = splitCsvLine(lines[headerIndex]).map(normalizeHeader);
  if (headers.includes('ledgertransactionid') && headers.includes('transactiontype') && headers.includes('transactionamount')) {
    return parseWhatnotCsv(lines.slice(headerIndex), headers);
  }
  if (headers.includes('listingtitle') && headers.includes('ebayitemid') && headers.includes('netsalesnetoftaxesandsellingcosts')) {
    return parseEbayListingSalesCsv(lines, headers, headerIndex);
  }

  const indexFor = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const dateIndex = indexFor('date', 'transactiondate', 'posteddate', 'postingdate');
  const descriptionIndex = indexFor('description', 'name', 'merchant', 'payee', 'details', 'memo');
  const amountIndex = indexFor('amount', 'transactionamount');
  const debitIndex = indexFor('debit', 'withdrawal', 'withdrawals', 'spent');
  const creditIndex = indexFor('credit', 'deposit', 'deposits', 'received');

  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error('CSV needs Date, Description, and Amount columns. Bank exports with Debit/Credit columns also work.');
  }

  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = splitCsvLine(line);
    const isoDate = formatDateCell(cells[dateIndex] || '');
    const description = (cells[descriptionIndex] || 'Imported transaction').trim();
    const debit = debitIndex >= 0 ? Math.abs(parseCurrency(cells[debitIndex] || '')) : 0;
    const credit = creditIndex >= 0 ? Math.abs(parseCurrency(cells[creditIndex] || '')) : 0;
    const amount = amountIndex >= 0 ? parseCurrency(cells[amountIndex] || '') : credit - debit;
    const signedAmount = amount === 0 && debit > 0 ? -debit : amount === 0 && credit > 0 ? credit : amount;
    const type: Transaction['type'] = signedAmount >= 0 ? 'income' : 'expense';

    return {
      id: `statement-${Date.now()}-${index}`,
      date: isoDate,
      itemName: description,
      description,
      amount: signedAmount,
      type,
      category: type === 'income' ? 'Sales - Other' : 'Uncategorized',
      source: 'import' as const,
      platform: null,
      reference_id: null,
      merchant_name: description,
      notes: 'Imported from statement upload',
    };
  }).filter((tx) => tx.date && tx.description && tx.amount !== 0);
}

function isLikelyDuplicate(incoming: ParsedStatementTransaction, existing: Transaction[]) {
  const incomingItemName = normalizeDescription(incoming.itemName || incoming.description);
  return existing.filter((tx) => {
    const sameReference = Boolean(incoming.reference_id && tx.reference_id === incoming.reference_id);
    const sameDate = tx.date === incoming.date;
    const sameType = tx.type === incoming.type;
    const sameAmount = Math.abs(Math.abs(Number(tx.amount)) - Math.abs(incoming.amount)) < 0.01;
    const existingItemName = normalizeDescription(extractItemNameFromTransaction(tx));
    const similarItemName =
      incomingItemName.length > 8 &&
      existingItemName.length > 8 &&
      (incomingItemName.includes(existingItemName.slice(0, 18)) || existingItemName.includes(incomingItemName.slice(0, 18)));
    return sameDate && sameType && sameAmount && (similarItemName || sameReference);
  });
}

function amountTextClass(type: Transaction['type']) {
  if (type === 'income') return 'text-emerald-400';
  if (type === 'transfer') return 'text-blue-400';
  return 'text-red-400';
}

function amountPrefix(tx: Transaction) {
  if (tx.type === 'income') return '+';
  if (tx.type === 'expense' || tx.type === 'refund') return '-';
  return Number(tx.amount) < 0 ? '-' : '';
}

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
        amount: form.type === 'expense' || form.type === 'refund' ? -Math.abs(amt) : Math.abs(amt),
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
  const [uploadingStatement, setUploadingStatement] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingUniqueImports, setPendingUniqueImports] = useState<ParsedStatementTransaction[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const statementInputRef = useRef<HTMLInputElement>(null);

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

  const saveStatementRows = async (rows: ParsedStatementTransaction[]) => {
    for (const row of rows) {
      await createTransaction({
        date: row.date,
        description: row.description,
        amount: row.amount,
        type: row.type,
        category: row.category,
        source: row.source,
        platform: row.platform,
        reference_id: row.reference_id,
        merchant_name: row.merchant_name,
        notes: row.notes,
        is_reconciled: false,
      });
    }
  };

  const handleStatementFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadingStatement(true);
    try {
      const text = await file.text();
      const parsed = parseStatementCsv(text);
      if (parsed.length === 0) throw new Error('No transactions found in that statement file');

      const existing = await getTransactions({ limit: 5000 });
      const comparisonRows: Transaction[] = [...existing];
      const review: DuplicateReviewItem[] = [];
      const unique: ParsedStatementTransaction[] = [];

      for (const row of parsed) {
        const matches = isLikelyDuplicate(row, comparisonRows);
        if (matches.length > 0) review.push({ incoming: row, matches, decision: 'skip' });
        else {
          unique.push(row);
          comparisonRows.push({
            id: row.id,
            user_id: '',
            date: row.date,
            description: row.description,
            amount: row.amount,
            type: row.type,
            category: row.category,
            source: row.source,
            platform: row.platform,
            reference_id: row.reference_id,
            merchant_name: row.merchant_name,
            notes: row.notes,
            is_reconciled: false,
            created_at: '',
            updated_at: '',
          });
        }
      }

      if (unique.length > 0) {
        await saveStatementRows(unique);
      }

      if (review.length > 0) {
        setPendingUniqueImports(unique);
        setDuplicateReview(review);
        setReviewOpen(true);
        toast.info(`${unique.length} imported. Review ${review.length} possible duplicate(s).`);
      } else {
        toast.success(`Imported ${unique.length} statement transaction(s)`);
        load();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Statement upload failed');
    } finally {
      setUploadingStatement(false);
    }
  };

  const updateDuplicateDecision = (id: string, decision: 'add' | 'skip') => {
    setDuplicateReview((prev) => prev.map((item) => item.incoming.id === id ? { ...item, decision } : item));
  };

  const finishDuplicateReview = async () => {
    const rowsToAdd = duplicateReview.filter((item) => item.decision === 'add').map((item) => item.incoming);
    setUploadingStatement(true);
    try {
      if (rowsToAdd.length > 0) await saveStatementRows(rowsToAdd);
      toast.success(`Statement import complete: ${pendingUniqueImports.length + rowsToAdd.length} added, ${duplicateReview.length - rowsToAdd.length} skipped`);
      setReviewOpen(false);
      setDuplicateReview([]);
      setPendingUniqueImports([]);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to finish import');
    } finally {
      setUploadingStatement(false);
    }
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
    if (t.type === 'income') acc.income += Math.abs(t.amount);
    else if (t.type === 'expense' || t.type === 'refund') acc.expense += Math.abs(t.amount);
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
          <input
            ref={statementInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleStatementFile}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => statementInputRef.current?.click()}
            disabled={uploadingStatement}
          >
            <Upload className={`w-3.5 h-3.5 mr-1.5 ${uploadingStatement ? 'animate-pulse' : ''}`} />
            Statement CSV
          </Button>
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
                  <td className={`py-3 px-4 text-right font-medium tabular-nums ${amountTextClass(tx.type)}`}>
                    {amountPrefix(tx)}{formatCurrency(Math.abs(tx.amount))}
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

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Review Possible Duplicates
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
            {duplicateReview.map((item) => (
              <div key={item.incoming.id} className="rounded-xl border border-border/40 bg-secondary/20 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white/85">{item.incoming.description}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.incoming.date} / {formatCurrency(Math.abs(item.incoming.amount))} / {item.incoming.type}
                    </div>
                    <div className="mt-2 text-[11px] text-amber-200/80">
                      Looks similar to {item.matches.length} existing transaction{item.matches.length === 1 ? '' : 's'}.
                    </div>
                    <div className="mt-2 space-y-1">
                      {item.matches.slice(0, 3).map((match) => (
                        <div key={match.id} className="rounded-md bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
                          {format(new Date(match.date), 'MMM d, yyyy')} / {match.description} / {formatCurrency(Math.abs(match.amount))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant={item.decision === 'skip' ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => updateDuplicateDecision(item.incoming.id, 'skip')}
                    >
                      Skip
                    </Button>
                    <Button
                      size="sm"
                      variant={item.decision === 'add' ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => updateDuplicateDecision(item.incoming.id, 'add')}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={uploadingStatement}>
              Decide Later
            </Button>
            <Button onClick={finishDuplicateReview} disabled={uploadingStatement}>
              Finish Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
