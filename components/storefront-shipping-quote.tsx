'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type ShippingCustomer, type ShippingRate } from '@/lib/storefront-shipping';
import { StorefrontAddressSearch } from '@/components/storefront-address-search';

export type ShippingSelection = { shippingToken: string; shippingRate: string; expires: number; amount: number; name: string; promotion?: { cost: number; amount: number; discount: number; goal: number | null } };
function selection(quote: Quote, rate: ShippingRate): ShippingSelection {
  return { shippingToken: quote.token, shippingRate: rate.id, expires: quote.expires, amount: rate.amount, name: rate.name,
    ...(rate.carrierAmount !== undefined ? { promotion: { cost: rate.carrierAmount, amount: rate.amount, discount: rate.discount || 0, goal: rate.promotionGoal ?? null } } : {}) };
}
type Quote = { token: string; rates: ShippingRate[]; parcels: number; expires: number };
const emptyCustomer: ShippingCustomer = { name: '', email: '', address: { line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US' } };

export function ShippingQuotePicker({ items, requestId, onSelect, disabled = false }: {
  items: { id: string; quantity: number }[]; requestId?: string;
  onSelect: (selection: ShippingSelection | null) => void; disabled?: boolean;
}) {
  const [customer, setCustomer] = useState(emptyCustomer);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const generation = useRef({});
  const cartKey = JSON.stringify(items);
  const customerKey = JSON.stringify(customer);
  useEffect(() => {
    generation.current = {};
    setQuote(null); setRate(''); setError(''); setExpired(false); setBusy(false); onSelect(null);
    return () => { generation.current = {}; };
  }, [cartKey, customerKey, requestId, onSelect]);
  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => { setExpired(true); onSelect(null); }, Math.max(0, quote.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [quote, onSelect]);
  const getRates = async () => {
    const request = {};
    generation.current = request;
    setBusy(true); setError(''); setExpired(false); setQuote(null); onSelect(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (requestId) {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) throw new Error('Sign in again before requesting invoice shipping.');
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const response = await fetch('/api/storefront/shipping', { method: 'POST', headers,
        body: JSON.stringify(requestId ? { action: 'invoice-quote', requestId, items } : { action: 'quote', customer, items }) });
      const result = await response.json();
      if (request !== generation.current) return;
      if (!response.ok || !result.success) throw new Error(result.message || 'Shipping rates could not load.');
      if (!Array.isArray(result.rates) || !result.rates.length) throw new Error('No shipping services returned. Contact support.');
      setQuote(result); setRate(result.rates[0].id);
      onSelect(selection(result, result.rates[0]));
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Shipping quote failed. Contact support.'); }
    finally { if (request === generation.current) setBusy(false); }
  };
  return <section className="shipping-quote space-y-4 rounded-lg border p-4" aria-label="Delivery and carrier rates">
    <h2 className="text-xl font-bold">Delivery & shipping options</h2>
    <p>Enter your delivery details to see available shipping services and prices. United States delivery only.</p>
    <fieldset disabled={disabled || busy} className="space-y-4">
      {!requestId && <div className="grid gap-4 sm:grid-cols-2">
        {(['name', 'email'] as const).map(key => <label key={key} className="block">{key === 'name' ? 'Recipient name' : 'Email for receipt'}<input required autoComplete={key === 'name' ? 'shipping name' : 'email'} type={key === 'email' ? 'email' : 'text'} value={customer[key]} onChange={e => setCustomer({ ...customer, [key]: e.target.value })} className="mt-1 w-full rounded border bg-background p-3"/></label>)}
        <div className="sm:col-span-2"><StorefrontAddressSearch disabled={disabled || busy} onSelect={address => setCustomer(current => ({ ...current, address: {
          line1: address.line1, line2: current.address.line2, city: address.city, state: address.state, postal_code: address.postal_code, country: address.country,
        } }))}/></div>
        {(['line1', 'line2', 'city', 'state', 'postal_code'] as const).map(key => <label className="block" key={key}>{({ line1: 'Delivery address', line2: 'Apartment / suite (optional)', city: 'City', state: 'State (2 letters)', postal_code: 'ZIP code' })[key]}<input autoComplete={({ line1: 'shipping address-line1', line2: 'shipping address-line2', city: 'shipping address-level2', state: 'shipping address-level1', postal_code: 'shipping postal-code' })[key]} value={customer.address[key]} onChange={e => setCustomer({ ...customer, address: { ...customer.address, [key]: e.target.value } })} className="mt-1 w-full rounded border bg-background p-3"/></label>)}
        <p className="self-end p-3">Country: United States</p>
      </div>}
      {requestId && <p>Rates use the customer address saved on this request.</p>}
      <button type="button" className="shipping-quote-button rounded border px-4 py-3 font-semibold" disabled={!items.length} onClick={getRates}>{busy ? 'Getting carrier rates...' : 'Get shipping options'}</button>
      {error && <p role="alert" className="reference-error text-red-500">{error}</p>}
      {expired && <p role="alert">This shipping quote expired. Get new shipping options before continuing.</p>}
      {quote && <><p>{quote.parcels} package{quote.parcels === 1 ? '' : 's'}. Prices include shipping for every package. Delivery times are estimates; quotes are valid for 15 minutes.</p>
        <label className="block">Delivery service<select aria-label="Delivery service" value={rate} disabled={expired} className="mt-1 w-full rounded border bg-background p-3" onChange={e => {
          const selected = quote.rates.find(r => r.id === e.target.value);
          if (!selected) { onSelect(null); return; }
          setRate(selected.id); onSelect(selection(quote, selected));
        }}>{quote.rates.map(r => <option value={r.id} key={r.id}>{r.name} · {r.amount===0?'Free':`$${(r.amount / 100).toFixed(2)}`}{r.estimatedDays === null ? '' : ` · estimated ${r.estimatedDays} business days`}</option>)}</select></label>
        <p className="text-sm">The delivery address is locked for this quote. To change it, update the address here and get new rates before paying.</p></>}
    </fieldset>
  </section>;
}
