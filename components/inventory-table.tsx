'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronRight, Gamepad2, FolderInput, Check, FolderOpen, X, Minus, Clock, BookOpen, Package, Printer, Tags } from 'lucide-react';
import { PrepStageMini } from '@/components/prep-stage-bar';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { getItemRegionDetails, getRegionStyle } from '@/lib/region';
import { getAgeActionLabel, getAgeStatus, getInventoryAgeDays, type AgingThresholds } from '@/lib/inventory-aging';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Collection } from '@/components/create-collection-dialog';
import { getInventoryFamily, isBookLikeItem, productTypeLabel } from '@/lib/item-taxonomy';

const LABEL_QUEUE_KEY = 'retroloot-label-queue';

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  region?: string | null;
  purchase_price: number;
  quantity: number;
  status?: string | null;
  created_at: string;
  image_url?: string | null;
  thumbnail_url?: string | null;
  barcode?: string;
  description?: string | null;
  category?: string | null;
  item_type?: string | null;
  genre?: string | null;
  source_metadata_provider?: string | null;
  source_upc_provider?: string | null;
  pricing_matched_title?: string | null;
  pricing_matched_platform?: string | null;
  collection_id?: string | null;
  pricing_data?: {
    loose_price: number;
    cib_price: number;
    new_price: number;
  }[];
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  selected_market_value?: number;
  estimated_profit?: number;
  estimated_margin_percent?: number;
  deal_score?: number;
  deal_score_label?: string;
  needs_review?: boolean;
  pricing_confidence?: number;
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
};

type InventoryTableProps = {
  items: InventoryItem[];
  onRefresh: () => void;
  agingThresholds?: AgingThresholds;
  collections?: Collection[];
  onMoveToCollection?: (itemId: string, collectionId: string | null) => Promise<void>;
  onBulkMoveToCollection?: (itemIds: string[], collectionId: string | null) => Promise<void>;
};

function getConditionStyle(condition: string) {
  switch (condition) {
    case 'Graded': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'Sealed':
    case 'New': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'CIB': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    case 'Used': return 'bg-violet-500/10 text-violet-300 border-violet-500/30';
    case 'Damaged': return 'bg-red-500/10 text-red-300 border-red-500/30';
    case 'Untested': return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30';
    default: return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
  }
}

function getDealBadge(label: string, _score: number) {
  const styles: Record<string, string> = {
    'Steal': 'bg-green-500/15 text-green-400 border-green-500/30',
    'Great': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'Good': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    'Fair': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    'Risky': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    'Avoid': 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return styles[label] || 'bg-muted text-muted-foreground border-border';
}

export function InventoryTable({
  items,
  onRefresh,
  agingThresholds = { watchDays: 45, reviewDays: 60 },
  collections = [],
  onMoveToCollection,
  onBulkMoveToCollection,
}: InventoryTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < items.length;

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('inventory_items').delete().eq('id', id);
      if (error) throw error;
      toast.success('Item deleted');
      onRefresh();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete item');
    }
  };

  const handleBulkMove = async (collectionId: string | null) => {
    if (!onBulkMoveToCollection || selectedIds.size === 0) return;
    await onBulkMoveToCollection(Array.from(selectedIds), collectionId);
    clearSelection();
  };

  const selectedIdList = () => Array.from(selectedIds);

  const handlePrintSelectedLabels = () => {
    const ids = selectedIdList();
    if (ids.length === 0) return;
    router.push(`/labels?ids=${encodeURIComponent(ids.join(','))}`);
  };

  const handleQueueSelectedLabels = () => {
    const ids = selectedIdList();
    if (ids.length === 0 || typeof window === 'undefined') return;
    let existing: string[] = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(LABEL_QUEUE_KEY) || '[]');
      existing = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      existing = [];
    }
    const next = Array.from(new Set([...existing, ...ids]));
    window.localStorage.setItem(LABEL_QUEUE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('retroloot-label-queue-change'));
    toast.success(`Queued ${ids.length} label${ids.length === 1 ? '' : 's'}`);
    clearSelection();
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-16 border border-border/50 rounded-xl bg-card/30">
        <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-muted-foreground font-medium">No items found</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Scan or add your first game, book, or resale item to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isSelectionMode && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 sticky top-2 z-10 backdrop-blur-sm">
          <div
            className="w-6 h-6 flex items-center justify-center rounded-sm border border-primary/60 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors flex-shrink-0"
            onClick={allSelected ? clearSelection : selectAll}
          >
            {allSelected ? (
              <Check className="w-4 h-4 text-primary" />
            ) : someSelected ? (
              <Minus className="w-4 h-4 text-primary" />
            ) : null}
          </div>

          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
          </span>

          {items.length > selectedIds.size && (
            <button
              onClick={selectAll}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Select all {items.length}
            </button>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            className="h-9 text-sm gap-1.5"
            onClick={handlePrintSelectedLabels}
          >
            <Printer className="w-4 h-4" />
            Print Labels
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-9 text-sm gap-1.5 border-border/60"
            onClick={handleQueueSelectedLabels}
          >
            <Tags className="w-4 h-4" />
            Add to Queue
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-sm text-muted-foreground"
            onClick={() => router.push('/labels')}
          >
            Open Queue
          </Button>

          {collections.length > 0 && onBulkMoveToCollection && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 text-sm gap-1.5 border-border/60">
                  <FolderOpen className="w-4 h-4" />
                  Move to Collection
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 bg-card border-border">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                  Move {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} to
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {collections.map((col) => (
                  <DropdownMenuItem
                    key={col.id}
                    className="cursor-pointer text-sm gap-2"
                    onClick={() => handleBulkMove(col.id)}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                    {col.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-sm text-muted-foreground gap-2"
                  onClick={() => handleBulkMove(null)}
                >
                  <X className="w-3.5 h-3.5" />
                  Remove from collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-sm text-muted-foreground"
            onClick={clearSelection}
          >
            Clear
          </Button>
        </div>
      )}

      {items.map((item) => {
        let marketValue = 0;
        let profit = 0;
        let dealScore = { score: 0, label: 'No Data', emoji: '', color: 'text-gray-400' };

        const pricing = item.pricing_data?.[0];
        const loosePrice = Number(item.price_loose) || Number(pricing?.loose_price) || 0;
        const cibPrice = Number(item.price_cib) || Number(pricing?.cib_price) || 0;
        const newPrice = Number(item.price_new) || Number(pricing?.new_price) || 0;
        const gradedPrice = Number(item.price_graded) || 0;
        const hasPricingTiers = loosePrice > 0 || cibPrice > 0 || newPrice > 0 || gradedPrice > 0;

        if (Number(item.selected_market_value) > 0) {
          marketValue = Number(item.selected_market_value);
          profit = Number(item.estimated_profit) || 0;
          if (item.deal_score !== undefined && item.deal_score_label) {
            dealScore = {
              score: item.deal_score,
              label: item.deal_score_label,
              emoji: '',
              color: getDealBadge(item.deal_score_label, item.deal_score),
            };
          }
        } else {
          if (hasPricingTiers) {
            marketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
            profit = marketValue - item.purchase_price;
            const inventoryAgeDays = Math.floor(
              (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)
            );
            dealScore = calculateDealScore(item.purchase_price, marketValue, 0, 0, inventoryAgeDays);
          }
        }

        const hasPricing = marketValue > 0;
        const bookLike = isBookLikeItem(item);
        const family = getInventoryFamily(item);
        const FallbackIcon = bookLike ? BookOpen : Gamepad2;
        const imageUrl = item.thumbnail_url || item.image_url;
        const isSelected = selectedIds.has(item.id);
        const hasCollections = collections.length > 0 && onMoveToCollection;
        const region = getItemRegionDetails(item);
        const isInStock = (item.status || 'available') !== 'sold';
        const ageDays = isInStock ? getInventoryAgeDays(item.created_at) : 0;
        const ageStatus = isInStock ? getAgeStatus(ageDays, agingThresholds) : 'fresh';
        const ageStyle =
          ageStatus === 'stale'
            ? 'border-red-500/35 bg-red-500/10 text-red-300'
            : ageStatus === 'watch'
              ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
              : 'border-border/45 bg-secondary/30 text-muted-foreground';

        return (
          <Link
            key={item.id}
            href={`/inventory/${item.id}`}
            onClick={isSelectionMode ? (e) => { e.preventDefault(); toggleSelection(item.id); } : undefined}
            className={`group flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
              isSelected
                ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
                : 'border-border/40 bg-card/40 hover:bg-card/80 hover:border-border/70'
            }`}
          >
            <div
              className={`flex-shrink-0 flex items-center justify-center w-5 h-5 transition-opacity duration-150 ${
                isSelectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelection(item.id); }}
            >
              <div className={`w-5 h-5 rounded-sm border flex items-center justify-center transition-colors ${
                isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-primary/60'
              }`}>
                {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
              </div>
            </div>

            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-secondary/30 border border-border/30 flex-shrink-0 flex items-center justify-center">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={item.product_name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : null}
              <FallbackIcon className={`w-6 h-6 text-muted-foreground/30 ${imageUrl ? 'hidden' : ''}`} />
              {item.needs_review && (
                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-yellow-500 rounded-full border-2 border-card" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-base truncate">{item.product_name}</span>
                {item.needs_review && (
                  <Badge variant="outline" className="border-yellow-500/40 text-yellow-400 text-[11px] px-2 py-0 h-5 flex-shrink-0">
                    Review
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">{item.console}</span>
                <span className="text-muted-foreground/30 text-sm">|</span>
                <Badge variant="outline" className="text-[11px] px-2 py-0 h-5 border-border/45 text-muted-foreground">
                  {productTypeLabel(family)}
                </Badge>
                <Badge variant="outline" className={`text-[11px] px-2 py-0 h-5 ${getConditionStyle(item.condition)}`}>
                  {item.condition}
                </Badge>
                {region && !bookLike && (
                  <Badge
                    variant="outline"
                    className={`text-[11px] px-2 py-0 h-5 font-bold tracking-[0.04em] ${getRegionStyle(region)}`}
                    title={region.label}
                  >
                    {region.shortLabel}
                  </Badge>
                )}
                {(item.genre || item.category) && (
                  <>
                    <span className="text-muted-foreground/30 text-sm hidden md:inline">|</span>
                    <span className="text-xs text-muted-foreground/60 hidden md:inline">{item.genre || item.category}</span>
                  </>
                )}
                {item.quantity > 1 && (
                  <>
                    <span className="text-muted-foreground/30 text-sm">|</span>
                    <span className="text-sm text-muted-foreground">x{item.quantity}</span>
                  </>
                )}
                {isInStock && (
                  <Badge
                    variant="outline"
                    className={`h-5 px-2 py-0 text-[11px] ${ageStyle}`}
                    title={getAgeActionLabel(ageDays, agingThresholds)}
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    {ageDays}d
                  </Badge>
                )}
              </div>
              {hasPricingTiers && (
                <div className="flex items-center gap-3 mt-1">
                  {[
                    { label: 'L', value: loosePrice, active: item.condition === 'Loose' },
                    { label: 'C', value: cibPrice, active: item.condition === 'CIB' },
                    { label: 'N', value: newPrice, active: item.condition === 'New' },
                    ...(gradedPrice > 0 ? [{ label: 'G', value: gradedPrice, active: item.condition === 'Graded' }] : []),
                  ].map(({ label, value, active }) => (
                    <span
                      key={label}
                      className={`text-[11px] font-mono ${
                        active
                          ? 'text-primary font-semibold'
                          : 'text-muted-foreground/40'
                      }`}
                    >
                      {label}: {value > 0 ? `$${value.toFixed(0)}` : '--'}
                    </span>
                  ))}
                </div>
              )}
              <PrepStageMini fields={item} />
            </div>

            <div className="flex items-center gap-6 flex-shrink-0">
              <div className="text-right hidden sm:block">
                <div className="text-xs text-muted-foreground/60 mb-1">Cost</div>
                <div className="text-base font-medium">${item.purchase_price.toFixed(2)}</div>
              </div>

              <div className="text-right hidden sm:block">
                <div className="text-xs text-muted-foreground/60 mb-1">Market</div>
                <div className="text-base font-medium text-primary">
                  {hasPricing ? `$${marketValue.toFixed(2)}` : bookLike ? 'Manual' : '--'}
                </div>
              </div>

              <div className="text-right hidden md:block w-20">
                <div className="text-xs text-muted-foreground/60 mb-1">Profit</div>
                <div className={`text-base font-semibold ${profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {hasPricing ? `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}` : '--'}
                </div>
              </div>

              {hasPricing && dealScore.label !== 'No Data' && (
                <div className="hidden lg:block">
                  <Badge variant="outline" className={`text-[11px] px-2.5 py-1 font-semibold ${getDealBadge(dealScore.label, dealScore.score)}`}>
                    {dealScore.label} {dealScore.score}
                  </Badge>
                </div>
              )}

              {!isSelectionMode && hasCollections && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      <FolderInput className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48 bg-card border-border"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Move to collection</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {collections.map((col) => (
                      <DropdownMenuItem
                        key={col.id}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const newId = item.collection_id === col.id ? null : col.id;
                          onMoveToCollection!(item.id, newId);
                        }}
                      >
                        <Check className={`w-3.5 h-3.5 ${item.collection_id === col.id ? 'opacity-100' : 'opacity-0'}`} />
                        {col.name}
                      </DropdownMenuItem>
                    ))}
                    {item.collection_id && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onMoveToCollection!(item.id, null);
                          }}
                        >
                          Remove from collection
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {!isSelectionMode && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.preventDefault()}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Item?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete &quot;{item.product_name}&quot; from your inventory.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(item.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {!isSelectionMode && (
                <ChevronRight className="w-5 h-5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors hidden sm:block" />
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
