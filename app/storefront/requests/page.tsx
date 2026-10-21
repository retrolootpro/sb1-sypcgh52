'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { ShippingQuotePicker, type ShippingSelection } from '@/components/storefront-shipping-quote';

type ItemRequest = { id:string; name:string; email:string; item:string; platform:string; notes:string; status:string;
  address:{line1:string;line2:string;city:string;state:string;postal_code:string;country:string}; created_at:string };
type Product = {id:string;title:string;price:number;quantity:number;platform:string;condition:string};
type Order = {id:string;request_id:string|null;kind:string;status:string;stripe_id:string|null;payment_url:string|null;email_sent:boolean;
  items:{title:string;quantity:number;unit_amount:number}[];subtotal_cents:number;total_cents:number|null;tax_cents:number;shipping_cents:number;
  customer:unknown;tracking:string|null;refunded_cents:number;created_at:string};
type Rate = {id:string;name:string;amount:number};
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;

async function api(path:string,body?:unknown) {
  const {data:{session},error}=await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in again to manage requests.');
  const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',
    headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if (!response.ok||!result.success) throw new Error(result.message||'Storefront action failed.');
  return result;
}

export default function StorefrontRequestsPage() {
  const {accountId,isAdmin}=useAuth();
  const [requests,setRequests]=useState<ItemRequest[]>([]);
  const [orders,setOrders]=useState<Order[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [rates,setRates]=useState<Rate[]>([]);
  const [shippingRate,setShippingRate]=useState('');
  const [carrierShipping,setCarrierShipping]=useState(false);
  const [shipping,setShipping]=useState<ShippingSelection|null>(null);
  const [selected,setSelected]=useState('');
  const [lines,setLines]=useState<Record<string,number>>({});
  const [query,setQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [setup,setSetup]=useState('');
  const [page,setPage]=useState(0);
  const customer=requests.find(row=>row.id===selected);

  const load=useCallback(async()=>{
    if (!accountId||!isAdmin) {setLoading(false);return;}
    setLoading(true);setError('');
    try {
      const result=await api(`/api/storefront/manage?page=${page}`);
      const response=await fetch('/api/storefront/catalog',{cache:'no-store'});
      const catalog=await response.json();
      if (!response.ok||!catalog.success) throw new Error(catalog.message||'Inventory could not load.');
      setRequests(result.requests);setOrders(result.orders);setProducts(catalog.products);setRates(result.shippingRates);
      setShippingRate(current=>result.shippingRates.some((rate:Rate)=>rate.id===current)?current:result.shippingRates[0]?.id||'');
      setSetup(result.setupMessage);
      setCarrierShipping(!!result.carrierShipping);
    } catch(cause) {console.error('Storefront manager:',cause);setError(cause instanceof Error?cause.message:'Could not load requests.');}
    finally {setLoading(false);}
  },[accountId,isAdmin,page]);
  useEffect(()=>{setSelected('');setLines({});load();},[load]);
  const action=async(body:unknown)=>{
    setBusy(true);setError('');setNotice('');
    try {const result=await api('/api/storefront/manage',body);await load();setNotice(result.url?'Invoice/payment link is ready. Open or copy it from the order below.':'Action completed.');}
    catch(cause) {console.error('Storefront manager action:',cause);setError(cause instanceof Error?cause.message:'Action failed.');}
    finally {setBusy(false);}
  };
  const invoice=async()=>{
    if (!customer) return;
    if (carrierShipping && (!shipping || shipping.expires <= Date.now())) {setError('Get fresh shipping options before creating an invoice.');return;}
    let orderId:string;
    try {
      const key=`storefront-invoice-${customer.id}`;
      orderId=sessionStorage.getItem(key)||crypto.randomUUID();
      sessionStorage.setItem(key,orderId);
    } catch {setError('Enable browser storage before creating an invoice.');return;}
    await action({action:'invoice',requestId:customer.id,orderId,shippingRate:shipping?.shippingRate||shippingRate,...(shipping?{shippingToken:shipping.shippingToken}:{}),items:Object.entries(lines).map(([id,quantity])=>({id,quantity}))});
  };
  const matching=products.filter(row=>`${row.title} ${row.platform} ${row.condition}`.toLowerCase().includes(query.toLowerCase())).slice(0,40);
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Shop requests & orders</h1><p className="mt-2 text-sm text-muted-foreground">Review guest requests, source items into RetroLoot, then email a Stripe invoice. All purchases ship; there is no local pickup.</p></div><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/storefront/shipping">Shipping & packages</Link></Button><Button asChild variant="outline"><Link href="/storefront">Inventory & pricing</Link></Button><Button disabled={busy||loading} onClick={load}>Refresh</Button></div></header>
    {!isAdmin?<p role="alert">Store administrator access is required.</p>:<>
      {error&&<p role="alert" className="rounded-lg border border-red-500 p-4 text-red-500">{error}</p>}
      {notice&&<p role="status" className="rounded-lg border p-4">{notice}</p>}
      {setup&&<p className="rounded-lg border border-amber-500 p-4">Payments are not ready: {setup} Requests can still be reviewed. No live payments are enabled by this screen.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page===0||loading||busy} onClick={()=>setPage(value=>value-1)}>Previous</Button><span>Page {page+1} · up to 50 requests and 50 orders</span><Button variant="outline" disabled={loading||busy||(requests.length<50&&orders.length<50)} onClick={()=>setPage(value=>value+1)}>Next</Button></div>
      {loading?<p role="status">Loading requests and orders...</p>:<div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4"><h2 className="text-xl font-semibold">Customer requests</h2>{!requests.length&&<p>No requests on this page.</p>}
          {requests.map(row=><article key={row.id} className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{row.item}</h3><span>{row.status}</span></div>
            <p className="break-words text-sm">{row.name} · <a className="underline" href={`mailto:${row.email}`}>{row.email}</a> · {row.platform}</p><p className="whitespace-pre-wrap break-words text-sm">{row.notes}</p>
            <p className="text-sm text-muted-foreground">{Object.values(row.address).filter(Boolean).join(', ')}</p>
            {['new','reviewing'].includes(row.status)&&<div className="flex flex-wrap gap-2">
              <Button disabled={busy} variant="outline" onClick={()=>action({action:'review',id:row.id})}>Mark reviewing</Button>
              <Button disabled={busy||!!setup} onClick={()=>{setSelected(row.id);setLines({});setError('');}}>Create an invoice</Button>
              <Button disabled={busy} variant="outline" onClick={()=>action({action:'close',id:row.id})}>Close request</Button>
            </div>}
          </article>)}
        </section>
        <section className="space-y-4"><h2 className="text-xl font-semibold">Orders & invoices</h2>{!orders.length&&<p>No orders on this page.</p>}
          {orders.map(order=><article className="space-y-3 rounded-xl border bg-card p-5" key={order.id}>
            <h3 className="break-all font-bold">{order.kind} · {order.status} · {order.id.slice(0,8)}</h3>
            <ul className="text-sm">{order.items.map((item,index)=><li key={index}>{item.quantity} × {item.title} · {money(item.quantity*item.unit_amount)}</li>)}</ul>
            <p className="text-sm">Item subtotal {money(order.subtotal_cents)}{order.total_cents!==null?` · Paid total ${money(order.total_cents)} · Tax ${money(order.tax_cents)} · Shipping ${money(order.shipping_cents)}`:''}</p>
            {order.refunded_cents>0&&<p>Refunded: {money(order.refunded_cents)}. Inspect returned items before manually restocking.</p>}
            {order.customer!=null&&<details><summary className="cursor-pointer text-sm">Shipping / contact details</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(order.customer,null,2)}</pre></details>}
            {order.tracking&&<p className="break-words text-sm">Tracking: {order.tracking}</p>}
            {order.payment_url&&<div className="flex flex-wrap gap-3"><a href={order.payment_url} target="_blank" rel="noreferrer" className="underline">Open Stripe payment page</a><Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(order.payment_url!);setNotice('Payment link copied.');}catch{setError('Could not copy. Open the Stripe link and copy its address.');}}}>Copy payment link</Button></div>}
            {order.kind==='invoice'&&<p className="text-sm">{order.email_sent?'Invoice email sent by Stripe.':'Invoice email not yet sent. Use Retry if creation was interrupted.'}</p>}
            {['creating','pending'].includes(order.status)&&<div className="flex flex-wrap gap-2"><Button disabled={busy||!!setup} onClick={()=>action({action:'retry',id:order.id})}>Retry / recover payment</Button><Button variant="outline" disabled={busy} onClick={()=>action({action:'cancel',id:order.id})}>Cancel unpaid order & release stock</Button></div>}
            {order.status==='paid'&&<form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();const tracking=String(new FormData(event.currentTarget).get('tracking')||'');action({action:'ship',id:order.id,tracking});}}><label className="min-w-0 flex-1 text-sm">Carrier and tracking number<input name="tracking" required minLength={3} maxLength={200} className="mt-1 w-full rounded-md border bg-background p-2"/></label><Button disabled={busy} type="submit">Mark shipped</Button></form>}
          </article>)}
        </section>
      </div>}
      {customer&&<section className="space-y-4 rounded-xl border bg-card p-5" aria-label="Create invoice">
        <h2 className="text-xl font-bold">Invoice for {customer.name}: {customer.item}</h2><p>Only in-stock, priced inventory can be invoiced. Update the price in Storefront Manager before selecting an item. Shipping and automatic tax are added by Stripe. The invoice is emailed immediately.</p>
        <label className="block">Search inventory<input value={query} onChange={event=>setQuery(event.target.value)} className="mt-2 w-full rounded-md border bg-background p-3"/></label>
        <div className="max-h-80 space-y-2 overflow-y-auto">{matching.map(item=><label key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><span className="flex-1">{item.title} · {item.platform} · {item.condition} · ${item.price.toFixed(2)} · {item.quantity} available</span><input type="number" aria-label={`Invoice quantity for ${item.title}`} min={0} max={Math.min(20,item.quantity)} value={lines[item.id]||0} className="w-20 rounded border bg-background p-2" onChange={event=>{const quantity=Number(event.target.value);setLines(current=>{const next={...current};if(quantity>0)next[item.id]=quantity;else delete next[item.id];return next;});}}/></label>)}</div>
        <p>{Object.keys(lines).length} selected item(s). Item subtotal ${Object.entries(lines).reduce((sum,[id,quantity])=>sum+(products.find(item=>item.id===id)?.price||0)*quantity,0).toFixed(2)}.</p>
        {carrierShipping ? <ShippingQuotePicker items={Object.entries(lines).map(([id,quantity])=>({id,quantity}))} requestId={customer.id} onSelect={setShipping} disabled={busy}/>
          : <label className="block">Stripe shipping rate<select value={shippingRate} onChange={event=>setShippingRate(event.target.value)} className="mt-2 w-full rounded border bg-background p-3">{rates.map(rate=><option key={rate.id} value={rate.id}>{rate.name} · {money(rate.amount)}</option>)}</select></label>}
        <div className="flex flex-wrap gap-3"><Button disabled={busy||!!setup||!(carrierShipping?shipping:shippingRate)||!Object.keys(lines).length} onClick={invoice}>{busy?'Creating invoice...':'Create & email Stripe invoice'}</Button><Button variant="outline" onClick={()=>setSelected('')} disabled={busy}>Close editor</Button></div>
      </section>}
    </>}
  </div></DashboardLayout>;
}
