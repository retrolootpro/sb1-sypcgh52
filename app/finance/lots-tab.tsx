'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  allocateLotCost,
  formatCurrency,
  getLotCostSummaries,
  upsertLotPurchase,
  type LotCostSummary,
} from '@/lib/finance-services';
import { cn } from '@/lib/utils';
import { Calculator, DollarSign, Layers, Loader2, RefreshCw, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type AllocationMethod = 'equal' | 'market_weighted';

function CostStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' | 'amber' }) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      tone === 'green' ? 'border-emerald-500/20 bg-emerald-500/5' :
      tone === 'amber' ? 'border-amber-500/20 bg-amber-500/5' :
      'border-border/40 bg-white/[0.02]'
    )}>
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-white/85">{value}</div>
    </div>
  );
}

function LotCostDialog({
  lot,
  open,
  onOpenChange,
  onSaved,
}: {
  lot: LotCostSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<AllocationMethod>('equal');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lot && open) {
      setAmount(lot.totalCost > 0 ? lot.totalCost.toFixed(2) : '');
      setMethod('market_weighted');
    }
  }, [lot, open]);

  const amountNum = Number(amount) || 0;
  const unitCount = lot?.unitCount || lot?.itemCount || 0;
  const projectedAverage = unitCount ? amountNum / unitCount : 0;

  const handleSave = async () => {
    if (!lot) return;
    if (amountNum <= 0) {
      toast.error('Enter the total paid for this lot');
      return;
    }
    setSaving(true);
    try {
      await upsertLotPurchase(lot, amountNum);
      if (lot.itemCount > 0) {
        await allocateLotCost(lot.id, amountNum, method);
      }
      toast.success(`Allocated ${formatCurrency(amountNum)} across ${lot.itemCount} item${lot.itemCount === 1 ? '' : 's'}`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to allocate lot cost');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Allocate Lot Cost</DialogTitle>
        </DialogHeader>
        {lot && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3">
              <div className="text-sm font-semibold text-white/85">{lot.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {lot.itemCount} row{lot.itemCount === 1 ? '' : 's'} / {unitCount} unit{unitCount === 1 ? '' : 's'}{lot.source ? ` · ${lot.source}` : ''}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Total Paid</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-10 bg-secondary/40 pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Allocation Method</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as AllocationMethod)}>
                <SelectTrigger className="h-10 bg-secondary/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market_weighted">Weighted by current market value</SelectItem>
                  <SelectItem value="equal">Equal average per item</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <CostStat label="Projected Unit Avg" value={formatCurrency(projectedAverage)} tone="amber" />
              <CostStat label="Units" value={String(unitCount)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !lot || lot.itemCount === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
            Save & Allocate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LotsTab() {
  const [lots, setLots] = useState<LotCostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<LotCostSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLots(await getLotCostSummaries());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load lot costs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => lots.reduce((acc, lot) => {
    acc.totalCost += lot.totalCost;
    acc.allocated += lot.allocatedCost;
    acc.items += lot.itemCount;
    acc.units += lot.unitCount || lot.itemCount;
    return acc;
  }, { totalCost: 0, allocated: 0, items: 0, units: 0 }), [lots]);

  return (
    <div className="space-y-4">
      <LotCostDialog
        lot={selectedLot}
        open={!!selectedLot}
        onOpenChange={(open) => !open && setSelectedLot(null)}
        onSaved={load}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white/85">Lot Costing</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Lots come from received shipments. Allocate COGS by each item&apos;s share of current market value.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <CostStat label="Lot Spend" value={formatCurrency(totals.totalCost)} tone="amber" />
        <CostStat label="Allocated Cost" value={formatCurrency(totals.allocated)} tone="green" />
        <CostStat label="Lot Units" value={String(totals.units)} />
      </div>

      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading lots...</div>
        ) : lots.length === 0 ? (
          <div className="p-8 text-center">
            <Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
            <div className="text-sm font-medium text-white/70">No lots yet</div>
            <div className="mt-1 text-xs text-muted-foreground">Create lots from Prep Tracker, then manage cost basis here.</div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {lots.map((lot) => {
              const delta = lot.totalCost - lot.allocatedCost;
              const isAllocated = lot.itemCount > 0 && Math.abs(delta) < 0.05;
              return (
                <div key={lot.id} className="p-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-white/85">{lot.name}</div>
                        <Badge variant="outline" className={cn(
                          'text-[10px]',
                          isAllocated ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                        )}>
                          {isAllocated ? 'Allocated' : 'Needs allocation'}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {lot.source && <span>{lot.source}</span>}
                        {lot.received_at && <span>{format(new Date(lot.received_at), 'MMM d, yyyy')}</span>}
                        <span>{lot.itemCount} row{lot.itemCount === 1 ? '' : 's'} / {(lot.unitCount || lot.itemCount)} unit{(lot.unitCount || lot.itemCount) === 1 ? '' : 's'}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 lg:w-[360px]">
                      <CostStat label="Paid" value={formatCurrency(lot.totalCost)} tone="amber" />
                      <CostStat label="FMV" value={formatCurrency(lot.totalMarketValue)} />
                      <CostStat label="Delta" value={formatCurrency(delta)} tone={Math.abs(delta) < 0.05 ? 'green' : 'amber'} />
                    </div>

                    <Button size="sm" className="h-8 text-xs lg:w-32" onClick={() => setSelectedLot(lot)}>
                      <Scale className="mr-1.5 h-3.5 w-3.5" />
                      Cost Lot
                    </Button>
                  </div>

                  {lot.items.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {lot.items.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                          <div className="truncate text-xs font-medium text-white/75">{item.product_name}</div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{item.console} · {item.condition}{Number(item.quantity || 1) > 1 ? ` · qty ${item.quantity}` : ''}</span>
                            <span className="font-semibold text-white/70">
                              {formatCurrency(Number(item.purchase_price) || 0)}
                              {Number(item.quantity || 1) > 1 ? ` / ${formatCurrency((Number(item.purchase_price) || 0) * Number(item.quantity || 1))}` : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                      {lot.items.length > 6 && (
                        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-xs text-muted-foreground">
                          +{lot.items.length - 6} more item{lot.items.length - 6 === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
