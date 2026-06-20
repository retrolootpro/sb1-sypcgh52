'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { ScanItemDialog } from '@/components/scan-item-dialog';
import { ScanResult } from '@/lib/barcode-scanner';
import {
  Camera, Keyboard, History, CircleCheck as CheckCircle2,
  CircleAlert as AlertCircle, Loader as Loader2, Undo2, Trash2,
  User, TrendingUp, Layers, Play, ScanBarcode, PackageCheck, Calculator, Search,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { classifyItem, normalizeTitle, calculateConfidence, extractPlatform, detectEdition } from '@/lib/barcode-lookup';
import { lookupUPC, getActiveEmployees, type Employee } from '@/lib/api-services';
import { allocateLotCost, formatCurrency, getLotCostSummaries, type LotCostSummary } from '@/lib/finance-services';
import { getCanonicalPricing, getPricingData, getPricingStatusMessage, toDatabaseStatus, type PricingResult } from '@/lib/pricing-service';
import { calculateSimpleDealScore, getMarketValueByCondition, shouldSkipReview } from '@/lib/deal-score';

type ScanMode = 'single' | 'continuous';

const INTAKE_SESSION_KEY = 'retroloot-intake-session';

type QueueItem = {
  id: string;
  barcode: string;
  status: 'scanning' | 'looking_up' | 'pricing' | 'awaiting_price' | 'calculating' | 'added' | 'needs_review' | 'failed';
  scannedAt: number;
  scanCount?: number;
  duplicateSessionScan?: boolean;
  productName?: string;
  result?: any;
  error?: string;
  purchasePrice?: number;
  selectedConsole?: string;
  inventoryItemId?: string;
  dealScore?: any;
  duplicateMatches?: Array<{
    id: string;
    product_name: string;
    console: string | null;
    condition: string | null;
    created_at: string | null;
  }>;
};

type PendingBarcode = {
  barcode: string;
  scannedAt: number;
  scanCount?: number;
};

const DATABASE_SAFE_ITEM_TYPES = new Set(['game', 'console', 'accessory', 'unknown']);

function toDatabaseItemType(itemType: string | undefined) {
  if (!itemType) return 'unknown';
  return DATABASE_SAFE_ITEM_TYPES.has(itemType) ? itemType : 'accessory';
}

export default function ScanPage() {
  const { user, accountId } = useAuth();
  const [scanMode, setScanMode] = useState<ScanMode>('single');
  const [batchMode, setBatchMode] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualPlatform, setManualPlatform] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingBarcodes, setPendingBarcodes] = useState<PendingBarcode[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [intakeActive, setIntakeActive] = useState(false);
  const [savedIntakeAvailable, setSavedIntakeAvailable] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [lots, setLots] = useState<LotCostSummary[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<string>('none');
  const [allocatingLot, setAllocatingLot] = useState(false);

  const [showItemDialog, setShowItemDialog] = useState(false);
  const [currentQueueItemForDialog, setCurrentQueueItemForDialog] = useState<QueueItem | null>(null);

  const recentScansRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    getActiveEmployees().then(setEmployees).catch(() => {});
    getLotCostSummaries().then(setLots).catch(() => {});
    try {
      const saved = window.localStorage.getItem(INTAKE_SESSION_KEY);
      if (saved) setSavedIntakeAvailable(true);
    } catch {}
  }, []);

  const selectedLot = lots.find((lot) => lot.id === selectedLotId) || null;

  const startIntake = useCallback(() => {
    try {
      const saved = window.localStorage.getItem(INTAKE_SESSION_KEY);
      if (saved) {
        const session = JSON.parse(saved);
        if (session.selectedLotId) setSelectedLotId(session.selectedLotId);
        if (session.scanMode) setScanMode(session.scanMode);
        if (typeof session.batchMode === 'boolean') setBatchMode(session.batchMode);
        if (Array.isArray(session.pendingBarcodes)) setPendingBarcodes(session.pendingBarcodes);
        if (Array.isArray(session.queue)) setQueue(session.queue);
        if (typeof session.manualBarcode === 'string') setManualBarcode(session.manualBarcode);
        if (typeof session.manualTitle === 'string') setManualTitle(session.manualTitle);
        if (typeof session.manualPlatform === 'string') setManualPlatform(session.manualPlatform);
        recentScansRef.current = new Set([
          ...(Array.isArray(session.pendingBarcodes) ? session.pendingBarcodes.map((item: PendingBarcode) => item.barcode).filter(Boolean) : []),
          ...(Array.isArray(session.queue) ? session.queue.map((item: QueueItem) => item.barcode).filter(Boolean) : []),
        ]);
      } else {
        setScanMode('continuous');
        setBatchMode(true);
      }
    } catch {
      setScanMode('continuous');
      setBatchMode(true);
    }
    setIntakeActive(true);
    setSavedIntakeAvailable(false);
    toast.success('Intake started');
  }, []);

  const saveAndCloseIntake = useCallback(() => {
    try {
      window.localStorage.setItem(INTAKE_SESSION_KEY, JSON.stringify({
        selectedLotId,
        scanMode,
        batchMode,
        pendingBarcodes,
        queue: queue.filter((item) => item.status !== 'scanning' && item.status !== 'looking_up' && item.status !== 'pricing' && item.status !== 'calculating'),
        manualBarcode,
        manualTitle,
        manualPlatform,
        savedAt: new Date().toISOString(),
      }));
    } catch {}
    setScannerActive(false);
    setIntakeActive(false);
    setSavedIntakeAvailable(true);
    toast.success('Intake saved');
  }, [batchMode, manualBarcode, manualPlatform, manualTitle, pendingBarcodes, queue, scanMode, selectedLotId]);

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const findDuplicateInventoryItems = useCallback(async (barcode: string, title: string, platform: string | null) => {
    if (!user) return [];
    const normalizedTitleStr = normalizeTitle(title || '');
    const account = accountId || user.id;

    let query = supabase
      .from('inventory_items')
      .select('id, product_name, console, condition, created_at')
      .eq('user_id', account)
      .eq('barcode', barcode)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: barcodeMatches, error: barcodeError } = await query;
    if (barcodeError) return [];
    if (barcodeMatches?.length) return barcodeMatches;

    if (!normalizedTitleStr) return [];

    let titleQuery = supabase
      .from('inventory_items')
      .select('id, product_name, console, condition, created_at')
      .eq('user_id', account)
      .eq('normalized_title', normalizedTitleStr)
      .order('created_at', { ascending: false })
      .limit(10);

    if (platform) {
      titleQuery = titleQuery.ilike('console', platform);
    }

    const { data: titleMatches } = await titleQuery;
    return titleMatches || [];
  }, [user, accountId]);

  const processBarcode = useCallback(async (queueItem: QueueItem) => {
    if (!user) return;

    try {
      updateQueueItem(queueItem.id, { status: 'looking_up' });

      let upcLookupResult;
      try {
        upcLookupResult = await lookupUPC(queueItem.barcode, accountId || user.id);
      } catch (lookupError: any) {
        if (lookupError.message?.includes('API key not configured')) {
          throw new Error('Please configure a barcode lookup API key in Settings');
        }
        throw lookupError;
      }

      if (!upcLookupResult) throw new Error('Product not found in any database');
      if (!upcLookupResult.title?.trim()) throw new Error('Invalid product data: missing title');

      const classification = classifyItem(
        upcLookupResult.title,
        upcLookupResult.category || '',
        upcLookupResult.brand || ''
      );

      const platform = upcLookupResult.platform || extractPlatform(upcLookupResult.title);
      const edition = detectEdition(upcLookupResult.title);

      let pricingResult: PricingResult | null = null;
      if (classification.itemType === 'game' || classification.itemType === 'console') {
        updateQueueItem(queueItem.id, { status: 'pricing' });
        try {
          pricingResult = await getPricingData(upcLookupResult.title, platform || 'Unknown', accountId || user.id);
        } catch (pricingError) {
          pricingResult = {
            status: 'api_error',
            error: pricingError instanceof Error ? pricingError.message : 'Unknown exception',
          };
        }
      }

      const hasPricing = pricingResult?.status === 'success' && pricingResult.data !== undefined;
      const confidence = calculateConfidence({
        barcodeMatch: true,
        titleSimilarity: 100,
        platformMatch: platform !== null,
        itemTypeConfidence: classification.confidence,
        hasImage: !!upcLookupResult.imageUrl,
        hasPricing,
        editionMatch: edition !== null,
      });

      const duplicateMatches = await findDuplicateInventoryItems(queueItem.barcode, upcLookupResult.title, platform);
      const result = { ...upcLookupResult, platform, edition, pricingResult, classification, confidence };

      updateQueueItem(queueItem.id, { status: 'awaiting_price', result, productName: upcLookupResult.title, duplicateMatches });
      setCurrentQueueItemForDialog({ ...queueItem, result, productName: upcLookupResult.title, duplicateMatches });
      setShowItemDialog(true);

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred';
      updateQueueItem(queueItem.id, { status: 'failed', error: errorMessage });

      if (errorMessage.includes('API key')) {
        toast.error('Configuration Required', { description: errorMessage, duration: 5000 });
      } else if (errorMessage.includes('not found')) {
        toast.error('Not Found', { description: `Barcode ${queueItem.barcode} not in database`, duration: 3000 });
      } else {
        toast.error('Scan Failed', { description: errorMessage, duration: 4000 });
      }
    }
  }, [user, accountId, updateQueueItem, findDuplicateInventoryItems]);

  const handleScan = useCallback((result: ScanResult) => {
    const barcode = result.barcode.trim();
    if (!barcode) return;

    const duplicateSessionScan = recentScansRef.current.has(barcode);
    if (!duplicateSessionScan) {
      recentScansRef.current.add(barcode);
    } else {
      toast.info('Another copy added to this intake queue', { description: barcode, duration: 1400 });
    }

    if (batchMode) {
      setPendingBarcodes((prev) => {
        const existing = prev.find((p) => p.barcode === barcode);
        if (existing) {
          return prev.map((p) => p.barcode === barcode ? { ...p, scanCount: Number(p.scanCount || 1) + 1, scannedAt: result.timestamp } : p);
        }
        return [...prev, { barcode, scannedAt: result.timestamp, scanCount: 1 }];
      });
      if (scanMode === 'single') setScannerActive(false);
      return;
    }

    const queueItem: QueueItem = {
      id: `scan-${Date.now()}-${barcode}`,
      barcode,
      status: 'scanning',
      scannedAt: result.timestamp,
      scanCount: 1,
      duplicateSessionScan,
    };

    setQueue((prev) => [queueItem, ...prev]);
    if (scanMode === 'single') setScannerActive(false);
    processBarcode(queueItem);
  }, [batchMode, scanMode, processBarcode]);

  const processBatch = useCallback(async () => {
    if (pendingBarcodes.length === 0 || isProcessingBatch) return;
    setIsProcessingBatch(true);

    for (const pending of pendingBarcodes) {
      const queueItem: QueueItem = {
        id: `scan-${Date.now()}-${pending.barcode}`,
        barcode: pending.barcode,
        status: 'scanning',
        scannedAt: pending.scannedAt,
        scanCount: Math.max(1, Number(pending.scanCount || 1)),
      };
      setQueue((prev) => [queueItem, ...prev]);

      await new Promise<void>((resolve) => {
        const originalProcessBarcode = async () => {
          await processBarcode(queueItem);
          let checks = 0;
          const waitForDialog = () => {
            setQueue((prev) => {
              const item = prev.find((i) => i.id === queueItem.id);
              if (!item || item.status === 'awaiting_price') {
                return prev;
              }
              if (['added', 'needs_review', 'failed'].includes(item.status)) {
                resolve();
              }
              return prev;
            });
            checks++;
            if (checks < 300) setTimeout(waitForDialog, 500);
            else resolve();
          };
          waitForDialog();
        };
        originalProcessBarcode();
      });
    }

    setPendingBarcodes([]);
    recentScansRef.current.clear();
    setIsProcessingBatch(false);
    toast.success('Batch processing complete');
  }, [pendingBarcodes, isProcessingBatch, processBarcode]);

  const createInventoryItem = useCallback(async (
    queueItem: QueueItem,
    lookupResult: any,
    classification: any,
    confidence: any,
    pricingResult: PricingResult | null,
    purchasePrice: number,
    selectedConsole: string,
    selectedRegion: string,
    dealScoreData: any,
    needsReview: boolean
  ) => {
    if (!user) throw new Error('Not authenticated');

    const pricingStatus = pricingResult ? toDatabaseStatus(pricingResult) : 'pending';
    const condition = 'CIB';
    const normalizedTitleStr = normalizeTitle(lookupResult.title || '');

    let selectedMarketValue = 0;
    let estimatedProfit = 0;
    let estimatedMarginPercent = 0;
    let priceLoose = 0;
    let priceCib = 0;
    let priceNew = 0;
    let priceGraded = 0;

    if (pricingResult?.status === 'success' && pricingResult.data) {
      priceLoose = pricingResult.data.loosePrice;
      priceCib = pricingResult.data.cibPrice;
      priceNew = pricingResult.data.newPrice;
      priceGraded = pricingResult.data.gradedPrice || 0;
      selectedMarketValue = getMarketValueByCondition(condition, priceLoose, priceCib, priceNew, priceGraded);
      if (purchasePrice > 0) {
        estimatedProfit = selectedMarketValue - purchasePrice;
        estimatedMarginPercent = (estimatedProfit / purchasePrice) * 100;
      }
    }

    const { data: inventoryItem, error: inventoryError } = await supabase
      .from('inventory_items')
      .insert({
        user_id: accountId || user.id,
        product_name: lookupResult.title?.trim() || 'Unknown Product',
        console: selectedConsole || lookupResult.platform || '',
        condition,
        region: selectedRegion,
        purchase_price: Math.max(0, purchasePrice),
        quantity: Math.max(1, Number(queueItem.scanCount || 1)),
        barcode: queueItem.barcode || null,
        raw_scanned_title: lookupResult.title?.trim() || '',
        normalized_title: normalizedTitleStr,
        platform_raw: lookupResult.platform || '',
        platform_normalized: selectedConsole || lookupResult.platform || '',
        category: lookupResult.category || '',
        item_type: toDatabaseItemType(classification.itemType),
        brand: lookupResult.brand || null,
        confidence_score: confidence.overall || 0,
        source_upc_provider: queueItem.barcode ? (lookupResult.source || 'local_upc_lookup') : 'manual_title_search',
        source_metadata_provider: pricingResult?.status === 'success' ? 'pricecharting' : (lookupResult.source || null),
        source_image_provider: lookupResult.imageUrl ? (lookupResult.source || 'local_upc_lookup') : null,
        description: lookupResult.description || '',
        genre: pricingResult?.data?.genre || '',
        scan_created_at: new Date().toISOString(),
        image_url: lookupResult.imageUrl || null,
        thumbnail_url: lookupResult.thumbnailUrl || null,
        added_by_employee_id: selectedEmployeeId || null,
        lot_id: selectedLotId !== 'none' ? selectedLotId : null,
        pricing_source: pricingResult?.status === 'success' ? 'PriceCharting' : 'pending',
        pricing_status: pricingStatus,
        pricing_attempted_at: new Date().toISOString(),
        pricing_last_checked_at: new Date().toISOString(),
        pricing_error_message: pricingResult?.error || null,
        pricing_error_code: pricingResult?.errorCode || null,
        pricing_confidence: pricingResult?.data?.confidence || null,
        pricing_matched_title: pricingResult?.data?.matchedTitle || null,
        pricing_matched_platform: pricingResult?.data?.matchedPlatform || null,
        pc_source_product_id: pricingResult?.data?.pcProductId || null,
        pricing_diagnostics: pricingResult ? {
          scanStatus: pricingResult.status,
          attemptedQueries: pricingResult.attemptedQueries ?? [],
          capturedAt: new Date().toISOString(),
        } : null,
        price_loose: priceLoose,
        price_cib: priceCib,
        price_new: priceNew,
        price_graded: priceGraded,
        selected_market_value: selectedMarketValue,
        estimated_profit: estimatedProfit,
        estimated_margin_percent: estimatedMarginPercent,
        purchase_price_override: purchasePrice > 0,
        deal_score: dealScoreData?.score || 0,
        deal_score_label: dealScoreData?.label || '',
        needs_review: needsReview,
      })
      .select()
      .single();

    if (inventoryError) throw new Error(`Failed to save item: ${inventoryError.message}`);
    if (!inventoryItem) throw new Error('Failed to create inventory item - no data returned');

    if (pricingResult?.status === 'success' && pricingResult.data) {
      await supabase.from('pricing_data').insert({
        item_id: inventoryItem.id,
        loose_price: priceLoose,
        cib_price: priceCib,
        new_price: priceNew,
        fetched_at: new Date().toISOString(),
      }).then(() => {});
    }

    if (selectedLotId !== 'none') {
      try {
        const lot = lots.find((entry) => entry.id === selectedLotId);
        const paid = Number(lot?.totalCost || lot?.total_paid || 0);
        if (paid > 0) {
          await allocateLotCost(selectedLotId, paid, 'market_weighted');
          getLotCostSummaries().then(setLots).catch(() => {});
        }
      } catch {
        // If market data is incomplete, the lot can be finalized from the panel.
      }
    }

    return inventoryItem;
  }, [user, accountId, selectedEmployeeId, selectedLotId, lots]);

  const handleAllocateSelectedLot = useCallback(async () => {
    if (!selectedLot) return;
    const paid = Number(selectedLot.totalCost || selectedLot.total_paid || 0);
    if (paid <= 0) {
      toast.error('This lot needs a total paid amount before COGS can be allocated');
      return;
    }
    setAllocatingLot(true);
    try {
      await allocateLotCost(selectedLot.id, paid, 'market_weighted');
      toast.success('Lot COGS allocated from market-value totals');
      setLots(await getLotCostSummaries());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to allocate lot cost');
    } finally {
      setAllocatingLot(false);
    }
  }, [selectedLot]);

  const handleItemConfirm = useCallback(async (purchasePrice: number, selectedConsole: string, selectedRegion: string) => {
    if (!currentQueueItemForDialog || !user) return;

    setShowItemDialog(false);

    const queueItem = queue.find((q) => q.id === currentQueueItemForDialog.id)
      ?? currentQueueItemForDialog;
    if (!queueItem?.result) return;

    const { result: lookupResult } = queueItem;
    let { pricingResult } = lookupResult;
    const { classification, confidence } = lookupResult;

    updateQueueItem(queueItem.id, { status: 'calculating', purchasePrice, selectedConsole });

    const confirmedConsole = selectedConsole.trim();
    const shouldRetryPricing =
      confirmedConsole &&
      (
        !pricingResult ||
        pricingResult.status !== 'success' ||
        (pricingResult.data?.matchedPlatform &&
          pricingResult.data.matchedPlatform.toLowerCase() !== confirmedConsole.toLowerCase())
      );

    if (shouldRetryPricing) {
      try {
        const retriedPricing = await getPricingData(
          lookupResult.title,
          confirmedConsole,
          accountId || user.id,
          true,
          queueItem.barcode
        );
        if (retriedPricing.status === 'success' || !pricingResult) {
          pricingResult = retriedPricing;
        }
      } catch (pricingError) {
        if (!pricingResult) {
          pricingResult = {
            status: 'api_error',
            error: pricingError instanceof Error ? pricingError.message : 'Unknown exception',
          };
        }
      }
    }

    try {
      const marketPricing = await getCanonicalPricing(lookupResult.title, confirmedConsole, {
        upc: queueItem.barcode,
        storedPcProductId: pricingResult?.data?.pcProductId || null,
        forceRefresh: true,
      });
      const p = marketPricing.prices;
      const hasMarketPrice = p.loose.value > 0 || p.cib.value > 0 || p.new.value > 0 || p.graded.value > 0;
      if (marketPricing.status !== 'api_error' && hasMarketPrice) {
        pricingResult = {
          status: 'success',
          data: {
            productName: marketPricing.pcMatch?.productName || pricingResult?.data?.productName || lookupResult.title,
            console: marketPricing.pcMatch?.platform || confirmedConsole,
            loosePrice: p.loose.value,
            cibPrice: p.cib.value,
            newPrice: p.new.value,
            gradedPrice: p.graded.value,
            pcProductId: marketPricing.pcMatch?.productId || pricingResult?.data?.pcProductId || '',
            matchedTitle: marketPricing.pcMatch?.productName || pricingResult?.data?.matchedTitle || undefined,
            matchedPlatform: marketPricing.pcMatch?.platform || confirmedConsole,
            confidence: marketPricing.diagnostics.pcApiUsed ? 90 : 75,
            strategy: marketPricing.pcMatch?.strategy || 'recent_sales_90d',
            genre: pricingResult?.data?.genre || '',
          },
        };
      }
    } catch {
      // Keep the PriceCharting-only result if the 90-day market refresh is unavailable.
    }

    const hasPricing = pricingResult?.status === 'success' && pricingResult.data;
    const condition = 'CIB';
    let dealScoreData = null;
    let marketValue = 0;

    if (hasPricing && pricingResult.data) {
      marketValue = getMarketValueByCondition(
        condition,
        pricingResult.data.loosePrice,
        pricingResult.data.cibPrice,
        pricingResult.data.newPrice,
        pricingResult.data.gradedPrice || 0
      );
      if (purchasePrice > 0) {
        dealScoreData = calculateSimpleDealScore(purchasePrice, marketValue, pricingResult.data.confidence);
        updateQueueItem(queueItem.id, { dealScore: dealScoreData });
      }
    }

    const normalizedTitleStr = normalizeTitle(lookupResult.title || '');
    const lotAllocationPending = selectedLotId !== 'none' && purchasePrice <= 0;
    const reviewCheck = lotAllocationPending && marketValue > 0
      ? { skip: true, reason: 'Lot COGS will be allocated after this lot is complete' }
      : shouldSkipReview(
        queueItem.barcode,
        normalizedTitleStr,
        selectedConsole,
        condition,
        purchasePrice,
        pricingResult ? toDatabaseStatus(pricingResult) : 'pending',
        marketValue,
        pricingResult?.data?.confidence || 0
      );

    try {
      if (reviewCheck.skip) {
        const inventoryItem = await createInventoryItem(queueItem, lookupResult, classification, confidence, pricingResult, purchasePrice, selectedConsole, selectedRegion, dealScoreData, false);
        updateQueueItem(queueItem.id, { status: 'added', inventoryItemId: inventoryItem.id });
        const pricingMsg = pricingResult?.status === 'success'
          ? purchasePrice > 0
            ? `$${purchasePrice} → ${dealScoreData?.emoji ?? ''} ${dealScoreData?.label ?? ''}`
            : 'Saved for lot COGS allocation'
          : getPricingStatusMessage(pricingResult!);
        toast.success(`Added: ${lookupResult.title}`, { description: pricingMsg, duration: 2500 });
      } else {
        const inventoryItem = await createInventoryItem(queueItem, lookupResult, classification, confidence, pricingResult, purchasePrice, selectedConsole, selectedRegion, dealScoreData, true);
        updateQueueItem(queueItem.id, { status: 'needs_review', inventoryItemId: inventoryItem.id });
        toast.warning(`${lookupResult.title} — Needs Review`, { description: reviewCheck.reason, duration: 3000 });
      }
    } catch (err: any) {
      updateQueueItem(queueItem.id, { status: 'failed', error: err.message });
      toast.error('Failed to save item', { description: err.message });
    }

    setCurrentQueueItemForDialog(null);
  }, [currentQueueItemForDialog, user, queue, updateQueueItem, createInventoryItem, selectedLotId]);

  const handleItemSkip = useCallback(async () => {
    if (!currentQueueItemForDialog || !user) return;
    setShowItemDialog(false);

    const queueItem = queue.find((q) => q.id === currentQueueItemForDialog.id)
      ?? currentQueueItemForDialog;
    if (!queueItem?.result) return;

    const { result: lookupResult } = queueItem;
    const detectedConsole = lookupResult.platform || '';

    try {
      const inventoryItem = await createInventoryItem(queueItem, lookupResult, lookupResult.classification, lookupResult.confidence, lookupResult.pricingResult, 0, detectedConsole, 'US', null, true);
      updateQueueItem(queueItem.id, { status: 'needs_review', inventoryItemId: inventoryItem.id });
      toast.warning(`${lookupResult.title} — Needs Review`, { description: 'Missing purchase price', duration: 3000 });
    } catch (err: any) {
      updateQueueItem(queueItem.id, { status: 'failed', error: err.message });
      toast.error('Failed to save item');
    }

    setCurrentQueueItemForDialog(null);
  }, [currentQueueItemForDialog, user, queue, updateQueueItem, createInventoryItem]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    handleScan({ barcode: manualBarcode.trim(), format: 'manual', timestamp: Date.now() });
    setManualBarcode('');
  };

  const handleManualTitleSubmit = async () => {
    if (!user) return;
    const title = manualTitle.trim();
    if (!title) return;

    const platform = manualPlatform.trim() || extractPlatform(title) || '';
    const classification = classifyItem(title, '', '');
    const confidence = calculateConfidence({
      barcodeMatch: false,
      titleSimilarity: 85,
      platformMatch: !!platform,
      itemTypeConfidence: classification.confidence,
      hasImage: false,
      hasPricing: false,
      editionMatch: false,
    });

    let pricingResult: PricingResult | null = null;
    if (classification.itemType === 'game' || classification.itemType === 'console') {
      try {
        pricingResult = await getPricingData(title, platform || 'Unknown', accountId || user.id, true);
      } catch (pricingError) {
        pricingResult = {
          status: 'api_error',
          error: pricingError instanceof Error ? pricingError.message : 'Unknown exception',
        };
      }
    }

    const queueItem: QueueItem = {
      id: `manual-${Date.now()}`,
      barcode: '',
      status: 'awaiting_price',
      scannedAt: Date.now(),
      scanCount: 1,
      productName: title,
      result: {
        title,
        platform,
        category: 'Manual Entry',
        classification,
        confidence,
        pricingResult,
      },
    };

    setQueue((prev) => [queueItem, ...prev]);
    setCurrentQueueItemForDialog(queueItem);
    setShowItemDialog(true);
    setManualTitle('');
    setManualPlatform('');
  };

  const handleUndo = async () => {
    if (queue.length === 0 || !user) return;
    const lastItem = queue[0];
    if (lastItem.status === 'added' || lastItem.status === 'needs_review') {
      const deleteQuery = supabase
        .from('inventory_items')
        .delete()
        .eq('user_id', accountId || user.id);

      if (lastItem.inventoryItemId) {
        await deleteQuery.eq('id', lastItem.inventoryItemId);
      } else if (lastItem.barcode) {
        await deleteQuery
          .eq('barcode', lastItem.barcode)
          .order('created_at', { ascending: false })
          .limit(1);
      }
    }
    setQueue((prev) => prev.slice(1));
    recentScansRef.current.delete(lastItem.barcode);
    toast.success('Undone');
  };

  const clearQueue = () => {
    setQueue([]);
    setPendingBarcodes([]);
    recentScansRef.current.clear();
    try {
      window.localStorage.removeItem(INTAKE_SESSION_KEY);
      setSavedIntakeAvailable(false);
    } catch {}
    toast.success('Queue cleared');
  };

  const clearPending = () => {
    setPendingBarcodes([]);
    pendingBarcodes.forEach((p) => recentScansRef.current.delete(p.barcode));
  };

  const getStatusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'scanning':
      case 'looking_up':
      case 'pricing':
      case 'calculating':
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/70" />;
      case 'awaiting_price':
        return <TrendingUp className="w-3.5 h-3.5 text-primary animate-pulse" />;
      case 'added':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'needs_review':
        return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
      case 'failed':
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    }
  };

  const getStatusLabel = (status: QueueItem['status']) => {
    switch (status) {
      case 'scanning': return 'Scanning...';
      case 'looking_up': return 'Looking up...';
      case 'pricing': return 'Getting prices...';
      case 'awaiting_price': return 'Awaiting details';
      case 'calculating': return 'Calculating...';
      case 'added': return 'Added';
      case 'needs_review': return 'Needs review';
      case 'failed': return 'Failed';
      default: return status;
    }
  };

  const detectedConsoleForDialog = currentQueueItemForDialog?.result?.platform ?? null;

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-8 max-w-5xl">
        <div>
          <div className="label-caps mb-1">Catalog</div>
          <h1 className="heading-lg text-[22px]">Scan Items</h1>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold">{intakeActive ? 'Lot Intake In Progress' : savedIntakeAvailable ? 'Saved Intake Available' : 'Start Intake'}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Select a lot, scan UPCs or enter them manually, save items without per-item cost, then finalize lot COGS when the lot is complete.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-9 text-xs" onClick={startIntake}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {savedIntakeAvailable ? 'Continue Intake' : intakeActive ? 'Restart Flow' : 'Start Intake'}
              </Button>
              {intakeActive && (
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={saveAndCloseIntake}>
                  Save & Close
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
            {['1. Select lot', '2. Scan or enter', '3. Confirm item', '4. Finalize COGS'].map((step) => (
              <div key={step} className="rounded-lg border border-white/10 bg-card/70 px-3 py-2 text-muted-foreground">
                {step}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <span className="font-semibold text-[14px] tracking-tight">Camera Scanner</span>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  onClick={() => setScannerActive(!scannerActive)}
                  variant={scannerActive ? 'destructive' : 'default'}
                  className="flex-1 h-9 rounded-lg text-[13px]"
                  size="sm"
                >
                  {scannerActive ? 'Stop Scanner' : 'Start Scanner'}
                </Button>
                <Select value={scanMode} onValueChange={(value: ScanMode) => setScanMode(value)}>
                  <SelectTrigger className="w-[130px] bg-secondary/40 h-9 rounded-lg text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="continuous">Continuous</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between px-1 py-2 rounded-md bg-secondary/30 border border-border/30">
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  <div>
                    <div className="text-[13px] font-medium">Batch Mode</div>
                    <div className="text-[11px] text-muted-foreground">Queue all barcodes, then process at once</div>
                  </div>
                </div>
                <Switch
                  checked={batchMode}
                  onCheckedChange={setBatchMode}
                />
              </div>

              {scannerActive && (
                <div className="border border-primary/20 rounded-lg overflow-hidden">
                  <BarcodeScannerView
                    onScan={handleScan}
                    isActive={scannerActive}
                    onStop={() => setScannerActive(false)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-[14px] tracking-tight">Manual Entry</span>
            </div>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="barcode" className="label-caps">Barcode / UPC</Label>
                <Input
                  id="barcode"
                  type="text"
                  placeholder="Enter barcode..."
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lot" className="label-caps">Receiving Lot</Label>
                <Select value={selectedLotId} onValueChange={setSelectedLotId}>
                  <SelectTrigger id="lot" className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]">
                    <SelectValue placeholder="Select lot..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No lot selected</SelectItem>
                    {lots.map((lot) => (
                      <SelectItem key={lot.id} value={lot.id}>
                        {lot.name} - {formatCurrency(Number(lot.totalCost || lot.total_paid || 0))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  Receive a shipment in Shipping Hub to create a scannable lot.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="employee" className="label-caps">Added By (Optional)</Label>
                <Select value={selectedEmployeeId ?? 'none'} onValueChange={(value) => setSelectedEmployeeId(value === 'none' ? null : value)}>
                  <SelectTrigger id="employee" className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]">
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5" />
                          {employee.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full h-9 rounded-lg text-[13px]" disabled={!manualBarcode.trim()}>
                Process Barcode
              </Button>
            </form>
            <div className="border-t border-border/40 pt-4">
              <div className="mb-3 flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                <span className="font-semibold text-[13px] tracking-tight">No UPC / Manual Title</span>
              </div>
              <div className="grid gap-3">
                <Input
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleManualTitleSubmit();
                  }}
                  placeholder="Game or item title..."
                  className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]"
                />
                <Input
                  value={manualPlatform}
                  onChange={(event) => setManualPlatform(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleManualTitleSubmit();
                  }}
                  placeholder="Platform, category, or system..."
                  className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]"
                />
                <Button type="button" variant="outline" className="w-full h-9 rounded-lg text-[13px]" disabled={!manualTitle.trim()} onClick={handleManualTitleSubmit}>
                  Add Manual Search Item
                </Button>
              </div>
            </div>
          </div>
        </div>

        {selectedLot && (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg border border-primary/25 bg-primary/10 flex items-center justify-center shrink-0">
                  <PackageCheck className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{selectedLot.name}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Paid {formatCurrency(Number(selectedLot.totalCost || selectedLot.total_paid || 0))}</span>
                    <span>{selectedLot.itemCount} item{selectedLot.itemCount === 1 ? '' : 's'}</span>
                    <span>FMV {formatCurrency(Number(selectedLot.totalMarketValue || selectedLot.total_market_value || 0))}</span>
                    {Number(selectedLot.allocation_ratio) > 0 && <span>COGS ratio {(Number(selectedLot.allocation_ratio) * 100).toFixed(1)}%</span>}
                  </div>
                </div>
              </div>
              <Button size="sm" className="h-9 text-xs" onClick={handleAllocateSelectedLot} disabled={allocatingLot}>
                {allocatingLot ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1.5" />}
                Finalize Lot COGS
              </Button>
            </div>
          </div>
        )}

        {batchMode && pendingBarcodes.length > 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-primary/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4 text-primary" />
                <span className="font-semibold text-[14px]">Batch Queue</span>
                <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
                  {pendingBarcodes.reduce((sum, item) => sum + Number(item.scanCount || 1), 0)} item{pendingBarcodes.reduce((sum, item) => sum + Number(item.scanCount || 1), 0) === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearPending}
                  disabled={isProcessingBatch}
                  className="h-8 text-[12px] text-muted-foreground"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={processBatch}
                  disabled={isProcessingBatch}
                  className="h-8 text-[12px]"
                >
                  {isProcessingBatch ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Processing...</>
                  ) : (
                    <><Play className="w-3.5 h-3.5 mr-1.5" />Process All</>
                  )}
                </Button>
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {pendingBarcodes.map((p) => (
                  <div key={p.barcode} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card border border-border/30 text-[12px]">
                    <ScanBarcode className="w-3 h-3 text-primary/50 flex-shrink-0" />
                    <span className="font-mono text-foreground/70 truncate">{p.barcode}</span>
                    {Number(p.scanCount || 1) > 1 && (
                      <Badge variant="outline" className="ml-auto border-primary/25 text-[10px] text-primary">Qty {p.scanCount}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {queue.length > 0 && (
          <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-[14px]">Processing Queue</span>
                <Badge variant="secondary" className="text-xs">{queue.reduce((sum, item) => sum + Number(item.scanCount || 1), 0)}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleUndo} disabled={queue.length === 0} className="h-7 text-[12px]">
                  <Undo2 className="w-3 h-3 mr-1.5" />
                  Undo
                </Button>
                <Button variant="ghost" size="sm" onClick={clearQueue} className="h-7 text-[12px] text-muted-foreground">
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Clear
                </Button>
              </div>
            </div>
            <div className="p-2">
              <div className="space-y-0.5">
                {queue.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {getStatusIcon(item.status)}
                      <div className="min-w-0">
                        {item.productName ? (
                          <div className="text-[13px] font-medium truncate">{item.productName}</div>
                        ) : (
                          <div className="font-mono text-[12px] text-muted-foreground">{item.barcode}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <span>{getStatusLabel(item.status)}</span>
                          {item.selectedConsole && (
                            <span className="text-foreground/40">· {item.selectedConsole}</span>
                          )}
                          {item.dealScore && (
                            <span className="text-primary/70">{item.dealScore.emoji} {item.dealScore.label} ({item.dealScore.score})</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {item.status === 'awaiting_price' && item.result && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            setCurrentQueueItemForDialog(item);
                            setShowItemDialog(true);
                          }}
                        >
                          Confirm
                        </Button>
                      )}
                      {item.error && (
                        <Badge variant="destructive" className="text-[10px] max-w-[120px] truncate">
                          {item.error}
                        </Badge>
                      )}
                      {Number(item.scanCount || 1) > 1 && (
                        <Badge variant="outline" className="text-[11px] border-primary/30 text-primary">
                          Qty {item.scanCount}
                        </Badge>
                      )}
                      {item.duplicateSessionScan && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-300">
                          Duplicate scan
                        </Badge>
                      )}
                      {item.purchasePrice !== undefined && item.purchasePrice > 0 && (
                        <Badge variant="outline" className="text-[11px] border-border/60">
                          ${item.purchasePrice.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <ScanItemDialog
          open={showItemDialog}
          onOpenChange={setShowItemDialog}
          onConfirm={handleItemConfirm}
          onSkip={handleItemSkip}
          productName={currentQueueItemForDialog?.result?.title || currentQueueItemForDialog?.productName || ''}
          detectedConsole={detectedConsoleForDialog}
          duplicateMatches={currentQueueItemForDialog?.duplicateMatches || []}
        />
      </div>
    </DashboardLayout>
  );
}
