'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PrepCard, type PrepItem } from './prep-card';
import { CreateLotDialog } from './create-lot-dialog';
import { ClipboardList, ScanBarcode, ChevronDown, ChevronRight, FolderOpen, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { matchesPrepQueue } from '@/lib/prep-workflow';

type Lot = {
  id: string;
  name: string;
  source: string;
  notes: string;
  received_at: string;
};

type FilterTab = 'in_progress' | 'ready' | 'listed' | 'sold' | 'lots';

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex min-w-[120px] items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${color}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}

function LotSection({
  lot,
  items,
  onItemChange,
}: {
  lot: Lot | null;
  items: PrepItem[];
  onItemChange: (id: string, updates: Partial<PrepItem>) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const doneCount = items.filter(i => !!i.on_rack_at).length;
  const listedCount = items.filter(i => i.listed_ebay_at || i.listed_amazon_at || i.listed_whatnot_at).length;
  const soldCount = items.filter(i => i.status === 'sold' || i.sold_at).length;

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 overflow-hidden">
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <FolderOpen className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white/80">
              {lot?.name ?? 'No Lot'}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
              {lot?.source && <span>{lot.source}</span>}
              {lot?.received_at && <span>Received {format(new Date(lot.received_at), 'MMM d, yyyy')}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
            <div className="hidden items-center gap-2 text-[10px] sm:flex">
            <span className="text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            {doneCount > 0 && (
              <span className="text-emerald-400">{doneCount} on rack</span>
            )}
            {listedCount > 0 && (
              <span className="text-primary">{listedCount} listed</span>
            )}
            {soldCount > 0 && (
              <span className="text-emerald-400">{soldCount} sold</span>
            )}
          </div>
          <div className="w-1.5 h-1.5" />
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-white/30" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/30" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 border-t border-border/20 pt-4">
          {items.map(item => (
            <PrepCard
              key={item.id}
              item={item}
              onChange={updates => onItemChange(item.id, updates)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PrepPage() {
  const { user, accountId } = useAuth();
  const [items, setItems] = useState<PrepItem[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('in_progress');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showLotDialog, setShowLotDialog] = useState(false);
  const [loadError, setLoadError] = useState('');
  const generation = useRef({});

  const load = useCallback(async () => {
    const current = {}; generation.current = current;
    setLoading(true); setLoadError(''); setItems([]); setLots([]); setPage(0);
    if (!user || !accountId) { setLoading(false); return; }
    try {
      const [rows, lotRows] = await Promise.all([
        (async () => {
          const rows: PrepItem[] = [];
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from('inventory_items')
              .select('id,product_name,console,condition,purchase_price,quantity,created_at,sorted_at,cleaned_at,tested_at,notes_added_at,on_rack_at,listed_ebay_at,listed_amazon_at,listed_whatnot_at,status,sold_at,sell_price,lot_id')
              .eq('user_id', accountId).order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
            if (error) throw error;
            if (!data) throw new Error('Preparation inventory response was missing.');
            if (generation.current !== current) return [];
            rows.push(...data);
            if (data.length < 500) return rows;
          }
        })(),
        (async () => {
          const rows: Lot[] = [];
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from('lots').select('id,name,source,notes,received_at')
              .eq('user_id', accountId).order('received_at', { ascending: false }).order('id').range(offset, offset + 499);
            if (error) throw error;
            if (!data) throw new Error('Preparation lots response was missing.');
            if (generation.current !== current) return [];
            rows.push(...data);
            if (data.length < 500) return rows;
          }
        })(),
      ]);
      if (generation.current === current) { setItems(rows); setLots(lotRows); }
    } catch (cause) {
      console.error('Preparation load:', cause);
      if (generation.current === current) setLoadError('Preparation inventory and lots could not be loaded. Retry before making changes.');
    } finally { if (generation.current === current) setLoading(false); }
  }, [user, accountId]);

  useEffect(() => { void load(); return () => { generation.current = {}; }; }, [load]);

  const handleItemChange = (id: string, updates: Partial<PrepItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const filteredItems = items.filter(item => {
    if (search) {
      const q = search.toLowerCase();
      if (!item.product_name.toLowerCase().includes(q) && !item.console.toLowerCase().includes(q)) return false;
    }
    return matchesPrepQueue(item, filter);
  });

  const inProgressCount = items.filter(i => matchesPrepQueue(i, 'in_progress')).length;
  const readyCount = items.filter(i => matchesPrepQueue(i, 'ready')).length;
  const listedCount = items.filter(i => matchesPrepQueue(i, 'listed')).length;
  const soldCount = items.filter(i => matchesPrepQueue(i, 'sold')).length;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 24));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = filteredItems.slice(currentPage * 24, (currentPage + 1) * 24);

  const TABS: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'in_progress', label: 'Needs Work', count: inProgressCount },
    { key: 'ready', label: 'Ready to List', count: readyCount },
    { key: 'listed', label: 'Listed', count: listedCount },
    { key: 'sold', label: 'Sold', count: soldCount },
    { key: 'lots', label: 'By Lot' },
  ];

  const lotsWithItems = lots.map(lot => ({
    lot,
    items: visibleItems.filter(i => i.lot_id === lot.id),
  })).filter(l => l.items.length > 0);

  const noLotItems = visibleItems.filter(i => !i.lot_id || !lots.some(lot => lot.id === i.lot_id));

  return (
    <DashboardLayout>
      <CreateLotDialog
        open={showLotDialog}
        onOpenChange={setShowLotDialog}
        onSuccess={(lotId, lotName) => {
          setLots(prev => [{ id: lotId, name: lotName, source: '', notes: '', received_at: new Date().toISOString() }, ...prev]);
          toast.success(`Lot created — now add items via Scan and assign them to "${lotName}"`);
        }}
      />

      <div className="prep-workspace max-w-7xl space-y-6 p-4 sm:p-7">
        <div className="catalog-workspace-header">
          <div>
            <p className="brand-eyebrow">A LITTLE CARE. A GREAT NEXT CHAPTER.</p>
            <h1>From new arrival to shop-ready.</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sort, clean, test and document each find. Every card shows the next step; you stay in control.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs border-border/60" onClick={() => setShowLotDialog(true)}>
              <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
              New Lot
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs border-border/60" asChild>
              <Link href="/business/tasks">
                <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                Tasks
              </Link>
            </Button>
            <Button size="sm" className="h-8 text-xs" asChild>
              <Link href="/business/scan">
                <ScanBarcode className="w-3.5 h-3.5 mr-1.5" />
                Add Items
              </Link>
            </Button>
          </div>
        </div>

        <nav className="catalog-workflow-strip" aria-label="Preparation workflow"><Link href="/business/inventory"><ClipboardList size={18}/><span><strong>Check the item</strong><small>Condition, photos and internal notes</small></span></Link><Link href="/business/storefront"><ScanBarcode size={18}/><span><strong>Review the shop</strong><small>Live price, public photo and shipping offer</small></span></Link><Button variant="outline" className="m-3" disabled={loading} onClick={load}>Refresh preparation</Button></nav>
        <p className="text-xs leading-6 text-muted-foreground">Prep tracks physical work, not shop publication. Listed refers to eBay, Amazon or Whatnot. Work queues show available stock; Sold and By Lot retain history.</p>
        {loadError ? <section className="business-overview-message"><p role="alert">{loadError}</p><Button variant="outline" onClick={load}>Retry preparation</Button></section> : <>
        {!loading && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatPill label="Needs Work" value={inProgressCount} color="border-border/30 text-white/70 bg-white/[0.02]" />
          <StatPill label="Ready" value={readyCount} color="border-primary/25 text-primary bg-primary/[0.04]" />
          <StatPill label="Listed" value={listedCount} color="border-emerald-500/25 text-emerald-400 bg-emerald-500/[0.04]" />
          <StatPill label="Sold" value={soldCount} color="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.06]" />
        </div>
        </>}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex w-full flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-border/30 bg-white/[0.04] p-1 xl:min-w-0">
            {TABS.map(tab => (
              <button
                key={tab.key}
                aria-pressed={filter === tab.key}
                onClick={() => { setFilter(tab.key); setPage(0); }}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  filter === tab.key
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    filter === tab.key ? 'bg-primary/20 text-primary' : 'bg-white/[0.06] text-white/30'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative w-full shrink-0 xl:w-52 2xl:w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search..."
              aria-label="Search preparation"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="h-8 pl-8 text-xs bg-secondary/40 border-border/50"
            />
            {search && (
              <button aria-label="Clear preparation search" onClick={() => { setSearch(''); setPage(0); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white/60">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card h-40 animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-border/30 flex items-center justify-center">
              <ClipboardList className="w-7 h-7 text-white/15" />
            </div>
            <div className="text-center">
                <p className="text-sm text-white/50 font-medium">
                {search ? 'No items match your search' : filter === 'ready' ? 'Nothing is ready to list yet' : filter === 'listed' ? 'Nothing is listed yet' : filter === 'sold' ? 'Nothing is sold yet' : 'No items need work'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {!search && filter === 'in_progress' && 'Items that are ready, listed, or sold are available in the filters above'}
              </p>
            </div>
            {!search && filter === 'in_progress' && items.length === 0 && (
              <Button size="sm" className="mt-2 h-8 text-xs" asChild>
                <Link href="/business/scan">
                  <ScanBarcode className="w-3.5 h-3.5 mr-1.5" />
                  Scan Items
                </Link>
              </Button>
            )}
          </div>
        ) : filter === 'lots' ? (
          <div className="space-y-4">
            {lotsWithItems.map(({ lot, items: lotItems }) => (
              <LotSection
                key={lot.id}
                lot={lot}
                items={lotItems}
                onItemChange={handleItemChange}
              />
            ))}
            {noLotItems.length > 0 && (
              <LotSection
                lot={null}
                items={noLotItems}
                onItemChange={handleItemChange}
              />
            )}
            {lotsWithItems.length === 0 && noLotItems.length === 0 && (
              <div className="rounded-2xl border border-border/40 bg-card flex items-center justify-center py-10">
                <p className="text-sm text-muted-foreground">No items match the current filter</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleItems.map(item => (
              <PrepCard
                key={item.id}
                item={item}
                onChange={updates => handleItemChange(item.id, updates)}
              />
            ))}
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <nav aria-label="Preparation pages" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Items {currentPage * 24 + 1}–{Math.min((currentPage + 1) * 24, filteredItems.length)} of {filteredItems.length}. {filter === 'lots' && 'Lot groups show this page of matching items.'}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button variant="outline" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </div>
          </nav>
        )}
        <div className="rounded-2xl border border-border/30 bg-white/[0.01] p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-white/45">Workflow:</span>
            <span>Sort</span>
            <span>/</span>
            <span>Clean</span>
            <span>/</span>
            <span>Test</span>
            <span>/</span>
            <span>Notes</span>
            <span>/</span>
            <span>Rack</span>
            <span>/</span>
            <span>Listed</span>
            <span>/</span>
            <span>Sold</span>
          </div>
        </div>
        </>}
      </div>
    </DashboardLayout>
  );
}
