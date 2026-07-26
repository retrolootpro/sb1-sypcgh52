'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LockKeyhole, MapPin, ShieldCheck, Truck } from 'lucide-react';

type Product = { id: string; title: string; price: number; quantity: number; thumbnail_url?: string | null; image_url?: string | null };

export default function CheckoutPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [fulfillment, setFulfillment] = useState<'shipping' | 'pickup'>('shipping');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    try { setCart(JSON.parse(window.localStorage.getItem('pixel-page-cart') || '{}')); } catch { setCart({}); }
    fetch('/api/storefront/catalog', { cache: 'no-store' })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) throw new Error(result.message || 'Inventory could not be loaded.');
        setProducts((result.products || []).map((item: Product) => ({ ...item, price: Number(item.price || 0), quantity: Number(item.quantity || 0) })));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Inventory could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const items = useMemo(() => products.filter((item) => cart[item.id]), [products, cart]);
  const subtotal = items.reduce((sum, item) => sum + item.price * Math.min(cart[item.id], item.quantity), 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="commerce-checkout">
      <section>
        <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft/>Continue shopping</Link>
        <h1>Checkout</h1>
        {loading ? <div className="commerce-checkout-section"><h2>Loading your cart...</h2></div> : items.length === 0 ? <div className="commerce-checkout-section"><h2>Your cart is empty</h2><p>Return to the shop to add live inventory.</p><Link href="/shop">Browse products</Link></div> : <form onSubmit={submit}>
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
              <button type="button" className="commerce-page-card" onClick={() => setFulfillment('shipping')} aria-pressed={fulfillment === 'shipping'}><Truck/><h3>Ship my order</h3><p>Shipping information and timing are confirmed during checkout.</p></button>
              <button type="button" className="commerce-page-card" onClick={() => setFulfillment('pickup')} aria-pressed={fulfillment === 'pickup'}><MapPin/><h3>Local pickup</h3><p>Pick up at Pixel & Page in the Daytona Flea Market.</p></button>
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
          {message && <div className="commerce-checkout-section commerce-checkout-message"><strong>{message}</strong></div>}
          <button type="submit" className="commerce-checkout-submit" disabled={submitting}>{submitting ? 'Starting secure checkout...' : 'Continue to secure payment'}</button>
        </form>}
      </section>
      <aside className="commerce-checkout-summary">
        <h2>Order summary</h2>
        {items.map((item) => <div className="commerce-checkout-summary-row" key={item.id}><span>{item.title} x {Math.min(cart[item.id], item.quantity)}</span><strong>${(item.price * Math.min(cart[item.id], item.quantity)).toFixed(2)}</strong></div>)}
        <div className="commerce-checkout-summary-row"><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
        <div className="commerce-checkout-summary-row"><span>{fulfillment === 'pickup' ? 'Pickup' : 'Shipping'}</span><strong>{fulfillment === 'pickup' ? 'Free' : 'At payment'}</strong></div>
        <p className="commerce-checkout-note"><LockKeyhole/>Payment is completed on Clover's secure checkout page.</p>
        <p className="commerce-checkout-note"><ShieldCheck/>Your cart is revalidated against live RetroLootPro inventory before payment.</p>
      </aside>
    </main>
  );
}
