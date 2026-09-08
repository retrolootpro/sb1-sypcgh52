'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

type ReconcileResult = {
  success: boolean;
  message?: string;
  workbook?: { groups: number; units: number };
  current?: { rows: number; units: number };
  protectedLots?: Array<{ id: string; name: string; source?: string }>;
  protectedItems?: Array<{ id: string; product_name: string; quantity: number }>;
  changes?: {
    matched: number;
    quantityUpdates: number;
    additions: number;
    archives: number;
    additionUnits: number;
    archivedUnits: number;
  };
  samples?: {
    additions: Array<{ name: string; console: string; condition: string; quantity: number }>;
    archives: Array<{ name: string; console: string; condition: string; quantity: number }>;
    fuzzyMatches: Array<{ workbook: string; inventory: string; score: number }>;
  };
  applied?: boolean;
  verified?: { rows: number; units: number; protectedItemsPresent: boolean };
};

export default function ReconcileStockCountPage() {
  const [records, setRecords] = useState<unknown[] | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [loading, setLoading] = useState(false);

  const readFile = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as { records?: unknown[] };
    if (!Array.isArray(parsed.records)) throw new Error('Invalid stock-count extraction');
    setRecords(parsed.records);
    setResult(null);
  };

  const run = async (apply: boolean) => {
    if (!records) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/inventory/reconcile-stock-count', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          records,
          apply,
          confirmation: apply ? 'APPLY STOCK COUNT 2026-08-30' : undefined,
        }),
      });
      const next = await response.json() as ReconcileResult;
      setResult(next);
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : 'Reconciliation failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5 p-5 sm:p-7 lg:p-8">
        <Link href="/inventory" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Inventory
        </Link>
        <div>
          <div className="label-caps">Inventory</div>
          <h1 className="heading-lg text-[22px]">Stock Count Reconciliation</h1>
        </div>

        <div className="space-y-4 border-y border-border/60 py-5">
          <Input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file).catch((error) => setResult({ success: false, message: error.message }));
            }}
          />
          <div className="flex gap-2">
            <Button onClick={() => run(false)} disabled={!records || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
              Preview
            </Button>
            <Button variant="destructive" onClick={() => run(true)} disabled={!result?.success || loading || result.applied}>
              Apply Reconciliation
            </Button>
          </div>
        </div>

        {result && (
          <div className="space-y-5 text-sm">
            {!result.success ? (
              <div className="border border-destructive/50 bg-destructive/10 p-4 text-destructive">{result.message}</div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Workbook" value={`${result.workbook?.groups || 0} rows / ${result.workbook?.units || 0} units`} />
                  <Metric label="Matched" value={String(result.changes?.matched || 0)} />
                  <Metric label="Add" value={`${result.changes?.additions || 0} rows`} />
                  <Metric label="Archive" value={`${result.changes?.archives || 0} rows`} />
                </div>
                <div className="border-y border-border/60 py-4">
                  <div className="font-semibold">Protected September 6 lot</div>
                  <div className="text-muted-foreground">
                    {(result.protectedLots || []).map((lot) => lot.name || lot.source || lot.id).join(', ') || 'No matching lot found'}
                    {' '}({result.protectedItems?.length || 0} items)
                  </div>
                </div>
                {result.applied && result.verified && (
                  <div className="border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-200">
                    Applied: {result.verified.rows} active rows / {result.verified.units} units. Protected lot present: {result.verified.protectedItemsPresent ? 'Yes' : 'No'}.
                  </div>
                )}
                <Sample title="Fuzzy matches" rows={(result.samples?.fuzzyMatches || []).map((item) => `${item.workbook} -> ${item.inventory} (${item.score})`)} />
                <Sample title="Items to add" rows={(result.samples?.additions || []).map((item) => `${item.name} | ${item.console} | ${item.condition} | Qty ${item.quantity}`)} />
                <Sample title="Items to archive" rows={(result.samples?.archives || []).map((item) => `${item.name} | ${item.console} | ${item.condition} | Qty ${item.quantity}`)} />
              </>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-primary/60 pl-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Sample({ title, rows }: { title: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-2 font-semibold">{title}</div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {rows.map((row, index) => <div key={`${title}-${index}`}>{row}</div>)}
      </div>
    </div>
  );
}
