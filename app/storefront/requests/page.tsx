'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { ShippingQuotePicker, type ShippingSelection } from '@/components/storefront-shipping-quote';
import { StorefrontOrderCard, type StorefrontOrder } from '@/components/storefront-order-card';

type ItemRequest = { id:string; name:string; email:string; item:string; platform:string; notes:string; status:string;
  address:{line1:string;line2:string;city:string;state:string;postal_code:string;country:string}; created_at:string };
type Product = {id:string;title:string;price:number;quantity:number;platform:string;condition:string};
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
  const [orders,setOrders]=useState<StorefrontOrder[]>([]);
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
  const [view,setView]=useState<'orders'|'requests'>('orders');
  const [orderFilter,setOrderFilter]=useState('all');
  const [orderQuery,setOrderQuery]=useState('');
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
  const visibleOrders=orders.filter(order=>(orderFilter==='all'||order.status===orderFilter||orderFilter==='pending'&&order.status==='creating')
    && `${order.id} ${order.items.map(item=>item.title).join(' ')} ${order.shipping_quote?.customer.name||''}`.toLowerCase().includes(orderQuery.toLowerCase()))
    .sort((a,b)=>Number(b.status==='paid')-Number(a.status==='paid')||b.created_at.localeCompare(a.created_at));
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Pixel & Page · Fulfillment</p><h1 className="text-2xl font-bold sm:text-3xl">Shop requests & orders</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review paid orders, prepare the customer-selected shipping service, and purchase postage when the package is ready. Online only; no local pickup.</p></div><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/storefront/shipping">Shipping & packages</Link></Button><Button asChild variant="outline"><Link href="/storefront">Inventory & pricing</Link></Button><Button disabled={busy||loading} onClick={load}>Refresh</Button></div></header>
    {!isAdmin?<p role="alert">Store administrator access is required.</p>:<>
      {error&&<p role="alert" className="rounded-lg border border-red-500 p-4 text-red-500">{error}</p>}
      {notice&&<p role="status" className="rounded-lg border p-4">{notice}</p>}
      {setup&&<p className="rounded-lg border border-amber-500 p-4">Payments are not ready: {setup} Requests can still be reviewed. No live payments are enabled by this screen.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Current page overview">{[
        ['Ready to ship',orders.filter(o=>o.status==='paid').length],
        ['Awaiting payment',orders.filter(o=>['pending','creating'].includes(o.status)).length],
        ['Shipped',orders.filter(o=>o.status==='shipped').length],
        ['Open requests',requests.filter(r=>['new','reviewing'].includes(r.status)).length],
      ].map(([label,count])=><div className="rounded-xl border bg-card p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{count}</p></div>)}</div>
      <div className="flex flex-wrap gap-2 border-b pb-3" aria-label="Fulfillment views"><Button variant={view==='orders'?'default':'outline'} aria-pressed={view==='orders'} onClick={()=>setView('orders')}>Orders & invoices ({orders.length})</Button><Button variant={view==='requests'?'default':'outline'} aria-pressed={view==='requests'} onClick={()=>setView('requests')}>Customer requests ({requests.length})</Button></div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page===0||loading||busy} onClick={()=>setPage(value=>value-1)}>Previous</Button><span>Page {page+1} · up to 50 requests and 50 orders</span><Button variant="outline" disabled={loading||busy||(requests.length<50&&orders.length<50)} onClick={()=>setPage(value=>value+1)}>Next</Button></div>
      {loading?<p role="status">Loading requests and orders...</p>:<div>
        {view==='requests'&&<section className="space-y-4"><h2 className="text-xl font-semibold">Customer requests</h2>{!requests.length&&<div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No requests on this page. Requests submitted by shoppers will appear here for review.</div>}
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
        </section>}
        {view==='orders'&&<section className="space-y-5" aria-label="Orders and invoices">
          <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Find order<input className="mt-1 w-full rounded-md border bg-background p-3" value={orderQuery} onChange={e=>setOrderQuery(e.target.value)} placeholder="Item, customer, or order reference"/></label><label className="text-sm">Order status<select aria-label="Order status" className="mt-1 w-full rounded-md border bg-background p-3" value={orderFilter} onChange={e=>setOrderFilter(e.target.value)}><option value="all">All orders</option><option value="paid">Ready to ship</option><option value="pending">Awaiting payment</option><option value="shipped">Shipped</option><option value="cancelled">Cancelled</option></select></label></div>
          <p className="text-xs text-muted-foreground">Counts, search and filters apply to this page. Paid orders are shown first.</p>
          {!visibleOrders.length&&<p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No matching orders on this page.</p>}
          <div className={`grid items-start gap-5 ${visibleOrders.length>1?'xl:grid-cols-2':''}`}>{visibleOrders.map(order=><StorefrontOrderCard key={order.id} order={order} api={api} action={action} busy={busy} setup={setup}/>)}</div>
        </section>}
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
