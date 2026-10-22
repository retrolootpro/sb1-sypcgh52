'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { ScanItemDialog } from '@/components/scan-item-dialog';
import { ScanResult } from '@/lib/barcode-scanner';
import {
  Camera, Keyboard, History, CircleCheck as CheckCircle2,
  CircleAlert as AlertCircle, Loader as Loader2, Undo2, Trash2,
  User, TrendingUp, Layers, Play, ScanBarcode, PackageCheck, Calculator, Search, BookOpen,
  Printer,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { classifyItem, normalizeTitle, calculateConfidence, extractPlatform, detectEdition } from '@/lib/barcode-lookup';
import { lookupUPC, getActiveEmployees, type Employee } from '@/lib/api-services';
import { allocateLotCost, formatCurrency, getLotCostSummaries, type LotCostSummary } from '@/lib/finance-services';
import { getCanonicalPricing, getPricingData, getPricingStatusMessage, toDatabaseStatus, type PricingResult } from '@/lib/pricing-service';
import { calculateSimpleDealScore, getMarketValueByCondition, shouldSkipReview } from '@/lib/deal-score';
import { defaultConditionForPlatform, isBookLikeItem, type UPCLookupMode } from '@/lib/item-taxonomy';
import { INTAKE_SESSION_KEY, readIntakeDraft, type IntakeSessionDraft } from '@/lib/intake-draft';
import { undoIntakeItem } from '@/lib/intake-actions';
import { lotCostFinalized } from '@/lib/intake-input';

type ScanMode = 'single' | 'continuous';
type IntakeItemType = 'game' | 'book' | 'mixed';

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

type ManualSearchResult = {
  id: string;
  productName: string;
  consoleName: string;
};

type ManualSearchDetails = ManualSearchResult & {
  prices: {
    loose: number;
    cib: number;
    new: number;
    graded: number;
  };
};

const DATABASE_SAFE_ITEM_TYPES = new Set(['game', 'console', 'accessory', 'unknown']);
const INTAKE_TRANSIENT_STATUSES = new Set<QueueItem['status']>(['scanning', 'looking_up', 'pricing', 'calculating']);

function toDatabaseItemType(itemType: string | undefined) {
  if (!itemType) return 'unknown';
  return DATABASE_SAFE_ITEM_TYPES.has(itemType) ? itemType : 'accessory';
}

function getDraftBarcodes(draft: Pick<IntakeSessionDraft, 'pendingBarcodes' | 'queue'>) {
  return [
    ...draft.pendingBarcodes.map((item) => item.barcode).filter(Boolean),
    ...draft.queue.map((item) => item.barcode).filter(Boolean),
  ];
}

export default function ScanPage() {
  const { user, accountId } = useAuth();
  const router = useRouter();
  const [scanMode, setScanMode] = useState<ScanMode>('single');
  const [intakeItemType, setIntakeItemType] = useState<IntakeItemType>('game');
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
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [draftBlocked, setDraftBlocked] = useState(false);
  const [draftOwner, setDraftOwner] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState('');

  const [showItemDialog, setShowItemDialog] = useState(false);
  const [currentQueueItemForDialog, setCurrentQueueItemForDialog] = useState<QueueItem | null>(null);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [manualSearchResults, setManualSearchResults] = useState<ManualSearchResult[]>([]);
  const [manualSearchMessage, setManualSearchMessage] = useState('');
  const [manualSearchDraft, setManualSearchDraft] = useState({ title: '', platform: '' });

  const recentScansRef = useRef<Set<string>>(new Set());
  const intakeDraftHydratedRef = useRef(false);
  const referenceGeneration = useRef({});
  const undoLock = useRef(false);
  const saveLock = useRef(false);
  const [savingItem, setSavingItem] = useState(false);
  const batchWaiter = useRef<{ id: string; resolve: () => void } | null>(null);
  const batchLock = useRef(false);
  useEffect(() => {
    const waiter = batchWaiter.current;
    if (waiter && queue.some(item => item.id === waiter.id && ['added', 'needs_review', 'failed'].includes(item.status))) {
      batchWaiter.current = null; waiter.resolve();
    }
  }, [queue]);
  useEffect(() => () => { batchWaiter.current?.resolve(); batchWaiter.current = null; batchLock.current = false; }, []);

  const loadReferences = useCallback(async () => {
    const current = {}; referenceGeneration.current = current;
    setReferenceLoading(true); setReferenceError(''); setEmployees([]); setLots([]);
    if (!user || !accountId) { setReferenceLoading(false); return; }
    try {
      const [staff, summaries] = await Promise.all([getActiveEmployees(), getLotCostSummaries()]);
      if (referenceGeneration.current === current) { setEmployees(staff); setLots(summaries); }
    } catch (cause) {
      console.error('Intake reference data:', cause);
      if (referenceGeneration.current === current) setReferenceError('Receiving lots and employee choices could not be loaded. Retry before adding inventory.');
    } finally { if (referenceGeneration.current === current) setReferenceLoading(false); }
  }, [user, accountId]);

  useEffect(() => {
    void loadReferences();
    return () => { referenceGeneration.current = {}; };
  }, [loadReferences]);

  useEffect(() => {
    if (!user || !accountId) return;
    intakeDraftHydratedRef.current = false;
    setQueue([]); setPendingBarcodes([]); setManualBarcode(''); setManualTitle(''); setManualPlatform('');
    setSelectedLotId('none'); setSelectedEmployeeId(null); setIntakeActive(false); setSavedIntakeAvailable(false);
    setDraftError(''); setDraftBlocked(false); recentScansRef.current.clear();
    try {
      const saved = window.localStorage.getItem(INTAKE_SESSION_KEY);
      if (saved) {
        const session = readIntakeDraft(saved, accountId, user.id);
        if (session.selectedLotId) setSelectedLotId(session.selectedLotId);
        if (session.selectedEmployeeId !== undefined) setSelectedEmployeeId(session.selectedEmployeeId);
        if (session.scanMode) setScanMode(session.scanMode);
        if (session.intakeItemType) setIntakeItemType(session.intakeItemType);
        if (typeof session.batchMode === 'boolean') setBatchMode(session.batchMode);
        const savedPending = Array.isArray(session.pendingBarcodes) ? session.pendingBarcodes : [];
        const savedQueue = Array.isArray(session.queue) ? session.queue : [];
        setPendingBarcodes(savedPending);
        setQueue(savedQueue);
        if (typeof session.manualBarcode === 'string') setManualBarcode(session.manualBarcode);
        if (typeof session.manualTitle === 'string') setManualTitle(session.manualTitle);
        if (typeof session.manualPlatform === 'string') setManualPlatform(session.manualPlatform);
        recentScansRef.current = new Set(getDraftBarcodes({ pendingBarcodes: savedPending, queue: savedQueue }));
        setSavedIntakeAvailable(true);
        setIntakeActive(true);
      }
    } catch (cause) {
      console.error('Intake draft restore:', cause);
      setDraftBlocked(true);
      setDraftError('The saved intake could not be verified or read. It has not been restored or overwritten. You can discard this browser draft; saved inventory will not be deleted.');
    }
    intakeDraftHydratedRef.current = true;
    setDraftOwner(`${accountId}:${user.id}`);
  }, [user, accountId]);

  const queueBusy = savingItem || isProcessingBatch || queue.some(item => INTAKE_TRANSIENT_STATUSES.has(item.status));
  const intakeUnavailable = referenceLoading || !!referenceError || draftBlocked || !accountId;

  const selectedLot = lots.find((lot) => lot.id === selectedLotId) || null;
  const completedQueueItems = queue.filter((item) => ['added', 'needs_review'].includes(item.status));
  const unresolvedQueueItems = queue.filter((item) => !['added', 'needs_review'].includes(item.status));
  const intakeHasScans = pendingBarcodes.length > 0 || queue.length > 0;
  const intakeScansComplete = intakeHasScans && pendingBarcodes.length === 0 && !isProcessingBatch;
  const intakeItemsConfirmed = queue.length > 0 && unresolvedQueueItems.length === 0 && completedQueueItems.length > 0;
  const selectedLotCogsComplete = lotCostFinalized(selectedLot);
  const intakeCanFinish = Boolean(selectedLot && intakeScansComplete && intakeItemsConfirmed && selectedLotCogsComplete);
  const intakeSteps = [
    { label: '1. Select lot', complete: Boolean(selectedLot) },
    { label: '2. Scan or enter', complete: intakeScansComplete },
    { label: '3. Confirm items', complete: intakeItemsConfirmed },
    { label: '4. Finalize COGS', complete: selectedLotCogsComplete },
  ];

  const printableGameLabelIds = useMemo(() => {
    return queue.flatMap((item) => {
      if (!item.inventoryItemId || !['added', 'needs_review'].includes(item.status)) return [];

      const itemType = String(item.result?.classification?.itemType || '').toLowerCase();
      const consoleName = String(item.selectedConsole || item.result?.platform || '').toLowerCase();
      const isBook = itemType === 'book' || itemType === 'manga' || /book|manga|comic/.test(consoleName);
      if (isBook) return [];

      const count = Math.max(1, Number(item.scanCount || 1));
      return Array.from({ length: count }, () => item.inventoryItemId as string);
    });
  }, [queue]);

  const printCompletedGameLabels = useCallback(() => {
    if (printableGameLabelIds.length === 0) {
      toast.info('No game labels ready yet', {
        description: 'Process the intake queue first, then print labels for the completed games.',
      });
      return;
    }

    router.push(`/business/labels?ids=${encodeURIComponent(printableGameLabelIds.join(','))}&autoprint=1`);
  }, [printableGameLabelIds, router]);

  const startIntake = useCallback(() => {
    if (intakeUnavailable || queueBusy) return;
    if (!savedIntakeAvailable && !intakeHasScans) {
      setScanMode('continuous');
      setIntakeItemType('game');
      setBatchMode(true);
    }
    setIntakeActive(true);
    setSavedIntakeAvailable(false);
    toast.success('Intake started');
  }, [intakeUnavailable, queueBusy, savedIntakeAvailable, intakeHasScans]);

  const persistIntakeDraft = useCallback(() => {
    if (!accountId || !user || draftBlocked || draftOwner !== `${accountId}:${user.id}` || !intakeDraftHydratedRef.current) return false;
    const draft: IntakeSessionDraft = {
      accountId, staffId: user.id,
      selectedLotId,
      selectedEmployeeId,
      scanMode,
      intakeItemType,
      batchMode,
      pendingBarcodes,
      queue,
      manualBarcode,
      manualTitle,
      manualPlatform,
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(INTAKE_SESSION_KEY, JSON.stringify(draft));
      setSavedIntakeAvailable(true);
      setDraftError('');
      return true;
    } catch (cause) {
      console.error('Intake draft save:', cause);
      setDraftError('This intake could not be saved in this browser. Keep this page open; unresolved scans may be lost if you leave.');
      return false;
    }
  }, [accountId, user, draftBlocked, draftOwner, batchMode, intakeItemType, manualBarcode, manualPlatform, manualTitle, pendingBarcodes, queue, scanMode, selectedEmployeeId, selectedLotId]);

  useEffect(() => {
    if (!intakeDraftHydratedRef.current || !intakeActive) return;
    persistIntakeDraft();
  }, [batchMode, intakeActive, intakeItemType, manualBarcode, manualPlatform, manualTitle, pendingBarcodes, persistIntakeDraft, queue, scanMode, selectedEmployeeId, selectedLotId]);

  const saveAndCloseIntake = useCallback(() => {
    if (queueBusy || !persistIntakeDraft()) return;
    setScannerActive(false);
    setIntakeActive(false);
    setSavedIntakeAvailable(true);
    toast.success('Intake saved');
  }, [persistIntakeDraft, queueBusy]);

  const finishIntake = useCallback(() => {
    if (!intakeCanFinish) {
      toast.error('Finish the intake checklist first', {
        description: 'Select a lot, process all scans, confirm every item, and finalize COGS.',
      });
      return;
    }
    if (queueBusy) return;
    try {
      window.localStorage.removeItem(INTAKE_SESSION_KEY);
    } catch (cause) {
      console.error('Intake draft removal:', cause);
      setDraftError('The completed draft could not be removed from this browser. Keep this page open and retry.');
      return;
    }

    setScannerActive(false);
    setIntakeActive(false);
    setSavedIntakeAvailable(false);
    setPendingBarcodes([]);
    setQueue([]);
    setManualBarcode('');
    setManualTitle('');
    setManualPlatform('');
    setSelectedLotId('none');
    setSelectedEmployeeId(null);
    setBatchMode(false);
    setScanMode('single');
    setIntakeItemType('game');
    recentScansRef.current.clear();
    toast.success('Intake finished. Ready for the next lot.');
  }, [intakeCanFinish, queueBusy]);

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const findDuplicateInventoryItems = useCallback(async (barcode: string, title: string, platform: string | null) => {
    if (!user || !accountId) throw new Error('Team access must be verified before duplicate checks.');
    const normalizedTitleStr = normalizeTitle(title || '');
    const account = accountId;

    let query = supabase
      .from('inventory_items')
      .select('id, product_name, console, condition, created_at')
      .eq('user_id', account)
      .eq('barcode', barcode)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: barcodeMatches, error: barcodeError } = await query;
    if (barcodeError) throw new Error(`Duplicate check failed: ${barcodeError.message}`);
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

    const { data: titleMatches, error: titleError } = await titleQuery;
    if (titleError) throw new Error(`Duplicate check failed: ${titleError.message}`);
    return titleMatches || [];
  }, [user, accountId]);

  const processBarcode = useCallback(async (queueItem: QueueItem) => {
    if (!user) return;

    try {
      updateQueueItem(queueItem.id, { status: 'looking_up' });

      let upcLookupResult;
      try {
        const lookupMode: UPCLookupMode = intakeItemType === 'book' ? 'book' : 'auto';
        upcLookupResult = await lookupUPC(queueItem.barcode, accountId || user.id, undefined, lookupMode);
      } catch (lookupError: any) {
        if (lookupError.message?.includes('API key not configured')) {
          throw new Error('Please configure a barcode lookup API key in Settings');
        }
        if (intakeItemType === 'book' && /book metadata|not found|Product not found/i.test(lookupError.message || '')) {
          const classification = { itemType: 'book', confidence: 70, reasoning: 'Book barcode kept; title required' };
          const confidence = calculateConfidence({
            barcodeMatch: true,
            titleSimilarity: 0,
            platformMatch: true,
            itemTypeConfidence: classification.confidence,
            hasImage: false,
            hasPricing: false,
            editionMatch: false,
          });
          const title = `Book ${queueItem.barcode}`;
          const result = {
            barcode: queueItem.barcode,
            title,
            platform: 'Book',
            category: 'Books',
            brand: 'Books',
            description: 'Manual book intake from scanned barcode.',
            imageUrl: '',
            thumbnailUrl: '',
            source: 'manual_book_barcode',
            pricingResult: null,
            classification,
            confidence,
            manualTitleRequired: true,
            bookMetadata: {
              title,
              subtitle: '',
              authors: [],
              publisher: '',
              publishedDate: '',
              publishedYear: '',
              description: '',
              pageCount: null,
              categories: [],
              language: '',
              isbn10: '',
              isbn13: '',
              coverImageUrl: '',
              source: 'manual_book_barcode',
              sourcesTried: [],
            },
          };

          updateQueueItem(queueItem.id, { status: 'awaiting_price', result, productName: title });
          setCurrentQueueItemForDialog({ ...queueItem, status: 'awaiting_price', result, productName: title });
          setShowItemDialog(true);
          toast.info('Book title needed', {
            description: 'No reliable barcode match found. Enter the title to save this scan.',
            duration: 3500,
          });
          return;
        }
        throw lookupError;
      }

      if (!upcLookupResult) throw new Error('Product not found in any database');
      if (!upcLookupResult.title?.trim()) throw new Error('Invalid product data: missing title');

      const forcedBook = intakeItemType === 'book' || isBookLikeItem(upcLookupResult);
      const classification = forcedBook
        ? {
            itemType: upcLookupResult.platform === 'Manga' ? 'manga' : 'book',
            confidence: 96,
            reasoning: 'Book/media intake mode',
          }
        : classifyItem(
            upcLookupResult.title,
            upcLookupResult.category || '',
            upcLookupResult.brand || ''
          );

      const platform = upcLookupResult.platform || (forcedBook ? 'Book' : extractPlatform(upcLookupResult.title));
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
        const description = intakeItemType === 'book'
          ? 'No book match found. Use the manual title option and enter price manually.'
          : `Barcode ${queueItem.barcode} not in database`;
        toast.error('Not Found', { description, duration: 3000 });
      } else {
        toast.error('Scan Failed', { description: errorMessage, duration: 4000 });
      }
    }
  }, [user, accountId, intakeItemType, updateQueueItem, findDuplicateInventoryItems]);

  const handleScan = useCallback((result: ScanResult) => {
    if (intakeUnavailable || queueBusy || undoLock.current) return;
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
  }, [batchMode, scanMode, processBarcode, intakeUnavailable, queueBusy]);

  const processBatch = useCallback(async () => {
    if (pendingBarcodes.length === 0 || batchLock.current || intakeUnavailable || savingItem) return;
    batchLock.current = true;
    setIsProcessingBatch(true);

    for (const pending of pendingBarcodes) {
      if (!batchLock.current) return;
      const queueItem: QueueItem = {
        id: `scan-${Date.now()}-${pending.barcode}`,
        barcode: pending.barcode,
        status: 'scanning',
        scannedAt: pending.scannedAt,
        scanCount: Math.max(1, Number(pending.scanCount || 1)),
      };
      setQueue((prev) => [queueItem, ...prev]);
      setPendingBarcodes(prev => prev.filter(item => item.barcode !== pending.barcode));
      const confirmed = new Promise<void>(resolve => { batchWaiter.current = { id: queueItem.id, resolve }; });
      await processBarcode(queueItem);
      await confirmed;
    }

    if (!batchLock.current) return;
    batchLock.current = false;
    setIsProcessingBatch(false);
    toast.info('Batch processing finished. Check the queue for failed items or review flags.');
  }, [pendingBarcodes, processBarcode, intakeUnavailable, savingItem]);

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
    needsReview: boolean,
    askingPrice?: number
  ) => {
    if (!user || !accountId) throw new Error('Team access must be verified before saving inventory.');
    if (referenceLoading || referenceError) throw new Error('Reload receiving lots and employees before saving.');
    if (selectedLotId !== 'none' && !lots.some(lot => lot.id === selectedLotId)) throw new Error('The selected lot is no longer available. Select a current lot.');
    if (selectedEmployeeId && !employees.some(employee => employee.id === selectedEmployeeId)) throw new Error('The selected employee is no longer available.');

    const pricingStatus = pricingResult ? toDatabaseStatus(pricingResult) : 'pending';
    const manualPricedItem = isBookLikeItem({ ...lookupResult, console: selectedConsole });
    const condition = manualPricedItem ? 'Loose' : lookupResult.condition || defaultConditionForPlatform(selectedConsole || lookupResult.platform);
    const normalizedTitleStr = normalizeTitle(lookupResult.title || '');
    const bookMetadata = lookupResult.bookMetadata || null;

    let selectedMarketValue = 0;
    let estimatedProfit = 0;
    let estimatedMarginPercent = 0;
    let priceLoose = 0;
    let priceCib = 0;
    let priceNew = 0;
    let priceGraded = 0;
    const manualAskingPrice = Number.isFinite(Number(askingPrice)) && Number(askingPrice) > 0
      ? Number(askingPrice)
      : 0;

    if (!manualPricedItem && pricingResult?.status === 'success' && pricingResult.data) {
      priceLoose = pricingResult.data.loosePrice;
      priceCib = pricingResult.data.cibPrice;
      priceNew = pricingResult.data.newPrice;
      priceGraded = pricingResult.data.gradedPrice || 0;
      selectedMarketValue = getMarketValueByCondition(condition, priceLoose, priceCib, priceNew, priceGraded);
    }
    if (manualAskingPrice > 0) {
      selectedMarketValue = manualAskingPrice;
    }
    if (purchasePrice > 0 && selectedMarketValue > 0) {
      estimatedProfit = selectedMarketValue - purchasePrice;
      estimatedMarginPercent = (estimatedProfit / purchasePrice) * 100;
    }

    const { data: inventoryItem, error: inventoryError } = await supabase
      .from('inventory_items')
      .insert({
        user_id: accountId,
        product_name: lookupResult.title?.trim() || 'Unknown Product',
        console: selectedConsole || lookupResult.platform || '',
        condition,
        region: manualPricedItem ? null : selectedRegion,
        purchase_price: Math.max(0, purchasePrice),
        sell_price: manualAskingPrice > 0 ? manualAskingPrice : null,
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
        source_metadata_provider: manualPricedItem
          ? (bookMetadata?.source || lookupResult.source || 'manual_book_metadata')
          : pricingResult?.status === 'success' ? 'pricecharting' : (lookupResult.source || null),
        source_image_provider: lookupResult.imageUrl ? (lookupResult.source || 'local_upc_lookup') : null,
        description: lookupResult.description || '',
        genre: manualPricedItem ? null : pricingResult?.data?.genre || '',
        book_format: bookMetadata?.format || null,
        book_authors: Array.isArray(bookMetadata?.authors) ? bookMetadata.authors : null,
        book_publisher: bookMetadata?.publisher || null,
        book_published_date: bookMetadata?.publishedDate || null,
        book_published_year: bookMetadata?.publishedYear || null,
        book_page_count: bookMetadata?.pageCount ?? null,
        book_language: bookMetadata?.language || null,
        book_isbn10: bookMetadata?.isbn10 || null,
        book_isbn13: bookMetadata?.isbn13 || null,
        book_cover_url: bookMetadata?.coverImageUrl || lookupResult.imageUrl || null,
        book_metadata_source: bookMetadata?.source || null,
        book_metadata_updated_at: bookMetadata ? new Date().toISOString() : null,
        raw_lookup_payload: bookMetadata ? {
          type: 'book_metadata',
          barcode: queueItem.barcode || null,
          title: bookMetadata.title || lookupResult.title || '',
          subtitle: bookMetadata.subtitle || '',
          authors: Array.isArray(bookMetadata.authors) ? bookMetadata.authors : [],
          publisher: bookMetadata.publisher || '',
          publishedDate: bookMetadata.publishedDate || '',
          publishedYear: bookMetadata.publishedYear || '',
          description: bookMetadata.description || lookupResult.description || '',
          pageCount: bookMetadata.pageCount ?? null,
          categories: Array.isArray(bookMetadata.categories) ? bookMetadata.categories : [],
          language: bookMetadata.language || '',
          isbn10: bookMetadata.isbn10 || '',
          isbn13: bookMetadata.isbn13 || '',
          coverImageUrl: bookMetadata.coverImageUrl || lookupResult.imageUrl || '',
          format: bookMetadata.format || '',
          retailPrice: Number(bookMetadata.retailPrice) || null,
          retailPriceCurrency: bookMetadata.retailPriceCurrency || '',
          retailPriceSource: bookMetadata.retailPriceSource || '',
          source: bookMetadata.source || lookupResult.source || '',
          sourcesTried: Array.isArray(bookMetadata.sourcesTried) ? bookMetadata.sourcesTried : [],
        } : lookupResult.rawLookupPayload || {},
        scan_created_at: new Date().toISOString(),
        image_url: lookupResult.imageUrl || null,
        thumbnail_url: lookupResult.thumbnailUrl || null,
        added_by_employee_id: selectedEmployeeId || null,
        lot_id: selectedLotId !== 'none' ? selectedLotId : null,
        pricing_source: manualPricedItem ? 'Manual / book metadata' : pricingResult?.status === 'success' ? 'PriceCharting' : 'pending',
        pricing_status: manualPricedItem ? 'manual' : pricingStatus,
        pricing_attempted_at: manualPricedItem ? null : new Date().toISOString(),
        pricing_last_checked_at: manualPricedItem ? null : new Date().toISOString(),
        pricing_error_message: manualPricedItem ? null : pricingResult?.error || null,
        pricing_error_code: manualPricedItem ? null : pricingResult?.errorCode || null,
        pricing_confidence: manualPricedItem ? null : pricingResult?.data?.confidence || null,
        pricing_matched_title: manualPricedItem ? null : pricingResult?.data?.matchedTitle || null,
        pricing_matched_platform: manualPricedItem ? null : pricingResult?.data?.matchedPlatform || null,
        pc_source_product_id: manualPricedItem ? null : pricingResult?.data?.pcProductId || null,
        pricing_diagnostics: !manualPricedItem && pricingResult ? {
          scanStatus: pricingResult.status,
          attemptedQueries: pricingResult.attemptedQueries ?? [],
          capturedAt: new Date().toISOString(),
        } : null,
        price_loose: manualPricedItem ? null : priceLoose,
        price_cib: manualPricedItem ? null : priceCib,
        price_new: manualPricedItem ? null : priceNew,
        price_graded: manualPricedItem ? null : priceGraded,
        selected_market_value: selectedMarketValue,
        estimated_profit: estimatedProfit,
        estimated_margin_percent: estimatedMarginPercent,
        purchase_price_override: purchasePrice > 0,
        deal_score: manualPricedItem ? 0 : dealScoreData?.score || 0,
        deal_score_label: manualPricedItem ? '' : dealScoreData?.label || '',
        needs_review: needsReview,
      })
      .select()
      .single();

    if (inventoryError) throw new Error(`Failed to save item: ${inventoryError.message}`);
    if (!inventoryItem) throw new Error('Failed to create inventory item - no data returned');

    if (!manualPricedItem && pricingResult?.status === 'success' && pricingResult.data) {
      const { error: pricingHistoryError } = await supabase.from('pricing_data').insert({
        item_id: inventoryItem.id,
        loose_price: priceLoose,
        cib_price: priceCib,
        new_price: priceNew,
        fetched_at: new Date().toISOString(),
      });
      if (pricingHistoryError) {
        console.error('Intake pricing history:', pricingHistoryError);
        toast.warning('Inventory saved, but pricing history could not be recorded. Do not add this item again; review pricing in Inventory.');
      }
    }

    if (selectedLotId !== 'none') {
      try {
        const lot = lots.find((entry) => entry.id === selectedLotId);
        const paid = Number(lot?.totalCost || lot?.total_paid || 0);
        if (paid > 0) {
          await allocateLotCost(selectedLotId, paid, 'market_weighted');
          try { setLots(await getLotCostSummaries()); }
          catch (cause) {
            console.error('Intake lot refresh:', cause);
            setReferenceError('Inventory was saved, but updated lot totals could not be loaded. Retry receiving data before adding more items.');
          }
        }
      } catch (cause) {
        console.error('Intake automatic lot allocation:', cause);
        toast.warning('Inventory saved; lot cost allocation needs attention. Review the lot and finalize COGS before finishing intake.');
      }
    }

    return inventoryItem;
  }, [user, accountId, selectedEmployeeId, selectedLotId, lots, employees, referenceLoading, referenceError]);

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

  const handleItemConfirm = useCallback(async (
    purchasePrice: number,
    selectedConsole: string,
    selectedRegion: string,
    titleOverride?: string,
    bookMetadataOverride?: Record<string, unknown>,
    askingPrice?: number,
    forReview = false
  ) => {
    if (!currentQueueItemForDialog || !user || saveLock.current) return;
    saveLock.current = true; setSavingItem(true);

    setShowItemDialog(false);

    const queueItem = queue.find((q) => q.id === currentQueueItemForDialog.id)
      ?? currentQueueItemForDialog;
    if (!queueItem?.result) { saveLock.current = false; setSavingItem(false); toast.error('Item details are unavailable. Look up the item again.'); return; }

    const { result } = queueItem;
    const editedBookMetadata = bookMetadataOverride || {};
    const metadataTitle = typeof editedBookMetadata.title === 'string' ? editedBookMetadata.title.trim() : '';
    const finalTitle = titleOverride?.trim() || metadataTitle;
    const lookupResult = finalTitle
      ? {
          ...result,
          title: finalTitle,
          productName: finalTitle,
          description: typeof editedBookMetadata.description === 'string' ? editedBookMetadata.description : result.description,
          brand: typeof editedBookMetadata.publisher === 'string' && editedBookMetadata.publisher.trim()
            ? editedBookMetadata.publisher
            : result.brand,
          category: Array.isArray(editedBookMetadata.categories) && editedBookMetadata.categories.length
            ? `Books, ${editedBookMetadata.categories.join(', ')}`
            : result.category,
          imageUrl: typeof editedBookMetadata.coverImageUrl === 'string' && editedBookMetadata.coverImageUrl.trim()
            ? editedBookMetadata.coverImageUrl
            : result.imageUrl,
          thumbnailUrl: typeof editedBookMetadata.coverImageUrl === 'string' && editedBookMetadata.coverImageUrl.trim()
            ? editedBookMetadata.coverImageUrl
            : result.thumbnailUrl,
          bookMetadata: bookMetadataOverride ? editedBookMetadata : result.bookMetadata,
          manualTitleRequired: false,
        }
      : result;
    if (finalTitle) {
      updateQueueItem(queueItem.id, { result: lookupResult, productName: finalTitle });
    }
    let { pricingResult } = lookupResult;
    const { classification, confidence } = lookupResult;
    const usesAutomatedPricing = classification.itemType === 'game' || classification.itemType === 'console';

    updateQueueItem(queueItem.id, { status: 'calculating', purchasePrice, selectedConsole });

    const confirmedConsole = selectedConsole.trim();
    const shouldRetryPricing =
      usesAutomatedPricing &&
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

    if (usesAutomatedPricing) {
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
    }

    const hasPricing = pricingResult?.status === 'success' && pricingResult.data;
    const condition = lookupResult.condition || defaultConditionForPlatform(selectedConsole || lookupResult.platform);
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
    const reviewCheck = forReview
      ? { skip: false, reason: 'Saved for review at staff request' }
      : lotAllocationPending
      ? { skip: true, reason: 'Lot COGS will be allocated after this lot is complete' }
      : !usesAutomatedPricing
        ? purchasePrice > 0
          ? { skip: true, reason: 'Manual-priced item saved without automated market pricing' }
          : { skip: false, reason: 'Missing purchase price' }
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
        const inventoryItem = await createInventoryItem(queueItem, lookupResult, classification, confidence, pricingResult, purchasePrice, selectedConsole, selectedRegion, dealScoreData, false, askingPrice);
        updateQueueItem(queueItem.id, { status: 'added', inventoryItemId: inventoryItem.id });
        const pricingMsg = !usesAutomatedPricing
          ? reviewCheck.reason
          : pricingResult?.status === 'success'
            ? purchasePrice > 0
              ? `$${purchasePrice} → ${dealScoreData?.emoji ?? ''} ${dealScoreData?.label ?? ''}`
              : 'Saved for lot COGS allocation'
            : pricingResult
              ? getPricingStatusMessage(pricingResult)
              : 'Pricing unavailable';
        toast.success(`Added: ${lookupResult.title}`, { description: pricingMsg, duration: 2500 });
      } else {
        const inventoryItem = await createInventoryItem(queueItem, lookupResult, classification, confidence, pricingResult, purchasePrice, selectedConsole, selectedRegion, dealScoreData, true, askingPrice);
        updateQueueItem(queueItem.id, { status: 'needs_review', inventoryItemId: inventoryItem.id });
        toast.warning(`${lookupResult.title} — Needs Review`, { description: reviewCheck.reason, duration: 3000 });
      }
    } catch (err: any) {
      updateQueueItem(queueItem.id, { status: 'failed', error: err.message });
      toast.error('Failed to save item', { description: err.message });
    }

    setCurrentQueueItemForDialog(null);
    saveLock.current = false; setSavingItem(false);
  }, [currentQueueItemForDialog, user, accountId, queue, updateQueueItem, createInventoryItem, selectedLotId]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    handleScan({ barcode: manualBarcode.trim(), format: 'manual', timestamp: Date.now() });
    setManualBarcode('');
  };

  const openManualItemDialog = useCallback((title: string, platform: string, pricingResult: PricingResult | null = null) => {
    const manualBook = intakeItemType === 'book';
    const resolvedPlatform = platform.trim() || (manualBook ? 'Book' : extractPlatform(title) || '');
    const classification = manualBook
      ? { itemType: 'book', confidence: 90, reasoning: 'Manual book/media entry' }
      : classifyItem(title, '', '');
    const confidence = calculateConfidence({
      barcodeMatch: false,
      titleSimilarity: pricingResult?.status === 'success' ? 95 : 75,
      platformMatch: !!resolvedPlatform,
      itemTypeConfidence: classification.confidence,
      hasImage: false,
      hasPricing: pricingResult?.status === 'success',
      editionMatch: false,
    });

    const queueItem: QueueItem = {
      id: `manual-${Date.now()}`,
      barcode: '',
      status: 'awaiting_price',
      scannedAt: Date.now(),
      scanCount: 1,
      productName: title,
      result: {
        title,
        platform: resolvedPlatform,
        category: manualBook ? 'Books' : 'Manual Entry',
        classification,
        confidence,
        pricingResult,
      },
    };

    setQueue((prev) => [queueItem, ...prev]);
    setCurrentQueueItemForDialog(queueItem);
    setShowItemDialog(true);
    setManualSearchOpen(false);
    setManualTitle('');
    setManualPlatform('');
  }, [intakeItemType]);

  const handleManualTitleSubmit = async () => {
    if (!user) return;
    const title = manualTitle.trim();
    const platform = manualPlatform.trim();
    if (!title) return;

    setManualSearchDraft({ title, platform });
    setManualSearchOpen(true);
    setManualSearchLoading(true);
    setManualSearchResults([]);
    setManualSearchMessage('Searching by keyword...');

    if (intakeItemType === 'book') {
      setManualSearchLoading(false);
      setManualSearchMessage('No automated game matches are searched for book/media intake. Continue manually to add this item.');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const response = await fetch('/api/pricecharting-search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'search', title, platform: '' }),
      });
      const data = await response.json();
      if (!data?.success) throw new Error(data?.message || 'Search failed');

      const typedPlatform = platform.toLowerCase();
      const results = ((data.products || []) as ManualSearchResult[])
        .filter((item) => item.id && item.productName)
        .sort((a, b) => {
          if (!typedPlatform) return 0;
          const aMatch = a.consoleName.toLowerCase().includes(typedPlatform) ? 0 : 1;
          const bMatch = b.consoleName.toLowerCase().includes(typedPlatform) ? 0 : 1;
          return aMatch - bMatch;
        });

      setManualSearchResults(results);
      setManualSearchMessage(
        results.length > 0
          ? 'Choose the closest keyword match, or continue manually if none are right.'
          : 'No items found. Try fewer keywords, remove the platform, or continue manually.'
      );
    } catch (error) {
      setManualSearchResults([]);
      setManualSearchMessage(error instanceof Error ? error.message : 'No items found. Continue manually or try different keywords.');
    } finally {
      setManualSearchLoading(false);
    }
  };

  const continueManualSearchItem = useCallback(() => {
    const title = manualSearchDraft.title.trim();
    if (!title) return;
    openManualItemDialog(title, manualSearchDraft.platform, null);
  }, [manualSearchDraft, openManualItemDialog]);

  const selectManualSearchResult = useCallback(async (result: ManualSearchResult) => {
    setManualSearchLoading(true);
    setManualSearchMessage('Loading selected item prices...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const response = await fetch('/api/pricecharting-search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'details', id: result.id }),
      });
      const data = await response.json();
      if (!data?.success) throw new Error(data?.message || 'Could not load item prices');

      const details = data.product as ManualSearchDetails;
      const loosePrice = Number(details.prices?.loose || 0);
      const pricingResult: PricingResult = {
        status: 'success',
        data: {
          productName: details.productName || result.productName,
          console: details.consoleName || result.consoleName,
          loosePrice,
          cibPrice: Number(details.prices?.cib || 0),
          newPrice: Number(details.prices?.new || 0),
          gradedPrice: Number(details.prices?.graded || 0),
          pcProductId: details.id || result.id,
          matchedTitle: details.productName || result.productName,
          matchedPlatform: details.consoleName || result.consoleName,
          confidence: 90,
          strategy: 'manual_keyword_search',
        },
      };

      const title = details.productName || result.productName;
      const platform = details.consoleName || result.consoleName;
      const manualBook = intakeItemType === 'book';
      const classification = manualBook
        ? { itemType: 'book', confidence: 90, reasoning: 'Manual book/media entry' }
        : classifyItem(title, '', '');
      const confidence = calculateConfidence({
        barcodeMatch: false,
        titleSimilarity: 95,
        platformMatch: !!platform,
        itemTypeConfidence: classification.confidence,
        hasImage: false,
        hasPricing: true,
        editionMatch: false,
      });
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
          condition: 'Loose',
          category: 'Manual Entry',
          classification,
          confidence,
          pricingResult,
          suggestedAskingPrice: loosePrice,
        },
      };

      setQueue((prev) => [queueItem, ...prev]);
      setCurrentQueueItemForDialog(queueItem);
      setShowItemDialog(true);
      setManualSearchOpen(false);
      setManualTitle('');
      setManualPlatform('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load selected item');
      setManualSearchMessage(error instanceof Error ? error.message : 'Could not load selected item');
    } finally {
      setManualSearchLoading(false);
    }
  }, [intakeItemType]);

  const handleUndo = async () => {
    if (queue.length === 0 || !accountId || undoLock.current || queueBusy) return;
    const lastItem = queue[0];
    const saved = ['added', 'needs_review'].includes(lastItem.status);
    if (saved && !lastItem.inventoryItemId) { setUndoError('This saved item has no verified inventory ID. Open inventory to review it; no item was removed.'); return; }
    if (!window.confirm(saved
      ? `Remove the saved inventory record for "${lastItem.productName || lastItem.barcode}" (${lastItem.scanCount || 1} unit(s))? Lot-linked, sold or unavailable stock must be reviewed in Inventory instead.`
      : 'Remove the newest unsaved entry from this intake queue?')) return;
    undoLock.current = true; setUndoing(true); setUndoError('');
    try {
      if (saved && lastItem.inventoryItemId) await undoIntakeItem(accountId, lastItem.inventoryItemId);
      setQueue(prev => prev.filter(item => item.id !== lastItem.id));
      recentScansRef.current.delete(lastItem.barcode);
      toast.success(saved ? 'Newly added inventory item removed' : 'Unsaved queue entry removed');
    } catch (cause) {
      console.error('Intake undo:', cause);
      setUndoError('Undo could not be confirmed. The queue has been kept. Check Inventory before retrying; lot-linked, sold and unavailable items cannot be undone here.');
      toast.error('Could not undo this intake item');
    } finally { undoLock.current = false; setUndoing(false); }
  };

  const clearQueue = () => {
    if (queueBusy || undoing || !window.confirm('Clear this browser intake queue? Saved inventory stays in Inventory. Unsaved queue entries will be discarded.')) return;
    try {
      window.localStorage.removeItem(INTAKE_SESSION_KEY);
    } catch (cause) {
      console.error('Intake queue draft removal:', cause);
      setDraftError('The saved browser queue could not be removed. Nothing was cleared. Retry when browser storage is available.');
      return;
    }
    setQueue([]);
    setPendingBarcodes([]);
    recentScansRef.current.clear();
    setSavedIntakeAvailable(false);
    toast.success('Queue cleared; saved inventory is unchanged');
  };

  const discardDraft = () => {
    if (!window.confirm('Discard only this saved browser draft? Existing inventory will not be removed.')) return;
    try {
      window.localStorage.removeItem(INTAKE_SESSION_KEY);
      setDraftError(''); setDraftBlocked(false); setSavedIntakeAvailable(false);
    } catch (cause) { console.error('Discard intake draft:', cause); setDraftError('The draft could not be removed from browser storage. Retry when storage is available.'); }
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
      <div className="intake-workspace p-4 sm:p-7 space-y-6 max-w-6xl">
        <div className="catalog-workspace-header">
          <div><p className="brand-eyebrow">GREAT FINDS START HERE</p>
          <h1>A new chapter for every find.</h1>
          <p>Scan a barcode or enter a title. Confirm the details, connect the receiving lot, then hand each item off to preparation.</p></div>
        </div>
        <nav className="catalog-workflow-strip" aria-label="Intake workflow">
          <Link href="/business/shipping"><PackageCheck size={18}/><span><strong>Receive a shipment</strong><small>Create a receiving lot and record what you paid</small></span></Link>
          <Link href="/business/inventory"><Search size={18}/><span><strong>Review inventory</strong><small>Check saved finds, quantities and condition</small></span></Link>
          <Link href="/business/prep"><Layers size={18}/><span><strong>Prepare the next chapter</strong><small>Clean, test, document and rack</small></span></Link>
        </nav>
        {referenceLoading && <p role="status" className="text-sm text-muted-foreground">Loading receiving lots and employee choices…</p>}
        {referenceError && <section className="business-overview-message"><p role="alert">{referenceError}</p><Button variant="outline" onClick={loadReferences} disabled={referenceLoading || queueBusy}>Retry receiving data</Button></section>}
        {draftError && <section className="business-overview-message"><p role="alert">{draftError}</p>{draftBlocked ? <Button variant="outline" onClick={discardDraft}>Discard saved browser draft</Button> : <Button variant="outline" onClick={persistIntakeDraft}>Retry draft save</Button>}</section>}
        {undoError && <section className="business-overview-message"><p role="alert">{undoError}</p><Link className="underline" href="/business/inventory">Review inventory</Link></section>}

        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold">{intakeActive ? 'Lot Intake In Progress' : savedIntakeAvailable ? 'Saved Intake Available' : 'Start Intake'}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                For a lot purchase, select the receiving lot and leave individual cost blank for allocation. For one-off purchases, enter a unit cost when confirming.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-9 text-xs" onClick={startIntake} disabled={intakeUnavailable || queueBusy || undoing}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {intakeActive ? 'Intake active' : savedIntakeAvailable ? 'Continue Intake' : 'Start Intake'}
              </Button>
              {intakeActive && (
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={saveAndCloseIntake} disabled={queueBusy || undoing || draftBlocked}>
                  Save & Close
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
            {intakeSteps.map((step) => (
              <div
                key={step.label}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  step.complete
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/10 bg-card/70 text-muted-foreground'
                }`}
              >
                {step.complete && <CheckCircle2 className="h-3.5 w-3.5" />}
                {step.label}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">During active intake, drafts save only in this browser for the current staff member. Saved inventory is shared with the company. {queueBusy && 'Complete the current item before changing intake settings or closing this flow.'}</p>
        </div>

        <fieldset aria-label="Scan and manual intake" disabled={intakeUnavailable || queueBusy || undoing} className="grid min-w-0 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <span className="font-semibold text-[14px] tracking-tight">Camera Scanner</span>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="label-caps flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" />
                  Intake Type
                </Label>
                <Select value={intakeItemType} onValueChange={(value) => setIntakeItemType(value as IntakeItemType)}>
                  <SelectTrigger aria-label="Intake type" className="bg-secondary/40 h-9 rounded-lg text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="game">Games / Consoles</SelectItem>
                    <SelectItem value="book">Books / Manga</SelectItem>
                    <SelectItem value="mixed">Mixed Lot</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  Book mode skips PriceCharting and saves items for manual pricing.
                </p>
              </div>

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
                  aria-label="Batch mode"
                  checked={batchMode}
                  onCheckedChange={setBatchMode}
                />
              </div>

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
                  placeholder={intakeItemType === 'book' ? 'Enter ISBN / book barcode...' : 'Enter barcode...'}
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
                  aria-label={intakeItemType === 'book' ? 'Book title' : 'Game or item title'}
                  className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]"
                />
                <Input
                  value={manualPlatform}
                  aria-label="Platform or category"
                  onChange={(event) => setManualPlatform(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleManualTitleSubmit();
                  }}
                  placeholder={intakeItemType === 'book' ? 'Book, Manga, Comic...' : 'Platform, category, or system...'}
                  className="bg-secondary/40 border-border/60 h-9 rounded-lg text-[13px]"
                />
                <Button type="button" variant="outline" className="w-full h-9 rounded-lg text-[13px]" disabled={!manualTitle.trim()} onClick={handleManualTitleSubmit}>
                  Add Manual Search Item
                </Button>
              </div>
            </div>
          </div>
        </fieldset>
        {scannerActive && <BarcodeScannerView onScan={handleScan} isActive={scannerActive} onStop={() => setScannerActive(false)} variant="compact" title="Scan Intake" />}

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
                    <span>
                      {selectedLot.itemCount} row{selectedLot.itemCount === 1 ? '' : 's'} / {(selectedLot.unitCount || selectedLot.itemCount)} unit{(selectedLot.unitCount || selectedLot.itemCount) === 1 ? '' : 's'}
                    </span>
                    <span>FMV {formatCurrency(Number(selectedLot.totalMarketValue || selectedLot.total_market_value || 0))}</span>
                    {Number(selectedLot.allocation_ratio) > 0 && <span>COGS ratio {(Number(selectedLot.allocation_ratio) * 100).toFixed(1)}%</span>}
                  </div>
                </div>
              </div>
              <Button size="sm" className="h-9 text-xs" onClick={handleAllocateSelectedLot} disabled={allocatingLot || intakeUnavailable || queueBusy || undoing}>
                {allocatingLot ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1.5" />}
                Finalize Lot COGS
              </Button>
              <Button
                size="sm"
                variant={intakeCanFinish ? 'default' : 'outline'}
                className="h-9 text-xs"
                onClick={finishIntake}
                disabled={!intakeCanFinish || intakeUnavailable || queueBusy || undoing || allocatingLot}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Finished Intake
              </Button>
            </div>
          </div>
        )}

        {batchMode && pendingBarcodes.length > 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-primary/10 flex flex-wrap gap-3 items-center justify-between">
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
                  disabled={queueBusy || undoing}
                  className="h-8 text-[12px] text-muted-foreground"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={processBatch}
                  disabled={queueBusy || intakeUnavailable || undoing}
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

        {isProcessingBatch && <p role="status" className="text-sm">Batch in progress: confirm the current item to continue. Closing its dialog keeps it pending; use Confirm in the queue to reopen it.</p>}
        {queue.length > 0 && (
          <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border/40 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-3">
                <History className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-[14px]">Processing Queue</span>
                <Badge variant="secondary" className="text-xs">{queue.reduce((sum, item) => sum + Number(item.scanCount || 1), 0)}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={printCompletedGameLabels}
                  disabled={printableGameLabelIds.length === 0}
                  className="h-7 text-[12px]"
                >
                  <Printer className="w-3 h-3 mr-1.5" />
                  Print Labels {printableGameLabelIds.length > 0 ? `(${printableGameLabelIds.length})` : ''}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleUndo} disabled={queue.length === 0 || queueBusy || undoing || intakeUnavailable} className="h-7 text-[12px]">
                  <Undo2 className="w-3 h-3 mr-1.5" />
                  Undo
                </Button>
                <Button variant="ghost" size="sm" onClick={clearQueue} disabled={queueBusy || undoing} className="h-7 text-[12px] text-muted-foreground">
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Clear
                </Button>
              </div>
            </div>
            <div className="p-2">
              <div className="space-y-0.5">
                {queue.map((item) => (
                  <article aria-label={item.productName || item.barcode} key={item.id} className="flex flex-wrap gap-3 items-center justify-between px-3 py-2.5 rounded-lg hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {getStatusIcon(item.status)}
                      <div className="min-w-0">
                        {item.productName ? (
                          <div className="text-[13px] font-medium break-words">{item.inventoryItemId ? <Link className="underline underline-offset-4" href={`/business/inventory/${item.inventoryItemId}`}>{item.productName}</Link> : item.productName}</div>
                        ) : (
                          <div className="font-mono text-[12px] text-muted-foreground">{item.barcode}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5">
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
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {item.status === 'awaiting_price' && item.result && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          disabled={savingItem || intakeUnavailable || undoing}
                          onClick={() => {
                            setCurrentQueueItemForDialog(item);
                            setShowItemDialog(true);
                          }}
                        >
                          Confirm
                        </Button>
                      )}
                      {item.error && (
                        <p role="alert" className="text-xs leading-5 text-red-800 break-words">
                          {item.error}
                        </p>
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
                  </article>
                ))}
              </div>
            </div>
          </div>
        )}

        <Dialog open={manualSearchOpen} onOpenChange={setManualSearchOpen}>
          <DialogContent className="intake-dialog max-w-2xl bg-card border-border">
            <DialogHeader>
              <DialogTitle>Manual Search Results</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-border/40 bg-secondary/30 px-3 py-2">
                <div className="text-sm font-medium text-foreground">
                  {manualSearchDraft.title || 'Manual item'}
                </div>
                {manualSearchDraft.platform && (
                  <div className="mt-0.5 text-xs text-muted-foreground">Keyword platform: {manualSearchDraft.platform}</div>
                )}
              </div>

              <div className="text-sm text-muted-foreground">
                {manualSearchLoading ? 'Searching...' : manualSearchMessage}
              </div>

              {manualSearchResults.length > 0 && (
                <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                  {manualSearchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="w-full rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      onClick={() => selectManualSearchResult(result)}
                      disabled={manualSearchLoading}
                    >
                      <div className="text-sm font-semibold text-foreground">{result.productName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{result.consoleName || 'Unknown platform'}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setManualSearchOpen(false)} disabled={manualSearchLoading}>
                  Cancel
                </Button>
                <Button onClick={continueManualSearchItem} disabled={manualSearchLoading || !manualSearchDraft.title.trim()}>
                  Continue Manually
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <ScanItemDialog
          open={showItemDialog}
          onOpenChange={setShowItemDialog}
          onConfirm={handleItemConfirm}
          productName={currentQueueItemForDialog?.result?.title || currentQueueItemForDialog?.productName || ''}
          detectedConsole={detectedConsoleForDialog}
          duplicateMatches={currentQueueItemForDialog?.duplicateMatches || []}
          allowTitleEdit={Boolean(
            currentQueueItemForDialog?.result?.manualTitleRequired ||
            isBookLikeItem({
              ...currentQueueItemForDialog?.result,
              console: detectedConsoleForDialog || undefined,
            })
          )}
          bookMetadata={currentQueueItemForDialog?.result?.bookMetadata || null}
          suggestedAskingPrice={Number(currentQueueItemForDialog?.result?.suggestedAskingPrice || currentQueueItemForDialog?.result?.bookMetadata?.retailPrice) || undefined}
        />
      </div>
    </DashboardLayout>
  );
}
