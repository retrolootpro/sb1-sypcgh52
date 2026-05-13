'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Plus, Search, RefreshCw, Package, DollarSign, TrendingUp, FolderOpen, X, FolderPlus, ArrowUpDown, Bell, Clock } from 'lucide-react';
import { AddItemDialog } from '@/components/add-item-dialog';
import { InventoryTable } from '@/components/inventory-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONSOLES, CONDITIONS, REGIONS } from '@/lib/constants';
import { lookupUPC } from '@/lib/api-services';
import { getCanonicalPricing } from '@/lib/pricing-service';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { getItemRegionDetails } from '@/lib/region';
import { getAgeStatus, getInventoryAgeDays, normalizeAgingThresholds, readAgingThresholds, writeAgingThresholds, type AgingThresholds } from '@/lib/inventory-aging';
import { toast } from 'sonner';
import { CreateCollectionDialog, type Collection } from '@/components/create-collection-dialog';
import { useSearchParams } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ContextHelp } from '@/components/context-help';

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
  barcode?: string;
  image_url?: string;
  thumbnail_url?: string;
  description?: string | null;
  brand?: string;
  collection_id?: string | null;
  pricing_matched_title?: string | null;
  pricing_matched_platform?: string | null;
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  selected_market_value?: number;
  pc_source_product_id?: string | null;
  pricing_data?: {
    loose_price: number;
    cib_price: number;
    new_price: number;
  }[];
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
};

export default function InventoryPage() {
  const { user, accountId } = useAuth();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [consoleFilter, setConsoleFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [agingThresholds, setAgingThresholds] = useState<AgingThresholds>({ watchDays: 45, reviewDays: 60 });
  const [backfilling, setBackfilling] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);

  const loadInventory = useCallback(async () => {
    if (!user || !accountId) return;
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select(`*, pricing_data (*)`)
        .eq('user_id', accountId)
        .order('product_name', { ascending: true });

      if (error) throw error;
      setItems(data as InventoryItem[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [user, accountId]);

  const loadCollections = useCallback(async () => {
    if (!user || !accountId) return;
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('user_id', accountId)
      .order('created_at', { ascending: true });
    if (!error && data) setCollections(data as Collection[]);
  }, [user, accountId]);

  useEffect(() => {
    if (user && accountId) {
      loadInventory();
      loadCollections();
    }
  }, [user, accountId, loadInventory, loadCollections]);

  useEffect(() => {
    if (searchParams.get('age') === 'stale') {
      setAgeFilter('stale');
      setSortBy('age_high');
    }
  }, [searchParams]);

  useEffect(() => {
    const syncThreshold = () => setAgingThresholds(readAgingThresholds());
    syncThreshold();
    window.addEventListener('storage', syncThreshold);
    window.addEventListener('retroloot-stale-threshold-change', syncThreshold);
    return () => {
      window.removeEventListener('storage', syncThreshold);
      window.removeEventListener('retroloot-stale-threshold-change', syncThreshold);
    };
  }, []);

  const handleCollectionCreated = (col: Collection) => {
    setCollections((prev) => [...prev, col]);
    setSelectedCollectionId(col.id);
  };

  const handleDeleteCollection = async (col: Collection) => {
    try {
      const { error } = await supabase.from('collections').delete().eq('id', col.id);
      if (error) throw error;
      setCollections((prev) => prev.filter((c) => c.id !== col.id));
      if (selectedCollectionId === col.id) setSelectedCollectionId(null);
      toast.success(`Collection "${col.name}" deleted`);
      loadInventory();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete collection');
    } finally {
      setCollectionToDelete(null);
    }
  };

  const handleMoveToCollection = async (itemId: string, collectionId: string | null) => {
    const { error } = await supabase
      .from('inventory_items')
      .update({ collection_id: collectionId })
      .eq('id', itemId);
    if (error) {
      toast.error('Failed to update collection');
    } else {
      const colName = collections.find((c) => c.id === collectionId)?.name;
      toast.success(collectionId ? `Moved to "${colName}"` : 'Removed from collection');
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, collection_id: collectionId } : i))
      );
    }
  };

  const handleBulkMoveToCollection = async (itemIds: string[], collectionId: string | null) => {
    const { error } = await supabase
      .from('inventory_items')
      .update({ collection_id: collectionId })
      .in('id', itemIds);
    if (error) {
      toast.error('Failed to update collection');
    } else {
      const colName = collections.find((c) => c.id === collectionId)?.name;
      toast.success(
        collectionId
          ? `Moved ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} to "${colName}"`
          : `Removed ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} from collection`
      );
      setItems((prev) =>
        prev.map((i) => itemIds.includes(i.id) ? { ...i, collection_id: collectionId } : i)
      );
    }
  };

  const fetchSteamImage = async (title: string): Promise<string | null> => {
    try {
      const res = await fetch(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.items || data.items.length === 0) return null;
      const appId = data.items[0].id;
      return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
    } catch {
      return null;
    }
  };

  const runLocalMetadataRefresh = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.access_token) throw new Error('Not authenticated');

    const response = await fetch('/api/local-metadata-refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true, limit: 250 }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new Error(result.message || 'Failed to refresh metadata');
    }

    return result as { scanned?: number; updated?: number; skipped?: number; failed?: number };
  };

  const handleBackfillBarcodeData = async () => {
    if (!user) return;
    setBackfilling(true);
    try {
      if (typeof window !== 'undefined') {
        toast.info('Refreshing metadata and images...');
        const result = await runLocalMetadataRefresh();
        if ((result.updated ?? 0) > 0) {
          toast.success(`Updated ${result.updated} item${result.updated === 1 ? '' : 's'}`);
          loadInventory();
        } else {
          toast.info('No metadata changes found');
        }
        if ((result.failed ?? 0) > 0) {
          toast.warning(`${result.failed} item${result.failed === 1 ? '' : 's'} could not be refreshed`);
        }
        return;
      }

      const itemsNeedingBackfill = items.filter(
        (item: any) => item.barcode && (!item.image_url || !item.thumbnail_url || !(item as any).description)
      );
      if (itemsNeedingBackfill.length === 0) {
        toast.info('All items already have images and metadata');
        return;
      }
      toast.info(`Fetching data for ${itemsNeedingBackfill.length} items...`);
      let successCount = 0;
      let errorCount = 0;
      for (const item of itemsNeedingBackfill) {
        try {
          if (!item.barcode) continue;
          let barcodeData: any = null;
          try {
            barcodeData = await lookupUPC(item.barcode, accountId || user.id, item.product_name || undefined);
          } catch {
            if (item.product_name) {
              const steamImage = await fetchSteamImage(item.product_name);
              if (steamImage) {
                barcodeData = { imageUrl: steamImage, thumbnailUrl: steamImage };
              }
            }
          }
          if (barcodeData) {
            const updates: Record<string, any> = {};
            if (barcodeData.imageUrl) { updates.image_url = barcodeData.imageUrl; updates.thumbnail_url = barcodeData.thumbnailUrl || barcodeData.imageUrl; }
            if (barcodeData.brand && !item.brand) updates.brand = barcodeData.brand;
            if (barcodeData.description && !(item as any).description) updates.description = barcodeData.description;
            if (barcodeData.category && !(item as any).category) updates.category = barcodeData.category;
            if (Object.keys(updates).length > 0) {
              const { error: updateError } = await supabase
                .from('inventory_items')
                .update(updates)
                .eq('id', item.id);
              if (updateError) { errorCount++; } else { successCount++; }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch { errorCount++; }
      }
      if (successCount > 0) { toast.success(`Updated ${successCount} items`); loadInventory(); }
      if (errorCount > 0) { toast.warning(`Failed to update ${errorCount} items`); }
    } catch (error: any) {
      toast.error(error.message || 'Failed to backfill barcode data');
    } finally {
      setBackfilling(false);
    }
  };

  const getItemMarketValue = useCallback((item: InventoryItem) => {
    const pricing = item.pricing_data?.[0];
    const loosePrice = Number(item.price_loose) || Number(pricing?.loose_price) || 0;
    const cibPrice = Number(item.price_cib) || Number(pricing?.cib_price) || 0;
    const newPrice = Number(item.price_new) || Number(pricing?.new_price) || 0;
    const gradedPrice = Number(item.price_graded) || 0;
    const savedMarketValue = Number(item.selected_market_value) || 0;
    const conditionMarketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
    return savedMarketValue > 0 ? savedMarketValue : conditionMarketValue;
  }, []);

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = items.filter((item) => {
      const matchesSearch = !query || item.product_name.toLowerCase().includes(query) || item.console.toLowerCase().includes(query);
      const matchesConsole = consoleFilter === 'all' || item.console === consoleFilter;
      const matchesCondition = conditionFilter === 'all' || item.condition === conditionFilter;
      const normalizedRegion = getItemRegionDetails(item)?.value || 'unset';
      const matchesRegion = regionFilter === 'all' || normalizedRegion === regionFilter;
      const isInStock = (item.status || 'available') !== 'sold';
      const ageDays = getInventoryAgeDays(item.created_at);
      const ageStatus = getAgeStatus(ageDays, agingThresholds);
      const matchesAge =
        ageFilter === 'all' ||
        (isInStock && ageFilter === 'stale' && ageStatus === 'stale') ||
        (isInStock && ageFilter === 'watch' && ageStatus === 'watch') ||
        (isInStock && ageFilter === 'fresh' && ageStatus === 'fresh');
      const matchesCollection = selectedCollectionId === null
        ? true
        : item.collection_id === selectedCollectionId;
      return matchesSearch && matchesConsole && matchesCondition && matchesRegion && matchesAge && matchesCollection;
    });

    return [...filtered].sort((a, b) => {
      const nameCompare = a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base', numeric: true });
      const consoleCompare = a.console.localeCompare(b.console, undefined, { sensitivity: 'base', numeric: true });
      const regionCompare = (getItemRegionDetails(a)?.value || 'ZZZ').localeCompare(getItemRegionDetails(b)?.value || 'ZZZ', undefined, { sensitivity: 'base' });
      const dateA = new Date(a.created_at).getTime() || 0;
      const dateB = new Date(b.created_at).getTime() || 0;
      const ageA = getInventoryAgeDays(a.created_at);
      const ageB = getInventoryAgeDays(b.created_at);
      const marketA = getItemMarketValue(a);
      const marketB = getItemMarketValue(b);
      const costA = Number(a.purchase_price) || 0;
      const costB = Number(b.purchase_price) || 0;
      const profitA = marketA - costA;
      const profitB = marketB - costB;

      switch (sortBy) {
        case 'name_desc':
          return -nameCompare;
        case 'newest':
          return dateB - dateA || nameCompare;
        case 'oldest':
          return dateA - dateB || nameCompare;
        case 'age_high':
          return ageB - ageA || nameCompare;
        case 'age_low':
          return ageA - ageB || nameCompare;
        case 'console':
          return consoleCompare || nameCompare;
        case 'condition':
          return a.condition.localeCompare(b.condition, undefined, { sensitivity: 'base' }) || nameCompare;
        case 'region':
          return regionCompare || nameCompare;
        case 'cost_high':
          return costB - costA || nameCompare;
        case 'cost_low':
          return costA - costB || nameCompare;
        case 'market_high':
          return marketB - marketA || nameCompare;
        case 'market_low':
          return marketA - marketB || nameCompare;
        case 'profit_high':
          return profitB - profitA || nameCompare;
        case 'profit_low':
          return profitA - profitB || nameCompare;
        case 'name_asc':
        default:
          return nameCompare;
      }
    });
  }, [items, searchQuery, consoleFilter, conditionFilter, regionFilter, ageFilter, agingThresholds, selectedCollectionId, sortBy, getItemMarketValue]);

  const collectionItemCount = useCallback((colId: string) =>
    items.filter((i) => i.collection_id === colId).length, [items]);

  const totalItems = filteredItems.length;

  const agingSummary = useMemo(() => {
    const availableItems = items.filter((item) => (item.status || 'available') !== 'sold');
    const staleItems = availableItems.filter((item) => getAgeStatus(getInventoryAgeDays(item.created_at), agingThresholds) === 'stale');
    const watchItems = availableItems.filter((item) => getAgeStatus(getInventoryAgeDays(item.created_at), agingThresholds) === 'watch');
    const oldest = [...availableItems].sort((a, b) => getInventoryAgeDays(b.created_at) - getInventoryAgeDays(a.created_at))[0];
    return {
      staleCount: staleItems.length,
      watchCount: watchItems.length,
      oldestAge: oldest ? getInventoryAgeDays(oldest.created_at) : 0,
      oldestName: oldest?.product_name || '',
    };
  }, [items, agingThresholds]);

  const { totalCost, totalMarketValue } = useMemo(() => {
    const source = filteredItems;
    let cost = 0;
    let market = 0;
    for (const item of source) {
      cost += item.purchase_price * item.quantity;
      const pricing = item.pricing_data?.[0];
      const loosePrice = Number(item.price_loose) || Number(pricing?.loose_price) || 0;
      const cibPrice = Number(item.price_cib) || Number(pricing?.cib_price) || 0;
      const newPrice = Number(item.price_new) || Number(pricing?.new_price) || 0;
      const gradedPrice = Number(item.price_graded) || 0;
      const savedMarketValue = Number(item.selected_market_value) || 0;
      const conditionMarketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
      market += (savedMarketValue > 0 ? savedMarketValue : conditionMarketValue) * item.quantity;
    }
    return { totalCost: cost, totalMarketValue: market };
  }, [filteredItems]);

  const handleRefreshInventoryPrices = async () => {
    if (!user) return;

    const targets = filteredItems.length > 0 ? filteredItems : items;
    if (targets.length === 0) {
      toast.info('No inventory items to price');
      return;
    }

    setRefreshingPrices(true);
    let updated = 0;
    let missing = 0;
    let failed = 0;

    try {
      toast.info(`Refreshing prices for ${targets.length} item${targets.length === 1 ? '' : 's'}...`);

      for (const item of targets) {
        try {
          const result = await getCanonicalPricing(item.product_name, item.console, {
            upc: item.barcode || null,
            storedPcProductId: item.pc_source_product_id || null,
            forceRefresh: true,
          });

          const p = result.prices;
          const pricing = item.pricing_data?.[0];
          const loosePrice = p.loose.value || Number(item.price_loose) || Number(pricing?.loose_price) || 0;
          const cibPrice = p.cib.value || Number(item.price_cib) || Number(pricing?.cib_price) || 0;
          const newPrice = p.new.value || Number(item.price_new) || Number(pricing?.new_price) || 0;
          const gradedPrice = p.graded.value || Number(item.price_graded) || 0;
          const marketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
          const purchasePrice = Number(item.purchase_price) || 0;
          const estimatedProfit = marketValue > 0 ? marketValue - purchasePrice : 0;
          const estimatedMarginPercent = marketValue > 0 && purchasePrice > 0 ? (estimatedProfit / purchasePrice) * 100 : 0;
          const itemAgeDays = Math.max(0, Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000));
          const dealScore = marketValue > 0
            ? calculateDealScore(purchasePrice, marketValue, 0, 0, itemAgeDays)
            : null;

          const updates: Record<string, any> = {
            pricing_status: marketValue > 0 ? 'found' : result.status === 'api_error' ? 'error' : 'missing',
            pricing_last_checked_at: new Date().toISOString(),
            selected_market_value: marketValue,
            estimated_profit: estimatedProfit,
            estimated_margin_percent: estimatedMarginPercent,
            deal_score: dealScore?.score ?? 0,
            deal_score_label: dealScore?.label ?? '',
            pricing_source: result.source || 'pricecharting',
            pricing_error_message: result.status === 'api_error' ? result.error || 'Pricing refresh failed' : null,
            pricing_confidence: result.pcMatch ? 90 : null,
            pricing_diagnostics: {
              ...result.diagnostics,
              refreshedFrom: 'inventory_page',
              refreshedAt: new Date().toISOString(),
            },
          };

          if (p.loose.value > 0) updates.price_loose = p.loose.value;
          if (p.cib.value > 0) updates.price_cib = p.cib.value;
          if (p.new.value > 0) updates.price_new = p.new.value;
          if (p.graded.value > 0) updates.price_graded = p.graded.value;
          if (result.pcMatch?.productId) {
            updates.pc_source_product_id = result.pcMatch.productId;
            updates.pricing_matched_title = result.pcMatch.productName;
            updates.pricing_matched_platform = result.pcMatch.platform;
          }

          const { error } = await supabase
            .from('inventory_items')
            .update(updates)
            .eq('id', item.id)
            .eq('user_id', accountId || user.id);

          if (error) {
            failed++;
          } else if (marketValue > 0) {
            updated++;
          } else {
            missing++;
          }

          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch {
          failed++;
        }
      }

      if (updated > 0) toast.success(`Updated pricing for ${updated} item${updated === 1 ? '' : 's'}`);
      if (missing > 0) toast.warning(`${missing} item${missing === 1 ? '' : 's'} still need pricing data`);
      if (failed > 0) toast.error(`${failed} price refresh${failed === 1 ? '' : 'es'} failed`);
      if (updated === 0 && missing === 0 && failed === 0) toast.info('No pricing changes found');

      await loadInventory();
    } finally {
      setRefreshingPrices(false);
    }
  };

  const saveAgingThresholds = (thresholds: Partial<AgingThresholds>) => {
    const next = normalizeAgingThresholds({ ...agingThresholds, ...thresholds });
    setAgingThresholds(next);
    writeAgingThresholds(next);
    toast.success(`Aging alerts set: watch ${next.watchDays}d, review ${next.reviewDays}d`);
  };

  const activeCollection = collections.find((c) => c.id === selectedCollectionId);

  return (
    <DashboardLayout>
      <div className="p-6 sm:p-8 lg:p-10 max-w-7xl space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="label-caps">Catalog</div>
              <ContextHelp href="/help#inventory-management" label="Open inventory management help">
                Inventory is the source of truth for item status, cost, price, condition, location, and next action.
              </ContextHelp>
            </div>
            <h1 className="heading-lg text-[22px]">
              {activeCollection ? activeCollection.name : 'Inventory'}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRefreshInventoryPrices} disabled={refreshingPrices || backfilling || loading} className="text-sm h-10 rounded-lg">
              <TrendingUp className={`w-4 h-4 mr-1.5 ${refreshingPrices ? 'animate-pulse' : ''}`} />
              {refreshingPrices ? 'Pricing...' : 'Refresh Prices'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleBackfillBarcodeData} disabled={backfilling || refreshingPrices || loading} className="text-sm h-10 rounded-lg">
              <RefreshCw className={`w-4 h-4 mr-1.5 ${backfilling ? 'animate-spin' : ''}`} />
              {backfilling ? 'Refreshing...' : 'Refresh Metadata'}
            </Button>
            <Button size="sm" className="h-10 rounded-lg text-sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Item
            </Button>
          </div>
        </div>

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="flex items-center gap-4 p-5 rounded-2xl border border-border/40 bg-card">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="label-caps">Items</div>
                <div className="text-[22px] font-bold stat-number mt-0.5">{totalItems}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-5 rounded-2xl border border-border/40 bg-card">
              <div className="w-10 h-10 rounded-xl bg-amber-400/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <div className="label-caps">Total Cost</div>
                  <ContextHelp href="/help#lot-cost-allocation" label="Open cost basis help">
                    Cost basis is what the item effectively cost the business, including lot allocation when used.
                  </ContextHelp>
                </div>
                <div className="text-[22px] font-bold stat-number mt-0.5">${totalCost.toFixed(2)}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-5 rounded-2xl border border-border/40 bg-card">
              <div className="w-10 h-10 rounded-xl bg-emerald-400/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <div className="label-caps">Market Value</div>
                  <ContextHelp href="/help#pricing-engine" label="Open pricing engine help">
                    Market value comes from refreshed pricing data and the selected condition.
                  </ContextHelp>
                </div>
                <div className={`text-[22px] font-bold stat-number mt-0.5 ${totalMarketValue > totalCost ? 'text-emerald-400' : totalMarketValue > 0 ? 'text-red-400' : ''}`}>
                  {totalMarketValue > 0 ? `$${totalMarketValue.toFixed(2)}` : '--'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAgeFilter(ageFilter === 'stale' ? 'all' : 'stale')}
              className={`flex items-center gap-4 p-5 rounded-2xl border text-left transition-colors ${
                agingSummary.staleCount > 0
                  ? 'border-red-500/35 bg-red-500/10 hover:bg-red-500/15'
                  : 'border-border/40 bg-card hover:bg-card/80'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                agingSummary.staleCount > 0 ? 'bg-red-400/10' : 'bg-secondary/40'
              }`}>
                <Bell className={`w-5 h-5 ${agingSummary.staleCount > 0 ? 'text-red-300' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <div className="label-caps">Aging Alerts</div>
                  <ContextHelp href="/help#dashboard-overview" label="Open dead inventory help">
                    Review aging items for price changes, new photos, channel changes, bundling, or clearance.
                  </ContextHelp>
                </div>
                <div className={`text-[22px] font-bold stat-number mt-0.5 ${agingSummary.staleCount > 0 ? 'text-red-300' : ''}`}>
                  {agingSummary.staleCount}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Review at {agingThresholds.reviewDays}d
                </div>
              </div>
            </button>
          </div>
        )}

        {!loading && agingSummary.staleCount > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-red-500/10 p-2">
                <Clock className="h-4 w-4 text-red-300" />
              </div>
              <div>
                <div className="text-sm font-semibold text-red-100">
                  {agingSummary.staleCount} item{agingSummary.staleCount === 1 ? '' : 's'} need listing review
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Oldest item is {agingSummary.oldestAge} days old{agingSummary.oldestName ? `: ${agingSummary.oldestName}` : ''}. Consider discounting, refreshing photos, or moving it to another platform.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10" onClick={() => setAgeFilter('stale')}>
              Review aging items
            </Button>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '30d', watchDays: 21, reviewDays: 30 },
                { label: '60d', watchDays: 45, reviewDays: 60 },
                { label: '90d', watchDays: 75, reviewDays: 90 },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className="h-9 border-red-500/20 text-red-100 hover:bg-red-500/10"
                  onClick={() => saveAgingThresholds(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCollectionId(null)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border ${
              selectedCollectionId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Package className="w-4 h-4" />
            All Items
            <span className={`text-[11px] ml-0.5 ${selectedCollectionId === null ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
              {items.length}
            </span>
          </button>

          {collections.map((col) => (
            <div key={col.id} className="relative group/chip">
              <button
                onClick={() => setSelectedCollectionId(col.id === selectedCollectionId ? null : col.id)}
                className={`flex items-center gap-2 pl-4 pr-8 py-2 rounded-lg text-sm font-medium transition-all duration-150 border ${
                  selectedCollectionId === col.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                {col.name}
                <span className={`text-[11px] ml-0.5 ${selectedCollectionId === col.id ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
                  {collectionItemCount(col.id)}
                </span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setCollectionToDelete(col); }}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity ${
                  selectedCollectionId === col.id
                    ? 'text-primary-foreground/60 hover:text-primary-foreground'
                    : 'text-muted-foreground/50 hover:text-foreground'
                }`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowCreateCollection(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-all duration-150"
          >
            <FolderPlus className="w-4 h-4" />
            New Collection
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <Input
              placeholder="Search inventory..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card border-border/50 h-11 text-base rounded-xl"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full min-w-[155px] flex-1 sm:w-[180px] sm:flex-none bg-card border-border/50 h-11 text-sm rounded-xl">
                <ArrowUpDown className="mr-2 h-4 w-4 text-muted-foreground/50" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name A-Z</SelectItem>
                <SelectItem value="name_desc">Name Z-A</SelectItem>
                <SelectItem value="newest">Newest Added</SelectItem>
                <SelectItem value="oldest">Oldest Added</SelectItem>
                <SelectItem value="age_high">Age High-Low</SelectItem>
                <SelectItem value="age_low">Age Low-High</SelectItem>
                <SelectItem value="console">Console A-Z</SelectItem>
                <SelectItem value="condition">Condition A-Z</SelectItem>
                <SelectItem value="region">Region A-Z</SelectItem>
                <SelectItem value="cost_high">Cost High-Low</SelectItem>
                <SelectItem value="cost_low">Cost Low-High</SelectItem>
                <SelectItem value="market_high">Market High-Low</SelectItem>
                <SelectItem value="market_low">Market Low-High</SelectItem>
                <SelectItem value="profit_high">Profit High-Low</SelectItem>
                <SelectItem value="profit_low">Profit Low-High</SelectItem>
              </SelectContent>
            </Select>
            <Select value={consoleFilter} onValueChange={setConsoleFilter}>
              <SelectTrigger className="w-full min-w-[145px] flex-1 sm:w-[170px] sm:flex-none bg-card border-border/50 h-11 text-sm rounded-xl">
                <SelectValue placeholder="Console" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Consoles</SelectItem>
                {CONSOLES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="w-full min-w-[135px] flex-1 sm:w-[150px] sm:flex-none bg-card border-border/50 h-11 text-sm rounded-xl">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                {CONDITIONS.map((condition) => (<SelectItem key={condition} value={condition}>{condition}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="w-full min-w-[145px] flex-1 sm:w-[160px] sm:flex-none bg-card border-border/50 h-11 text-sm rounded-xl">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                {REGIONS.map((region) => (
                  <SelectItem key={region.value} value={region.value}>{region.label}</SelectItem>
                ))}
                <SelectItem value="unset">No Region</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ageFilter} onValueChange={setAgeFilter}>
              <SelectTrigger className="w-full min-w-[145px] flex-1 sm:w-[165px] sm:flex-none bg-card border-border/50 h-11 text-sm rounded-xl">
                <Clock className="mr-2 h-4 w-4 text-muted-foreground/50" />
                <SelectValue placeholder="Age" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ages</SelectItem>
                <SelectItem value="stale">Review Now</SelectItem>
                <SelectItem value="watch">Watch Soon</SelectItem>
                <SelectItem value="fresh">Fresh Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <InventoryTable
            items={filteredItems}
            onRefresh={loadInventory}
            agingThresholds={agingThresholds}
            collections={collections}
            onMoveToCollection={handleMoveToCollection}
            onBulkMoveToCollection={handleBulkMoveToCollection}
          />
        )}

        <AddItemDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onSuccess={loadInventory}
          defaultCollectionId={selectedCollectionId}
        />

        <CreateCollectionDialog
          open={showCreateCollection}
          onOpenChange={setShowCreateCollection}
          onSuccess={handleCollectionCreated}
        />

        <AlertDialog open={!!collectionToDelete} onOpenChange={(v) => { if (!v) setCollectionToDelete(null); }}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Collection?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the &quot;{collectionToDelete?.name}&quot; collection. Items in this collection will remain in your inventory but will no longer be assigned to a collection.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => collectionToDelete && handleDeleteCollection(collectionToDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
