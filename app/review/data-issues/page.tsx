'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { ContextHelp } from '@/components/context-help';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, ArrowRight, FileSearch, ScanLine, Search, Tag, Text, Wallet } from 'lucide-react';
import { toast } from 'sonner';

type MissingField = {
  field: string;
  cloverValue: string;
  retroLootValue: string;
};

type CloverAuditIssue = {
  cloverId: string;
  cloverName: string;
  retroLootItemId: string;
  retroLootName: string;
  retroLootConsole: string;
  retroLootCondition: string;
  missingFields: MissingField[];
};

const FIELD_STYLES: Record<string, string> = {
  SKU: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  'Product Code / UPC': 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  Category: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  Description: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  Price: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
};

function fieldIcon(field: string) {
  switch (field) {
    case 'SKU': return Tag;
    case 'Product Code / UPC': return ScanLine;
    case 'Description': return Text;
    case 'Price': return Wallet;
    default: return AlertTriangle;
  }
}

export default function CloverMissingDataAuditPage() {
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<CloverAuditIssue[]>([]);
  const [summary, setSummary] = useState({ totalCloverRows: 0, matchedRetroLootRows: 0 });

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return issues;
    return issues.filter((issue) =>
      [
        issue.cloverName,
        issue.cloverId,
        issue.retroLootName,
        issue.retroLootConsole,
        ...issue.missingFields.map((field) => field.field),
      ].some((value) => String(value || '').toLowerCase().includes(normalized))
    );
  }, [issues, query]);

  const counts = useMemo(() => {
    const base: Record<string, number> = {
      total: issues.length,
      SKU: 0,
      'Product Code / UPC': 0,
      Category: 0,
      Description: 0,
      Price: 0,
    };
    for (const issue of issues) {
      for (const field of issue.missingFields) {
        base[field.field] = (base[field.field] || 0) + 1;
      }
    }
    return base;
  }, [issues]);

  const runAudit = async (file: File) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/clover/audit-missing-data', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Clover export audit failed');
      }
      setIssues(result.issues || []);
      setSummary({
        totalCloverRows: Number(result.totalCloverRows || 0),
        matchedRetroLootRows: Number(result.matchedRetroLootRows || 0),
      });
      toast.success(
        result.issues?.length
          ? `Found ${result.issues.length} Clover item${result.issues.length === 1 ? '' : 's'} with missing data RetroLoot can fill`
          : 'No missing Clover data found for matched RetroLoot items'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover export audit failed');
    } finally {
      if (uploadRef.current) uploadRef.current.value = '';
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl space-y-6 p-5 sm:p-7 lg:p-8">
        <input
          ref={uploadRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) runAudit(file);
          }}
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="label-caps">Review</div>
              <ContextHelp href="/help#inventory-management" label="Open Clover audit help">
                Upload a Clover items export to see which Clover rows are missing data that already exists in RetroLoot for manual correction.
              </ContextHelp>
            </div>
            <h1 className="heading-lg text-[22px]">Clover Missing Data Audit</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Compare a Clover export against RetroLoot and get a manual-fix list for missing SKU, UPC, category, description, or price.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-10 rounded-lg text-sm"
              onClick={() => uploadRef.current?.click()}
              disabled={loading}
            >
              <FileSearch className={`mr-1.5 h-4 w-4 ${loading ? 'animate-pulse' : ''}`} />
              Upload Clover export
            </Button>
            <Button asChild variant="outline" size="sm" className="h-10 rounded-lg text-sm">
              <Link href="/inventory">Back to inventory</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <div className="label-caps">Clover Items Flagged</div>
            <div className="mt-1 text-[24px] font-bold">{counts.total}</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <div className="label-caps">Missing SKU / UPC</div>
            <div className="mt-1 text-[24px] font-bold">{counts.SKU + counts['Product Code / UPC']}</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <div className="label-caps">Catalog Gaps</div>
            <div className="mt-1 text-[24px] font-bold">{counts.Category + counts.Description}</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <div className="label-caps">Export Rows Scanned</div>
            <div className="mt-1 text-[24px] font-bold">{summary.totalCloverRows}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Clover name, Clover ID, RetroLoot title, or missing field..."
                className="h-10 pl-9"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              Matched RetroLoot rows: <span className="font-medium text-foreground/90">{summary.matchedRetroLootRows}</span>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card p-10 text-center">
            <FileSearch className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <div className="text-sm font-medium">No Clover issues loaded yet</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a Clover export workbook to generate a manual correction list.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((issue) => (
              <div key={`${issue.cloverId}-${issue.retroLootItemId}`} className="rounded-2xl border border-border/40 bg-card p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-[16px] font-semibold">{issue.cloverName || issue.retroLootName}</h2>
                      <Badge variant="outline" className="border-border/60 text-xs text-muted-foreground">
                        Clover ID {issue.cloverId || 'Missing'}
                      </Badge>
                      <Badge variant="outline" className="border-border/60 text-xs text-muted-foreground">
                        {issue.retroLootConsole || 'Unknown platform'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {issue.missingFields.map((field) => {
                        const Icon = fieldIcon(field.field);
                        return (
                          <Badge key={`${issue.cloverId}-${field.field}`} variant="outline" className={`gap-1.5 ${FIELD_STYLES[field.field] || 'border-border/60 text-muted-foreground'}`}>
                            <Icon className="h-3 w-3" />
                            {field.field}
                          </Badge>
                        );
                      })}
                    </div>
                    <div className="mt-4 space-y-2">
                      {issue.missingFields.map((field) => (
                        <div key={`${issue.cloverId}-${field.field}-detail`} className="rounded-xl border border-border/30 bg-secondary/20 px-3 py-2 text-xs">
                          <div className="font-medium text-foreground/90">{field.field}</div>
                          <div className="mt-1 text-muted-foreground">
                            Clover: <span className="font-mono text-foreground/75">{field.cloverValue || 'Missing'}</span>
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            RetroLoot: <span className="font-mono text-foreground/90">{field.retroLootValue || 'Missing'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild size="sm" className="h-9 rounded-lg text-sm">
                      <Link href={`/inventory/${issue.retroLootItemId}`}>
                        Open RetroLoot item
                        <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
