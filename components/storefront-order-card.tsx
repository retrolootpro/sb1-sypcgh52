'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ShippingCustomer, QuotedShipping } from '@/lib/storefront-shipping';
import type { LabelParcel, LabelRate, ShippingLabel } from '@/lib/storefront-labels';

export type StorefrontOrder = {
  id: string; request_id: string | null; kind: string; status: string; payment_url: string | null; email_sent: boolean;
  items: { title: string; quantity: number; unit_amount: number }[]; subtotal_cents: number; total_cents: number | null;
  tax_cents: number; shipping_cents: number; tracking: string | null; refunded_cents: number; created_at: string;
  shipping_quote: QuotedShipping | null;
  customer: { shipping?: { name?: string; address?: ShippingCustomer['address'] }; contact?: { name?: string; email?: string } } | null;
};
type StaffApi = (path: string, body?: unknown) => Promise<{
  labels?: ShippingLabel[]; rates?: LabelRate[]; token?: string; expires?: number;
  destination?: ShippingCustomer; origin?: ShippingCustomer; purchasedService?: string;
}>;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const statusStyle: Record<string, string> = {
  paid: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  shipped: 'border-blue-500/40 bg-blue-500/10 text-blue-500',
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  creating: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
};
const statusName: Record<string, string> = { paid: 'Ready to ship', pending: 'Awaiting payment', creating: 'Payment setup', shipped: 'Shipped', cancelled: 'Cancelled' };
function addressLines(address: ShippingCustomer['address']) {
  return [address.line1, address.line2, `${address.city}, ${address.state} ${address.postal_code}`, address.country].filter(Boolean);
}

function OrderLabels({ order, api, onTracking }: { order: StorefrontOrder; api: StaffApi; onTracking: (tracking: string) => void }) {
  const [labels, setLabels] = useState<ShippingLabel[]>([]);
  const [index, setIndex] = useState(0);
  const [parcel, setParcel] = useState<Partial<LabelParcel>>({});
  const [quote, setQuote] = useState<Awaited<ReturnType<StaffApi>> | null>(null);
  const [rate, setRate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transaction, setTransaction] = useState('');
  const count = order.shipping_quote?.parcels || 0;
  const load = async () => {
    const result = await api(`/api/storefront/labels?orderId=${order.id}`);
    if (!result.labels) throw new Error('Label records were missing from the response.');
    setLabels(result.labels);
    const complete = result.labels.filter(label => label.status === 'success');
    if (complete.length === count) onTracking(complete.map(label => `${label.rate.name}: ${label.tracking_number}`).join('; '));
  };
  useEffect(() => {
    let active = true;
    api(`/api/storefront/labels?orderId=${order.id}`).then(result => {
      if (!result.labels) throw new Error('Label records were missing from the response.');
      if (active) {
        setLabels(result.labels);
        if (result.labels.length === count && result.labels.every(label => label.status === 'success')) {
          onTracking(result.labels.map(label => `${label.rate.name}: ${label.tracking_number}`).join('; '));
        }
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load labels.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, count, onTracking, order.id]);
  const run = async (body?: unknown) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (body) await api('/api/storefront/labels', body);
      await load();
      setQuote(null); setConfirmed(false);
      setNotice('Label records refreshed. Review the package status below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Label action failed.');
      // A failed response may follow a completed charge; always reload the durable record.
      try { await load(); } catch (reloadError) { setError(current => `${current} ${reloadError instanceof Error ? reloadError.message : 'Label records could not reload.'}`); }
    } finally { setBusy(false); }
  };
  const getQuote = async () => {
    setBusy(true); setError(''); setNotice(''); setQuote(null); setConfirmed(false);
    try {
      const result = await api('/api/storefront/labels', { action: 'quote', orderId: order.id, index, parcel });
      if (!result.rates?.length || !result.token || !result.expires || !result.origin || !result.destination) throw new Error('Label quote response was incomplete.');
      setQuote(result);
      setRate(result.rates.find(r => r.name === order.shipping_quote?.rate.name)?.id || result.rates[0].id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not quote postage.'); }
    finally { setBusy(false); }
  };
  const current = labels.find(label => label.parcel_index === index);
  const selectedRate = quote?.rates?.find(r => r.id === rate);
  return <section className="space-y-4 rounded-lg border bg-background/50 p-4" aria-label="Shipping labels">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Postage & labels</h4><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => run()}>Refresh labels</Button></div>
    <p className="text-sm text-muted-foreground">Shipping collected: {money(order.shipping_cents)}. Postage is purchased separately from your Shippo balance/payment method. Buying a label does not mark an order shipped or send an email.</p>
    {error && <p role="alert" className="rounded border border-red-500 p-3 text-sm text-red-500">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading ? <p role="status">Loading label records...</p> : <>
      <label className="block text-sm">Package<select aria-label="Package" className="mt-1 w-full rounded border bg-background p-2" value={index} disabled={busy} onChange={e => { setIndex(Number(e.target.value)); setQuote(null); setConfirmed(false); setTransaction(''); }}>
        {Array.from({ length: count }, (_, i) => <option key={i} value={i}>Package {i + 1} of {count}{labels.find(l => l.parcel_index === i) ? ` - ${labels.find(l => l.parcel_index === i)!.status}` : ' - no label purchased'}</option>)}
      </select></label>
      {current ? <div className="space-y-3 text-sm">
        <p><strong>{current.rate.name} · {money(current.rate.amount)}</strong></p>
        <p>Status: <strong>{current.status}</strong> · Purchase reference <span className="break-all">{current.id}</span></p>
        {current.message && <p role="status">{current.message}</p>}
        {current.status === 'purchasing' && <p role="alert">A purchase was started. If its result is unknown, check Shippo before doing anything else. This package is locked against duplicate purchases.</p>}
        {current.status === 'success' && <><div className="flex flex-wrap gap-3"><a className="font-semibold underline" href={current.label_url!} target="_blank" rel="noreferrer">Open / print 4×6 PDF label</a>{current.tracking_url && <a className="underline" href={current.tracking_url} target="_blank" rel="noreferrer">Track package</a>}</div><p className="break-all">Tracking: {current.tracking_number}</p></>}
        {current.transaction_id ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ action: 'refresh', orderId: order.id, labelId: current.id })}>Check Shippo status</Button>
          : <div className="space-y-2"><p>Find the transaction in Shippo using purchase metadata <code className="break-all">storefront-label:{current.id}</code>. Enter its transaction ID to recover the label without purchasing again.</p><label className="block">Shippo transaction ID<input className="mt-1 w-full rounded border bg-background p-2" value={transaction} onChange={e => setTransaction(e.target.value.trim())}/></label><Button variant="outline" size="sm" disabled={busy || !/^[a-f0-9]{32}$/.test(transaction)} onClick={() => run({ action: 'refresh', orderId: order.id, labelId: current.id, transactionId: transaction })}>Reconcile existing purchase</Button></div>}
        {current.status === 'error' && <p role="alert">Review the failed transaction in Shippo. Automatic replacement purchases are blocked to avoid duplicate charges. Use an external label only after confirming no usable label exists.</p>}
      </div> : order.status === 'paid' && order.refunded_cents === 0 ? <>
        <p className="text-sm">Measure this packed package. Enter inches and its full packed weight in ounces. Do not guess or reuse an item-only weight.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['length', 'width', 'height', 'weight'] as const).map(key => <label className="text-sm" key={key}>{key === 'weight' ? 'Packed weight (oz)' : `${key[0].toUpperCase()}${key.slice(1)} (in)`}<input aria-label={`Package ${key}`} type="number" min="0.01" step="any" max={key === 'weight' ? 2400 : 108} value={parcel[key] ?? ''} disabled={busy} className="mt-1 w-full rounded border bg-background p-2" onChange={e => { setParcel(p => ({ ...p, [key]: e.target.value ? Number(e.target.value) : undefined })); setQuote(null); setConfirmed(false); }}/></label>)}</div>
        <Button variant="outline" disabled={busy || !['length','width','height','weight'].every(key => (parcel[key as keyof LabelParcel] || 0) > 0)} onClick={getQuote}>{busy ? 'Working...' : 'Get label prices'}</Button>
        {quote && <div className="space-y-3 border-t pt-4">
          <p className="text-sm"><strong>From:</strong> {quote.origin?.name}, {quote.origin && addressLines(quote.origin.address).join(', ')}</p>
          <p className="text-sm"><strong>To:</strong> {quote.destination?.name}, {quote.destination && addressLines(quote.destination.address).join(', ')}</p>
          <label className="block text-sm">Postage service<select aria-label="Postage service" className="mt-1 w-full rounded border bg-background p-2" value={rate} onChange={e => { setRate(e.target.value); setConfirmed(false); }}>{quote.rates?.map(r => <option key={r.id} value={r.id}>{r.name} - {money(r.amount)}{r.estimatedDays !== null ? ` - estimated ${r.estimatedDays} business days` : ''}</option>)}</select></label>
          {selectedRate?.name !== order.shipping_quote?.rate.name && <p className="text-sm text-amber-500" role="alert">This differs from the customer-selected service: {order.shipping_quote?.rate.name}. Confirm this change is appropriate before purchasing.</p>}
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I verified the packed measurements, delivery address and service. I authorize a real postage purchase of {selectedRate ? money(selectedRate.amount) : 'the selected amount'} for this package.</label>
          <Button disabled={busy || !confirmed || !selectedRate} onClick={() => run({ action: 'buy', orderId: order.id, token: quote.token, rateId: rate, confirm: true })}>{busy ? 'Purchasing...' : `Buy label - ${selectedRate ? money(selectedRate.amount) : ''}`}</Button>
          <p className="text-xs text-muted-foreground">Quote expires after 15 minutes. Carrier adjustments may apply for incorrect measurements. Never buy a second label while the first purchase is unresolved.</p>
        </div>}
      </> : <p className="text-sm">New labels are unavailable for shipped or refunded orders.</p>}
    </>}
  </section>;
}

export function StorefrontOrderCard({ order, api, action, busy, setup }: {
  order: StorefrontOrder; api: StaffApi; action: (body: unknown) => Promise<void>; busy: boolean; setup: string;
}) {
  const [tracking, setTracking] = useState(order.tracking || '');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [copyError, setCopyError] = useState('');
  const recipient = order.shipping_quote?.customer;
  const address = recipient?.address || order.customer?.shipping?.address;
  const name = recipient?.name || order.customer?.shipping?.name || order.customer?.contact?.name;
  const email = recipient?.email || order.customer?.contact?.email;
  const [copied, setCopied] = useState(false);
  return <article className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm" aria-label={`Order ${order.id.slice(0, 8)}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 p-5">
      <div><h3 className="text-lg font-bold">Order #{order.id.slice(0, 8)}</h3><p className="mt-1 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString()} · {order.kind === 'invoice' ? 'Requested-item invoice' : 'Online checkout'}</p></div>
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle[order.status] || 'bg-muted text-muted-foreground'}`}>{statusName[order.status] || order.status}</span>
    </header>
    <div className="space-y-5 p-5">
      <ul className="divide-y">{order.items.map((item, i) => <li className="flex justify-between gap-4 py-2 text-sm" key={i}><span><strong>{item.quantity} ×</strong> {item.title}</span><span className="shrink-0 font-semibold">{money(item.quantity * item.unit_amount)}</span></li>)}</ul>
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-4 text-sm sm:grid-cols-4">{([['Items', order.subtotal_cents], ['Shipping collected', order.shipping_cents], ['Sales tax', order.tax_cents], ['Paid total', order.total_cents]] as const).map(([label, cents]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{typeof cents === 'number' ? money(cents) : 'Not paid'}</dd></div>)}</dl>
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer-selected shipping</p><p className="mt-1 font-bold">{order.shipping_quote?.rate.name || 'Service not saved - review in Stripe'}</p><p className="mt-1 text-sm text-muted-foreground">{order.shipping_quote ? `${order.shipping_quote.parcels} package${order.shipping_quote.parcels === 1 ? '' : 's'} quoted at checkout. Confirm the actual packed measurements before buying postage.` : 'Do not guess the shipping service or delivery address.'}</p></div>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Delivery details"><div><h4 className="text-sm font-semibold">Ship to</h4>{address ? <address className="mt-2 text-sm not-italic leading-6"><strong>{name}</strong>{addressLines(address).map((line, i) => <div key={i}>{line}</div>)}</address> : <p className="mt-2 text-sm text-amber-500">No saved delivery address. Review the order in Stripe before fulfillment.</p>}</div><div><h4 className="text-sm font-semibold">Customer contact</h4><p className="mt-2 break-words text-sm">{email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : 'Email not saved'}</p>{order.kind === 'invoice' && <p className="mt-2 text-xs text-muted-foreground">{order.email_sent ? 'Invoice email sent by Stripe.' : 'Invoice email not yet sent.'}</p>}</div></section>
      {order.refunded_cents > 0 && <p role="status" className="rounded border border-amber-500 p-3 text-sm">Refunded: {money(order.refunded_cents)}. Review before shipping. Refunds do not automatically restock inventory.</p>}
      {order.tracking && <p className="break-words rounded border p-3 text-sm"><strong>Saved tracking:</strong> {order.tracking}</p>}
      {order.payment_url && ['creating','pending'].includes(order.status) && <div className="flex flex-wrap items-center gap-3 text-sm"><a href={order.payment_url} target="_blank" rel="noreferrer" className="underline">Open Stripe payment page</a><Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(order.payment_url!); setCopied(true); setCopyError(''); } catch { setCopyError('Could not copy. Open the payment page to copy its address.'); } }}>{copied ? 'Copied' : 'Copy payment link'}</Button>{copyError && <p role="alert">{copyError}</p>}</div>}
      {['creating','pending'].includes(order.status) && <div className="flex flex-wrap gap-2"><Button disabled={busy || !!setup} onClick={() => action({ action: 'retry', id: order.id })}>Recover checkout</Button><Button variant="outline" disabled={busy} onClick={() => action({ action: 'cancel', id: order.id })}>Cancel & release stock</Button></div>}
      {['paid','shipped'].includes(order.status) && order.shipping_quote && <div className="space-y-3"><Button variant="outline" onClick={() => setLabelsOpen(v => !v)}>{labelsOpen ? 'Hide postage & labels' : 'Manage postage & labels'}</Button>{labelsOpen && <OrderLabels order={order} api={api} onTracking={setTracking}/>}</div>}
      {order.status === 'paid' && <form className="space-y-3 border-t pt-4" onSubmit={e => { e.preventDefault(); action({ action: 'ship', id: order.id, tracking }); }}><h4 className="font-semibold">Dispatch order</h4><p className="text-xs text-muted-foreground">Buy and print the label above, or enter tracking from an external label. Mark shipped when the package is dispatched, not merely when a label is printed. No shipping email is sent yet.</p><div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Carrier and tracking number<input name="tracking" required minLength={3} maxLength={2000} value={tracking} onChange={e => setTracking(e.target.value)} className="mt-1 w-full rounded border bg-background p-3"/></label><Button disabled={busy || order.refunded_cents > 0} type="submit">Mark shipped</Button></div></form>}
    </div>
  </article>;
}
