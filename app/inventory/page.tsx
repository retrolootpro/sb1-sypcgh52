'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Plus, Search, RefreshCw, Package, DollarSign, TrendingUp, FolderOpen, X, FolderPlus, ArrowUpDown, Bell, Clock, MoreHorizontal, BookOpen, ScanBarcode, Tags, FileDown, Archive } from 'lucide-react';
import { AddItemDialog } from '@/components/add-item-dialog';
import { InventoryTable } from '@/components/inventory-table';
import { BarcodeScannerView, type ScanResult } from '@/components/barcode-scanner-view';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONDITIONS, PLATFORM_OPTIONS, REGIONS } from '@/lib/constants';
import { lookupUPC } from '@/lib/api-services';
import { getCanonicalPricing } from '@/lib/pricing-service';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { getInventoryFamily, lookupModeForItem, productTypeLabel, supportsAutomatedGamePricing } from '@/lib/item-taxonomy';
import { getItemRegionDetails } from '@/lib/region';
import { getAgeStatus, getInventoryAgeDays, normalizeAgingThresholds, readAgingThresholds, writeAgingThresholds, type AgingThresholds } from '@/lib/inventory-aging';
import { toast } from 'sonner';
import { CreateCollectionDialog, type Collection } from '@/components/create-collection-dialog';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  region?: string | null;
  purchase_price: number;
  quantity: number;
  status?: string | null;
  sold_at?: string | null;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at: string;
  barcode?: string;
  image_url?: string;
  thumbnail_url?: string;
  description?: string | null;
  brand?: string;
  category?: string | null;
  item_type?: string | null;
  genre?: string | null;
  book_format?: string | null;
  book_authors?: string[] | null;
  book_publisher?: string | null;
  book_isbn10?: string | null;
  book_isbn13?: string | null;
  raw_lookup_payload?: Record<string, unknown> | null;
  source_metadata_provider?: string | null;
  source_upc_provider?: string | null;
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
  const [inventoryScannerActive, setInventoryScannerActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [consoleFilter, setConsoleFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [inventoryView, setInventoryView] = useState<'active' | 'archive' | 'all'>('active');
  const [sortBy, setSortBy] = useState('name_asc');
  const [agingThresholds, setAgingThresholds] = useState<AgingThresholds>({ watchDays: 45, reviewDays: 60 });
  const [backfilling, setBackfilling] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [syncingClover, setSyncingClover] = useState(false);
  const [exportingCloverWorkbook, setExportingCloverWorkbook] = useState(false);
  const [exportingCloverNewWorkbook, setExportingCloverNewWorkbook] = useState(false);
  const [buildingCloverUpdateWorkbook, setBuildingCloverUpdateWorkbook] = useState(false);
  const [buildingCloverRepairWorkbook, setBuildingCloverRepairWorkbook] = useState(false);
  const [cloverAutoSyncEnabled, setCloverAutoSyncEnabled] = useState(false);
  const cloverUpdateUploadRef = useRef<HTMLInputElement | null>(null);
  const cloverRepairUploadRef = useRef<HTMLInputElement | null>(null);

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
    if (!user || !accountId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/settings', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!response.ok) return;
      const result = await response.json();
      setCloverAutoSyncEnabled(Boolean(result.settings?.auto_sync_enabled));
    })();
  }, [user, accountId]);

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
            barcodeData = await lookupUPC(item.barcode, accountId || user.id, item.product_name || undefined, lookupModeForItem(item));
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

  const handleInventorySearchScan = useCallback((result: ScanResult) => {
    const barcode = result.barcode.trim();
    if (!barcode) return;
    setSearchQuery(barcode);
    setInventoryScannerActive(false);
    toast.success('Searching scanned barcode', { description: barcode });
  }, []);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const status = item.status || 'available';
      const isArchived = ['sold', 'archived', 'deleted'].includes(status);
      const matchesInventoryView =
        inventoryView === 'all' ||
        (inventoryView === 'archive' ? isArchived : !isArchived);
      const metadata = item.raw_lookup_payload && typeof item.raw_lookup_payload === 'object' ? item.raw_lookup_payload : {};
      const authors = Array.isArray(metadata.authors) ? metadata.authors.join(' ') : '';
      const categories = Array.isArray(metadata.categories) ? metadata.categories.join(' ') : '';
      const metadataText = [
        metadata.title,
        metadata.subtitle,
        authors,
        metadata.publisher,
        metadata.publishedYear,
        metadata.isbn10,
        metadata.isbn13,
        categories,
        metadata.language,
        item.book_format,
        Array.isArray(item.book_authors) ? item.book_authors.join(' ') : '',
        item.book_publisher,
        item.book_isbn10,
        item.book_isbn13,
      ].map((value) => String(value || '')).join(' ').toLowerCase();
      const matchesSearch = !query
        || item.product_name.toLowerCase().includes(query)
        || item.console.toLowerCase().includes(query)
        || String(item.category || '').toLowerCase().includes(query)
        || String(item.brand || '').toLowerCase().includes(query)
        || String(item.barcode || '').toLowerCase().includes(query)
        || metadataText.includes(query);
      const family = getInventoryFamily(item);
      const matchesType = typeFilter === 'all' || family === typeFilter;
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
      return matchesInventoryView && matchesSearch && matchesType && matchesConsole && matchesCondition && matchesRegion && matchesAge && matchesCollection;
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
  }, [items, searchQuery, typeFilter, consoleFilter, conditionFilter, regionFilter, ageFilter, inventoryView, agingThresholds, selectedCollectionId, sortBy, getItemMarketValue]);

  const platformOptions = useMemo(() => {
    const defaults = PLATFORM_OPTIONS.map((value) => String(value));
    const extras = items
      .map((item) => item.console)
      .filter((value): value is string => !!value && !defaults.includes(value))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return [...defaults, ...extras];
  }, [items]);

  const activeItems = useMemo(() => items.filter((item) => !['sold', 'archived', 'deleted'].includes(item.status || 'available')), [items]);
  const archivedItems = useMemo(() => items.filter((item) => ['sold', 'archived', 'deleted'].includes(item.status || 'available')), [items]);

  const collectionItemCount = useCallback((colId: string) =>
    activeItems.filter((i) => i.collection_id === colId).length, [activeItems]);

  const totalItems = filteredItems.length;
  const bookMediaCount = filteredItems.filter((item) => getInventoryFamily(item) === 'books_media').length;

  const agingSummary = useMemo(() => {
    const availableItems = activeItems;
    const staleItems = availableItems.filter((item) => getAgeStatus(getInventoryAgeDays(item.created_at), agingThresholds) === 'stale');
    const watchItems = availableItems.filter((item) => getAgeStatus(getInventoryAgeDays(item.created_at), agingThresholds) === 'watch');
    const oldest = [...availableItems].sort((a, b) => getInventoryAgeDays(b.created_at) - getInventoryAgeDays(a.created_at))[0];
    return {
      staleCount: staleItems.length,
      watchCount: watchItems.length,
      oldestAge: oldest ? getInventoryAgeDays(oldest.created_at) : 0,
      oldestName: oldest?.product_name || '',
    };
  }, [activeItems, agingThresholds]);

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

    const targets = filteredItems.length > 0 ? filteredItems : activeItems;
    const priceTargets = targets.filter(supportsAutomatedGamePricing);
    const skippedManual = targets.length - priceTargets.length;
    if (targets.length === 0) {
      toast.info('No inventory items to price');
      return;
    }

    if (priceTargets.length === 0) {
      toast.info('No game items to price', {
        description: 'Book and media items use manual pricing and were skipped.',
      });
      return;
    }

    setRefreshingPrices(true);
    let updated = 0;
    let missing = 0;
    let failed = 0;

    try {
      toast.info(`Refreshing prices for ${priceTargets.length} game item${priceTargets.length === 1 ? '' : 's'}...`);
      if (skippedManual > 0) {
        toast.info(`${skippedManual} book/media item${skippedManual === 1 ? '' : 's'} skipped for manual pricing`);
      }

      for (const item of priceTargets) {
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

  const handleSyncPendingToClover = async () => {
    setSyncingClover(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/sync-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Clover bulk sync failed');
      toast.success(`Clover sync complete: ${result.synced || 0} synced, ${result.failed || 0} failed`);
      await loadInventory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover bulk sync failed');
    } finally {
      setSyncingClover(false);
    }
  };

  const handleDownloadCloverWorkbook = async () => {
    setExportingCloverWorkbook(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/export-xlsx', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Clover workbook export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `retrolootpro-clover-import-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Clover import workbook downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover workbook export failed');
    } finally {
      setExportingCloverWorkbook(false);
    }
  };

  const handleDownloadCloverNewWorkbook = async () => {
    setExportingCloverNewWorkbook(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/export-new-xlsx', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Clover new-items export failed');
      }
      const blob = await response.blob();
      const total = Number(response.headers.get('X-Clover-Total') || 0);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `retrolootpro-clover-new-items-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Clover new-items workbook downloaded${total > 0 ? `: ${total} item${total === 1 ? '' : 's'}` : ''}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover new-items export failed');
    } finally {
      setExportingCloverNewWorkbook(false);
    }
  };

  const handleConfigureCloverAutoSync = async () => {
    try {
      const minutesText = window.prompt('Auto-sync interval in minutes. Use 0 to disable.', cloverAutoSyncEnabled ? '60' : '60');
      if (minutesText == null) return;
      const minutes = Number(minutesText);
      const enabled = minutes > 0;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          auto_sync_enabled: enabled,
          auto_sync_interval_minutes: enabled ? Math.max(15, minutes) : 60,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not save Clover auto-sync settings');
      setCloverAutoSyncEnabled(Boolean(result.settings?.auto_sync_enabled));
      toast.success(enabled ? `Clover auto-sync enabled every ${Math.max(15, minutes)} minutes` : 'Clover auto-sync disabled');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Clover auto-sync settings');
    }
  };

  const handleBuildCloverNewItemsWorkbook = async (file: File) => {
    setBuildingCloverUpdateWorkbook(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/clover/export-update-xlsx', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: formData,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Clover new-items workbook generation failed');
      }
      const blob = await response.blob();
      const created = Number(response.headers.get('X-Clover-Matched') || 0);
      const skipped = Number(response.headers.get('X-Clover-Skipped') || 0);
      const total = Number(response.headers.get('X-Clover-Total') || 0);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `retrolootpro-clover-new-items-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Clover new-items workbook ready: ${created} new, ${skipped} already in Clover, ${total} total`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover new-items workbook generation failed');
    } finally {
      if (cloverUpdateUploadRef.current) cloverUpdateUploadRef.current.value = '';
      setBuildingCloverUpdateWorkbook(false);
    }
  };

  const handleBuildCloverRepairWorkbook = async (file: File) => {
    setBuildingCloverRepairWorkbook(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/clover/export-repair-xlsx', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: formData,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Clover repair workbook generation failed');
      }
      const blob = await response.blob();
      const repaired = Number(response.headers.get('X-Clover-Repaired') || 0);
      const skipped = Number(response.headers.get('X-Clover-Skipped') || 0);
      const total = Number(response.headers.get('X-Clover-Total') || 0);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `retrolootpro-clover-repair-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Clover repair workbook ready: ${repaired} fixes, ${skipped} skipped, ${total} Clover rows checked`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover repair workbook generation failed');
    } finally {
      if (cloverRepairUploadRef.current) cloverRepairUploadRef.current.value = '';
      setBuildingCloverRepairWorkbook(false);
    }
  };

  const activeCollection = collections.find((c) => c.id === selectedCollectionId);

  return (
    <DashboardLayout>
      <div className="p-5 sm:p-7 lg:p-8 max-w-7xl space-y-6">
        <input
          ref={cloverUpdateUploadRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleBuildCloverNewItemsWorkbook(file);
          }}
        />
        <input
          ref={cloverRepairUploadRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleBuildCloverRepairWorkbook(file);
          }}
        />
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
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 rounded-lg text-sm" disabled={refreshingPrices || backfilling || syncingClover || exportingCloverWorkbook || exportingCloverNewWorkbook || buildingCloverUpdateWorkbook || buildingCloverRepairWorkbook || loading}>
                  <MoreHorizontal className="mr-1.5 h-4 w-4" />
                  Tools
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleRefreshInventoryPrices}>
                  <TrendingUp className={`mr-2 h-4 w-4 ${refreshingPrices ? 'animate-pulse' : ''}`} />
                  Refresh pricing
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBackfillBarcodeData}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${backfilling ? 'animate-spin' : ''}`} />
                  Refresh metadata
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/review/data-issues">
                    <Search className="mr-2 h-4 w-4" />
                    Review Missing Clover Data
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadCloverWorkbook}>
                  <FileDown className={`mr-2 h-4 w-4 ${exportingCloverWorkbook ? 'animate-pulse' : ''}`} />
                  Export All Items for Clover
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadCloverNewWorkbook}>
                  <FileDown className={`mr-2 h-4 w-4 ${exportingCloverNewWorkbook ? 'animate-pulse' : ''}`} />
                  Export Newly Added for Clover
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => cloverUpdateUploadRef.current?.click()}>
                  <FileDown className={`mr-2 h-4 w-4 ${buildingCloverUpdateWorkbook ? 'animate-pulse' : ''}`} />
                  Compare Clover Export for Missing Items
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => cloverRepairUploadRef.current?.click()}>
                  <FileDown className={`mr-2 h-4 w-4 ${buildingCloverRepairWorkbook ? 'animate-pulse' : ''}`} />
                  Fix Missing Clover SKU/UPC
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSyncPendingToClover}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncingClover ? 'animate-spin' : ''}`} />
                  Send Pending Items to Clover
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleConfigureCloverAutoSync}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {cloverAutoSyncEnabled ? 'Edit Clover auto-sync' : 'Enable Clover auto-sync'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild variant="outline" size="sm" className="h-10 rounded-lg text-sm">
              <Link href="/labels">
                <Tags className="mr-1.5 h-4 w-4" />
                Labels
              </Link>
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
                {bookMediaCount > 0 && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <BookOpen className="h-3 w-3" />
                    {bookMediaCount} book/media
                  </div>
                )}
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

        <div className="rounded-2xl border border-border/40 bg-card/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white/85">Collections</div>
              <div className="text-xs text-muted-foreground">Use collections to narrow the inventory table.</div>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedCollectionId(null)}
            className={`flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border ${
              selectedCollectionId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Package className="w-4 h-4" />
            All Items
            <span className={`text-[11px] ml-0.5 ${selectedCollectionId === null ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
              {activeItems.length}
            </span>
          </button>

          {collections.map((col) => (
            <div key={col.id} className="relative group/chip">
              <button
                onClick={() => setSelectedCollectionId(col.id === selectedCollectionId ? null : col.id)}
                className={`flex shrink-0 items-center gap-2 pl-4 pr-8 py-2 rounded-lg text-sm font-medium transition-all duration-150 border ${
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
            className="flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-all duration-150"
          >
            <FolderPlus className="w-4 h-4" />
            New Collection
          </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card/60 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Find & Filter</div>
              <div className="text-xs text-muted-foreground">{filteredItems.length} item{filteredItems.length === 1 ? '' : 's'} shown</div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { value: 'active', label: 'Active Inventory', count: activeItems.length, icon: Package },
                { value: 'archive', label: 'Sold Archive', count: archivedItems.length, icon: Archive },
                { value: 'all', label: 'All Records', count: items.length, icon: FolderOpen },
              ].map(({ value, label, count, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInventoryView(value as 'active' | 'archive' | 'all')}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    inventoryView === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/50 bg-card text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                  <span className="text-xs tabular-nums">{count}</span>
                </button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/55" />
                <Input
                  placeholder="Search name, UPC, ISBN, author, platform..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-14 min-h-14 w-full rounded-xl border-border/60 bg-background/95 pl-12 pr-4 text-[16px] font-medium leading-6 text-foreground shadow-sm caret-primary placeholder:text-muted-foreground/70 focus-visible:border-primary/70 focus-visible:ring-primary/25 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInventoryScannerActive(true)}
                className="h-14 shrink-0 rounded-xl border-border/50 px-4 sm:w-auto"
              >
                <ScanBarcode className="mr-2 h-4 w-4" />
                Scan
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
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
                <SelectItem value="console">Platform A-Z</SelectItem>
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
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="games">{productTypeLabel('games')}</SelectItem>
                <SelectItem value="books_media">{productTypeLabel('books_media')}</SelectItem>
                <SelectItem value="collectibles">{productTypeLabel('collectibles')}</SelectItem>
                <SelectItem value="other">{productTypeLabel('other')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={consoleFilter} onValueChange={setConsoleFilter}>
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                {platformOptions.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                {CONDITIONS.map((condition) => (<SelectItem key={condition} value={condition}>{condition}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
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
              <SelectTrigger className="h-11 w-full bg-card text-sm rounded-xl border-border/50">
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
            archiveMode={inventoryView === 'archive'}
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

        <BarcodeScannerView
          isActive={inventoryScannerActive}
          onStop={() => setInventoryScannerActive(false)}
          onScan={handleInventorySearchScan}
          variant="compact"
          title="Search Inventory"
        />
      </div>
    </DashboardLayout>
  );
}
