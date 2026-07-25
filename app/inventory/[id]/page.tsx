'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { calculateDealScore, getMarketValueByCondition } from '@/lib/deal-score';
import { ArrowLeft, Gamepad2, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp, CircleAlert as AlertCircle, CircleCheck as CheckCircle2, CircleDot, Pencil, Save, X, BookOpen, Trash2 } from 'lucide-react';
import { PrepStageBar } from '@/components/prep-stage-bar';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  getCanonicalPricing,
  sourceLabel,
  type CanonicalPricingResult,
  type ConditionSource,
} from '@/lib/pricing-service';
import { toast } from 'sonner';
import { CONDITIONS, PLATFORM_OPTIONS, REGIONS } from '@/lib/constants';
import { buildItemBusinessPlan } from '@/lib/business-rules';
import { ContextHelp } from '@/components/context-help';
import { defaultConditionForPlatform, isBookLikeItem, isBookLikeValue } from '@/lib/item-taxonomy';

// ─── Types ────────────────────────────────────────────────────────────────────

type InventoryItem = {
  id: string;
  product_name: string;
  console: string;
  condition: string;
  purchase_price: number;
  quantity: number;
  status?: string | null;
  sell_price?: number | null;
  notes: string;
  barcode: string;
  region?: string | null;
  created_at: string;
  brand?: string;
  description?: string;
  genre?: string;
  category?: string;
  item_type?: string | null;
  source_metadata_provider?: string | null;
  source_upc_provider?: string | null;
  confidence_score?: number;
  pricing_confidence?: number;
  image_url?: string;
  thumbnail_url?: string;
  price_loose?: number;
  price_cib?: number;
  price_new?: number;
  price_graded?: number;
  pricing_status?: string;
  pricing_matched_title?: string;
  pricing_matched_platform?: string;
  pricing_source?: string;
  pricing_last_checked_at?: string;
  pricing_attempted_at?: string;
  pc_source_product_id?: string;
  pricing_diagnostics?: Record<string, unknown>;
  selected_market_value?: number;
  estimated_profit?: number;
  estimated_margin_percent?: number;
  sorted_at?: string | null;
  cleaned_at?: string | null;
  tested_at?: string | null;
  notes_added_at?: string | null;
  on_rack_at?: string | null;
  listed_ebay_at?: string | null;
  listed_amazon_at?: string | null;
  listed_whatnot_at?: string | null;
  clover_item_id?: string | null;
  clover_synced_at?: string | null;
  clover_sync_status?: 'pending' | 'synced' | 'failed' | null;
  clover_sync_error?: string | null;
  sync_to_clover?: boolean | null;
  sku?: string | null;
};

type MetadataForm = {
  product_name: string;
  console: string;
  condition: string;
  region: string;
  brand: string;
  category: string;
  genre: string;
  barcode: string;
  image_url: string;
  thumbnail_url: string;
  description: string;
  notes: string;
  status: string;
  purchase_price: string;
  quantity: string;
  sell_price: string;
  sku: string;
  sync_to_clover: boolean;
  price_loose: string;
  price_cib: string;
  price_new: string;
  price_graded: string;
  manual_market_value: string;
};

type CloverDiagnosticState = {
  success: boolean;
  message: string;
  baseUrl?: string;
  merchantId?: string;
  tokenLength?: number;
  failedProbe?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConditionStyle(condition: string) {
  switch (condition) {
    case 'Graded': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'Sealed':
    case 'New':    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'CIB':    return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    case 'Used':   return 'bg-violet-500/10 text-violet-300 border-violet-500/30';
    case 'Damaged': return 'bg-red-500/10 text-red-300 border-red-500/30';
    case 'Untested': return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30';
    default:       return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
  }
}

function getDealBadgeStyle(label: string): string {
  const styles: Record<string, string> = {
    Steal: 'bg-green-500/15 text-green-400 border-green-500/30',
    Great: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Good:  'bg-sky-500/15 text-sky-400 border-sky-500/30',
    Fair:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    Risky: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    Avoid: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return styles[label] ?? 'bg-muted text-muted-foreground border-border';
}

function SourceBadge({ source, sampleCount }: { source: ConditionSource; sampleCount: number }) {
  if (source === 'none') return null;
  const label = sourceLabel(source, sampleCount);
  const style =
    source === 'pricecharting_api'
      ? 'text-emerald-400/70'
      : source === 'pricecharting_web'
      ? 'text-emerald-300/70'
      : source === 'ebay_90d' || source === 'ebay_web'
      ? 'text-sky-400/70'
      : 'text-muted-foreground/50';
  return <div className={`text-[9px] mt-0.5 ${style}`}>{label}</div>;
}

function RefreshStatusIcon({ status }: { status: 'success' | 'partial' | 'failed' | null }) {
  if (!status) return null;
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  if (status === 'partial')  return <CircleDot className="w-3.5 h-3.5 text-amber-400" />;
  return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
}

const INVENTORY_STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'needs_testing', label: 'Needs Testing' },
  { value: 'needs_cleaning', label: 'Needs Cleaning' },
  { value: 'ready_to_list', label: 'Ready to List' },
  { value: 'listed', label: 'Listed' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'returned', label: 'Returned' },
  { value: 'dead_stock', label: 'Dead Stock' },
];

// ─── Page component ───────────────────────────────────────────────────────────

export default function ItemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, accountId } = useAuth();

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [syncingClover, setSyncingClover] = useState(false);
  const [testingClover, setTestingClover] = useState(false);
  const [cloverDiagnostic, setCloverDiagnostic] = useState<CloverDiagnosticState | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [showDiag, setShowDiag]     = useState(false);
  const [autoRefreshAttempted, setAutoRefreshAttempted] = useState(false);
  const [metadataForm, setMetadataForm] = useState<MetadataForm>({
    product_name: '',
    console: 'Unknown',
    condition: 'Loose',
    region: 'US',
    brand: '',
    category: '',
    genre: '',
    barcode: '',
    image_url: '',
    thumbnail_url: '',
    description: '',
    notes: '',
    status: 'available',
    purchase_price: '0',
    quantity: '1',
    sell_price: '',
    sku: '',
    sync_to_clover: false,
    price_loose: '',
    price_cib: '',
    price_new: '',
    price_graded: '',
    manual_market_value: '',
  });

  // Live canonical pricing state (null = not yet refreshed this session)
  const [canonical, setCanonical] = useState<CanonicalPricingResult | null>(null);

  const loadItem = useCallback(async () => {
    if (!user || !accountId) return;
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('id', params.id as string)
        .eq('user_id', accountId)
        .single();
      if (error) throw error;
      setItem(data as InventoryItem);
    } catch {
      router.push('/inventory');
    } finally {
      setLoading(false);
    }
  }, [user, accountId, params.id, router]);

  useEffect(() => {
    if (user && accountId && params.id) loadItem();
  }, [user, accountId, params.id, loadItem]);

  useEffect(() => {
    if (!item || editingMetadata) return;
    setMetadataForm({
      product_name: item.product_name || '',
      console: item.console || 'Unknown',
      condition: item.condition || 'Loose',
      region: item.region || 'US',
      brand: item.brand || '',
      category: item.category || '',
      genre: item.genre || '',
      barcode: item.barcode || '',
      image_url: item.image_url || '',
      thumbnail_url: item.thumbnail_url || '',
      description: item.description || '',
      notes: item.notes || '',
      status: item.status || 'available',
      purchase_price: String(Number(item.purchase_price) || 0),
      quantity: String(Number(item.quantity) || 1),
      sell_price: item.sell_price != null ? String(Number(item.sell_price) || 0) : '',
      sku: item.sku || '',
      sync_to_clover: Boolean(item.sync_to_clover),
      price_loose: item.price_loose != null ? String(Number(item.price_loose) || 0) : '',
      price_cib: item.price_cib != null ? String(Number(item.price_cib) || 0) : '',
      price_new: item.price_new != null ? String(Number(item.price_new) || 0) : '',
      price_graded: item.price_graded != null ? String(Number(item.price_graded) || 0) : '',
      manual_market_value: item.selected_market_value ? String(item.selected_market_value) : '',
    });
  }, [item, editingMetadata]);

  const isPricingStale = useCallback((target: InventoryItem) => {
    const lastChecked = target.pricing_last_checked_at || target.pricing_attempted_at;
    if (!lastChecked) return true;
    const lastCheckedTime = new Date(lastChecked).getTime();
    if (!Number.isFinite(lastCheckedTime)) return true;
    return Date.now() - lastCheckedTime > 4 * 60 * 60 * 1000;
  }, []);

  // ── Refresh handler ───────────────────────────────────────────────────────

  const handleRefreshPricing = useCallback(async () => {
    if (!item || !user || !accountId) return;
    if (isBookLikeItem(item)) {
      toast.info('Book and media items use manual pricing', {
        description: 'Edit the item metadata to enter a manual market value.',
      });
      return;
    }
    setRefreshing(true);
    const checkedAt = new Date().toISOString();
    try {
      const result = await getCanonicalPricing(item.product_name, item.console, {
        upc:               item.barcode || null,
        storedPcProductId: item.pc_source_product_id || null,
        forceRefresh:      true,
      });

      setCanonical(result);

      if (result.status === 'api_error') {
        await supabase
          .from('inventory_items')
          .update({
            pricing_status: 'error',
            pricing_attempted_at: checkedAt,
            pricing_error_message: result.error || 'Pricing refresh failed',
            pricing_diagnostics: {
              refreshStatus: 'failed',
              warnings: [result.error || 'Pricing refresh failed'],
              refreshedAt: checkedAt,
            },
          })
          .eq('id', item.id)
          .eq('user_id', accountId);
        toast.error(result.error || 'Could not fetch market prices. Try again shortly.');
        return;
      }

      const p = result.prices;

      // ── CRITICAL FIX: Only write a price column when the new value is > 0.
      //    This prevents a partial refresh (e.g., eBay blocked for CIB) from
      //    zeroing out a previously good PriceCharting API value.
      const dbUpdates: Record<string, unknown> = {
        pricing_status:           result.status === 'failed' ? 'missing' : 'found',
        pricing_attempted_at:     checkedAt,
        pricing_last_checked_at:  checkedAt,
        pricing_diagnostics:      {
          refreshStatus:     result.diagnostics.refreshStatus,
          missingConditions: result.diagnostics.missingConditions,
          warnings:          result.diagnostics.warnings,
          pcApiUsed:         result.diagnostics.pcApiUsed,
          refreshedAt:       checkedAt,
        },
      };

      if (p.loose.value  > 0) dbUpdates.price_loose  = p.loose.value;
      if (p.cib.value    > 0) dbUpdates.price_cib    = p.cib.value;
      if (p.new.value    > 0) dbUpdates.price_new    = p.new.value;
      if (p.graded.value > 0) dbUpdates.price_graded = p.graded.value;

      const mergedPrices = {
        loose:  p.loose.value  > 0 ? p.loose.value  : Number(item.price_loose)  || 0,
        cib:    p.cib.value    > 0 ? p.cib.value    : Number(item.price_cib)    || 0,
        new:    p.new.value    > 0 ? p.new.value    : Number(item.price_new)    || 0,
        graded: p.graded.value > 0 ? p.graded.value : Number(item.price_graded) || 0,
      };
      const selectedMarketValue = getMarketValueByCondition(
        item.condition,
        mergedPrices.loose,
        mergedPrices.cib,
        mergedPrices.new,
        mergedPrices.graded
      );
      const estimatedProfit = selectedMarketValue > 0 ? selectedMarketValue - item.purchase_price : 0;
      const estimatedMarginPercent =
        selectedMarketValue > 0 && item.purchase_price > 0
          ? (estimatedProfit / item.purchase_price) * 100
          : 0;
      const itemAgeDays = Math.floor(
        (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
      );
      const refreshedDealScore = selectedMarketValue > 0
        ? calculateDealScore(item.purchase_price, selectedMarketValue, 0, 0, itemAgeDays)
        : null;

      dbUpdates.selected_market_value = selectedMarketValue;
      dbUpdates.estimated_profit = estimatedProfit;
      dbUpdates.estimated_margin_percent = estimatedMarginPercent;
      dbUpdates.deal_score = refreshedDealScore?.score ?? 0;
      dbUpdates.deal_score_label = refreshedDealScore?.label ?? '';

      // Store resolved PC product ID so future refreshes skip the search step
      if (result.pcMatch?.productId) {
        dbUpdates.pc_source_product_id = result.pcMatch.productId;
        dbUpdates.pricing_matched_title    = result.pcMatch.productName;
        dbUpdates.pricing_matched_platform = result.pcMatch.platform;
      }

      const sourceParts: string[] = [];
      if (result.diagnostics.pcApiUsed)          sourceParts.push('PriceCharting');
      if (result.diagnostics.warnings.some(w => w.includes('eBay'))) sourceParts.push('eBay');
      if (sourceParts.length === 0)              sourceParts.push(result.source || 'multi');
      dbUpdates.pricing_source = sourceParts.join(', ');

      const { error: updateErr } = await supabase
        .from('inventory_items')
        .update(dbUpdates)
        .eq('id', item.id)
        .eq('user_id', accountId);

      if (updateErr) throw updateErr;

      await loadItem();

      const { refreshStatus, missingConditions, warnings } = result.diagnostics;
      if (refreshStatus === 'success') {
        toast.success('All condition prices updated successfully');
      } else if (refreshStatus === 'partial') {
        const missing = missingConditions.join(', ');
        toast.warning(`Prices updated — no data for: ${missing}`);
      } else {
        toast.error(warnings[0] || 'Could not fetch market prices. Try again shortly.');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh pricing');
    } finally {
      setRefreshing(false);
    }
  }, [item, user, accountId, loadItem]);

  useEffect(() => {
    if (!item || autoRefreshAttempted || refreshing) return;
    if (isBookLikeItem(item)) return;
    if (!isPricingStale(item)) return;
    setAutoRefreshAttempted(true);
    toast.info('Checking current market value...');
    handleRefreshPricing();
  }, [item, autoRefreshAttempted, refreshing, isPricingStale, handleRefreshPricing]);

  const updateMetadataForm = <K extends keyof MetadataForm>(field: K, value: MetadataForm[K]) => {
    setMetadataForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateMetadataChecked = (field: 'sync_to_clover', value: boolean) => {
    setMetadataForm((prev) => ({ ...prev, [field]: value }));
  };

  const syncToCloverRequest = async (conflictAction?: 'create_additional' | 'update_existing' | 'skip') => {
    if (!item) return;
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch('/api/clover/sync-item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
      body: JSON.stringify({ inventoryItemId: item.id, conflictAction }),
    });
    const result = await response.json();
    return { response, result };
  };

  const handleSyncToClover = async () => {
    if (!item) return;
    setSyncingClover(true);
    try {
      const first = await syncToCloverRequest();
      if (first?.response.status === 409 && first.result?.conflict) {
        const choice = window.prompt(
          'This item already appears to exist in Clover. Type create, update, or skip.',
          'update'
        )?.trim().toLowerCase();
        const conflictAction =
          choice === 'create' ? 'create_additional' :
          choice === 'skip' ? 'skip' :
          choice === 'update' ? 'update_existing' :
          null;
        if (!conflictAction) {
          toast.info('Clover sync cancelled');
          return;
        }
        const second = await syncToCloverRequest(conflictAction);
        if (!second?.response.ok || !second.result.success) throw new Error(second?.result.message || 'Clover sync failed');
        toast.success(conflictAction === 'skip' ? 'Skipped Clover sync' : 'Synced to Clover');
      } else {
        if (!first?.response.ok || !first.result.success) throw new Error(first?.result.message || 'Clover sync failed');
        toast.success('Synced to Clover');
      }
      await loadItem();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clover sync failed');
      await loadItem();
    } finally {
      setSyncingClover(false);
    }
  };

  const handleTestCloverConnection = async () => {
    setTestingClover(true);
    setCloverDiagnostic(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/clover/diagnostics', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const result = await response.json();
      const probes = result?.diagnostics?.probes || [];
      const failed = probes.find((probe: { ok?: boolean; name?: string; message?: string }) => !probe.ok);
      const message = failed?.message || result?.message || (result?.success ? 'Clover connection looks good' : 'Clover connection failed');
      setCloverDiagnostic({
        success: Boolean(result?.success),
        message,
        baseUrl: result?.diagnostics?.baseUrl,
        merchantId: result?.diagnostics?.merchantId,
        tokenLength: result?.diagnostics?.tokenLength,
        failedProbe: failed?.name,
      });
      if (result?.success) toast.success('Clover connection looks good');
      else toast.error(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Clover diagnostic failed';
      setCloverDiagnostic({ success: false, message });
      toast.error(message);
    } finally {
      setTestingClover(false);
    }
  };

  const handleSaveMetadata = async () => {
    if (!item || !user || !accountId) return;
    if (!metadataForm.product_name.trim()) {
      toast.error('Product name is required');
      return;
    }

    setSavingMetadata(true);
    try {
      const titleChanged = metadataForm.product_name.trim() !== item.product_name;
      const platformChanged = metadataForm.console !== item.console;
      const conditionChanged = metadataForm.condition !== item.condition;
      const manualPricedItem = isBookLikeValue(metadataForm.console);
      const manualMarketValue = metadataForm.manual_market_value.trim() === ''
        ? Number(item.selected_market_value) || 0
        : Number(metadataForm.manual_market_value);
      if (Number.isNaN(manualMarketValue) || manualMarketValue < 0) {
        toast.error('Manual market value must be 0 or higher');
        setSavingMetadata(false);
        return;
      }
      const purchasePrice = Number(metadataForm.purchase_price);
      const quantity = Number(metadataForm.quantity);
      const sellPrice = metadataForm.sell_price.trim() === '' ? null : Number(metadataForm.sell_price);
      const priceLoose = metadataForm.price_loose.trim() === '' ? null : Number(metadataForm.price_loose);
      const priceCib = metadataForm.price_cib.trim() === '' ? null : Number(metadataForm.price_cib);
      const priceNew = metadataForm.price_new.trim() === '' ? null : Number(metadataForm.price_new);
      const priceGraded = metadataForm.price_graded.trim() === '' ? null : Number(metadataForm.price_graded);
      const numericChecks = [
        { label: 'Purchase price', value: purchasePrice, min: 0 },
        { label: 'Quantity', value: quantity, min: 1 },
        ...(sellPrice == null ? [] : [{ label: 'Sell price', value: sellPrice, min: 0 }]),
        ...(priceLoose == null ? [] : [{ label: 'Loose price', value: priceLoose, min: 0 }]),
        ...(priceCib == null ? [] : [{ label: 'CIB price', value: priceCib, min: 0 }]),
        ...(priceNew == null ? [] : [{ label: 'New price', value: priceNew, min: 0 }]),
        ...(priceGraded == null ? [] : [{ label: 'Graded price', value: priceGraded, min: 0 }]),
      ];
      const invalidNumber = numericChecks.find((check) => !Number.isFinite(check.value) || check.value < check.min);
      if (invalidNumber) {
        toast.error(`${invalidNumber.label} must be ${invalidNumber.min} or higher`);
        setSavingMetadata(false);
        return;
      }
      const imageUrl = metadataForm.image_url.trim();
      const thumbnailUrl = metadataForm.thumbnail_url.trim() || imageUrl;
      const normalizedBarcode = metadataForm.barcode.trim() || null;
      const estimatedProfit = manualMarketValue > 0 ? manualMarketValue - purchasePrice : 0;
      const estimatedMarginPercent = manualMarketValue > 0 && purchasePrice > 0
        ? (estimatedProfit / purchasePrice) * 100
        : 0;

      const { error } = await supabase
        .from('inventory_items')
        .update({
          product_name: metadataForm.product_name.trim(),
          console: metadataForm.console,
          condition: metadataForm.condition,
          region: metadataForm.region,
          status: metadataForm.status,
          purchase_price: purchasePrice,
          quantity: Math.floor(quantity),
          sell_price: sellPrice,
          sku: normalizedBarcode || metadataForm.sku.trim() || null,
          sync_to_clover: metadataForm.sync_to_clover,
          clover_sync_status: metadataForm.sync_to_clover && item.clover_sync_status !== 'synced' ? 'pending' : item.clover_sync_status || 'pending',
          brand: metadataForm.brand.trim() || null,
          category: metadataForm.category.trim() || null,
          genre: metadataForm.genre.trim() || null,
          barcode: normalizedBarcode,
          image_url: imageUrl || null,
          thumbnail_url: thumbnailUrl || null,
          description: metadataForm.description.trim() || null,
          notes: metadataForm.notes.trim() || null,
          price_loose: priceLoose,
          price_cib: priceCib,
          price_new: priceNew,
          price_graded: priceGraded,
          selected_market_value: manualMarketValue,
          estimated_profit: estimatedProfit,
          estimated_margin_percent: estimatedMarginPercent,
          pricing_source: manualPricedItem ? 'Manual / book metadata' : item.pricing_source || null,
          pricing_status: manualPricedItem ? 'manual' : item.pricing_status || null,
          pc_source_product_id: manualPricedItem || titleChanged || platformChanged ? null : item.pc_source_product_id || null,
          pricing_matched_title: manualPricedItem || titleChanged || platformChanged ? null : item.pricing_matched_title || null,
          pricing_matched_platform: manualPricedItem || titleChanged || platformChanged ? null : item.pricing_matched_platform || null,
          pricing_last_checked_at: manualPricedItem || titleChanged || platformChanged || conditionChanged ? null : item.pricing_last_checked_at || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('user_id', accountId);

      if (error) throw error;
      toast.success('Item metadata updated');
      setEditingMetadata(false);
      setCanonical(null);
      setAutoRefreshAttempted(false);
      await loadItem();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update item');
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!item || !user || !accountId) return;
    try {
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', item.id)
        .eq('user_id', accountId);
      if (error) throw error;
      toast.success('Item deleted');
      router.push('/inventory');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete item');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!item) return null;

  // Price values — prefer live canonical result, fall back to DB values
  const loosePrice  = canonical ? (canonical.prices.loose.value  || Number(item.price_loose)  || 0) : (Number(item.price_loose)  || 0);
  const cibPrice    = canonical ? (canonical.prices.cib.value    || Number(item.price_cib)    || 0) : (Number(item.price_cib)    || 0);
  const newPrice    = canonical ? (canonical.prices.new.value    || Number(item.price_new)    || 0) : (Number(item.price_new)    || 0);
  const gradedPrice = canonical ? (canonical.prices.graded.value || Number(item.price_graded) || 0) : (Number(item.price_graded) || 0);

  const conditionMarketValue = getMarketValueByCondition(item.condition, loosePrice, cibPrice, newPrice, gradedPrice);
  const savedMarketValue = Number(item.selected_market_value) || 0;
  const marketValue = savedMarketValue > 0 ? savedMarketValue : conditionMarketValue;
  const profit      = marketValue - item.purchase_price;
  const profitMargin = item.purchase_price > 0 ? (profit / item.purchase_price) * 100 : 0;

  const inventoryAgeDays = Math.floor(
    (Date.now() - new Date(item.created_at).getTime()) / 86_400_000
  );

  const dealScore = marketValue > 0
    ? calculateDealScore(item.purchase_price, marketValue, 0, 0, inventoryAgeDays)
    : { score: 0, label: 'No Data', emoji: '', color: 'text-gray-400', breakdown: undefined };
  const businessPlan = buildItemBusinessPlan({
    ...item,
    selected_market_value: marketValue,
    purchase_price: item.purchase_price,
    price_loose: loosePrice,
    price_cib: cibPrice,
    price_new: newPrice,
    price_graded: gradedPrice,
  });

  const hasPricing = marketValue > 0;
  const bookLike = isBookLikeItem(item);
  const imageUrl   = item.image_url || item.thumbnail_url;

  // Has the user ever refreshed? (either this session or previously saved)
  const hasEverRefreshed = !!canonical || !!item.pricing_last_checked_at;

  const allConditions = [
    { key: 'loose'  as const, label: 'Loose',  value: loosePrice,  active: item.condition === 'Loose' },
    { key: 'cib'    as const, label: 'CIB',    value: cibPrice,    active: item.condition === 'CIB'   },
    { key: 'new'    as const, label: 'New',     value: newPrice,    active: item.condition === 'New'   },
    { key: 'graded' as const, label: 'Graded',  value: gradedPrice, active: item.condition === 'Graded'},
  ];

  // Diagnostics to display — prefer live result, fall back to DB snapshot
  const diagData = canonical?.diagnostics ?? (
    item.pricing_diagnostics
      ? {
          refreshStatus:     item.pricing_diagnostics.refreshStatus as string,
          missingConditions: (item.pricing_diagnostics.missingConditions as string[]) ?? [],
          warnings:          (item.pricing_diagnostics.warnings as string[]) ?? [],
          pcApiUsed:         item.pricing_diagnostics.pcApiUsed as boolean,
        }
      : null
  );

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-5xl">
        <Link href="/inventory">
          <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </Link>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* ── Left column: image + UPC ───────────────────────────────── */}
          <div className="space-y-4">
            <div className="aspect-square rounded-xl overflow-hidden bg-secondary/30 border border-border/40 flex items-center justify-center">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={item.product_name}
                  className="w-full h-full object-contain p-2"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                bookLike ? (
                  <BookOpen className="w-16 h-16 text-muted-foreground/20" />
                ) : (
                  <Gamepad2 className="w-16 h-16 text-muted-foreground/20" />
                )
              )}
            </div>

            {item.barcode && (
              <div className="p-3 rounded-lg bg-secondary/20 border border-border/30">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">UPC</div>
                <div className="font-mono text-sm">{item.barcode}</div>
              </div>
            )}
          </div>

          {/* ── Right column: details ──────────────────────────────────── */}
          <div className="space-y-5">

            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <h1 className="text-2xl font-bold tracking-tight">{item.product_name}</h1>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingMetadata(true)}
                    className="h-8 px-3 text-xs border-border/50"
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshPricing}
                    disabled={refreshing || bookLike}
                    className="h-8 px-3 text-xs border-border/50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                    {bookLike ? 'Manual Pricing' : refreshing ? 'Refreshing...' : 'Refresh Pricing'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card border-border">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes &quot;{item.product_name}&quot; from inventory. This is best for accidental duplicate scans.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteItem}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Item
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {item.description && (
                <p className="text-sm text-muted-foreground/70 mb-2.5 leading-relaxed line-clamp-3">
                  {item.description}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="border-border/50 text-xs">
                  {bookLike && <BookOpen className="mr-1 h-3 w-3" />}
                  {item.console}
                </Badge>
                <Badge variant="outline" className={`text-xs ${getConditionStyle(item.condition)}`}>
                  {item.condition}
                </Badge>
                {item.genre && (
                  <Badge variant="outline" className="border-border/50 text-xs text-muted-foreground">
                    {item.genre}
                  </Badge>
                )}
                {item.region && (
                  <Badge variant="outline" className="border-border/50 text-xs text-muted-foreground">
                    {REGIONS.find((region) => region.value === item.region)?.shortLabel || item.region}
                  </Badge>
                )}
                {hasPricing && dealScore.label !== 'No Data' && (
                  <Badge variant="outline" className={`text-xs font-semibold ${getDealBadgeStyle(dealScore.label)}`}>
                    {dealScore.label} {dealScore.score}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground/60 ml-1">
                  Added {format(new Date(item.created_at), 'MMM d, yyyy')}
                </span>
              </div>
            </div>

            {editingMetadata && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">Edit Item Metadata</CardTitle>
                    <ContextHelp href="/help#inventory-management" label="Open item metadata help">
                      Correct title, platform, condition, region, image, and notes here. Title or platform changes reset stale pricing matches.
                    </ContextHelp>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setEditingMetadata(false)}
                    disabled={savingMetadata}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Title</Label>
                      <Input
                        value={metadataForm.product_name}
                        onChange={(event) => updateMetadataForm('product_name', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Platform / Category</Label>
                      <Select
                        value={metadataForm.console}
                        onValueChange={(value) => {
                          updateMetadataForm('console', value);
                          updateMetadataForm('condition', defaultConditionForPlatform(value));
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLATFORM_OPTIONS.map((consoleName) => (
                            <SelectItem key={consoleName} value={consoleName}>{consoleName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Condition</Label>
                      <Select value={metadataForm.condition} onValueChange={(value) => updateMetadataForm('condition', value)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITIONS.map((condition) => (
                            <SelectItem key={condition} value={condition}>{condition}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <Select value={metadataForm.status} onValueChange={(value) => updateMetadataForm('status', value)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INVENTORY_STATUSES.map((status) => (
                            <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Region</Label>
                      <Select value={metadataForm.region} onValueChange={(value) => updateMetadataForm('region', value)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REGIONS.map((region) => (
                            <SelectItem key={region.value} value={region.value}>{region.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">UPC / Barcode</Label>
                      <Input
                        value={metadataForm.barcode}
                        onChange={(event) => updateMetadataForm('barcode', event.target.value)}
                        className="h-9 font-mono"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Cost</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.purchase_price}
                        onChange={(event) => updateMetadataForm('purchase_price', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={metadataForm.quantity}
                        onChange={(event) => updateMetadataForm('quantity', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Sell Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.sell_price}
                        onChange={(event) => updateMetadataForm('sell_price', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">SKU</Label>
                      <Input
                        value={metadataForm.sku}
                        onChange={(event) => updateMetadataForm('sku', event.target.value)}
                        className="h-9 font-mono"
                        placeholder={metadataForm.barcode.trim() ? 'Will match UPC / barcode on save' : 'Uses UPC when available'}
                      />
                    </div>

                    <label className="flex items-center gap-2 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={metadataForm.sync_to_clover}
                        onChange={(event) => updateMetadataChecked('sync_to_clover', event.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Sync this item to Clover
                    </label>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Publisher / Brand</Label>
                      <Input
                        value={metadataForm.brand}
                        onChange={(event) => updateMetadataForm('brand', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Input
                        value={metadataForm.category}
                        onChange={(event) => updateMetadataForm('category', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Loose Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.price_loose}
                        onChange={(event) => updateMetadataForm('price_loose', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">CIB Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.price_cib}
                        onChange={(event) => updateMetadataForm('price_cib', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">New Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.price_new}
                        onChange={(event) => updateMetadataForm('price_new', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Graded Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.price_graded}
                        onChange={(event) => updateMetadataForm('price_graded', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Manual Market Value</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={metadataForm.manual_market_value}
                        onChange={(event) => updateMetadataForm('manual_market_value', event.target.value)}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Image URL</Label>
                      <Input
                        value={metadataForm.image_url}
                        onChange={(event) => updateMetadataForm('image_url', event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Description</Label>
                      <Textarea
                        value={metadataForm.description}
                        onChange={(event) => updateMetadataForm('description', event.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Notes</Label>
                      <Textarea
                        value={metadataForm.notes}
                        onChange={(event) => updateMetadataForm('notes', event.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => setEditingMetadata(false)}
                      disabled={savingMetadata}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" className="h-9" onClick={handleSaveMetadata} disabled={savingMetadata}>
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      {savingMetadata ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Prep stage */}
            <PrepStageBar
              itemId={item.id}
              fields={item}
              onUpdate={(updates) => setItem(prev => prev ? { ...prev, ...updates } as InventoryItem : null)}
            />

            <Card className="border-border/40 bg-card/40">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">Clover sync</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Status: {item.clover_sync_status || 'pending'}
                    {item.clover_synced_at ? ` · Last synced ${format(new Date(item.clover_synced_at), 'MMM d, yyyy h:mm a')}` : ''}
                  </div>
                  {item.clover_item_id && (
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">Clover item {item.clover_item_id}</div>
                  )}
                  {item.clover_sync_error && (
                    <div className="mt-1 text-xs text-red-400">{item.clover_sync_error}</div>
                  )}
                  {cloverDiagnostic && (
                    <div className="mt-1 space-y-1 text-xs">
                      <div className={cloverDiagnostic.success ? 'text-emerald-400' : 'text-red-400'}>
                        {cloverDiagnostic.message}
                      </div>
                      {(cloverDiagnostic.baseUrl || cloverDiagnostic.merchantId || cloverDiagnostic.tokenLength || cloverDiagnostic.failedProbe) && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {[
                            cloverDiagnostic.failedProbe ? `probe=${cloverDiagnostic.failedProbe}` : null,
                            cloverDiagnostic.baseUrl ? `url=${cloverDiagnostic.baseUrl}` : null,
                            cloverDiagnostic.merchantId ? `merchant=${cloverDiagnostic.merchantId}` : null,
                            cloverDiagnostic.tokenLength ? `token chars=${cloverDiagnostic.tokenLength}` : null,
                          ].filter(Boolean).join(' / ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTestCloverConnection}
                    disabled={testingClover || syncingClover}
                  >
                    <CheckCircle2 className={`mr-1.5 h-3.5 w-3.5 ${testingClover ? 'animate-pulse' : ''}`} />
                    {testingClover ? 'Testing...' : 'Test connection'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSyncToClover}
                    disabled={syncingClover || testingClover || ['sold', 'archived', 'deleted'].includes(String(item.status || ''))}
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncingClover ? 'animate-spin' : ''}`} />
                    {syncingClover ? 'Syncing...' : 'Sync to Clover'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                  {item.quantity > 1 ? 'Unit Cost' : 'Cost'}
                </div>
                <div className="text-xl font-bold">${item.purchase_price.toFixed(2)}</div>
                {item.quantity > 1 && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Total COGS: ${(item.purchase_price * item.quantity).toFixed(2)}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Market Value</div>
                <div className="text-xl font-bold text-primary">
                  {hasPricing ? `$${marketValue.toFixed(2)}` : '--'}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Profit</div>
                <div className={`text-xl font-bold flex items-center gap-1 ${profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : ''}`}>
                  {hasPricing ? (
                    <>
                      {profit > 0 ? <TrendingUp className="w-4 h-4" /> : profit < 0 ? <TrendingDown className="w-4 h-4" /> : null}
                      {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                    </>
                  ) : '--'}
                </div>
                {hasPricing && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {profitMargin.toFixed(0)}% margin{item.quantity > 1 ? ` / total ${profit >= 0 ? '+' : ''}$${(profit * item.quantity).toFixed(2)}` : ''}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/40">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Quantity</div>
                <div className="text-xl font-bold">{item.quantity}</div>
                {hasPricing && item.quantity > 1 && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Total: ${(marketValue * item.quantity).toFixed(2)}
                  </div>
                )}
              </div>
            </div>

            {/* ── Market Value card ─────────────────────────────────────── */}
            <Card className="border-border/40 bg-card/40">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">Current Market Value</CardTitle>
                    <ContextHelp href="/help#pricing-engine" label="Open pricing help">
                      Refresh pricing before listing. Condition values drive market value, profit, margin, and sell plan recommendations.
                    </ContextHelp>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {bookLike
                      ? 'Manual value for books and media'
                      : diagData?.pcApiUsed
                      ? 'Sourced from PriceCharting API + eBay fallback'
                      : 'Aggregated from eBay completed listings'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {diagData && (
                    <RefreshStatusIcon status={diagData.refreshStatus as 'success' | 'partial' | 'failed'} />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshPricing}
                    disabled={refreshing || bookLike}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                    {bookLike ? 'Manual' : refreshing ? 'Fetching...' : 'Refresh'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {bookLike ? (
                  <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
                    <div className="text-sm font-semibold">
                      {hasPricing ? `$${marketValue.toFixed(2)} manual market value` : 'No manual market value set'}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Edit metadata to enter a manual value after checking eBay, Amazon, local comps, or your own sales history.
                    </p>
                  </div>
                ) : hasPricing || hasEverRefreshed ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {allConditions.map((c) => {
                        const condData = canonical?.prices[c.key];
                        const src: ConditionSource = condData?.source ?? 'none';
                        const samples = condData?.sampleCount ?? 0;
                        const noDataAfterRefresh = hasEverRefreshed && c.value === 0;

                        return (
                          <div
                            key={c.label}
                            className={`p-2.5 rounded-lg text-center transition-colors ${
                              c.active
                                ? 'bg-primary/10 border border-primary/30 ring-1 ring-primary/20'
                                : 'bg-secondary/20 border border-transparent'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                              {c.label}
                            </div>
                            {c.value > 0 ? (
                              <>
                                <div className={`text-sm font-bold ${c.active ? 'text-primary' : ''}`}>
                                  ${c.value.toFixed(2)}
                                </div>
                                <SourceBadge source={src} sampleCount={samples} />
                                {c.active && (
                                  <div className="text-[9px] text-primary/70 mt-0.5">Selected</div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-bold text-muted-foreground/30">--</div>
                                {noDataAfterRefresh ? (
                                  <div className="text-[9px] text-amber-500/60 mt-0.5">No verified data</div>
                                ) : (
                                  <div className="text-[9px] text-muted-foreground/30 mt-0.5">Not fetched</div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Fallback notice */}
                    {marketValue > 0 && (() => {
                      const activeConditionValue = allConditions.find(c => c.active)?.value ?? 0;
                      if (activeConditionValue > 0 || marketValue === 0) return null;
                      const fallbackCond = allConditions.find(c => c.value === marketValue && !c.active);
                      return (
                        <p className="text-[10px] text-amber-500/70 mt-2">
                          No {item.condition} price — using {fallbackCond?.label ?? 'available'} price as display fallback only
                        </p>
                      );
                    })()}

                    {/* Timestamps */}
                    <div className="flex items-center justify-between mt-3">
                      <div>
                        {diagData?.warnings && diagData.warnings.length > 0 && (
                          <button
                            onClick={() => setShowDiag(v => !v)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          >
                            {showDiag ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {showDiag ? 'Hide' : 'Show'} diagnostics ({diagData.warnings.length})
                          </button>
                        )}
                      </div>
                      {item.pricing_last_checked_at && (
                        <div className="text-[10px] text-muted-foreground/40">
                          Updated {format(new Date(item.pricing_last_checked_at), 'MMM d, yyyy')}
                        </div>
                      )}
                    </div>

                    {/* Diagnostics drawer */}
                    {showDiag && diagData && (
                      <div className="mt-3 p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                          Pricing Diagnostics
                        </div>
                        {(canonical?.pcMatch || item.pricing_matched_title) && (
                          <div className="flex items-start justify-between text-[11px]">
                            <span className="text-muted-foreground/60">PC Match</span>
                            <span className="font-mono text-right text-muted-foreground/80 max-w-[60%]">
                              {canonical?.pcMatch?.productName || item.pricing_matched_title}
                              {(canonical?.pcMatch?.productId || item.pc_source_product_id) && (
                                <span className="text-muted-foreground/40 ml-1">
                                  #{canonical?.pcMatch?.productId || item.pc_source_product_id}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {(canonical?.pcMatch?.strategy) && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground/60">Resolution</span>
                            <span className="font-mono text-muted-foreground/80">{canonical.pcMatch.strategy}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground/60">Status</span>
                          <span className={`font-medium ${
                            diagData.refreshStatus === 'success' ? 'text-green-400' :
                            diagData.refreshStatus === 'partial' ? 'text-amber-400' : 'text-red-400'
                          }`}>{diagData.refreshStatus}</span>
                        </div>
                        {diagData.missingConditions.length > 0 && (
                          <div className="flex items-start justify-between text-[11px]">
                            <span className="text-muted-foreground/60">Missing</span>
                            <span className="text-amber-400/80">{diagData.missingConditions.join(', ')}</span>
                          </div>
                        )}
                        {diagData.warnings && diagData.warnings.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-border/20">
                            {(diagData.warnings as string[]).map((w, i) => (
                              <div key={i} className="text-[10px] text-muted-foreground/50 leading-snug">
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <p className="text-sm text-muted-foreground">No pricing data yet.</p>
                    <p className="text-xs text-muted-foreground/60">
                      Click Refresh to fetch current market prices from PriceCharting and eBay.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Deal Score */}
            {hasPricing && dealScore.breakdown && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Deal Score Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Profit Margin</span>
                    <span className="font-semibold">+{dealScore.breakdown.profitMargin}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Rarity Bonus</span>
                    <span className={`font-semibold ${dealScore.breakdown.rarityBonus >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dealScore.breakdown.rarityBonus >= 0 ? '+' : ''}{dealScore.breakdown.rarityBonus}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Liquidity</span>
                    <span className={`font-semibold ${dealScore.breakdown.liquidityScore >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dealScore.breakdown.liquidityScore >= 0 ? '+' : ''}{dealScore.breakdown.liquidityScore}
                    </span>
                  </div>
                  {dealScore.breakdown.ageScore !== 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Age ({inventoryAgeDays}d)</span>
                      <span className="font-semibold text-red-400">{dealScore.breakdown.ageScore}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-border/30 flex items-center justify-between">
                    <span className="text-sm font-medium">Total Score</span>
                    <Badge variant="outline" className={`font-bold ${getDealBadgeStyle(dealScore.label)}`}>
                      {dealScore.score} / 100
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sell plan */}
            <Card className="border-border/40 bg-card/40">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-medium">Sell Plan</CardTitle>
                      <ContextHelp href="/help#sell-channel-recommendations" label="Open sell plan help">
                        Sell Plan suggests ask, quick-sale price, floor, emergency floor, and best sales channel.
                      </ContextHelp>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                      Rule-based recommendation from current item data.
                    </p>
                  </div>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {businessPlan.recommendation.channel}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Ask</div>
                    <div className="mt-1 text-lg font-bold">${businessPlan.pricePlan.recommendedAskingPrice.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Quick Sale</div>
                    <div className="mt-1 text-lg font-bold">${businessPlan.pricePlan.quickSalePrice.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Floor</div>
                    <div className="mt-1 text-lg font-bold">${businessPlan.pricePlan.floorPrice.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Emergency</div>
                    <div className="mt-1 text-lg font-bold">${businessPlan.pricePlan.emergencyFloorPrice.toFixed(2)}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{businessPlan.recommendation.summary}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Best as {businessPlan.recommendation.singleOrBundle === 'either' ? 'single item or bundle support' : `${businessPlan.recommendation.singleOrBundle} item`}.
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>Profit ${businessPlan.pricePlan.expectedProfit.toFixed(2)}</div>
                      <div>{businessPlan.pricePlan.marginPercent.toFixed(0)}% margin</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Why</div>
                      {businessPlan.recommendation.reasons.length > 0 ? (
                        businessPlan.recommendation.reasons.map((reason) => (
                          <div key={reason} className="text-xs text-muted-foreground">{reason}</div>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground">No special warnings from current data.</div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Watch</div>
                      {businessPlan.recommendation.cautions.length > 0 ? (
                        businessPlan.recommendation.cautions.map((caution) => (
                          <div key={caution} className="text-xs text-amber-300/80">{caution}</div>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground">No extra cautions from current data.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Listing Draft</div>
                    <Badge variant="outline" className="border-border/50 text-xs">
                      {businessPlan.listingDraft.suggestedCategory}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Title</Label>
                    <Input defaultValue={businessPlan.listingDraft.title} className="h-9 bg-secondary/30" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <Textarea defaultValue={businessPlan.listingDraft.description} rows={5} className="bg-secondary/30" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Condition Notes</Label>
                      <Textarea defaultValue={businessPlan.listingDraft.conditionNotes} rows={3} className="bg-secondary/30" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Whatnot Notes</Label>
                      <Textarea defaultValue={businessPlan.listingDraft.whatnotNotes} rows={3} className="bg-secondary/30" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {businessPlan.listingDraft.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="border-border/50 text-[10px] text-muted-foreground">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {businessPlan.listingDraft.shippingNotes}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            {item.notes && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
                </CardContent>
              </Card>
            )}

            {/* Item details */}
            {(item.brand || item.pricing_matched_title || item.pricing_source || item.pricing_confidence) && (
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Item Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {item.brand && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Publisher / Brand</span>
                      <span className="font-medium">{item.brand}</span>
                    </div>
                  )}
                  {item.category && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Category</span>
                      <span className="font-medium">{item.category}</span>
                    </div>
                  )}
                  {item.pricing_matched_title && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">PriceCharting Match</span>
                      <span className="font-medium text-right max-w-[60%] truncate">{item.pricing_matched_title}</span>
                    </div>
                  )}
                  {item.pricing_matched_platform && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Matched Platform</span>
                      <span className="font-medium">{item.pricing_matched_platform}</span>
                    </div>
                  )}
                  {item.pc_source_product_id && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">PC Product ID</span>
                      <span className="font-mono text-xs text-muted-foreground/70">{item.pc_source_product_id}</span>
                    </div>
                  )}
                  {item.pricing_source && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Pricing Source</span>
                      <span className="font-medium">{item.pricing_source}</span>
                    </div>
                  )}
                  {!!item.pricing_confidence && item.pricing_confidence > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Match Confidence</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-secondary rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              item.pricing_confidence >= 85 ? 'bg-green-400' :
                              item.pricing_confidence >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                            }`}
                            style={{ width: `${item.pricing_confidence}%` }}
                          />
                        </div>
                        <span className="font-medium">{item.pricing_confidence}%</span>
                      </div>
                    </div>
                  )}
                  {item.pricing_last_checked_at && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Price Check</span>
                      <span className="font-medium">{format(new Date(item.pricing_last_checked_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
