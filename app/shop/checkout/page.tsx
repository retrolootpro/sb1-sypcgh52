'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LockKeyhole, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Product = { id: string; title: string; price: number; quantity: number; thumbnail_url?: string | null; image_url?: string | null };

export default function CheckoutPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [fulfillment, setFulfillment] = useState<'shipping' | 'pickup'>('shipping');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    try { setCart(JSON.parse(window.localStorage.getItem('pixel-page-cart') || '{}')); } catch { setCart({}); }
    supabase.rpc('get_storefront_products', { requested_slug: 'pixel-and-page' }).then(({ data }) => {
      if (data) setProducts(data.map((item: any) => ({ ...item, price: Number(item.price || 0), quantity: Number(item.quantity || 0) })));
    });
  }, []);

  const items = useMemo(() => products.filter((item) => cart[item.id]), [products, cart]);
  const subtotal = items.reduce((sum, item) => sum + item.price * Math.min(cart[item.id], item.quantity), 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/storefront/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((item) => ({ id: item.id, quantity: Math.min(cart[item.id], item.quantity) })),
        fulfillment,
        customer: {
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          email: form.get('email'),
          phone: form.get('phone'),
          address1: form.get('address1'),
          address2: form.get('address2'),
          city: form.get('city'),
          state: form.get('state'),
          postalCode: form.get('postalCode'),
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.href) window.location.href = result.href;
    else setMessage(result.message || 'Checkout could not be started.');
    setSubmitting(false);
  };

  return (
    <main className="commerce-checkout">
      <section>
        <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft size={14}/> Continue shopping</Link>
        <h1>Checkout</h1>
        {items.length === 0 ? <div className="commerce-checkout-section"><h2>Your cart is empty</h2><p>Return to the shop to add live inventory.</p><Link href="/shop">Browse products</Link></div> : <form onSubmit={submit}>
          <div className="commerce-checkout-section">
            <h2>1. Contact information</h2>
            <div className="commerce-form-grid">
              <label>First name<input name="firstName" required/></label>
              <label>Last name<input name="lastName" required/></label>
              <label className="full">Email<input type="email" name="email" required/></label>
              <label className="full">Phone<input name="phone"/></label>
            </div>
          </div>
          <div className="commerce-checkout-section">
            <h2>2. Delivery method</h2>
            <div className="commerce-page-grid">
              <button type="button" className="commerce-page-card" onClick={() => setFulfillment('shipping')} style={{textAlign:'left',borderColor:fulfillment==='shipping'?'#2b8b86':undefined}}><Truck/><h3>Ship my order</h3><p>Shipping information and timing are confirmed during checkout.</p></button>
              <button type="button" className="commerce-page-card" onClick={() => setFulfillment('pickup')} style={{textAlign:'left',borderColor:fulfillment==='pickup'?'#2b8b86':undefined}}><MapPin/><h3>Local pickup</h3><p>Pick up at Pixel & Page in the Daytona Flea Market.</p></button>
            </div>
          </div>
          {fulfillment === 'shipping' && <div className="commerce-checkout-section">
            <h2>3. Shipping address</h2>
            <div className="commerce-form-grid">
              <label className="full">Address<input name="address1" required/></label>
              <label className="full">Apartment, suite, etc.<input name="address2"/></label>
              <label>City<input name="city" required/></label>
              <label>State<input name="state" required/></label>
              <label>ZIP code<input name="postalCode" required/></label>
            </div>
          </div>}
          {message && <div className="commerce-checkout-section" style={{borderColor:'#c95d31'}}><strong>{message}</strong><p>The storefront is ready to redirect to Clover Hosted Checkout once the production merchant credentials are saved in Netlify.</p></div>}
          <button type="submit" style={{width:'100%',height:52,border:0,borderRadius:11,background:'#c95d31',color:'#fff',fontWeight:900}} disabled={submitting}>{submitting ? 'Starting secure checkout…' : 'Continue to secure payment'}</button>
        </form>}
      </section>
      <aside className="commerce-checkout-summary">
        <h2>Order summary</h2>
        {items.map((item) => <div className="commerce-checkout-summary-row" key={item.id}><span>{item.title} × {Math.min(cart[item.id], item.quantity)}</span><strong>${(item.price*Math.min(cart[item.id],item.quantity)).toFixed(2)}</strong></div>)}
        <div className="commerce-checkout-summary-row"><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
        <div className="commerce-checkout-summary-row"><span>{fulfillment === 'pickup' ? 'Pickup' : 'Shipping'}</span><strong>{fulfillment === 'pickup' ? 'Free' : 'At payment'}</strong></div>
        <p className="commerce-checkout-note"><LockKeyhole size={13}/> Payment is completed on Clover’s secure checkout page.</p>
        <p className="commerce-checkout-note"><ShieldCheck size={13}/> Your cart is revalidated against live RetroLootPro inventory before payment.</p>
      </aside>
    </main>
  );
}
