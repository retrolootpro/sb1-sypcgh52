'use client';

import { useState } from 'react';
import { PackageCheck, Layers, Sparkles, Zap, FileText, ShoppingCart, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type PrepFields = {
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
};

const STAGES = [
  { key: 'received',  label: 'Received', field: null,             icon: PackageCheck, shortLabel: 'Rcvd'  },
  { key: 'sorted',   label: 'Sorted',   field: 'sorted_at',      icon: Layers,       shortLabel: 'Sort'  },
  { key: 'cleaned',  label: 'Cleaned',  field: 'cleaned_at',     icon: Sparkles,     shortLabel: 'Clean' },
  { key: 'tested',   label: 'Tested',   field: 'tested_at',      icon: Zap,          shortLabel: 'Test'  },
  { key: 'noted',    label: 'Noted',    field: 'notes_added_at', icon: FileText,     shortLabel: 'Noted' },
  { key: 'rack',     label: 'On Rack',  field: 'on_rack_at',     icon: ShoppingCart, shortLabel: 'Rack'  },
] as const;

type StageStatus = 'done' | 'active' | 'pending';

function getStageStatus(fields: PrepFields, idx: number): StageStatus {
  const stage = STAGES[idx];
  if (stage.field === null) return 'done';
  const val = fields[stage.field as keyof PrepFields];
  if (val) return 'done';
  if (idx === 0) return 'active';
  const prevField = STAGES[idx - 1].field;
  if (prevField === null) return 'active';
  return fields[prevField as keyof PrepFields] ? 'active' : 'pending';
}

export function getCurrentStageLabel(fields: PrepFields): string {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const stage = STAGES[i];
    if (stage.field === null) continue;
    if (fields[stage.field as keyof PrepFields]) return stage.label;
  }
  return 'Received';
}

export function getCompletedCount(fields: PrepFields): number {
  let count = 1;
  for (const stage of STAGES) {
    if (stage.field && fields[stage.field as keyof PrepFields]) count++;
  }
  return Math.min(count, STAGES.length);
}

type MiniProps = {
  fields: PrepFields;
  className?: string;
};

export function PrepStageMini({ fields, className }: MiniProps) {
  const allDone = STAGES.every(s => s.field === null || !!fields[s.field as keyof PrepFields]);
  const hasListing = fields.listed_ebay_at || fields.listed_amazon_at || fields.listed_whatnot_at;

  const platforms = [
    fields.listed_ebay_at && 'eBay',
    fields.listed_amazon_at && 'Amazon',
    fields.listed_whatnot_at && 'Whatnot',
  ].filter(Boolean);

  return (
    <div className={cn('flex items-center gap-1.5 mt-1', className)}>
      <div className="flex items-center gap-0.5">
        {STAGES.map((stage, idx) => {
          const status = getStageStatus(fields, idx);
          return (
            <div
              key={stage.key}
              title={`${stage.label}: ${status === 'done' ? 'Complete' : status === 'active' ? 'Current stage' : 'Pending'}`}
              className={cn(
                'w-[7px] h-[7px] rounded-full transition-colors',
                status === 'done'
                  ? 'bg-emerald-500'
                  : status === 'active'
                  ? 'bg-primary'
                  : 'bg-white/10'
              )}
            />
          );
        })}
      </div>
      <span className={cn(
        'text-[10px] font-medium leading-none',
        allDone && hasListing
          ? 'text-emerald-400'
          : allDone
          ? 'text-primary'
          : 'text-muted-foreground'
      )}>
        {hasListing
          ? platforms.join(' · ')
          : allDone
          ? 'Ready to list'
          : getCurrentStageLabel(fields)}
      </span>
    </div>
  );
}

type FullProps = {
  itemId: string;
  fields: PrepFields;
  onUpdate: (updates: Partial<PrepFields>) => void;
};

export function PrepStageBar({ itemId, fields, onUpdate }: FullProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  const toggleStage = async (stageField: string) => {
    const current = fields[stageField as keyof PrepFields];
    const newVal = current ? null : new Date().toISOString();
    setUpdating(stageField);
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ [stageField]: newVal })
        .eq('id', itemId);
      if (error) throw error;
      onUpdate({ [stageField]: newVal });
    } catch {
      toast.error('Failed to update stage');
    } finally {
      setUpdating(null);
    }
  };

  const allDone = STAGES.every(s => s.field === null || !!fields[s.field as keyof PrepFields]);
  const hasListing = fields.listed_ebay_at || fields.listed_amazon_at || fields.listed_whatnot_at;

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Prep Status</span>
        {allDone && (
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full font-semibold border',
            hasListing
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : 'bg-primary/10 border-primary/25 text-primary'
          )}>
            {hasListing ? 'Listed' : 'Ready to list'}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between relative">
        {STAGES.map((stage, idx) => {
          const status = getStageStatus(fields, idx);
          const Icon = stage.icon;
          const isUpdating = updating === stage.field;
          const isClickable = stage.field !== null && (status === 'done' || status === 'active');

          return (
            <div key={stage.key} className="flex flex-col items-center flex-1 relative">
              {idx < STAGES.length - 1 && (
                <div className="absolute top-4 left-1/2 w-full h-0.5 z-0">
                  <div className="h-full bg-white/[0.05]" />
                  <div
                    className="absolute inset-0 h-full transition-all duration-500 rounded-full"
                    style={{
                      width: status === 'done' ? '100%' : '0%',
                      background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                    }}
                  />
                </div>
              )}

              <button
                onClick={() => isClickable && stage.field && toggleStage(stage.field)}
                disabled={!isClickable || !!updating}
                title={isClickable ? (status === 'done' ? `Undo: mark ${stage.label} as incomplete` : `Mark ${stage.label} as done`) : stage.label}
                className={cn(
                  'relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 border-2',
                  isUpdating ? 'opacity-50' : '',
                  status === 'done'
                    ? 'bg-emerald-500 border-emerald-500 cursor-pointer hover:bg-emerald-600'
                    : status === 'active'
                    ? 'bg-primary/10 border-primary cursor-pointer hover:bg-primary/20'
                    : 'bg-transparent border-white/[0.10] cursor-default'
                )}
              >
                {status === 'done' ? (
                  <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                ) : (
                  <Icon className={cn(
                    'w-3.5 h-3.5',
                    status === 'active' ? 'text-primary animate-pulse' : 'text-white/15'
                  )} />
                )}
              </button>

              <span className={cn(
                'mt-1.5 text-[9px] font-medium text-center',
                status === 'done' ? 'text-emerald-400' : status === 'active' ? 'text-primary' : 'text-white/20'
              )}>
                {stage.shortLabel}
              </span>
            </div>
          );
        })}
      </div>

      {!allDone && (() => {
        const activeIdx = STAGES.findIndex((_, i) => getStageStatus(fields, i) === 'active');
        if (activeIdx < 0) return null;
        return (
          <div className="mt-3 pt-2.5 border-t border-border/20">
            <p className="text-[11px] text-muted-foreground">
              Next step: <span className="text-white/60 font-medium">{STAGES[activeIdx].label}</span>
              {activeIdx === 1 && ' — identify, categorize, and verify pricing'}
              {activeIdx === 2 && ' — physically clean and wipe down the item'}
              {activeIdx === 3 && ' — test it works correctly, note any issues'}
              {activeIdx === 4 && ' — add condition notes and photos to this item'}
              {activeIdx === 5 && ' — place on the rack and prepare for listing'}
            </p>
          </div>
        );
      })()}
    </div>
  );
}
