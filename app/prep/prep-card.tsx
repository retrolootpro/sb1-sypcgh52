'use client';

import { useState } from 'react';
import { Check, ChevronDown, Circle, ClipboardCheck, FileText, PackageCheck, ShoppingCart, Sparkles, Tag, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type PrepItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  created_at: string;
  sorted_at: string | null;
  cleaned_at: string | null;
  tested_at: string | null;
  notes_added_at: string | null;
  on_rack_at: string | null;
  listed_ebay_at: string | null;
  listed_amazon_at: string | null;
  listed_whatnot_at: string | null;
  status: string | null;
  sold_at: string | null;
  sell_price: number | null;
  lot_id: string | null;
};

const STEPS = [
  {
    label: 'Sort',
    field: 'sorted_at',
    icon: Tag,
    action: 'Mark Sorted',
    detail: 'Title, console, condition, and pricing look right.',
  },
  {
    label: 'Clean',
    field: 'cleaned_at',
    icon: Sparkles,
    action: 'Mark Cleaned',
    detail: 'Wipe case, cart, disc, stickers, and residue.',
  },
  {
    label: 'Test',
    field: 'tested_at',
    icon: Zap,
    action: 'Mark Tested',
    detail: 'Confirm it works or note any problem.',
  },
  {
    label: 'Notes',
    field: 'notes_added_at',
    icon: FileText,
    action: 'Mark Notes Done',
    detail: 'Condition notes and photos are ready.',
  },
  {
    label: 'Rack',
    field: 'on_rack_at',
    icon: ShoppingCart,
    action: 'Move to Rack',
    detail: 'Item is staged and ready to list or sell.',
  },
] as const;

type Step = (typeof STEPS)[number];
type StepField = Step['field'];

const WORKFLOW_STEP_COUNT = STEPS.length + 2;

type Props = {
  item: PrepItem;
  onChange: (updated: Partial<PrepItem>) => void;
};

function getNextStep(item: PrepItem) {
  const prepStep = STEPS.find((step) => !item[step.field]);
  if (prepStep) return { type: 'prep' as const, step: prepStep };
  if (!listStatus(item)) return { type: 'listed' as const };
  if (!isSold(item)) return { type: 'sold' as const };
  return null;
}

function completeCount(item: PrepItem) {
  return (
    STEPS.filter((step) => !!item[step.field]).length +
    (listStatus(item) ? 1 : 0) +
    (isSold(item) ? 1 : 0)
  );
}

function listStatus(item: PrepItem) {
  const platforms = [
    item.listed_ebay_at && 'eBay',
    item.listed_amazon_at && 'Amazon',
    item.listed_whatnot_at && 'Whatnot',
  ].filter(Boolean);
  return platforms.length > 0 ? platforms.join(', ') : '';
}

function isSold(item: PrepItem) {
  return item.status === 'sold' || Boolean(item.sold_at);
}

function nextStepLabel(item: PrepItem) {
  const next = getNextStep(item);
  if (!next) return 'Complete';
  if (next.type === 'prep') return next.step.label;
  if (next.type === 'listed') return 'List';
  return 'Sold';
}

function nextStepDetail(item: PrepItem) {
  const next = getNextStep(item);
  if (!next) return 'This item has finished the workflow.';
  if (next.type === 'prep') return next.step.detail;
  if (next.type === 'listed') return 'Choose where it is listed below.';
  return 'Enter the sale price when this item sells.';
}

export function PrepCard({ item, onChange }: Props) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const nextStep = getNextStep(item);
  const completed = completeCount(item);
  const progress = Math.round((completed / WORKFLOW_STEP_COUNT) * 100);
  const listedOn = listStatus(item);
  const sold = isSold(item);
  const readyToList = nextStep?.type === 'listed';
  const listed = Boolean(listedOn) && !sold;
  const readyToMarkSold = nextStep?.type === 'sold';

  const updateField = async (field: StepField | 'listed_ebay_at' | 'listed_amazon_at' | 'listed_whatnot_at', value: string | null) => {
    setUpdating(field);
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      onChange({ [field]: value } as Partial<PrepItem>);
    } catch {
      toast.error('Could not update this item');
    } finally {
      setUpdating(null);
    }
  };

  const toggleStep = async (step: Step) => {
    const current = item[step.field];
    await updateField(step.field, current ? null : new Date().toISOString());
  };

  const completeNextStep = async () => {
    if (!nextStep || nextStep.type !== 'prep') return;
    await updateField(nextStep.step.field, new Date().toISOString());
    toast.success(`${nextStep.step.label} marked done`);
  };

  const toggleListing = async (field: 'listed_ebay_at' | 'listed_amazon_at' | 'listed_whatnot_at', label: string) => {
    const current = item[field];
    await updateField(field, current ? null : new Date().toISOString());
    toast.success(current ? `${label} listing removed` : `Marked listed on ${label}`);
  };

  const markSold = async () => {
    const raw = window.prompt('Sale price? Enter the amount this item sold for.');
    if (raw === null) return;
    const salePrice = Number(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      toast.error('Enter a valid sale price');
      return;
    }

    setUpdating('sold_at');
    try {
      const soldAt = new Date().toISOString();
      const { error } = await supabase
        .from('inventory_items')
        .update({
          status: 'sold',
          sold_at: soldAt,
          sell_price: salePrice,
          updated_at: soldAt,
        })
        .eq('id', item.id);
      if (error) throw error;
      onChange({ status: 'sold', sold_at: soldAt, sell_price: salePrice });
      toast.success('Marked sold');
    } catch {
      toast.error('Could not mark this item sold');
    } finally {
      setUpdating(null);
    }
  };

  const undoSold = async () => {
    setUpdating('sold_at');
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({
          status: 'available',
          sold_at: null,
          sell_price: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) throw error;
      onChange({ status: 'available', sold_at: null, sell_price: 0 });
      toast.success('Sold status removed');
    } catch {
      toast.error('Could not update sold status');
    } finally {
      setUpdating(null);
    }
  };

  const StatusIcon = sold
    ? Check
    : listed
    ? ClipboardCheck
    : readyToList
    ? ShoppingCart
    : nextStep?.type === 'prep'
    ? nextStep.step.icon
    : PackageCheck;

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card transition-colors',
        sold
          ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
          : listed
          ? 'border-emerald-500/20 bg-emerald-500/[0.025]'
          : readyToList
          ? 'border-primary/30 bg-primary/[0.035]'
          : 'border-border/40'
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
              sold
                ? 'border-emerald-500/30 bg-emerald-500/12'
                : listed
                ? 'border-emerald-500/25 bg-emerald-500/10'
                : readyToList
                ? 'border-primary/25 bg-primary/10'
                : 'border-white/10 bg-white/[0.035]'
            )}
          >
            <StatusIcon className={cn('h-5 w-5', sold || listed ? 'text-emerald-400' : readyToList ? 'text-primary' : 'text-white/55')} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight text-white/85">{item.product_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{item.console || 'Unknown'}</span>
              <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-white/45">
                {item.condition || 'Condition?'}
              </span>
              <span>${item.purchase_price?.toFixed(2) ?? '0.00'} cost</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border/30 bg-secondary/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {sold ? 'Sold' : listed ? 'Listed' : readyToList ? 'Ready' : 'Next Step'}
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {sold
                  ? `Sold${item.sell_price ? ` for $${Number(item.sell_price).toFixed(2)}` : ''}`
                  : listed
                  ? `Listed on ${listedOn}`
                  : readyToList
                  ? 'Ready to list'
                  : nextStep?.type === 'prep'
                  ? nextStep.step.label
                  : 'Ready'}
              </div>
              {!listed && !sold && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {nextStepDetail(item)}
                </div>
              )}
            </div>
            {!listed && !sold && !readyToList && nextStep?.type === 'prep' && (
              <Button
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={Boolean(updating)}
                onClick={completeNextStep}
              >
                {updating === nextStep.step.field ? 'Saving...' : nextStep.step.action}
              </Button>
            )}
            {readyToMarkSold && (
              <Button
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={Boolean(updating)}
                onClick={markSold}
              >
                {updating === 'sold_at' ? 'Saving...' : 'Mark Sold'}
              </Button>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px]">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">Progress</span>
              <span className={readyToList || listed || sold ? 'font-semibold text-primary' : 'text-white/45'}>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>{completed} of {WORKFLOW_STEP_COUNT} steps complete</span>
              {!sold && (
                <>
                  <span className="text-white/20">/</span>
                  <span className={readyToList || readyToMarkSold ? 'font-semibold text-primary' : 'text-white/55'}>
                    Next: {nextStepLabel(item)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {(readyToList || listed || readyToMarkSold) && !sold && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['listed_ebay_at', 'eBay'],
              ['listed_amazon_at', 'Amazon'],
              ['listed_whatnot_at', 'Whatnot'],
            ].map(([field, label]) => {
              const typedField = field as 'listed_ebay_at' | 'listed_amazon_at' | 'listed_whatnot_at';
              const active = Boolean(item[typedField]);
              return (
                <button
                  key={field}
                  onClick={() => toggleListing(typedField, label)}
                  disabled={updating === field}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-xs font-semibold transition-colors',
                    active
                      ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400'
                      : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-primary/25 hover:text-primary'
                  )}
                >
                  {active ? 'Listed' : label}
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          className="mt-3 flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] text-muted-foreground transition-colors hover:text-white/70"
        >
          <span>Show full checklist</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')} />
        </button>

        {detailsOpen && (
          <div className="mt-2 space-y-1.5 rounded-xl border border-border/25 bg-black/20 p-2">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const done = Boolean(item[step.field]);
              return (
                <button
                  key={step.field}
                  type="button"
                  onClick={() => toggleStep(step)}
                  disabled={updating === step.field}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-white/[0.04]"
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      done ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-white/12 text-white/25'
                    )}
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <Circle className="h-2.5 w-2.5" />}
                  </div>
                  <Icon className={cn('h-3.5 w-3.5', done ? 'text-emerald-400' : 'text-white/35')} />
                  <span className={done ? 'text-white/70' : 'text-muted-foreground'}>{step.label}</span>
                  {done && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {format(new Date(item[step.field]!), 'MMM d')}
                    </span>
                  )}
                </button>
              );
            })}
            <div className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs">
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  listedOn ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-white/12 text-white/25'
                )}
              >
                {listedOn ? <Check className="h-3 w-3" strokeWidth={3} /> : <Circle className="h-2.5 w-2.5" />}
              </div>
              <ClipboardCheck className={cn('h-3.5 w-3.5', listedOn ? 'text-emerald-400' : 'text-white/35')} />
              <span className={listedOn ? 'text-white/70' : 'text-muted-foreground'}>Listed</span>
              {listedOn && <span className="ml-auto text-[10px] text-muted-foreground">{listedOn}</span>}
            </div>
            <button
              type="button"
              onClick={sold ? undoSold : listedOn ? markSold : undefined}
              disabled={!listedOn || updating === 'sold_at'}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors',
                listedOn ? 'hover:bg-white/[0.04]' : 'cursor-default opacity-60'
              )}
            >
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  sold ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-white/12 text-white/25'
                )}
              >
                {sold ? <Check className="h-3 w-3" strokeWidth={3} /> : <Circle className="h-2.5 w-2.5" />}
              </div>
              <Check className={cn('h-3.5 w-3.5', sold ? 'text-emerald-400' : 'text-white/35')} />
              <span className={sold ? 'text-white/70' : 'text-muted-foreground'}>Sold</span>
              {sold && item.sold_at && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {format(new Date(item.sold_at), 'MMM d')}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
