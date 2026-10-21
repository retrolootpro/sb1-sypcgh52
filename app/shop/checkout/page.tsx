'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseSavedCart } from '@/lib/storefront-model';
import { ShippingQuotePicker, type ShippingSelection } from '@/components/storefront-shipping-quote';

type Product = { id: string; slug: string; title: string; quantity: number; price: number };
type Attempt = { orderId: string; items: { id: string; quantity: number }[]; shippingToken?: string; shippingRate?: string };

export default function CheckoutPage() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string,number>>({});
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const [carrierShipping, setCarrierShipping] = useState(false);
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        if (sessionId) {
          const response = await fetch(`/api/storefront/checkout?session_id=${encodeURIComponent(sessionId)}`, {cache:'no-store'});
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'Payment status could not be checked.');
          if (cancelled) return;
          const paid = ['paid','shipped'].includes(result.status);
          setStatus(paid ? 'paid' : result.status === 'cancelled' ? 'cancelled' : 'processing');
          if (paid) {
            const receiptKey = `pixel-page-receipt-${sessionId}`;
            if (!localStorage.getItem(receiptKey)) {
              const saved = parseSavedCart(localStorage.getItem('pixel-page-cart'));
              for (const item of result.purchased as {id:string;quantity:number}[]) {
                if (saved[item.id]) { saved[item.id] = Math.max(0,saved[item.id]-item.quantity); if (!saved[item.id]) delete saved[item.id]; }
              }
              localStorage.setItem('pixel-page-cart',JSON.stringify(saved));
              localStorage.setItem(receiptKey,'confirmed');
              sessionStorage.removeItem('pixel-page-checkout');
            }
          } else if (result.status !== 'cancelled') timer = setTimeout(load,3000);
        } else {
          const configuration=await fetch('/api/storefront/checkout',{cache:'no-store'});
          const setup=await configuration.json();
          if (!configuration.ok) throw new Error(setup.message||'Checkout configuration could not load.');
          if (!cancelled) {setReady(setup.paymentReady);setSetupMessage(setup.message||'');setCarrierShipping(!!setup.carrierShipping);}
          const saved = parseSavedCart(localStorage.getItem('pixel-page-cart'));
          const previous = sessionStorage.getItem('pixel-page-checkout');
          if (previous) {
            const value: Attempt = JSON.parse(previous);
            if (typeof value.orderId !== 'string' || !Array.isArray(value.items)) throw new Error('Saved checkout is invalid. Contact support before starting another payment.');
            if (!cancelled) setAttempt(value);
          }
          const response = await fetch('/api/storefront/catalog',{cache:'no-store'});
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'Cart inventory could not load.');
          if (!cancelled) {setProducts(result.products);setCart(saved);}
        }
      } catch (cause) {if (!cancelled) setError(cause instanceof Error ? cause.message : 'Checkout failed. Contact support.');}
      finally {if (!cancelled) setLoading(false);}
    };
    load();
    return () => {cancelled=true;clearTimeout(timer);};
  },[sessionId]);

  const update = (id:string,quantity:number) => {
    try {
      const next={...cart};
      if (quantity<=0) delete next[id]; else next[id]=quantity;
      localStorage.setItem('pixel-page-cart',JSON.stringify(next)); setCart(next);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Cart could not be saved.');}
  };
  const pay = async (resume=false) => {
    setBusy(true);setError('');
    try {
      const items=Object.entries(cart).map(([id,quantity])=>({id,quantity}));
      if (!resume && carrierShipping && (!shipping || shipping.expires <= Date.now())) throw new Error('Get fresh shipping options before continuing.');
      const input=resume && attempt ? attempt : {orderId:crypto.randomUUID(),items,...(shipping ? { shippingToken: shipping.shippingToken, shippingRate: shipping.shippingRate } : {})};
      sessionStorage.setItem('pixel-page-checkout',JSON.stringify(input));setAttempt(input);
      const response=await fetch('/api/storefront/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      const result=await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Checkout could not start.');
      window.location.assign(result.url);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Checkout failed. Contact support.');}
    finally {setBusy(false);}
  };
  const cancel = async () => {
    if (!attempt) return;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/storefront/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...attempt,action:'cancel'})});
      const result=await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Checkout could not be cancelled.');
      sessionStorage.removeItem('pixel-page-checkout');window.location.assign('/shop/checkout');
    } catch(cause) {setError(cause instanceof Error ? cause.message : 'Cancellation failed. Contact support.');}
    finally {setBusy(false);}
  };
  const missing=Object.entries(cart).some(([id,quantity])=>!products.some(product=>product.id===id&&product.quantity>=quantity));
  const subtotal=Object.entries(cart).reduce((sum,[id,quantity])=>sum+(products.find(product=>product.id===id)?.price||0)*quantity,0);
  const blockedReason = !ready ? 'Online payments are currently unavailable. You can review your cart and shipping options, but cannot place an order yet.'
    : attempt ? 'Resume or cancel your previous checkout before starting another.'
    : missing ? 'Update unavailable items before continuing.'
    : carrierShipping && !shipping ? 'Enter your delivery address and choose a shipping service to continue.'
    : 'You will review automatic tax and the final total securely in Stripe before paying.';
  return <main className="commerce-page reference-checkout">
    <header className="commerce-page-header"><Link href="/shop#catalog">Back to shopping</Link><p className="commerce-kicker">SECURE ONLINE SHOPPING</p><h1>{sessionId?'Payment confirmation':'Checkout'}</h1><p>Delivery details, shipping options, then secure payment with Stripe. No account required.</p>
      {!sessionId && <ol className="checkout-steps" aria-label="Checkout steps"><li>1. Delivery</li><li>2. Shipping</li><li>3. Stripe payment</li></ol>}
    </header>
    {error && <div role="alert" className="reference-error">{error} <a href="mailto:support@pixelandpagellc.com">Contact support</a></div>}
    {!sessionId && setupMessage && <section className="checkout-notice" role="status"><strong>Online checkout is not open yet</strong><p>{setupMessage}</p><Link href="/shop/request">Request an item instead</Link></section>}
    {loading?<p role="status">Loading checkout...</p>: sessionId ? <section className="commerce-page-card" role="status">
      <h2>{status==='paid'?'Payment confirmed':status==='cancelled'?'Checkout expired or cancelled':'Confirming your payment'}</h2>
      <p>{status==='paid'?'Thank you! Your payment is confirmed. Keep your Stripe receipt for reference. Contact support for shipping questions.':status==='cancelled'?'No purchase was completed for this checkout. Return to your cart to review current availability.':'A redirect alone does not confirm payment. We are waiting for secure confirmation from Stripe. Do not pay again; contact support if this message persists.'}</p>
      <Link href="/shop">Continue shopping</Link>
    </section>:<>
      {attempt && <section className="commerce-page-card"><h2>Previous checkout</h2><p>You have a previous checkout attempt. Resume it, or cancel it to release any reserved stock before starting another. If a payment was already made, do not start another checkout.</p><div className="reference-page-actions"><button disabled={busy} onClick={()=>pay(true)}>Resume checkout</button><button disabled={busy} onClick={cancel}>Cancel previous checkout</button></div></section>}
      {!Object.keys(cart).length?<section className="commerce-page-card"><h2>Your cart is empty</h2><Link href="/shop#catalog">Browse inventory</Link></section>:<div className="checkout-layout">
        <div className="checkout-delivery">
          {carrierShipping && !attempt ? <ShippingQuotePicker items={Object.entries(cart).map(([id,quantity])=>({id,quantity}))} onSelect={setShipping} disabled={busy||missing}/>
            : <section className="commerce-page-card"><h2>{attempt ? 'Your checkout is saved' : 'Delivery & payment'}</h2><p>{attempt ? 'Use the previous-checkout controls above to resume secure payment or cancel your reservation.' : 'Your delivery address and available shipping services will be collected in Stripe before payment.'}</p></section>}
          <section className="commerce-page-card checkout-payment-info"><h2>Secure payment</h2><p>Your card details are entered only on Stripe. Shipping is to the delivery address you provide; no local pickup is available.</p><p>Tax and the final total are shown before you pay. Your cart does not reserve inventory until checkout starts.</p></section>
        </div>
        <section className="commerce-page-card checkout-summary" aria-label="Order summary">
        <h2>Order summary</h2>
        <ul className="reference-cart-list">{Object.entries(cart).map(([id,quantity])=>{
          const product=products.find(item=>item.id===id);
          return <li key={id}><div>{product?<Link href={`/shop/product/${product.slug}`}>{product.title}</Link>:<strong>Item no longer available</strong>}<p>{product?`$${product.price.toFixed(2)} each - ${product.quantity} available`:'Remove this item or request help finding it.'}</p></div><label>Quantity<input type="number" min={1} max={Math.min(20,product?.quantity||20)} value={quantity} disabled={!!attempt} onChange={event=>update(id,Number(event.target.value))}/></label><button disabled={!!attempt} onClick={()=>update(id,0)}>Remove</button></li>;
        })}</ul>
        <h2 className="checkout-subtotal">Item subtotal: ${subtotal.toFixed(2)}</h2>
        <dl className="checkout-totals"><div><dt>Shipping{shipping ? ` · ${shipping.name}` : ''}</dt><dd>{shipping ? `$${(shipping.amount/100).toFixed(2)}` : 'Not calculated'}</dd></div><div><dt>Sales tax</dt><dd>Calculated in Stripe</dd></div>
          <div className="checkout-total"><dt>Total before tax</dt><dd>${(subtotal+(shipping?.amount||0)/100).toFixed(2)}{!shipping&&carrierShipping?' + shipping':''}</dd></div></dl>
        {missing && <p role="alert">Availability changed or items are reserved by your previous checkout. Resume or cancel it, or remove unavailable items before starting a new checkout.</p>}
        <p id="checkout-next-step" className="checkout-next-step" role="status">{blockedReason}</p>
        <button className="reference-primary checkout-pay" aria-describedby="checkout-next-step" disabled={busy||missing||!!attempt||!ready||(carrierShipping&&!shipping)} onClick={()=>pay()}>{busy?'Connecting to Stripe...':!ready?'Online payments unavailable':'Continue to Stripe checkout'}</button>
        <p className="checkout-payment-caption">Secure payment powered by Stripe</p>
      </section></div>}
      <div className="reference-page-actions"><Link href="/shop#catalog">Continue shopping</Link><Link href="/shop/request">Request an item</Link><button disabled={busy||!!attempt} onClick={()=>{try{localStorage.removeItem('pixel-page-cart');setCart({});setError('');}catch{setError('Browser storage is unavailable.');}}}>Clear cart</button></div>
    </>}
  </main>;
}
