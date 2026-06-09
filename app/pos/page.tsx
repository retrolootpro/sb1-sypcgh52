'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, HandCoins, Package, Plus, Search, ShoppingCart, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth-context';
import {
  completeCustomerBuy,
  completePosSale,
  createPosCustomer,
  getPosTaxSettings,
  searchPosCustomers,
  searchPosInventory,
  type PosCartLine,
  type PosBuyItem,
  type PosCustomer,
  type PosInventoryItem,
  type PosSale,
  type PosTaxSettings,
} from '@/lib/pos-services';
import { supabase } from '@/lib/supabase';

const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const CASH_OFFER_RATE = 0.35;
const TRADE_OFFER_RATE = 0.6;
const CONDITION_RATING_MULTIPLIERS: Record<number, number> = {
  5: 1,
  4: 0.85,
  3: 0.65,
  2: 0.35,
  1: 0.1,
};

type TradeItem = PosBuyItem & {
  id: string;
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

function payoutOfferRate(payoutType: 'cash' | 'trade_credit' | 'mixed') {
  return payoutType === 'cash' ? CASH_OFFER_RATE : TRADE_OFFER_RATE;
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

function baselinePriceChartingValue(details: PriceChartingDetails) {
  const marketBaseline = Math.max(
    Number(details.prices.loose || 0),
    Number(details.prices.cib || 0),
    Number(details.prices.new || 0),
    Number(details.prices.graded || 0)
  );
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
  const [mode, setMode] = useState<'sale' | 'buy' | 'customers'>('sale');
  const [inventory, setInventory] = useState<PosInventoryItem[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
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
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [scanBuffer, setScanBuffer] = useState('');
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [tradeItems, setTradeItems] = useState<TradeItem[]>([]);
  const [tradeItemForm, setTradeItemForm] = useState({ title: '', platform: '', condition: 'Loose', conditionRating: '5', quantity: '1' });
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
    if (!user) return;
    loadInventory();
    loadCustomers();
    loadTaxSettings();
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

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.unit_price, 0), [cart]);
  const discountRaw = Math.max(0, Number(discount || 0));
  const discountAmount = Math.min(discountType === 'percent' ? subtotal * Math.min(discountRaw, 100) / 100 : discountRaw, subtotal);
  const taxable = Math.max(0, subtotal - discountAmount);
  const activeTaxRate = Math.max(0, Number(taxSettings?.default_tax_rate || 0));
  const taxAmount = taxable * activeTaxRate;
  const total = taxable + taxAmount;
  const creditUsed = Math.min(Number(creditToUse || 0), selectedCustomer?.credit_balance || 0, total);
  const dueAfterCredit = Math.max(0, total - creditUsed);
  const cashAmount = Number(cashReceived || 0);
  const cardTenderAmount = Number(cardAmount || 0);
  const tenderedAmount = paymentMethod === 'cash'
    ? cashAmount
    : paymentMethod === 'split'
      ? cashAmount + cardTenderAmount
      : dueAfterCredit;
  const changeDue = Math.max(0, tenderedAmount - dueAfterCredit);
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
  const acceptedTradeOfferTotal = useMemo(
    () => tradeItems.reduce((sum, item) => sum + Number(item.accepted_offer || 0), 0),
    [tradeItems]
  );
  const suggestedCashPercent = offerPercent(tradeCashOfferTotal, tradeMarketTotal);
  const suggestedTradePercent = offerPercent(tradeCreditOfferTotal, tradeMarketTotal);

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
      unit_price: Number(item.sell_price || item.selected_market_value || item.purchase_price || 0),
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
    if (!tradeItemForm.title.trim()) {
      toast.error('Enter a trade item title');
      return;
    }

    const quantity = Math.max(1, Number(tradeItemForm.quantity || 1));
    const newItem: TradeItem = {
      id: uid(),
      title: tradeItemForm.title.trim(),
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
    setTradeItemForm({ title: '', platform: '', condition: 'Loose', conditionRating: '5', quantity: '1' });
    window.setTimeout(() => lookupTradeItemPricing(newItem), 0);
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
        next.accepted_offer = conditionAdjustedOffer(marketValue, quantity, payoutOfferRate(buyForm.payout_type), Number(next.condition_rating || 5));
      }
      return next;
    }));
  };

  const applySuggestedOffer = (type: 'cash' | 'trade') => {
    const amount = type === 'cash' ? tradeCashOfferTotal : tradeCreditOfferTotal;
    setTradeItems((current) => current.map((item) => ({
      ...item,
      accepted_offer: type === 'cash' ? item.recommended_cash_offer : item.recommended_trade_offer,
    })));
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
      const pcValue = baselinePriceChartingValue(details);
      const gamestopValue = Number(details.prices.gamestop || 0);
      const marketValue = bestMarketValue(pcValue, gamestopValue);
      const quantity = Math.max(1, Number(item.quantity || 1));

      updateTradeItem(item.id, {
        title: details.productName || match.productName,
        platform: details.consoleName || match.consoleName,
        pricecharting_value: pcValue,
        gamestop_value: gamestopValue,
        market_value: marketValue,
        recommended_cash_offer: conditionAdjustedOffer(marketValue, quantity, CASH_OFFER_RATE, Number(item.condition_rating || 5)),
        recommended_trade_offer: conditionAdjustedOffer(marketValue, quantity, TRADE_OFFER_RATE, Number(item.condition_rating || 5)),
        accepted_offer: conditionAdjustedOffer(marketValue, quantity, payoutOfferRate(buyForm.payout_type), Number(item.condition_rating || 5)),
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
    if ((paymentMethod === 'cash' || paymentMethod === 'split') && tenderedAmount < dueAfterCredit) {
      return toast.error('Cash received is below the amount due');
    }
    if ((paymentMethod === 'external_card' || paymentMethod === 'square' || paymentMethod === 'stripe' || paymentMethod === 'split') && !processorReference.trim()) {
      return toast.error('Enter the card machine reference number');
    }
    setSaving(true);
    try {
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
        processor_reference: processorReference,
      });
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
      await Promise.all([loadInventory(), loadCustomers()]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to complete sale');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteBuy = async () => {
    const itemSummary = tradeItems.length
      ? tradeItems.map((item) => `${item.quantity}x ${item.title}${item.platform ? ` (${item.platform})` : ''}`).join('; ')
      : buyForm.item_summary.trim();
    const offerAmount = Number(buyForm.offer_amount || 0) || acceptedTradeOfferTotal;
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
      await loadCustomers();
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
    <div className="h-screen overflow-hidden bg-neutral-950 text-white">
      <header className="h-[64px] border-b border-white/10 bg-black/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" className="h-10 w-10 border-white/15 bg-white/5 text-white hover:bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="text-lg font-bold tracking-tight">RetroLootPro POS</div>
              <div className="text-xs text-white/45">iPad register mode</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
            <ModeButton active={mode === 'sale'} icon={ShoppingCart} label="Sell" onClick={() => setMode('sale')} />
            <ModeButton active={mode === 'buy'} icon={HandCoins} label="Buy / Trade" onClick={() => setMode('buy')} />
            <ModeButton active={mode === 'customers'} icon={Users} label="Customers" onClick={() => setMode('customers')} />
          </div>
        </div>
      </header>

      <main className="grid h-[calc(100vh-64px)] gap-3 overflow-hidden p-3 xl:grid-cols-[1fr_380px]">
        <section className="space-y-3 overflow-hidden">
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

          {mode === 'sale' && (
            <div className="grid h-[calc(100vh-160px)] gap-3 overflow-hidden lg:grid-cols-[1.15fr_.85fr]">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Package className="h-5 w-5 text-primary" />
                  Scan / Inventory
                </div>
                <div className="mb-2 flex gap-2">
                  <Input
                    ref={scanInputRef}
                    className="h-10 border-primary/30 bg-black/40 text-base"
                    value={scanBuffer}
                    onChange={(event) => setScanBuffer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') scanUpcIntoCart(scanBuffer);
                    }}
                    placeholder="Continuous UPC scan..."
                  />
                  <Button className="h-10" onClick={() => scanUpcIntoCart(scanBuffer)}>Add UPC</Button>
                </div>
                <div className="mb-2 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <Input className="h-10 border-white/10 bg-black/40 pl-9 text-sm" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search inventory..." />
                  </div>
                  <Button className="h-10" variant="outline" onClick={() => loadInventory()}>Search</Button>
                </div>
                <div className="grid max-h-[calc(100vh-280px)] gap-1.5 overflow-auto pr-1">
                  {inventory.map((item) => (
                    <button key={item.id} onClick={() => addInventoryItem(item)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-2 text-left transition hover:border-primary/35 hover:bg-primary/10">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/5">
                        {item.thumbnail_url || item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnail_url || item.image_url || ''} alt="" className="h-full w-full object-cover" />
                        ) : <Package className="h-6 w-6 text-white/30" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{item.title}</div>
                        <div className="text-xs text-white/45">{item.platform || 'No platform'} • {item.condition || 'No condition'}</div>
                      </div>
                      <div className="text-right text-sm font-bold text-primary">{money(Number(item.sell_price || item.selected_market_value || item.purchase_price || 0))}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Plus className="h-5 w-5 text-primary" />
                  Manual Item
                </div>
                <div className="grid gap-2">
                  <Input className="h-10 border-white/10 bg-black/40 text-sm" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Manual item, service, or misc sale" />
                  <Input className="h-10 border-white/10 bg-black/40 text-sm" type="number" min="0" step="0.01" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="Price" />
                  <Button className="h-10 text-sm" onClick={addManualItem}>Add Manual Item</Button>
                </div>
              </div>
            </div>
          )}

          {mode === 'buy' && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <HandCoins className="h-5 w-5 text-primary" />
                Buy From Customer / Trade Credit
              </div>
              <div className="grid gap-4">
                <div className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4 lg:grid-cols-[1.25fr_.75fr_.65fr_.8fr_.4fr_auto]">
                  <div>
                    <Label>Title</Label>
                    <Input className="mt-2 h-12 border-white/10 bg-black/40 text-base" value={tradeItemForm.title} onChange={(event) => setTradeItemForm({ ...tradeItemForm, title: event.target.value })} placeholder="Mario Party 8" />
                  </div>
                  <div>
                    <Label>Platform</Label>
                    <Input className="mt-2 h-12 border-white/10 bg-black/40 text-base" value={tradeItemForm.platform} onChange={(event) => setTradeItemForm({ ...tradeItemForm, platform: event.target.value })} placeholder="Wii" />
                  </div>
                  <div>
                    <Label>Condition</Label>
                    <Select value={tradeItemForm.condition} onValueChange={(value) => setTradeItemForm({ ...tradeItemForm, condition: value })}>
                      <SelectTrigger className="mt-2 h-12 border-white/10 bg-black/40 text-base"><SelectValue /></SelectTrigger>
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
                      <SelectTrigger className="mt-2 h-12 border-white/10 bg-black/40 text-base"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[5, 4, 3, 2, 1].map((rating) => (
                          <SelectItem key={rating} value={String(rating)}>{conditionRatingLabel(rating)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qty</Label>
                    <Input className="mt-2 h-12 border-white/10 bg-black/40 text-base" type="number" min="1" step="1" value={tradeItemForm.quantity} onChange={(event) => setTradeItemForm({ ...tradeItemForm, quantity: event.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button className="h-12 w-full px-6" onClick={addTradeItem}>Add</Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  {tradeItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-white/45">
                      Add each item in the customer trade. PriceCharting and GameStop values will show per line after lookup.
                    </div>
                  ) : tradeItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="grid gap-3 xl:grid-cols-[1.2fr_.65fr_.55fr_.75fr_.4fr_.6fr_.6fr_.6fr_.6fr_auto]">
                        <div>
                          <Label>Item</Label>
                          <Input className="mt-2 h-11 border-white/10 bg-black/40" value={item.title} onChange={(event) => updateTradeItem(item.id, { title: event.target.value })} />
                        </div>
                        <div>
                          <Label>Platform</Label>
                          <Input className="mt-2 h-11 border-white/10 bg-black/40" value={item.platform || ''} onChange={(event) => updateTradeItem(item.id, { platform: event.target.value })} />
                        </div>
                        <div>
                          <Label>Condition</Label>
                          <Select value={item.condition || 'Loose'} onValueChange={(value) => updateTradeItem(item.id, { condition: value })}>
                            <SelectTrigger className="mt-2 h-11 border-white/10 bg-black/40"><SelectValue /></SelectTrigger>
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
                            <SelectTrigger className="mt-2 h-11 border-white/10 bg-black/40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[5, 4, 3, 2, 1].map((rating) => (
                                <SelectItem key={rating} value={String(rating)}>{conditionRatingLabel(rating)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Qty</Label>
                          <Input className="mt-2 h-11 border-white/10 bg-black/40" type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateTradeItem(item.id, { quantity: Number(event.target.value || 1) })} />
                        </div>
                        <TradeMoneyInput label="PriceCharting" value={item.pricecharting_value} onChange={(value) => updateTradeItem(item.id, { pricecharting_value: value })} />
                        <TradeMoneyInput label="GameStop" value={item.gamestop_value} onChange={(value) => updateTradeItem(item.id, { gamestop_value: value })} />
                        <TradeMoneyInput label="Market" value={item.market_value} onChange={(value) => updateTradeItem(item.id, { market_value: value })} />
                        <TradeMoneyInput label="Recommended" value={item.accepted_offer} onChange={(value) => updateTradeItem(item.id, { accepted_offer: value })} />
                        <div className="flex items-end gap-2">
                          <Button className="h-11" variant="outline" onClick={() => lookupTradeItemPricing(item)} disabled={item.lookup_status === 'loading'}>
                            {item.lookup_status === 'loading' ? 'Pricing...' : 'Price'}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-11 w-11 text-white/45" onClick={() => setTradeItems((current) => current.filter((tradeItem) => tradeItem.id !== item.id))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/45">
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
                              <div className="text-sm font-semibold text-white">{match.productName}</div>
                              <div className="mt-1 text-xs text-white/50">{match.consoleName} • PC ID {match.id}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
                  <div className="space-y-3">
                    <Label>Fallback Item Summary</Label>
                    <Textarea className="min-h-24 border-white/10 bg-black/40 text-base" value={buyForm.item_summary} onChange={(event) => setBuyForm({ ...buyForm, item_summary: event.target.value })} placeholder="Use only if you do not want to itemize the trade." />
                    <Label>Notes</Label>
                    <Textarea className="min-h-24 border-white/10 bg-black/40" value={buyForm.notes} onChange={(event) => setBuyForm({ ...buyForm, notes: event.target.value })} placeholder="Condition, ID check, testing notes..." />
                  </div>
                  <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
                    <TotalsRow label="Total Market Value" value={tradeMarketTotal} large />
                    <TotalsRow label={`Suggested Cash (${suggestedCashPercent}%)`} value={tradeCashOfferTotal} />
                    <TotalsRow label={`Suggested Trade (${suggestedTradePercent}%)`} value={tradeCreditOfferTotal} />
                    <TotalsRow label="Recommended Offer" value={acceptedTradeOfferTotal} large />
                    <div className="grid grid-cols-2 gap-2">
                      <Button className="h-11" variant="outline" onClick={() => applySuggestedOffer('cash')}>Use Cash Offer</Button>
                      <Button className="h-11" onClick={() => applySuggestedOffer('trade')}>Use Trade Offer</Button>
                    </div>
                    <Label>Offer Amount</Label>
                    <Input className="h-12 border-white/10 bg-black/40 text-base" type="number" min="0" step="0.01" value={buyForm.offer_amount} onChange={(event) => setBuyForm({ ...buyForm, offer_amount: event.target.value })} />
                    <Label>Payout Type</Label>
                    <Select
                      value={buyForm.payout_type}
                      onValueChange={(value: 'cash' | 'trade_credit' | 'mixed') => {
                        const rate = payoutOfferRate(value);
                        const nextItems = tradeItems.map((item) => {
                          const quantity = Math.max(1, Number(item.quantity || 1));
                          return {
                            ...item,
                            accepted_offer: conditionAdjustedOffer(Number(item.market_value || 0), quantity, rate, Number(item.condition_rating || 5)),
                          };
                        });
                        const nextOffer = nextItems.reduce((sum, item) => sum + Number(item.accepted_offer || 0), 0);
                        setTradeItems(nextItems);
                        setBuyForm({
                          ...buyForm,
                          payout_type: value,
                          offer_amount: nextOffer > 0 ? nextOffer.toFixed(2) : buyForm.offer_amount,
                          cash_paid: value === 'cash' && nextOffer > 0 ? nextOffer.toFixed(2) : value === 'cash' ? buyForm.cash_paid : '',
                          trade_credit_issued: value !== 'cash' && nextOffer > 0 ? nextOffer.toFixed(2) : value !== 'cash' ? buyForm.trade_credit_issued : '',
                        });
                      }}
                    >
                      <SelectTrigger className="h-12 border-white/10 bg-black/40 text-base"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="trade_credit">Trade Credit</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Cash Paid</Label>
                        <Input className="mt-2 h-12 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={buyForm.cash_paid} onChange={(event) => setBuyForm({ ...buyForm, cash_paid: event.target.value })} />
                      </div>
                      <div>
                        <Label>Trade Credit</Label>
                        <Input className="mt-2 h-12 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={buyForm.trade_credit_issued} onChange={(event) => setBuyForm({ ...buyForm, trade_credit_issued: event.target.value })} />
                      </div>
                    </div>
                    <Button className="h-14 w-full text-lg" onClick={handleCompleteBuy} disabled={saving}>Complete Buy</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === 'customers' && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 text-lg font-semibold">Rewards Customers</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {customers.map((customer) => (
                  <button key={customer.id} onClick={() => setSelectedCustomer(customer)} className="rounded-xl border border-white/10 bg-black/30 p-4 text-left transition hover:border-primary/35 hover:bg-primary/10">
                    <div className="font-semibold">{customer.name}</div>
                    <div className="mt-1 text-sm text-white/45">{customer.phone || customer.email || customer.rewards_number}</div>
                    <div className="mt-3 text-lg font-bold text-primary">Credit {money(customer.credit_balance)}</div>
                    <div className="text-xs text-white/35">Lifetime spend {money(customer.lifetime_spend)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-black/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-lg font-bold">Receipt Cart</div>
            <Button className="h-8" variant="outline" size="sm" onClick={() => setCart([])}>Clear</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1 font-mono">
            {cart.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 p-6 text-center font-sans text-white/40">No sale items yet.</div>
            ) : cart.map((line) => (
              <div key={line.id} className="rounded-md border border-white/10 bg-white/[0.035] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{line.item_name}</div>
                    <div className="text-[10px] text-white/40">{line.platform || line.source}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-white/40" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-1 grid grid-cols-[54px_1fr_80px] items-center gap-1">
                  <Input className="h-8 border-white/10 bg-black/40 px-2 text-xs" type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value || 1) })} disabled={line.source === 'inventory'} />
                  <Input className="h-8 border-white/10 bg-black/40 px-2 text-xs" type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => updateLine(line.id, { unit_price: Number(event.target.value || 0) })} />
                  <div className="text-right text-xs font-semibold">{money(line.quantity * line.unit_price)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Discount</Label>
                <div className="mt-1 grid grid-cols-[70px_1fr] gap-1">
                  <Select value={discountType} onValueChange={(value: 'percent' | 'amount') => setDiscountType(value)}>
                    <SelectTrigger className="h-9 border-white/10 bg-black/40">
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
                      className={`h-9 border-white/10 bg-black/40 text-xs ${discountType === 'amount' ? 'pl-7' : ''}`}
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
              <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Tax</Label>
                  <span className="text-xs font-semibold text-primary">{(activeTaxRate * 100).toFixed(3)}%</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-white/45">
                  {taxSettings?.tax_zip ? `ZIP ${taxSettings.tax_zip}` : 'No ZIP set'} {taxSettings?.tax_source ? `- ${taxSettings.tax_source}` : '- admin setting'}
                </div>
              </div>
            </div>
            <TotalsRow label="Subtotal" value={subtotal} />
            <TotalsRow label="Discount" value={-discountAmount} />
            <TotalsRow label="Tax" value={taxAmount} />
            <TotalsRow label="Total" value={total} large />

            {selectedCustomer && selectedCustomer.credit_balance > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label className="text-xs">Customer Credit</Label>
                  <div className="text-xs text-primary">{money(selectedCustomer.credit_balance)} available</div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    className="h-9 border-white/10 bg-black/40 text-xs"
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
                    className="h-9 px-3 text-xs"
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
                      className="h-8 text-xs"
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
                    className="h-8 text-xs"
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
            <Button className="h-12 w-full text-lg" disabled={saving || cart.length === 0} onClick={() => setPaymentOpen(true)}>
              <CreditCard className="mr-2 h-5 w-5" />
              Checkout
            </Button>
          </div>
        </aside>
      </main>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md border-white/10 bg-neutral-950 text-white">
          <DialogHeader>
            <DialogTitle>Complete Sale</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <TotalsRow label="Total Due" value={dueAfterCredit} large />
              <TotalsRow label="Tendered" value={tenderedAmount} />
              <TotalsRow label="Change Due" value={changeDue} large />
            </div>
            <div>
              <Label>Tender</Label>
              <Select value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
                <SelectTrigger className="mt-2 h-12 border-white/10 bg-black/40 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="square">Card - Square</SelectItem>
                  <SelectItem value="stripe">Card - Stripe</SelectItem>
                  <SelectItem value="external_card">Card - Other</SelectItem>
                  <SelectItem value="split">Cash + Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(paymentMethod === 'cash' || paymentMethod === 'split') && (
              <div>
                <Label>Cash Received</Label>
                <Input className="mt-2 h-12 border-white/10 bg-black/40 text-lg" type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} />
              </div>
            )}
            {paymentMethod === 'split' && (
              <div>
                <Label>Card Amount</Label>
                <Input className="mt-2 h-12 border-white/10 bg-black/40 text-lg" type="number" min="0" step="0.01" value={cardAmount} onChange={(event) => setCardAmount(event.target.value)} />
              </div>
            )}
            {(paymentMethod === 'external_card' || paymentMethod === 'square' || paymentMethod === 'stripe' || paymentMethod === 'split') && (
              <div>
                <Label>Card Machine Reference</Label>
                <Input className="mt-2 h-12 border-white/10 bg-black/40 text-base" value={processorReference} onChange={(event) => setProcessorReference(event.target.value)} placeholder="Receipt / auth / batch reference" />
              </div>
            )}
            <Button className="h-14 w-full text-lg" disabled={saving || cart.length === 0} onClick={handleCompleteSale}>
              OK - Complete Sale
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${active ? 'bg-primary text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}>
      <Icon className="h-4 w-4" />
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
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Users className="h-5 w-5 text-primary" />
        Customer / Rewards
      </div>
      {props.selectedCustomer ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3">
          <div>
            <div className="text-base font-bold">{props.selectedCustomer.name}</div>
            <div className="text-xs text-white/55">{props.selectedCustomer.phone || props.selectedCustomer.email || props.selectedCustomer.rewards_number}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/50">Credit</div>
            <div className="text-lg font-bold text-primary">{money(props.selectedCustomer.credit_balance)}</div>
          </div>
          <Button className="h-9" variant="outline" onClick={() => props.setSelectedCustomer(null)}>Remove</Button>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
          <div>
            <div className="flex gap-2">
              <Input className="h-10 border-white/10 bg-black/40" value={props.customerSearch} onChange={(event) => props.setCustomerSearch(event.target.value)} placeholder="Search customer..." />
              <Button className="h-10" variant="outline" onClick={() => props.loadCustomers(props.customerSearch)}>Search</Button>
            </div>
            <div className="mt-2 grid max-h-24 gap-1 overflow-auto">
              {props.customers.map((customer) => (
                <button key={customer.id} onClick={() => props.setSelectedCustomer(customer)} className="rounded-lg border border-white/10 bg-black/30 p-2 text-left hover:border-primary/35">
                  <div className="text-sm font-semibold">{customer.name}</div>
                  <div className="text-xs text-white/45">Credit {money(customer.credit_balance)}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4 text-primary" />New Rewards Customer</div>
            <Input className="h-9 border-white/10 bg-black/40" value={props.customerForm.name} onChange={(event) => props.setCustomerForm({ ...props.customerForm, name: event.target.value })} placeholder="Name" />
            <div className="grid grid-cols-2 gap-2">
              <Input className="h-9 border-white/10 bg-black/40" value={props.customerForm.phone} onChange={(event) => props.setCustomerForm({ ...props.customerForm, phone: event.target.value })} placeholder="Phone" />
              <Input className="h-9 border-white/10 bg-black/40" value={props.customerForm.email} onChange={(event) => props.setCustomerForm({ ...props.customerForm, email: event.target.value })} placeholder="Email" />
            </div>
            <Button className="h-9" onClick={props.handleCreateCustomer} disabled={props.saving}>Create Customer</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeMoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-2 h-11 border-white/10 bg-black/40"
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
    <div className={`flex items-center justify-between ${large ? 'text-xl font-bold' : 'text-sm text-white/65'}`}>
      <span>{label}</span>
      <span className={value < 0 ? 'text-red-300' : large ? 'text-primary' : 'text-white'}>{money(value)}</span>
    </div>
  );
}
