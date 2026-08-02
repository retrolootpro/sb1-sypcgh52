'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, CreditCard, HandCoins, History, Package, Plus, ReceiptText, Search, ShoppingCart, Trash2, Undo2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { BarcodeScannerView } from '@/components/barcode-scanner-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth-context';
import type { ScanResult } from '@/lib/barcode-scanner';
import {
  backfillCompletedPosBuysIntoInventory,
  completeCustomerBuy,
  completePosSale,
  createPosCustomer,
  getRecentPosSales,
  getPosTaxSettings,
  searchPosCustomers,
  searchPosInventory,
  updatePosSaleStatus,
  type PosCartLine,
  type PosBuyItem,
  type PosCustomer,
  type PosInventoryItem,
  type PosSale,
  type PosTaxSettings,
} from '@/lib/pos-services';
import { supabase } from '@/lib/supabase';
import { inventoryLabelPrice } from '@/lib/label-pricing';
import { isCloverBridgeAvailable, requestCloverCardPayment, requestCloverCashDrawerOpen, requestCloverReceiptPrint } from '@/lib/clover-pos-bridge';

const uid = () => Math.random().toString(36).slice(2, 10);
const cents = (value: number) => Math.round((Number(value) || 0) * 100);
const fromCents = (value: number) => Number((value / 100).toFixed(2));
const currency = (value: number) => fromCents(cents(value));
const money = (value: number) => `$${currency(value).toFixed(2)}`;
const CASH_OFFER_RATE = 0.25;
const TRADE_OFFER_RATE = 0.4;
const RECOMMENDED_OFFER_RATE = (CASH_OFFER_RATE + TRADE_OFFER_RATE) / 2;
const CONDITION_RATING_MULTIPLIERS: Record<number, number> = {
  5: 1,
  4: 0.85,
  3: 0.65,
  2: 0.35,
  1: 0.1,
};

type TradeItem = PosBuyItem & {
  id: string;
  barcode?: string;
  lookup_status?: 'idle' | 'loading' | 'found' | 'missing' | 'error';
  search_results?: PriceChartingSearchResult[];
};

type PriceChartingSearchResult = {
  id: string;
  productName: string;
  consoleName: string;
};

type PriceChartingDetails = {
  id: string;
  productName: string;
  consoleName: string;
  prices: {
    loose: number;
    cib: number;
    new: number;
    graded: number;
    gamestop: number;
    gamestopTrade: number;
    retailLooseBuy: number;
    retailCibBuy: number;
    retailNewBuy: number;
  };
};

type LocalUpcLookupResult = {
  barcode: string;
  title: string;
  platform: string;
  pcProductId?: string;
};

type ScannerPurpose = 'sale' | 'trade';
type PosMode = 'sale' | 'buy' | 'customers' | 'history';

function bestMarketValue(pricecharting: number, gamestop: number) {
  return Math.max(Number(pricecharting || 0), Number(gamestop || 0));
}

function recommendedOffer(marketValue: number, quantity: number, rate: number) {
  return Number((Math.max(0, marketValue) * Math.max(1, quantity || 1) * rate).toFixed(2));
}

function conditionAdjustedOffer(marketValue: number, quantity: number, rate: number, rating: number) {
  const multiplier = CONDITION_RATING_MULTIPLIERS[Math.max(1, Math.min(5, Math.round(Number(rating || 5))))] ?? 1;
  return Number((recommendedOffer(marketValue, quantity, rate) * multiplier).toFixed(2));
}

function recommendedBuyOffer(marketValue: number, quantity: number, rating: number) {
  return conditionAdjustedOffer(marketValue, quantity, RECOMMENDED_OFFER_RATE, rating);
}

function offerPercent(offer: number, marketValue: number, quantity = 1) {
  const totalValue = Math.max(0, Number(marketValue || 0) * Math.max(1, Number(quantity || 1)));
  if (totalValue <= 0) return 0;
  return Number(((Number(offer || 0) / totalValue) * 100).toFixed(1));
}

function conditionRatingLabel(rating: number) {
  switch (Number(rating || 5)) {
    case 5: return '5 - flawless';
    case 4: return '4 - light wear';
    case 3: return '3 - average';
    case 2: return '2 - damaged';
    case 1: return '1 - parts/repair';
    default: return '5 - flawless';
  }
}

function baselinePriceChartingValue(details: PriceChartingDetails, condition: string) {
  const normalizedCondition = String(condition || '').toLowerCase();
  const looseValue = Number(details.prices.loose || 0);
  const cibValue = Number(details.prices.cib || 0);
  const newValue = Number(details.prices.new || 0);
  const gradedValue = Number(details.prices.graded || 0);
  const marketBaseline = normalizedCondition.includes('graded')
    ? gradedValue || newValue || cibValue || looseValue
    : normalizedCondition.includes('new') || normalizedCondition.includes('sealed')
      ? newValue || cibValue || looseValue
      : normalizedCondition.includes('cib') || normalizedCondition.includes('complete')
        ? cibValue || looseValue
        : looseValue || cibValue;
  const buyFallback = Math.max(
    Number(details.prices.retailLooseBuy || 0),
    Number(details.prices.retailCibBuy || 0),
    Number(details.prices.retailNewBuy || 0),
    Number(details.prices.gamestopTrade || 0)
  );

  return marketBaseline || buyFallback;
}

export default function PosPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<PosMode>('sale');
  const [inventory, setInventory] = useState<PosInventoryItem[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [recentSales, setRecentSales] = useState<PosSale[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [taxSettings, setTaxSettings] = useState<PosTaxSettings | null>(null);
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('amount');
  const [paymentMethod, setPaymentMethod] = useState<PosSale['payment_method']>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [creditToUse, setCreditToUse] = useState('');
  const [creditManualOverride, setCreditManualOverride] = useState(false);
  const [processorReference, setProcessorReference] = useState('');
  const [cloverAvailable, setCloverAvailable] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerPurpose, setScannerPurpose] = useState<ScannerPurpose>('sale');
  const [scanBuffer, setScanBuffer] = useState('');
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [tradeItems, setTradeItems] = useState<TradeItem[]>([]);
  const [tradeItemForm, setTradeItemForm] = useState({ barcode: '', title: '', platform: '', condition: 'Loose', conditionRating: '5', quantity: '1' });
  const [buyForm, setBuyForm] = useState({
    item_summary: '',
    offer_amount: '',
    payout_type: 'trade_credit' as 'cash' | 'trade_credit' | 'mixed',
    cash_paid: '',
    trade_credit_issued: '',
    notes: '',
  });

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [loading, router, user]);

  useEffect(() => {
    setCloverAvailable(isCloverBridgeAvailable());
  }, []);

  useEffect(() => {
    if (!user) return;
    loadInventory();
    loadCustomers();
    loadTaxSettings();
    loadRecentSales();
    backfillPosBuys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadInventory = async (search = inventorySearch) => {
    try {
      setInventory(await searchPosInventory(search));
    } catch (error: any) {
      toast.error(error.message || 'Failed to load inventory');
    }
  };

  const loadCustomers = async (search = customerSearch) => {
    try {
      setCustomers(await searchPosCustomers(search));
    } catch (error: any) {
      toast.error(error.message || 'Failed to load customers');
    }
  };

  const loadTaxSettings = async () => {
    try {
      setTaxSettings(await getPosTaxSettings());
    } catch (error: any) {
      toast.error(error.message || 'Failed to load POS tax settings');
    }
  };

  const loadRecentSales = async () => {
    try {
      setRecentSales(await getRecentPosSales(30));
    } catch (error: any) {
      toast.error(error.message || 'Failed to load POS history');
    }
  };

  const backfillPosBuys = async () => {
    try {
      const count = await backfillCompletedPosBuysIntoInventory();
      if (count > 0) {
        toast.success(`Added ${count} completed POS buy${count === 1 ? '' : 's'} to lots and inventory`);
        await loadInventory();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to backfill completed POS buys');
    }
  };

  const subtotal = useMemo(() => currency(cart.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)), [cart]);
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0), [cart]);
  const discountRaw = Math.max(0, Number(discount || 0));
  const discountAmount = currency(Math.min(discountType === 'percent' ? subtotal * Math.min(discountRaw, 100) / 100 : discountRaw, subtotal));
  const taxable = currency(Math.max(0, subtotal - discountAmount));
  const activeTaxRate = Math.max(0, Number(taxSettings?.default_tax_rate || 0));
  const taxAmount = currency(taxable * activeTaxRate);
  const total = currency(taxable + taxAmount);
  const creditUsed = currency(Math.min(Number(creditToUse || 0), selectedCustomer?.credit_balance || 0, total));
  const dueAfterCredit = currency(Math.max(0, total - creditUsed));
  const cashAmount = currency(Number(cashReceived || 0));
  const cardTenderAmount = currency(Number(cardAmount || 0));
  const tenderedAmount = paymentMethod === 'cash'
    ? cashAmount
    : paymentMethod === 'split'
      ? currency(cashAmount + cardTenderAmount)
      : dueAfterCredit;
  const changeDue = currency(Math.max(0, tenderedAmount - dueAfterCredit));
  const tradeMarketTotal = useMemo(
    () => tradeItems.reduce((sum, item) => sum + Number(item.market_value || 0) * Number(item.quantity || 1), 0),
    [tradeItems]
  );
  const tradeCashOfferTotal = useMemo(
    () => tradeItems.reduce((sum, item) => sum + Number(item.recommended_cash_offer || 0), 0),
    [tradeItems]
  );
  const tradeCreditOfferTotal = useMemo(
    () => tradeItems.reduce((sum, item) => sum + Number(item.recommended_trade_offer || 0), 0),
    [tradeItems]
  );
  const recommendedOfferTotal = useMemo(
    () => tradeItems.reduce((sum, item) => sum + Number(item.accepted_offer || 0), 0),
    [tradeItems]
  );
  const suggestedCashPercent = offerPercent(tradeCashOfferTotal, tradeMarketTotal);
  const suggestedTradePercent = offerPercent(tradeCreditOfferTotal, tradeMarketTotal);
  const registerStatus = mode === 'sale'
    ? cart.length > 0 ? 'Ready for checkout' : 'Scan or search items'
    : mode === 'buy'
      ? tradeItems.length > 0 ? 'Review trade offer' : 'Add trade items'
      : mode === 'history'
        ? 'Review transactions'
        : selectedCustomer ? 'Customer selected' : 'Find or create customer';

  const openCameraScanner = (purpose: ScannerPurpose) => {
    setScannerPurpose(purpose);
    setScannerActive(true);
  };

  const focusScanner = () => {
    setMode('sale');
    window.setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (!selectedCustomer) {
      setCreditToUse('');
      setCreditManualOverride(false);
      return;
    }
    if (!creditManualOverride) {
      setCreditToUse(Math.min(Number(selectedCustomer.credit_balance || 0), total).toFixed(2));
    }
  }, [creditManualOverride, selectedCustomer, total]);

  const addInventoryItem = (item: PosInventoryItem) => {
    if (cart.some((line) => line.inventory_item_id === item.id)) {
      toast.info('That inventory item is already in the cart');
      return;
    }
    setCart((current) => [...current, {
      id: uid(),
      source: 'inventory',
      inventory_item_id: item.id,
      item_name: item.title,
      platform: item.platform || '',
      quantity: 1,
      unit_price: inventoryLabelPrice(item),
    }]);
  };

  const scanUpcIntoCart = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;

    let matches = inventory.filter((item) => item.barcode && item.barcode.trim() === clean);
    if (matches.length === 0) {
      const fresh = await searchPosInventory(clean);
      matches = fresh.filter((item) => item.barcode && item.barcode.trim() === clean);
      if (matches.length === 0 && fresh.length === 1) matches = fresh;
    }

    if (matches.length === 0) {
      toast.error(`No inventory item found for UPC ${clean}`);
      return;
    }

    addInventoryItem(matches[0]);
    setScanBuffer('');
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  const handleCameraScan = (result: ScanResult) => {
    const code = result.barcode.trim();
    if (!code) return;

    if (scannerPurpose === 'trade') {
      setScannerActive(false);
      const quantity = Math.max(1, Number(tradeItemForm.quantity || 1));
      const newItem: TradeItem = {
        id: uid(),
        barcode: code,
        title: tradeItemForm.title.trim() || code,
        platform: tradeItemForm.platform.trim(),
        condition: tradeItemForm.condition,
        condition_rating: Number(tradeItemForm.conditionRating || 5),
        quantity,
        pricecharting_value: 0,
        gamestop_value: 0,
        market_value: 0,
        recommended_cash_offer: 0,
        recommended_trade_offer: 0,
        accepted_offer: 0,
        pricing_source: '',
        pricing_notes: '',
        lookup_status: 'idle',
      };
      setTradeItems((current) => [...current, newItem]);
      setTradeItemForm({ barcode: '', title: '', platform: '', condition: 'Loose', conditionRating: '5', quantity: '1' });
      window.setTimeout(() => lookupTradeItemByUpc(newItem), 0);
      return;
    }

    setScanBuffer(code);
    void scanUpcIntoCart(code);
  };

  const addManualItem = () => {
    if (!manualName.trim()) return toast.error('Enter an item name');
    setCart((current) => [...current, {
      id: uid(),
      source: 'manual',
      item_name: manualName.trim(),
      platform: 'Manual',
      quantity: 1,
      unit_price: Number(manualPrice || 0),
    }]);
    setManualName('');
    setManualPrice('');
  };

  const updateLine = (id: string, updates: Partial<PosCartLine>) => {
    setCart((current) => current.map((line) => line.id === id ? { ...line, ...updates } : line));
  };

  const addTradeItem = () => {
    const barcode = tradeItemForm.barcode.trim();
    const title = tradeItemForm.title.trim();
    if (!title && !barcode) {
      toast.error('Enter a trade item title or scan a UPC');
      return;
    }

    const quantity = Math.max(1, Number(tradeItemForm.quantity || 1));
    const newItem: TradeItem = {
      id: uid(),
      barcode,
      title: title || barcode,
      platform: tradeItemForm.platform.trim(),
      condition: tradeItemForm.condition,
      condition_rating: Number(tradeItemForm.conditionRating || 5),
      quantity,
      pricecharting_value: 0,
      gamestop_value: 0,
      market_value: 0,
      recommended_cash_offer: 0,
      recommended_trade_offer: 0,
      accepted_offer: 0,
      pricing_source: '',
      pricing_notes: '',
      lookup_status: 'idle',
    };
    setTradeItems((current) => [...current, newItem]);
    setTradeItemForm({ barcode: '', title: '', platform: '', condition: 'Loose', conditionRating: '5', quantity: '1' });
    window.setTimeout(() => {
      if (barcode) lookupTradeItemByUpc(newItem);
      else lookupTradeItemPricing(newItem);
    }, 0);
  };

  const updateTradeItem = (id: string, updates: Partial<TradeItem>) => {
    setTradeItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...updates };
      const marketValue = 'market_value' in updates
        ? Number(next.market_value || 0)
        : bestMarketValue(next.pricecharting_value, next.gamestop_value);
      const quantity = Math.max(1, Number(next.quantity || 1));
      if (
        'pricecharting_value' in updates ||
        'gamestop_value' in updates ||
        'market_value' in updates ||
        'quantity' in updates ||
        'condition' in updates ||
        'condition_rating' in updates
      ) {
        next.market_value = marketValue;
        next.recommended_cash_offer = conditionAdjustedOffer(marketValue, quantity, CASH_OFFER_RATE, Number(next.condition_rating || 5));
        next.recommended_trade_offer = conditionAdjustedOffer(marketValue, quantity, TRADE_OFFER_RATE, Number(next.condition_rating || 5));
        next.accepted_offer = recommendedBuyOffer(marketValue, quantity, Number(next.condition_rating || 5));
      }
      return next;
    }));
  };

  const applySuggestedOffer = (type: 'cash' | 'trade') => {
    const amount = type === 'cash' ? tradeCashOfferTotal : tradeCreditOfferTotal;
    setBuyForm((current) => ({
      ...current,
      offer_amount: amount.toFixed(2),
      payout_type: type === 'cash' ? 'cash' : 'trade_credit',
      cash_paid: type === 'cash' ? amount.toFixed(2) : '',
      trade_credit_issued: type === 'trade' ? amount.toFixed(2) : '',
    }));
  };

  const lookupTradeItemPricing = async (item: TradeItem) => {
    if (!item.title.trim()) return;
    updateTradeItem(item.id, { lookup_status: 'loading', search_results: [], pricing_notes: 'Searching PriceCharting...' });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const response = await fetch('/api/pricecharting-search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'search', title: item.title, platform: item.platform || '' }),
      });
      const data = await response.json();
      if (!data?.success) throw new Error(data?.message || 'PriceCharting search failed');

      const results = (data.products || []) as PriceChartingSearchResult[];
      if (results.length === 0) {
        updateTradeItem(item.id, { lookup_status: 'missing', pricing_notes: 'No PriceCharting matches found.' });
        toast.warning(`No PriceCharting matches for ${item.title}`);
        return;
      }

      updateTradeItem(item.id, {
        lookup_status: 'found',
        search_results: results,
        pricing_notes: results.length === 1 ? 'One match found. Tap it to confirm.' : `${results.length} matches found. Choose the exact item.`,
      });
      toast.success(`Found ${results.length} PriceCharting match${results.length === 1 ? '' : 'es'}`);
    } catch (error: any) {
      updateTradeItem(item.id, { lookup_status: 'error', pricing_notes: error.message || 'Lookup failed' });
      toast.error(error.message || 'Trade pricing lookup failed');
    }
  };

  const applyPriceChartingDetailsToTradeItem = (item: TradeItem, details: PriceChartingDetails, fallback?: Partial<PriceChartingSearchResult>) => {
    const pcValue = baselinePriceChartingValue(details, item.condition || 'Loose');
    const gamestopValue = Number(details.prices.gamestop || 0);
    const marketValue = bestMarketValue(pcValue, gamestopValue);
    const quantity = Math.max(1, Number(item.quantity || 1));

    updateTradeItem(item.id, {
      title: details.productName || fallback?.productName || item.title,
      platform: details.consoleName || fallback?.consoleName || item.platform,
      pricecharting_value: pcValue,
      gamestop_value: gamestopValue,
      market_value: marketValue,
      recommended_cash_offer: conditionAdjustedOffer(marketValue, quantity, CASH_OFFER_RATE, Number(item.condition_rating || 5)),
      recommended_trade_offer: conditionAdjustedOffer(marketValue, quantity, TRADE_OFFER_RATE, Number(item.condition_rating || 5)),
      accepted_offer: recommendedBuyOffer(marketValue, quantity, Number(item.condition_rating || 5)),
      pricing_source: [
        pcValue > 0 ? 'PriceCharting baseline' : '',
        gamestopValue > 0 ? 'GameStop via PriceCharting' : '',
      ].filter(Boolean).join(' + '),
      pricing_notes: marketValue > 0
        ? `Confirmed PriceCharting ID ${details.id}. Baseline value used; condition rating adjusts the offer.`
        : `Confirmed PriceCharting ID ${details.id}, but no baseline market value was returned.`,
      lookup_status: marketValue > 0 ? 'found' : 'missing',
      search_results: [],
    });
  };

  const lookupTradeItemByUpc = async (item: TradeItem) => {
    const barcode = String(item.barcode || '').trim();
    if (!barcode) {
      toast.error('Scan or enter a UPC first');
      return;
    }

    updateTradeItem(item.id, { lookup_status: 'loading', search_results: [], pricing_notes: `Looking up UPC ${barcode}...` });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const upcResponse = await fetch('/api/local-upc-lookup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ barcode, titleHint: item.title !== barcode ? item.title : undefined }),
      });
      const upcData = await upcResponse.json();
      if (!upcData?.success) throw new Error(upcData?.message || 'UPC lookup failed');

      const product = upcData as LocalUpcLookupResult;
      if (!product.pcProductId) {
        updateTradeItem(item.id, {
          title: product.title || item.title,
          platform: product.platform || item.platform,
          lookup_status: 'missing',
          pricing_notes: 'UPC matched metadata, but no PriceCharting product ID was returned.',
        });
        return;
      }

      const detailsResponse = await fetch('/api/pricecharting-search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'details', id: product.pcProductId }),
      });
      const detailsData = await detailsResponse.json();
      if (!detailsData?.success) throw new Error(detailsData?.message || 'Could not load PriceCharting item');

      applyPriceChartingDetailsToTradeItem(item, detailsData.product as PriceChartingDetails, {
        id: product.pcProductId,
        productName: product.title,
        consoleName: product.platform,
      });
      toast.success(`UPC matched ${product.title || item.title}`);
    } catch (error: any) {
      updateTradeItem(item.id, { lookup_status: 'error', pricing_notes: error.message || 'UPC lookup failed' });
      toast.error(error.message || 'Trade UPC lookup failed');
    }
  };

  const applyPriceChartingMatch = async (item: TradeItem, match: PriceChartingSearchResult) => {
    updateTradeItem(item.id, { lookup_status: 'loading', pricing_notes: `Loading ${match.productName} prices...` });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');

      const response = await fetch('/api/pricecharting-search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'details', id: match.id }),
      });
      const data = await response.json();
      if (!data?.success) throw new Error(data?.message || 'Could not load PriceCharting item');

      const details = data.product as PriceChartingDetails;
      applyPriceChartingDetailsToTradeItem(item, details, match);
      toast.success(`Applied ${details.productName || match.productName}`);
    } catch (error: any) {
      updateTradeItem(item.id, { lookup_status: 'error', pricing_notes: error.message || 'Could not apply PriceCharting match' });
      toast.error(error.message || 'Could not apply PriceCharting match');
    }
  };

  const handleCreateCustomer = async () => {
    if (!customerForm.name.trim()) {
      toast.error('Enter a customer name');
      return;
    }
    setSaving(true);
    try {
      const customer = await createPosCustomer(customerForm);
      setSelectedCustomer(customer);
      setCustomerForm({ name: '', phone: '', email: '', notes: '' });
      await loadCustomers('');
      toast.success('Customer created');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return toast.error('Add at least one item');
    const tenderedCents = cents(tenderedAmount);
    const dueCents = cents(dueAfterCredit);
    if ((paymentMethod === 'cash' || paymentMethod === 'split') && tenderedCents < dueCents) {
      return toast.error(`Cash received is below the amount due. Received ${money(tenderedAmount)} / Due ${money(dueAfterCredit)}`);
    }
    if ((paymentMethod === 'external_card' || paymentMethod === 'square' || paymentMethod === 'stripe' || paymentMethod === 'split') && !processorReference.trim()) {
      return toast.error('Enter the card machine reference number');
    }
    setSaving(true);
    try {
      let completedProcessorReference = processorReference.trim();
      if (paymentMethod === 'clover_card') {
        const externalId = `rlp-${Date.now()}-${uid()}`;
        toast.info('Sending payment to Clover...');
        const result = await requestCloverCardPayment({
          externalId,
          amountCents: Math.round(dueAfterCredit * 100),
          amount: dueAfterCredit,
          subtotal,
          discountAmount,
          taxAmount,
          taxRate: activeTaxRate,
          creditUsed,
          lines: cart.map((line) => ({
            name: line.item_name,
            quantity: line.quantity,
            unitPrice: line.unit_price,
          })),
        });

        if (!result.success) {
          throw new Error(result.message || result.reason || 'Clover payment was declined or cancelled.');
        }
        completedProcessorReference = result.reference || result.paymentId || result.externalId || externalId;
      }

      const sale = await completePosSale({
        customer_id: selectedCustomer?.id || null,
        lines: cart,
        discount_amount: discountAmount,
        tax_rate: activeTaxRate,
        tax_zip: taxSettings?.tax_zip || '',
        tax_source: taxSettings?.tax_source || '',
        payment_method: paymentMethod,
        trade_credit_used: creditUsed,
        cash_received: cashAmount,
        processor_reference: completedProcessorReference,
      });
      if (isCloverBridgeAvailable()) {
        requestCloverReceiptPrint({
          saleNumber: sale.sale_number,
          soldAt: sale.sold_at,
          lines: cart.map((line) => ({
            name: line.item_name,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            lineTotal: line.quantity * line.unit_price,
          })),
          subtotal,
          discountAmount,
          taxAmount,
          total,
          creditUsed,
          paymentMethod,
          processorReference: completedProcessorReference,
        });
        if (paymentMethod === 'cash' || paymentMethod === 'split') {
          requestCloverCashDrawerOpen();
        }
      }
      toast.success(`Sale complete: ${sale.sale_number}`);
      setCart([]);
      setDiscount('');
      setDiscountType('amount');
      setCreditToUse('');
      setCreditManualOverride(false);
      setCashReceived('');
      setCardAmount('');
      setProcessorReference('');
      setPaymentOpen(false);
      if (selectedCustomer) {
        setSelectedCustomer({
          ...selectedCustomer,
          credit_balance: Math.max(0, Number(selectedCustomer.credit_balance || 0) - creditUsed),
          lifetime_spend: Number(selectedCustomer.lifetime_spend || 0) + total,
        });
      }
      await Promise.all([loadInventory(), loadCustomers(), loadRecentSales()]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to complete sale');
    } finally {
      setSaving(false);
    }
  };

  const handleSaleAction = async (sale: PosSale, status: 'voided' | 'refunded') => {
    const action = status === 'refunded' ? 'refund' : 'void';
    if (!window.confirm(`Confirm ${action} for sale ${sale.sale_number}? This will reverse the finance entry and restore inventory items.`)) return;
    setSaving(true);
    try {
      await updatePosSaleStatus(sale.id, status);
      toast.success(`Sale ${sale.sale_number} marked ${status}`);
      await Promise.all([loadRecentSales(), loadInventory(), loadCustomers()]);
    } catch (error: any) {
      toast.error(error.message || `Failed to ${action} sale`);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteBuy = async () => {
    const itemSummary = tradeItems.length
      ? tradeItems.map((item) => `${item.quantity}x ${item.title}${item.platform ? ` (${item.platform})` : ''}`).join('; ')
      : buyForm.item_summary.trim();
    const offerAmount = Number(buyForm.offer_amount || 0) || recommendedOfferTotal;
    const cashPaid = Number(buyForm.cash_paid || 0) || (buyForm.payout_type === 'cash' ? offerAmount : 0);
    const tradeCreditIssued = Number(buyForm.trade_credit_issued || 0) || (buyForm.payout_type === 'trade_credit' ? offerAmount : 0);

    if (!itemSummary) return toast.error('Add at least one trade item or enter what the customer is selling/trading');
    if (!selectedCustomer && tradeCreditIssued > 0) return toast.error('Select or create a rewards customer before issuing trade credit');

    setSaving(true);
    try {
      const buy = await completeCustomerBuy({
        customer_id: selectedCustomer?.id || null,
        item_summary: itemSummary,
        items: tradeItems,
        offer_amount: offerAmount,
        payout_type: buyForm.payout_type,
        cash_paid: cashPaid,
        trade_credit_issued: tradeCreditIssued,
        notes: buyForm.notes,
      });
      toast.success(`Buy complete: ${buy.buy_number}`);
      setBuyForm({ item_summary: '', offer_amount: '', payout_type: 'trade_credit', cash_paid: '', trade_credit_issued: '', notes: '' });
      setTradeItems([]);
      if (selectedCustomer && tradeCreditIssued > 0) {
        setSelectedCustomer({
          ...selectedCustomer,
          credit_balance: Number(selectedCustomer.credit_balance || 0) + tradeCreditIssued,
        });
      }
      await Promise.all([loadCustomers(), loadInventory()]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to complete buy');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-white">Loading POS...</div>;
  }

  return (
    <div className="pos-register h-[100dvh] overflow-hidden bg-background text-[17px] text-foreground dark:bg-[radial-gradient(circle_at_top_left,hsl(148_100%_50%/0.12),transparent_34%),linear-gradient(180deg,#080908,#020403)] dark:text-white">
      <header className="h-[82px] border-b border-white/[0.08] bg-black/70 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="flex h-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" className="h-12 w-12 rounded-2xl border-white/10 bg-white/[0.04] text-white hover:bg-white/10">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">Live Register</div>
              <div className="text-xl font-semibold tracking-tight">RetroLootPro POS</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <div className="[&_button]:h-12 [&_button]:w-12">
              <ThemeToggle compact />
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-[20px] border border-white/[0.08] bg-white/[0.045] p-1 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)] sm:w-auto sm:flex-none">
              <ModeButton active={mode === 'sale'} icon={ShoppingCart} label="Sell" onClick={() => setMode('sale')} />
              <ModeButton active={mode === 'buy'} icon={HandCoins} label="Buy / Trade" onClick={() => setMode('buy')} />
              <ModeButton active={mode === 'customers'} icon={Users} label="Customers" onClick={() => setMode('customers')} />
              <ModeButton active={mode === 'history'} icon={History} label="History" onClick={() => {
                setMode('history');
                loadRecentSales();
              }} />
            </div>
          </div>
        </div>
      </header>

      <main className="grid h-[calc(100dvh-82px)] min-h-0 gap-4 overflow-hidden p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,440px)]">
        <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-auto pr-1 xl:overflow-hidden">
          <RegisterStatusStrip
            mode={mode}
            status={registerStatus}
            customerLabel={selectedCustomer?.name || 'Walk-in customer'}
            customerCredit={selectedCustomer?.credit_balance || 0}
            itemCount={mode === 'buy' ? tradeItems.length : cartItemCount}
            due={mode === 'buy' ? recommendedOfferTotal : dueAfterCredit}
            onScan={focusScanner}
            onCustomer={() => setMode('customers')}
            onTrade={() => setMode('buy')}
            onCameraScan={() => openCameraScanner(mode === 'buy' ? 'trade' : 'sale')}
            onCheckout={() => setPaymentOpen(true)}
            checkoutDisabled={cart.length === 0}
          />

          {mode === 'sale' && (
            <div className="grid min-h-0 flex-1 gap-3 2xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,.88fr)]">
              <div className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-4 shadow-[0_24px_80px_-64px_hsl(148_100%_50%/0.45)]">
                <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Package className="h-5 w-5 text-primary" />
                  Scan / Inventory
                </div>
                <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <Input
                    ref={scanInputRef}
                    className="h-14 rounded-2xl border-primary/30 bg-black/45 text-lg"
                    value={scanBuffer}
                    onChange={(event) => setScanBuffer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') scanUpcIntoCart(scanBuffer);
                    }}
                    placeholder="Continuous UPC scan..."
                  />
                  <Button className="h-14 rounded-2xl px-6 text-lg" variant="outline" onClick={() => openCameraScanner('sale')}>
                    <Camera className="mr-2 h-5 w-5" />
                    Camera
                  </Button>
                  <Button className="h-14 rounded-2xl px-6 text-lg" onClick={() => scanUpcIntoCart(scanBuffer)}>Add UPC</Button>
                </div>
                <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <Input className="h-14 rounded-2xl border-white/10 bg-black/45 pl-9 text-lg" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search inventory..." />
                  </div>
                  <Button className="h-14 rounded-2xl px-6 text-lg" variant="outline" onClick={() => loadInventory()}>Search</Button>
                </div>
                <div className="grid min-h-0 flex-1 gap-2 overflow-auto pr-1">
                  {inventory.map((item) => (
                    <button key={item.id} onClick={() => addInventoryItem(item)} className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-3 text-left transition hover:border-primary/35 hover:bg-primary/10">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                        {item.thumbnail_url || item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnail_url || item.image_url || ''} alt="" className="h-full w-full object-cover" />
                        ) : <Package className="h-6 w-6 text-white/30" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-semibold">{item.title}</div>
                        <div className="text-sm text-white/50">{item.platform || 'No platform'} - {item.condition || 'No condition'}</div>
                      </div>
                      <div className="text-right text-lg font-bold text-primary">{money(inventoryLabelPrice(item))}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Plus className="h-5 w-5 text-primary" />
                  Manual Item
                </div>
                <div className="grid gap-3">
                  <Input className="h-14 rounded-2xl border-white/10 bg-black/45 text-lg" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Manual item, service, or misc sale" />
                  <Input className="h-14 rounded-2xl border-white/10 bg-black/45 text-lg" type="number" min="0" step="0.01" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="Price" />
                  <Button className="h-14 rounded-2xl text-lg" onClick={addManualItem}>Add Manual Item</Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                  <button type="button" onClick={() => openCameraScanner('sale')} className="rounded-2xl border border-white/[0.08] bg-black/25 p-4 text-left transition hover:border-primary/35 hover:bg-primary/10">
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <Camera className="h-5 w-5 text-primary" />
                      Camera UPC
                    </div>
                    <div className="mt-2 text-2xl font-bold text-primary">Scan</div>
                  </button>
                  <button type="button" onClick={() => setMode('customers')} className="rounded-2xl border border-white/[0.08] bg-black/25 p-4 text-left transition hover:border-primary/35 hover:bg-primary/10">
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <Users className="h-5 w-5 text-primary" />
                      Rewards
                    </div>
                    <div className="mt-2 text-2xl font-bold text-primary">{selectedCustomer ? 'Active' : 'Select'}</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'buy' && (
            <div className="min-h-0 flex-1 overflow-auto rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-5 shadow-[0_24px_80px_-64px_hsl(148_100%_50%/0.45)]">
              <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <HandCoins className="h-5 w-5 text-primary" />
                Buy From Customer / Trade Credit
              </div>
              <div className="grid gap-4">
                <div className="grid gap-3 rounded-[22px] border border-white/[0.08] bg-black/25 p-4 2xl:grid-cols-[.85fr_1.2fr_.7fr_.6fr_.75fr_.35fr_auto_auto]">
                  <div>
                    <Label>UPC</Label>
                    <Input
                      className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 font-mono text-lg"
                      value={tradeItemForm.barcode}
                      onChange={(event) => setTradeItemForm({ ...tradeItemForm, barcode: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addTradeItem();
                      }}
                      placeholder="Scan UPC"
                    />
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" value={tradeItemForm.title} onChange={(event) => setTradeItemForm({ ...tradeItemForm, title: event.target.value })} placeholder="Mario Party 8" />
                  </div>
                  <div>
                    <Label>Platform</Label>
                    <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" value={tradeItemForm.platform} onChange={(event) => setTradeItemForm({ ...tradeItemForm, platform: event.target.value })} placeholder="Wii" />
                  </div>
                  <div>
                    <Label>Condition</Label>
                    <Select value={tradeItemForm.condition} onValueChange={(value) => setTradeItemForm({ ...tradeItemForm, condition: value })}>
                      <SelectTrigger className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Loose">Loose</SelectItem>
                        <SelectItem value="CIB">CIB</SelectItem>
                        <SelectItem value="New">New</SelectItem>
                        <SelectItem value="Sealed">Sealed</SelectItem>
                        <SelectItem value="Graded">Graded</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Rating</Label>
                    <Select value={tradeItemForm.conditionRating} onValueChange={(value) => setTradeItemForm({ ...tradeItemForm, conditionRating: value })}>
                      <SelectTrigger className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[5, 4, 3, 2, 1].map((rating) => (
                          <SelectItem key={rating} value={String(rating)}>{conditionRatingLabel(rating)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qty</Label>
                    <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" type="number" min="1" step="1" value={tradeItemForm.quantity} onChange={(event) => setTradeItemForm({ ...tradeItemForm, quantity: event.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button className="h-14 w-full rounded-2xl px-5 text-lg" variant="outline" onClick={() => openCameraScanner('trade')}>
                      <Camera className="mr-2 h-5 w-5" />
                      Scan
                    </Button>
                  </div>
                  <div className="flex items-end">
                    <Button className="h-14 w-full rounded-2xl px-6 text-lg" onClick={addTradeItem}>Add</Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  {tradeItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45">
                      Add each item in the customer trade. PriceCharting and GameStop values will show per line after lookup.
                    </div>
                  ) : tradeItems.map((item) => (
                    <div key={item.id} className="rounded-[22px] border border-white/[0.08] bg-black/25 p-4">
                      <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <Label>UPC</Label>
                          <Input
                            className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 font-mono text-base"
                            value={item.barcode || ''}
                            onChange={(event) => updateTradeItem(item.id, { barcode: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') lookupTradeItemByUpc({ ...item, barcode: (event.target as HTMLInputElement).value });
                            }}
                            placeholder="Scan or enter UPC"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            className="h-12 rounded-xl px-5 text-base"
                            variant="outline"
                            onClick={() => lookupTradeItemByUpc(item)}
                            disabled={item.lookup_status === 'loading' || !item.barcode?.trim()}
                          >
                            Lookup UPC
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 2xl:grid-cols-[1.2fr_.65fr_.55fr_.75fr_.4fr_.6fr_.6fr_.6fr_.6fr_auto]">
                        <div>
                          <Label>Item</Label>
                          <Input className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 text-base" value={item.title} onChange={(event) => updateTradeItem(item.id, { title: event.target.value })} />
                        </div>
                        <div>
                          <Label>Platform</Label>
                          <Input className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 text-base" value={item.platform || ''} onChange={(event) => updateTradeItem(item.id, { platform: event.target.value })} />
                        </div>
                        <div>
                          <Label>Condition</Label>
                          <Select value={item.condition || 'Loose'} onValueChange={(value) => updateTradeItem(item.id, { condition: value })}>
                            <SelectTrigger className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 text-base"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Loose">Loose</SelectItem>
                              <SelectItem value="CIB">CIB</SelectItem>
                              <SelectItem value="New">New</SelectItem>
                              <SelectItem value="Sealed">Sealed</SelectItem>
                              <SelectItem value="Graded">Graded</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Rating</Label>
                          <Select value={String(item.condition_rating || 5)} onValueChange={(value) => updateTradeItem(item.id, { condition_rating: Number(value) } as Partial<TradeItem>)}>
                            <SelectTrigger className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 text-base"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[5, 4, 3, 2, 1].map((rating) => (
                                <SelectItem key={rating} value={String(rating)}>{conditionRatingLabel(rating)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Qty</Label>
                          <Input className="mt-2 h-12 rounded-xl border-white/10 bg-black/45 text-base" type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateTradeItem(item.id, { quantity: Number(event.target.value || 1) })} />
                        </div>
                        <TradeMoneyInput label="PriceCharting" value={item.pricecharting_value} onChange={(value) => updateTradeItem(item.id, { pricecharting_value: value })} />
                        <TradeMoneyInput label="GameStop" value={item.gamestop_value} onChange={(value) => updateTradeItem(item.id, { gamestop_value: value })} />
                        <TradeMoneyInput label="Market" value={item.market_value} onChange={(value) => updateTradeItem(item.id, { market_value: value })} />
                        <TradeMoneyInput label="Recommended" value={item.accepted_offer} onChange={(value) => updateTradeItem(item.id, { accepted_offer: value })} />
                        <div className="flex items-end gap-2">
                          <Button className="h-12 rounded-xl px-5 text-base" variant="outline" onClick={() => lookupTradeItemPricing(item)} disabled={item.lookup_status === 'loading'}>
                            {item.lookup_status === 'loading' ? 'Pricing...' : 'Price'}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-12 w-12 text-white/45" onClick={() => setTradeItems((current) => current.filter((tradeItem) => tradeItem.id !== item.id))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/50">
                        <span>Cash offer ({offerPercent(item.recommended_cash_offer, item.market_value, item.quantity)}%): <b className="text-white">{money(item.recommended_cash_offer)}</b></span>
                        <span>Trade offer ({offerPercent(item.recommended_trade_offer, item.market_value, item.quantity)}%): <b className="text-primary">{money(item.recommended_trade_offer)}</b></span>
                        <span>{item.pricing_source || 'No source yet'}</span>
                        {item.pricing_notes && <span className="text-amber-200">{item.pricing_notes}</span>}
                      </div>
                      {item.search_results && item.search_results.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {item.search_results.map((match) => (
                            <button
                              key={match.id}
                              onClick={() => applyPriceChartingMatch(item, match)}
                              className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-left transition hover:border-primary hover:bg-primary/20"
                            >
                              <div className="text-base font-semibold text-white">{match.productName}</div>
                              <div className="mt-1 text-sm text-white/50">{match.consoleName} - PC ID {match.id}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 2xl:grid-cols-[1fr_440px]">
                  <div className="space-y-3">
                    <Label>Fallback Item Summary</Label>
                    <Textarea className="min-h-24 rounded-2xl border-white/10 bg-black/45 text-base" value={buyForm.item_summary} onChange={(event) => setBuyForm({ ...buyForm, item_summary: event.target.value })} placeholder="Use only if you do not want to itemize the trade." />
                    <Label>Notes</Label>
                    <Textarea className="min-h-24 rounded-2xl border-white/10 bg-black/45" value={buyForm.notes} onChange={(event) => setBuyForm({ ...buyForm, notes: event.target.value })} placeholder="Condition, ID check, testing notes..." />
                  </div>
                  <div className="space-y-3 rounded-[22px] border border-primary/20 bg-primary/[0.055] p-4">
                    <TotalsRow label="Total Market Value" value={tradeMarketTotal} large />
                    <TotalsRow label={`Suggested Cash (${suggestedCashPercent}%)`} value={tradeCashOfferTotal} />
                    <TotalsRow label={`Suggested Trade (${suggestedTradePercent}%)`} value={tradeCreditOfferTotal} />
                    <TotalsRow label={`Recommended Offer (${offerPercent(recommendedOfferTotal, tradeMarketTotal)}%)`} value={recommendedOfferTotal} large />
                    <div className="grid grid-cols-2 gap-2">
                      <Button className="h-11 rounded-xl" variant="outline" onClick={() => applySuggestedOffer('cash')}>Use Cash Offer</Button>
                      <Button className="h-11 rounded-xl" onClick={() => applySuggestedOffer('trade')}>Use Trade Offer</Button>
                    </div>
                    <Label>Offer Amount</Label>
                    <Input className="h-14 rounded-2xl border-white/10 bg-black/45 text-lg" type="number" min="0" step="0.01" value={buyForm.offer_amount} onChange={(event) => setBuyForm({ ...buyForm, offer_amount: event.target.value })} />
                    <Button
                      className="h-12 w-full rounded-2xl text-base"
                      variant="outline"
                      onClick={() => setBuyForm((current) => ({
                        ...current,
                        offer_amount: recommendedOfferTotal.toFixed(2),
                        cash_paid: current.payout_type === 'cash' ? recommendedOfferTotal.toFixed(2) : '',
                        trade_credit_issued: current.payout_type !== 'cash' ? recommendedOfferTotal.toFixed(2) : '',
                      }))}
                      disabled={recommendedOfferTotal <= 0}
                    >
                      Use Recommended Offer
                    </Button>
                    <Label>Payout Type</Label>
                    <Select
                      value={buyForm.payout_type}
                      onValueChange={(value: 'cash' | 'trade_credit' | 'mixed') => {
                        setBuyForm({
                          ...buyForm,
                          payout_type: value,
                          cash_paid: value === 'cash' ? buyForm.offer_amount : '',
                          trade_credit_issued: value !== 'cash' ? buyForm.offer_amount : '',
                        });
                      }}
                    >
                      <SelectTrigger className="h-14 rounded-2xl border-white/10 bg-black/45 text-lg"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="trade_credit">Trade Credit</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Cash Paid</Label>
                        <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" type="number" min="0" step="0.01" value={buyForm.cash_paid} onChange={(event) => setBuyForm({ ...buyForm, cash_paid: event.target.value })} />
                      </div>
                      <div>
                        <Label>Trade Credit</Label>
                        <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" type="number" min="0" step="0.01" value={buyForm.trade_credit_issued} onChange={(event) => setBuyForm({ ...buyForm, trade_credit_issued: event.target.value })} />
                      </div>
                    </div>
                    <Button className="h-16 w-full rounded-2xl text-xl" onClick={handleCompleteBuy} disabled={saving}>Complete Buy</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === 'customers' && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-5 shadow-[0_24px_80px_-64px_hsl(148_100%_50%/0.45)]">
              <CustomerPanel
                customers={customers}
                selectedCustomer={selectedCustomer}
                customerSearch={customerSearch}
                setCustomerSearch={setCustomerSearch}
                setSelectedCustomer={setSelectedCustomer}
                loadCustomers={loadCustomers}
                customerForm={customerForm}
                setCustomerForm={setCustomerForm}
                handleCreateCustomer={handleCreateCustomer}
                saving={saving}
              />
            </div>
          )}

          {mode === 'history' && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-5 shadow-[0_24px_80px_-64px_hsl(148_100%_50%/0.45)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <History className="h-5 w-5 text-primary" />
                    POS Transactions
                  </div>
                  <div className="mt-1 text-sm text-white/50">Refund, void, reprint, or open the drawer from recent register activity.</div>
                </div>
                <div className="flex gap-2">
                  <Button className="h-11 text-base" variant="outline" onClick={() => requestCloverCashDrawerOpen()} disabled={!cloverAvailable}>
                    Open Drawer
                  </Button>
                  <Button className="h-11 text-base" variant="outline" onClick={loadRecentSales}>Refresh</Button>
                </div>
              </div>
              <div className="grid max-h-full gap-3 overflow-auto pr-1">
                {recentSales.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45">
                    No POS transactions found yet.
                  </div>
                ) : recentSales.map((sale) => (
                  <div key={sale.id} className="rounded-[22px] border border-white/[0.08] bg-black/25 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">{sale.sale_number}</div>
                        <div className="mt-1 text-sm text-white/50">
                          {new Date(sale.sold_at).toLocaleString()} - {sale.payment_method.replace(/_/g, ' ')}
                          {sale.processor_reference ? ` - Ref ${sale.processor_reference}` : ''}
                        </div>
                        <div className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-1 text-xs uppercase tracking-wide text-white/60">
                          {sale.status}
                        </div>
                        {sale.pos_sale_items && sale.pos_sale_items.length > 0 && (
                          <div className="mt-2 text-sm text-white/45">
                            {sale.pos_sale_items.slice(0, 3).map((item) => `${item.quantity}x ${item.item_name}`).join(', ')}
                            {sale.pos_sale_items.length > 3 ? ` +${sale.pos_sale_items.length - 3} more` : ''}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{money(Number(sale.total_amount || 0))}</div>
                        <div className="text-sm text-white/50">Tax {money(Number(sale.tax_amount || 0))}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <Button
                        className="h-12 text-base"
                        variant="outline"
                        onClick={() => requestCloverReceiptPrint({
                          saleNumber: sale.sale_number,
                          soldAt: sale.sold_at,
                          lines: (sale.pos_sale_items || []).map((item) => ({
                            name: item.item_name,
                            quantity: item.quantity,
                            unitPrice: Number(item.unit_price || 0),
                            lineTotal: Number(item.line_total || 0),
                          })),
                          subtotal: Number(sale.subtotal || 0),
                          discountAmount: Number(sale.discount_amount || 0),
                          taxAmount: Number(sale.tax_amount || 0),
                          total: Number(sale.total_amount || 0),
                          creditUsed: Number(sale.trade_credit_used || 0),
                          paymentMethod: sale.payment_method,
                          processorReference: sale.processor_reference,
                        })}
                        disabled={!cloverAvailable}
                      >
                        <ReceiptText className="mr-2 h-4 w-4" />
                        Reprint
                      </Button>
                      <Button
                        className="h-12 text-base"
                        variant="outline"
                        onClick={() => handleSaleAction(sale, 'voided')}
                        disabled={saving || sale.status !== 'completed'}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Void
                      </Button>
                      <Button
                        className="h-12 text-base"
                        variant="outline"
                        onClick={() => handleSaleAction(sale, 'refunded')}
                        disabled={saving || sale.status !== 'completed'}
                      >
                        Refund
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 min-w-0 flex-col rounded-[28px] border border-white/[0.08] bg-black/72 p-4 shadow-[0_30px_90px_-70px_hsl(148_100%_50%/0.55)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Current Sale</div>
              <div className="text-xl font-semibold tracking-tight">Receipt Cart</div>
            </div>
            <Button className="rounded-xl px-4 text-base" style={{ minHeight: 44 }} variant="outline" size="sm" onClick={() => setCart([])}>Clear</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-visible pr-1 font-mono xl:overflow-auto">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center font-sans text-white/40">No sale items yet.</div>
            ) : cart.map((line) => (
              <div key={line.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{line.item_name}</div>
                    <div className="text-sm text-white/45">{line.platform || line.source}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-white/40" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-[68px_1fr_96px] items-center gap-2">
                  <Input className="h-11 rounded-xl border-white/10 bg-black/45 px-2 text-base" type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value || 1) })} disabled={line.source === 'inventory'} />
                  <Input className="h-11 rounded-xl border-white/10 bg-black/45 px-2 text-base" type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => updateLine(line.id, { unit_price: Number(event.target.value || 0) })} />
                  <div className="text-right text-base font-semibold">{money(line.quantity * line.unit_price)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2 border-t border-white/[0.08] pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-sm">Discount</Label>
                <div className="mt-1 grid grid-cols-[80px_1fr] gap-2">
                  <Select value={discountType} onValueChange={(value: 'percent' | 'amount') => setDiscountType(value)}>
                    <SelectTrigger className="h-12 rounded-xl border-white/10 bg-black/45 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="amount">$</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    {discountType === 'amount' && (
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45">$</span>
                    )}
                    <Input
                      className={`h-12 rounded-xl border-white/10 bg-black/45 text-base ${discountType === 'amount' ? 'pl-7' : ''}`}
                      type="number"
                      min="0"
                      max={discountType === 'percent' ? 100 : undefined}
                      step="0.01"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                      placeholder={discountType === 'percent' ? '10' : '5.00'}
                    />
                    {discountType === 'percent' && (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/45">%</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-black/35 p-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">Tax</Label>
                  <span className="text-sm font-semibold text-primary">{(activeTaxRate * 100).toFixed(3)}%</span>
                </div>
                <div className="mt-1 truncate text-xs text-white/50">
                  {taxSettings?.tax_zip ? `ZIP ${taxSettings.tax_zip}` : 'No ZIP set'} {taxSettings?.tax_source ? `- ${taxSettings.tax_source}` : '- admin setting'}
                </div>
              </div>
            </div>
            <TotalsRow label="Subtotal" value={subtotal} />
            <TotalsRow label="Discount" value={-discountAmount} />
            <TotalsRow label="Tax" value={taxAmount} />
            <TotalsRow label="Total" value={total} large />

            {selectedCustomer && selectedCustomer.credit_balance > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.055] p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label className="text-sm">Customer Credit</Label>
                  <div className="text-sm text-primary">{money(selectedCustomer.credit_balance)} available</div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    className="h-12 rounded-xl border-white/10 bg-black/45 text-base"
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditToUse}
                    onChange={(event) => {
                      setCreditManualOverride(true);
                      setCreditToUse(event.target.value);
                    }}
                    placeholder={`Available ${money(selectedCustomer.credit_balance)}`}
                  />
                  <Button
                    className="h-12 rounded-xl px-4 text-base"
                    variant="outline"
                    onClick={() => {
                      setCreditManualOverride(false);
                      setCreditToUse(Math.min(Number(selectedCustomer.credit_balance || 0), total).toFixed(2));
                    }}
                  >
                    Use All
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {[5, 10, 15].map((percent) => (
                    <Button
                      key={percent}
                      className="h-11 rounded-xl text-sm"
                      variant="outline"
                      onClick={() => {
                        setDiscountType('percent');
                        setDiscount(String(percent));
                      }}
                    >
                      {percent}% Reward
                    </Button>
                  ))}
                  <Button
                    className="h-11 rounded-xl text-sm"
                    variant="outline"
                    onClick={() => {
                      setDiscount('');
                      setDiscountType('amount');
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            <TotalsRow label="Due after credit" value={dueAfterCredit} large />
            <Button className="h-16 w-full rounded-2xl text-xl shadow-[0_16px_40px_-24px_hsl(148_100%_50%/0.9)]" disabled={saving || cart.length === 0} onClick={() => setPaymentOpen(true)}>
              <CreditCard className="mr-2 h-5 w-5" />
              Checkout
            </Button>
          </div>
        </aside>
      </main>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-lg rounded-[28px] border-white/[0.08] bg-neutral-950 text-white">
          <DialogHeader>
            <DialogTitle>Complete Sale</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-black/45 p-4">
              <TotalsRow label="Total Due" value={dueAfterCredit} large />
              <TotalsRow label="Tendered" value={tenderedAmount} />
              <TotalsRow label="Change Due" value={changeDue} large />
            </div>
            <div>
              <Label>Tender</Label>
              <Select value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
                <SelectTrigger className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="clover_card">Card - Clover</SelectItem>
                  <SelectItem value="square">Card - Square</SelectItem>
                  <SelectItem value="stripe">Card - Stripe</SelectItem>
                  <SelectItem value="external_card">Card - Other</SelectItem>
                  <SelectItem value="split">Cash + Card</SelectItem>
                </SelectContent>
              </Select>
              {paymentMethod === 'clover_card' && (
                <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                  {cloverAvailable ? 'Ready to send payment to the Clover Duo.' : 'Open this screen from the Clover Android app to use Clover card processing.'}
                </div>
              )}
            </div>
            {(paymentMethod === 'cash' || paymentMethod === 'split') && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label>Cash Received</Label>
                  <Button
                    type="button"
                    className="h-9 rounded-xl px-3 text-sm"
                    variant="outline"
                    onClick={() => setCashReceived(dueAfterCredit.toFixed(2))}
                  >
                    Exact Cash
                  </Button>
                </div>
                <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-xl" type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} />
              </div>
            )}
            {paymentMethod === 'split' && (
              <div>
                <Label>Card Amount</Label>
                <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-xl" type="number" min="0" step="0.01" value={cardAmount} onChange={(event) => setCardAmount(event.target.value)} />
              </div>
            )}
            {(paymentMethod === 'external_card' || paymentMethod === 'square' || paymentMethod === 'stripe' || paymentMethod === 'split') && (
              <div>
                <Label>Card Machine Reference</Label>
                <Input className="mt-2 h-14 rounded-2xl border-white/10 bg-black/45 text-lg" value={processorReference} onChange={(event) => setProcessorReference(event.target.value)} placeholder="Receipt / auth / batch reference" />
              </div>
            )}
            <Button className="h-16 w-full rounded-2xl text-xl" disabled={saving || cart.length === 0} onClick={handleCompleteSale}>
              OK - Complete Sale
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BarcodeScannerView
        isActive={scannerActive}
        onScan={handleCameraScan}
        onStop={() => setScannerActive(false)}
        variant="compact"
        title={scannerPurpose === 'trade' ? 'Scan trade UPC' : 'Scan sale UPC'}
      />
    </div>
  );
}

function RegisterStatusStrip(props: {
  mode: PosMode;
  status: string;
  customerLabel: string;
  customerCredit: number;
  itemCount: number;
  due: number;
  onScan: () => void;
  onCustomer: () => void;
  onTrade: () => void;
  onCameraScan: () => void;
  onCheckout: () => void;
  checkoutDisabled: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.045] p-3 shadow-[0_24px_80px_-64px_hsl(148_100%_50%/0.45)]">
      <div className="grid gap-2 md:grid-cols-4">
        <RegisterMetric label="Register" value={props.status} detail={props.mode === 'sale' ? 'Sell mode' : props.mode === 'buy' ? 'Buy / trade' : props.mode === 'history' ? 'History' : 'Rewards'} />
        <RegisterMetric label="Customer" value={props.customerLabel} detail={`Credit ${money(props.customerCredit)}`} />
        <RegisterMetric label={props.mode === 'buy' ? 'Trade lines' : 'Cart items'} value={String(props.itemCount)} detail={props.itemCount === 1 ? '1 item active' : `${props.itemCount} items active`} />
        <RegisterMetric label={props.mode === 'buy' ? 'Offer' : 'Due'} value={money(props.due)} detail={props.mode === 'buy' ? 'Recommended offer' : 'After tax / credit'} strong />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Button className="h-12 rounded-2xl text-base" variant={props.mode === 'sale' ? 'default' : 'outline'} onClick={props.onScan}>
          <Package className="mr-2 h-4 w-4" />
          UPC Input
        </Button>
        <Button className="h-12 rounded-2xl text-base" variant="outline" onClick={props.onCameraScan}>
          <Camera className="mr-2 h-4 w-4" />
          Camera
        </Button>
        <Button className="h-12 rounded-2xl text-base" variant={props.mode === 'customers' ? 'default' : 'outline'} onClick={props.onCustomer}>
          <Users className="mr-2 h-4 w-4" />
          Customer
        </Button>
        <Button className="h-12 rounded-2xl text-base" variant={props.mode === 'buy' ? 'default' : 'outline'} onClick={props.onTrade}>
          <HandCoins className="mr-2 h-4 w-4" />
          Trade
        </Button>
        <Button className="h-12 rounded-2xl text-base" onClick={props.onCheckout} disabled={props.checkoutDisabled}>
          <CreditCard className="mr-2 h-4 w-4" />
          Checkout
        </Button>
      </div>
    </div>
  );
}

function RegisterMetric({ label, value, detail, strong = false }: { label: string; value: string; detail: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-black/25 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className={`mt-1 truncate ${strong ? 'text-xl font-bold text-primary' : 'text-base font-bold text-white'}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-white/45">{detail}</div>
    </div>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ minHeight: 52 }}
      className={`flex items-center justify-center gap-2 rounded-2xl px-3 text-base font-semibold transition sm:px-5 ${active ? 'bg-primary text-black shadow-[0_10px_30px_-22px_hsl(148_100%_50%/0.9)]' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function CustomerPanel(props: {
  customers: PosCustomer[];
  selectedCustomer: PosCustomer | null;
  customerSearch: string;
  setCustomerSearch: (value: string) => void;
  setSelectedCustomer: (customer: PosCustomer | null) => void;
  loadCustomers: (search?: string) => Promise<void>;
  customerForm: { name: string; phone: string; email: string; notes: string };
  setCustomerForm: (form: { name: string; phone: string; email: string; notes: string }) => void;
  handleCreateCustomer: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <Users className="h-6 w-6 text-primary" />
            Customers
          </div>
          <div className="mt-1 text-base text-white/55">Find a rewards customer or create one before checkout.</div>
        </div>
        {props.selectedCustomer && (
          <Button className="h-12 px-5 text-base" variant="outline" onClick={() => props.setSelectedCustomer(null)}>
            Change Customer
          </Button>
        )}
      </div>

      {props.selectedCustomer ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/10 p-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">Attached to sale</div>
            <div className="mt-1 text-2xl font-bold">{props.selectedCustomer.name}</div>
            <div className="mt-1 text-base text-white/60">{props.selectedCustomer.phone || props.selectedCustomer.email || props.selectedCustomer.rewards_number || 'No contact saved'}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-white/45">Credit</div>
            <div className="text-3xl font-bold text-primary">{money(props.selectedCustomer.credit_balance)}</div>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-card p-4">
          <div className="mb-3">
            <div className="text-lg font-bold">Find Existing Customer</div>
            <div className="mt-1 text-sm text-white/50">Tap a customer to attach them to this sale.</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              className="h-14 border-white/10 bg-black/40 text-lg"
              value={props.customerSearch}
              onChange={(event) => props.setCustomerSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.loadCustomers(props.customerSearch);
              }}
              placeholder="Name, phone, or email"
            />
            <Button className="h-14 px-6 text-lg" variant="outline" onClick={() => props.loadCustomers(props.customerSearch)}>
              <Search className="mr-2 h-5 w-5" />
              Search
            </Button>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
            {props.customers.length === 0 ? (
              <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-white/15 p-6 text-center text-base text-white/45">
                No customers found. Create a new rewards customer on the right.
              </div>
            ) : (
              <div className="grid gap-2">
                {props.customers.map((customer) => {
                  const isSelected = props.selectedCustomer?.id === customer.id;
                  return (
                    <button
                      key={customer.id}
                      onClick={() => props.setSelectedCustomer(customer)}
                      className={`rounded-xl border p-4 text-left transition ${isSelected ? 'border-primary/45 bg-primary/10' : 'border-white/10 bg-black/30 hover:border-primary/35 hover:bg-primary/10'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xl font-bold">{customer.name}</div>
                          <div className="mt-1 text-base text-white/55">{customer.phone || customer.email || customer.rewards_number || 'No contact saved'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Credit</div>
                          <div className="text-xl font-bold text-primary">{money(customer.credit_balance)}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-white/45">Lifetime spend {money(customer.lifetime_spend)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-card p-4">
          <div className="mb-3">
            <div className="flex items-center gap-2 text-lg font-bold">
              <UserPlus className="h-5 w-5 text-primary" />
              Create Rewards Customer
            </div>
            <div className="mt-1 text-sm text-white/50">Name is required. Phone or email helps find them later.</div>
          </div>
          <div className="grid gap-3">
            <div>
              <Label className="text-base">Customer Name</Label>
              <Input
                className="mt-2 h-14 border-white/10 bg-black/40 text-lg"
                value={props.customerForm.name}
                onChange={(event) => props.setCustomerForm({ ...props.customerForm, name: event.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-base">Phone</Label>
                <Input
                  className="mt-2 h-14 border-white/10 bg-black/40 text-lg"
                  value={props.customerForm.phone}
                  onChange={(event) => props.setCustomerForm({ ...props.customerForm, phone: event.target.value })}
                  placeholder="Phone number"
                />
              </div>
              <div>
                <Label className="text-base">Email</Label>
                <Input
                  className="mt-2 h-14 border-white/10 bg-black/40 text-lg"
                  value={props.customerForm.email}
                  onChange={(event) => props.setCustomerForm({ ...props.customerForm, email: event.target.value })}
                  placeholder="Email address"
                />
              </div>
            </div>
            <Button className="mt-1 h-16 text-xl" onClick={props.handleCreateCustomer} disabled={props.saving || !props.customerForm.name.trim()}>
              Create Customer
            </Button>
            <div className="rounded-xl border border-white/10 bg-muted/50 p-4 text-base leading-relaxed text-white/55">
              After creating a customer, tap their name in the list to attach them to the current sale.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function TradeMoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-2 h-12 border-white/10 bg-black/40 text-base"
        type="number"
        min="0"
        step="0.01"
        value={Number(value || 0)}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
    </div>
  );
}

function TotalsRow({ label, value, large = false }: { label: string; value: number; large?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${large ? 'text-2xl font-bold' : 'text-base text-white/70'}`}>
      <span>{label}</span>
      <span className={value < 0 ? 'text-red-300' : large ? 'text-primary' : 'text-white'}>{money(value)}</span>
    </div>
  );
}
