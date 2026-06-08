'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, HandCoins, Package, Plus, Search, ShoppingCart, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import {
  completeCustomerBuy,
  completePosSale,
  createPosCustomer,
  searchPosCustomers,
  searchPosInventory,
  type PosCartLine,
  type PosBuyItem,
  type PosCustomer,
  type PosInventoryItem,
  type PosSale,
} from '@/lib/pos-services';
import { getCanonicalPricing } from '@/lib/pricing-service';

const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const CASH_OFFER_RATE = 0.35;
const TRADE_OFFER_RATE = 0.45;

type TradeItem = PosBuyItem & {
  id: string;
  lookup_status?: 'idle' | 'loading' | 'found' | 'missing' | 'error';
};

function conditionKey(condition: string): 'loose' | 'cib' | 'new' | 'graded' {
  const normalized = condition.toLowerCase();
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('new') || normalized.includes('sealed')) return 'new';
  if (normalized.includes('cib') || normalized.includes('complete')) return 'cib';
  return 'loose';
}

function bestMarketValue(pricecharting: number, gamestop: number) {
  return Math.max(Number(pricecharting || 0), Number(gamestop || 0));
}

function recommendedOffer(marketValue: number, quantity: number, rate: number) {
  return Number((Math.max(0, marketValue) * Math.max(1, quantity || 1) * rate).toFixed(2));
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
  const [taxRate, setTaxRate] = useState('7');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PosSale['payment_method']>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [creditToUse, setCreditToUse] = useState('');
  const [processorReference, setProcessorReference] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [tradeItems, setTradeItems] = useState<TradeItem[]>([]);
  const [tradeItemForm, setTradeItemForm] = useState({ title: '', platform: '', condition: 'Loose', quantity: '1' });
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

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.unit_price, 0), [cart]);
  const discountAmount = Math.min(Number(discount || 0), subtotal);
  const taxable = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxable * (Math.max(0, Number(taxRate || 0)) / 100);
  const total = taxable + taxAmount;
  const creditUsed = Math.min(Number(creditToUse || 0), selectedCustomer?.credit_balance || 0, total);
  const dueAfterCredit = Math.max(0, total - creditUsed);
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
    setTradeItems((current) => [...current, {
      id: uid(),
      title: tradeItemForm.title.trim(),
      platform: tradeItemForm.platform.trim(),
      condition: tradeItemForm.condition,
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
    }]);
    setTradeItemForm({ title: '', platform: '', condition: 'Loose', quantity: '1' });
  };

  const updateTradeItem = (id: string, updates: Partial<TradeItem>) => {
    setTradeItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...updates };
      const marketValue = bestMarketValue(next.pricecharting_value, next.gamestop_value);
      const quantity = Math.max(1, Number(next.quantity || 1));
      if (
        'pricecharting_value' in updates ||
        'gamestop_value' in updates ||
        'quantity' in updates ||
        'condition' in updates
      ) {
        next.market_value = marketValue;
        next.recommended_cash_offer = recommendedOffer(marketValue, quantity, CASH_OFFER_RATE);
        next.recommended_trade_offer = recommendedOffer(marketValue, quantity, TRADE_OFFER_RATE);
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
    updateTradeItem(item.id, { lookup_status: 'loading' });

    try {
      const [pc, gamestop] = await Promise.all([
        getCanonicalPricing(item.title, item.platform || 'Unknown', { forceRefresh: true }),
        fetch('/api/gamestop-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.title, platform: item.platform || '' }),
        }).then((response) => response.json()).catch(() => null),
      ]);

      const key = conditionKey(item.condition || '');
      const pcValue = pc.status === 'api_error' ? 0 : Number(pc.prices[key]?.value || 0);
      const gamestopValue = gamestop?.success ? Number(gamestop.price || 0) : 0;
      const marketValue = bestMarketValue(pcValue, gamestopValue);
      const quantity = Math.max(1, Number(item.quantity || 1));
      const warnings = [
        ...(pc.status === 'api_error' ? [pc.error || 'PriceCharting lookup failed'] : pc.diagnostics.warnings || []),
        ...(gamestop?.warnings || []),
      ].filter(Boolean);

      updateTradeItem(item.id, {
        title: pc.pcMatch?.productName || item.title,
        platform: pc.pcMatch?.platform || item.platform || '',
        pricecharting_value: pcValue,
        gamestop_value: gamestopValue,
        market_value: marketValue,
        recommended_cash_offer: recommendedOffer(marketValue, quantity, CASH_OFFER_RATE),
        recommended_trade_offer: recommendedOffer(marketValue, quantity, TRADE_OFFER_RATE),
        accepted_offer: recommendedOffer(marketValue, quantity, buyForm.payout_type === 'cash' ? CASH_OFFER_RATE : TRADE_OFFER_RATE),
        pricing_source: [
          pcValue > 0 ? 'PriceCharting' : '',
          gamestopValue > 0 ? 'GameStop' : '',
        ].filter(Boolean).join(' + '),
        pricing_notes: warnings.slice(0, 2).join(' '),
        lookup_status: marketValue > 0 ? 'found' : 'missing',
      });

      if (marketValue > 0) toast.success(`Pricing found for ${item.title}`);
      else toast.warning(`No pricing found for ${item.title}`);
    } catch (error: any) {
      updateTradeItem(item.id, { lookup_status: 'error', pricing_notes: error.message || 'Lookup failed' });
      toast.error(error.message || 'Trade pricing lookup failed');
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
    if (paymentMethod === 'trade_credit' && dueAfterCredit > 0) {
      return toast.error('Trade credit does not cover the full total');
    }
    if (paymentMethod === 'cash' && Number(cashReceived || 0) < dueAfterCredit) {
      return toast.error('Cash received is below the amount due');
    }
    setSaving(true);
    try {
      const sale = await completePosSale({
        customer_id: selectedCustomer?.id || null,
        lines: cart,
        discount_amount: Number(discount || 0),
        tax_rate: Math.max(0, Number(taxRate || 0)) / 100,
        payment_method: paymentMethod,
        trade_credit_used: creditUsed,
        cash_received: Number(cashReceived || 0),
        processor_reference: processorReference,
      });
      toast.success(`Sale complete: ${sale.sale_number}`);
      setCart([]);
      setDiscount('');
      setCreditToUse('');
      setCashReceived('');
      setProcessorReference('');
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
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" className="h-11 w-11 border-white/15 bg-white/5 text-white hover:bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="text-xl font-bold tracking-tight">RetroLootPro POS</div>
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

      <main className="grid gap-4 p-4 xl:grid-cols-[1fr_430px]">
        <section className="space-y-4">
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
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Package className="h-5 w-5 text-primary" />
                  Inventory
                </div>
                <div className="mb-3 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <Input className="h-12 border-white/10 bg-black/40 pl-9 text-base" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search or scan UPC..." />
                  </div>
                  <Button className="h-12" variant="outline" onClick={() => loadInventory()}>Search</Button>
                </div>
                <div className="grid max-h-[540px] gap-2 overflow-auto pr-1">
                  {inventory.map((item) => (
                    <button key={item.id} onClick={() => addInventoryItem(item)} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3 text-left transition hover:border-primary/35 hover:bg-primary/10">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                        {item.thumbnail_url || item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnail_url || item.image_url || ''} alt="" className="h-full w-full object-cover" />
                        ) : <Package className="h-6 w-6 text-white/30" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{item.title}</div>
                        <div className="mt-1 text-sm text-white/45">{item.platform || 'No platform'} • {item.condition || 'No condition'}</div>
                      </div>
                      <div className="text-right font-bold text-primary">{money(Number(item.sell_price || item.selected_market_value || item.purchase_price || 0))}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Plus className="h-5 w-5 text-primary" />
                  Manual Item
                </div>
                <div className="grid gap-3">
                  <Input className="h-12 border-white/10 bg-black/40 text-base" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Manual item, service, or misc sale" />
                  <Input className="h-12 border-white/10 bg-black/40 text-base" type="number" min="0" step="0.01" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="Price" />
                  <Button className="h-12 text-base" onClick={addManualItem}>Add Manual Item</Button>
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
                <div className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4 lg:grid-cols-[1.4fr_.85fr_.7fr_.45fr_auto]">
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
                      <div className="grid gap-3 xl:grid-cols-[1.4fr_.75fr_.6fr_.45fr_.65fr_.65fr_.65fr_.65fr_auto]">
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
                          <Label>Qty</Label>
                          <Input className="mt-2 h-11 border-white/10 bg-black/40" type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateTradeItem(item.id, { quantity: Number(event.target.value || 1) })} />
                        </div>
                        <TradeMoneyInput label="PriceCharting" value={item.pricecharting_value} onChange={(value) => updateTradeItem(item.id, { pricecharting_value: value })} />
                        <TradeMoneyInput label="GameStop" value={item.gamestop_value} onChange={(value) => updateTradeItem(item.id, { gamestop_value: value })} />
                        <TradeMoneyInput label="Market" value={item.market_value} onChange={(value) => updateTradeItem(item.id, { market_value: value })} />
                        <TradeMoneyInput label="Accepted" value={item.accepted_offer} onChange={(value) => updateTradeItem(item.id, { accepted_offer: value })} />
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
                        <span>Cash offer: <b className="text-white">{money(item.recommended_cash_offer)}</b></span>
                        <span>Trade offer: <b className="text-primary">{money(item.recommended_trade_offer)}</b></span>
                        <span>{item.pricing_source || 'No source yet'}</span>
                        {item.pricing_notes && <span className="text-amber-200">{item.pricing_notes}</span>}
                      </div>
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
                    <TotalsRow label={`Suggested Cash (${Math.round(CASH_OFFER_RATE * 100)}%)`} value={tradeCashOfferTotal} />
                    <TotalsRow label={`Suggested Trade (${Math.round(TRADE_OFFER_RATE * 100)}%)`} value={tradeCreditOfferTotal} />
                    <TotalsRow label="Accepted Offer" value={acceptedTradeOfferTotal} large />
                    <div className="grid grid-cols-2 gap-2">
                      <Button className="h-11" variant="outline" onClick={() => applySuggestedOffer('cash')}>Use Cash Offer</Button>
                      <Button className="h-11" onClick={() => applySuggestedOffer('trade')}>Use Trade Offer</Button>
                    </div>
                    <Label>Offer Amount</Label>
                    <Input className="h-12 border-white/10 bg-black/40 text-base" type="number" min="0" step="0.01" value={buyForm.offer_amount} onChange={(event) => setBuyForm({ ...buyForm, offer_amount: event.target.value })} />
                    <Label>Payout Type</Label>
                    <Select value={buyForm.payout_type} onValueChange={(value: any) => setBuyForm({ ...buyForm, payout_type: value })}>
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

        <aside className="sticky top-[76px] h-fit rounded-2xl border border-white/10 bg-black/60 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xl font-bold">Cart</div>
            <Button variant="outline" size="sm" onClick={() => setCart([])}>Clear</Button>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-white/40">No sale items yet.</div>
            ) : cart.map((line) => (
              <div key={line.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{line.item_name}</div>
                    <div className="text-sm text-white/40">{line.platform || line.source}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Input className="h-11 border-white/10 bg-black/40" type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value || 1) })} disabled={line.source === 'inventory'} />
                  <Input className="h-11 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => updateLine(line.id, { unit_price: Number(event.target.value || 0) })} />
                </div>
                <div className="mt-2 text-right font-semibold">{money(line.quantity * line.unit_price)}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Discount</Label>
                <Input className="mt-2 h-11 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
              </div>
              <div>
                <Label>Tax %</Label>
                <Input className="mt-2 h-11 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
              </div>
            </div>
            <TotalsRow label="Subtotal" value={subtotal} />
            <TotalsRow label="Discount" value={-discountAmount} />
            <TotalsRow label="Tax" value={taxAmount} />
            <TotalsRow label="Total" value={total} large />

            {selectedCustomer && selectedCustomer.credit_balance > 0 && (
              <div>
                <Label>Trade Credit to Use</Label>
                <Input className="mt-2 h-11 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={creditToUse} onChange={(event) => setCreditToUse(event.target.value)} placeholder={`Available ${money(selectedCustomer.credit_balance)}`} />
              </div>
            )}

            <Select value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
              <SelectTrigger className="h-12 border-white/10 bg-black/40 text-base"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="external_card">External Card</SelectItem>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="trade_credit">Trade Credit</SelectItem>
                <SelectItem value="split">Split</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input className="h-11 border-white/10 bg-black/40" type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="Cash received" />
              <Input className="h-11 border-white/10 bg-black/40" value={processorReference} onChange={(event) => setProcessorReference(event.target.value)} placeholder="Card ref" />
            </div>
            <TotalsRow label="Due after credit" value={dueAfterCredit} large />
            <Button className="h-16 w-full text-xl" disabled={saving || cart.length === 0} onClick={handleCompleteSale}>
              <CreditCard className="mr-2 h-5 w-5" />
              Complete Sale
            </Button>
          </div>
        </aside>
      </main>
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Users className="h-5 w-5 text-primary" />
        Customer / Rewards
      </div>
      {props.selectedCustomer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 p-4">
          <div>
            <div className="text-lg font-bold">{props.selectedCustomer.name}</div>
            <div className="text-sm text-white/55">{props.selectedCustomer.phone || props.selectedCustomer.email || props.selectedCustomer.rewards_number}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-white/50">Credit</div>
            <div className="text-xl font-bold text-primary">{money(props.selectedCustomer.credit_balance)}</div>
          </div>
          <Button variant="outline" onClick={() => props.setSelectedCustomer(null)}>Remove</Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div>
            <div className="flex gap-2">
              <Input className="h-12 border-white/10 bg-black/40" value={props.customerSearch} onChange={(event) => props.setCustomerSearch(event.target.value)} placeholder="Search customer..." />
              <Button className="h-12" variant="outline" onClick={() => props.loadCustomers(props.customerSearch)}>Search</Button>
            </div>
            <div className="mt-3 grid max-h-44 gap-2 overflow-auto">
              {props.customers.map((customer) => (
                <button key={customer.id} onClick={() => props.setSelectedCustomer(customer)} className="rounded-lg border border-white/10 bg-black/30 p-3 text-left hover:border-primary/35">
                  <div className="font-semibold">{customer.name}</div>
                  <div className="text-xs text-white/45">Credit {money(customer.credit_balance)}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4 text-primary" />New Rewards Customer</div>
            <Input className="h-11 border-white/10 bg-black/40" value={props.customerForm.name} onChange={(event) => props.setCustomerForm({ ...props.customerForm, name: event.target.value })} placeholder="Name" />
            <div className="grid grid-cols-2 gap-2">
              <Input className="h-11 border-white/10 bg-black/40" value={props.customerForm.phone} onChange={(event) => props.setCustomerForm({ ...props.customerForm, phone: event.target.value })} placeholder="Phone" />
              <Input className="h-11 border-white/10 bg-black/40" value={props.customerForm.email} onChange={(event) => props.setCustomerForm({ ...props.customerForm, email: event.target.value })} placeholder="Email" />
            </div>
            <Button className="h-11" onClick={props.handleCreateCustomer} disabled={props.saving}>Create Customer</Button>
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
