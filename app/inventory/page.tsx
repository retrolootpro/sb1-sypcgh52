'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Plus, Search, RefreshCw, Package, DollarSign, TrendingUp, FolderOpen, X, FolderPlus } from 'lucide-react';
import { AddItemDialog } from '@/components/add-item-dialog';
import { InventoryTable } from '@/components/inventory-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONSOLES, CONDITIONS } from '@/lib/constants';
import { lookupUPC } from '@/lib/api-services';
import { getMarketValueByCondition } from '@/lib/deal-score';
import { toast } from 'sonner';
import { CreateCollectionDialog, type Collection } from '@/components/create-collection-dialog';
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

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  quantity: number;
  created_at: string;
  barcode?: string;
  image_url?: string;
  thumbnail_url?: string;
  brand?: string;
  collection_id?: string | null;
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  selected_market_value?: number;
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
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [consoleFilter, setConsoleFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [backfilling, setBackfilling] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);

  const loadInventory = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select(`*, pricing_data (*)`)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems(data as InventoryItem[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadCollections = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (!error && data) setCollections(data as Collection[]);
  }, [user]);

  useEffect(() => {
    if (user) {
      loadInventory();
      loadCollections();
    }
  }, [user, loadInventory, loadCollections]);

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
      if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
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
            barcodeData = await lookupUPC(item.barcode, user.id, item.product_name || undefined);
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

  const handleReprocessInventory = async () => {
    if (!user) return;
    setReprocessing(true);
    try {
      toast.info('Reprocessing inventory items...');
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/backfill-inventory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed to reprocess'); }
      const result = await response.json();
      if (result.itemsUpdated > 0) { toast.success(`Reprocessed ${result.itemsUpdated} items`); loadInventory(); }
      else if (result.itemsSkipped === result.itemsProcessed) { toast.info('All items are already up to date'); }
      else { toast.info(`Processed ${result.itemsProcessed} items`); }
    } catch (error: any) {
      toast.error(error.message || 'Failed to reprocess inventory');
    } finally {
      setReprocessing(false);
    }
  };

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query || item.product_name.toLowerCase().includes(query) || item.console.toLowerCase().includes(query);
      const matchesConsole = consoleFilter === 'all' || item.console === consoleFilter;
      const matchesCondition = conditionFilter === 'all' || item.condition === conditionFilter;
      const matchesCollection = selectedCollectionId === null
        ? true
        : item.collection_id === selectedCollectionId;
      return matchesSearch && matchesConsole && matchesCondition && matchesCollection;
    });
  }, [items, searchQuery, consoleFilter, conditionFilter, selectedCollectionId]);

  const collectionItemCount = useCallback((colId: string) =>
    items.filter((i) => i.collection_id === colId).length, [items]);

  const totalItems = selectedCollectionId === null ? items.length : filteredItems.length;

  const { totalCost, totalMarketValue } = useMemo(() => {
    const source = selectedCollectionId === null ? items : filteredItems;
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
  }, [items, filteredItems, selectedCollectionId]);

  const activeCollection = collections.find((c) => c.id === selectedCollectionId);

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 max-w-6xl space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="label-caps mb-1">Catalog</div>
            <h1 className="heading-lg text-[22px]">
              {activeCollection ? activeCollection.name : 'Inventory'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBackfillBarcodeData} disabled={backfilling || loading || reprocessing} className="text-xs h-9 rounded-lg">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${backfilling ? 'animate-spin' : ''}`} />
              {backfilling ? 'Refreshing...' : 'Refresh Metadata'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleReprocessInventory} disabled={reprocessing || loading || backfilling} className="text-xs h-9 rounded-lg">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${reprocessing ? 'animate-spin' : ''}`} />
              {reprocessing ? 'Processing...' : 'Reprocess'}
            </Button>
            <Button size="sm" className="h-9 rounded-lg" onClick={() => setShowAddDialog(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Item
            </Button>
          </div>
        </div>

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-border/40 bg-card">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="label-caps">Items</div>
                <div className="text-[18px] font-bold stat-number mt-0.5">{totalItems}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-border/40 bg-card">
              <div className="w-9 h-9 rounded-xl bg-amber-400/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="label-caps">Total Cost</div>
                <div className="text-[18px] font-bold stat-number mt-0.5">${totalCost.toFixed(2)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-border/40 bg-card">
              <div className="w-9 h-9 rounded-xl bg-emerald-400/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="label-caps">Market Value</div>
                <div className={`text-[18px] font-bold stat-number mt-0.5 ${totalMarketValue > totalCost ? 'text-emerald-400' : totalMarketValue > 0 ? 'text-red-400' : ''}`}>
                  {totalMarketValue > 0 ? `$${totalMarketValue.toFixed(2)}` : '--'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCollectionId(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 border ${
              selectedCollectionId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            All Items
            <span className={`text-[11px] ml-0.5 ${selectedCollectionId === null ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
              {items.length}
            </span>
          </button>

          {collections.map((col) => (
            <div key={col.id} className="relative group/chip">
              <button
                onClick={() => setSelectedCollectionId(col.id === selectedCollectionId ? null : col.id)}
                className={`flex items-center gap-1.5 pl-3 pr-7 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 border ${
                  selectedCollectionId === col.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-all duration-150"
          >
            <FolderPlus className="w-3.5 h-3.5" />
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
              className="pl-9 bg-card border-border/50 h-10 text-sm rounded-xl"
            />
          </div>
          <div className="flex gap-2">
            <Select value={consoleFilter} onValueChange={setConsoleFilter}>
              <SelectTrigger className="w-[160px] bg-card border-border/50 h-10 text-sm rounded-xl">
                <SelectValue placeholder="Console" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Consoles</SelectItem>
                {CONSOLES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="w-[140px] bg-card border-border/50 h-10 text-sm rounded-xl">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                {CONDITIONS.map((condition) => (<SelectItem key={condition} value={condition}>{condition}</SelectItem>))}
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
