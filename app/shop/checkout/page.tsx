'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  LockKeyhole,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react';

type Product = {
  id: string;
  title: string;
  price: number;
  quantity: number;
  condition?: string;
  platform?: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
};

const CART_KEY = 'pixel-page-cart';

export default function CheckoutPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [fulfillment, setFulfillment] = useState<'shipping' | 'pickup'>('shipping');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    try {
      setCart(JSON.parse(window.localStorage.getItem(CART_KEY) || '{}'));
    } catch {
      setCart({});
    }

    fetch('/api/storefront/catalog', { cache: 'no-store' })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) throw new Error(result.message || 'Inventory could not be loaded.');
        setProducts((result.products || []).map((item: Product) => ({
          ...item,
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
        })));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Inventory could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const items = useMemo(() => products.filter((item) => cart[item.id]), [products, cart]);
  const subtotal = items.reduce((sum, item) => sum + item.price * Math.min(cart[item.id], item.quantity), 0);
  const itemCount = items.reduce((sum, item) => sum + Math.min(cart[item.id], item.quantity), 0);

  const changeQuantity = (item: Product, change: number) => {
    setCart((current) => {
      const next = { ...current };
      const value = Math.max(0, Math.min(item.quantity, (current[item.id] || 0) + change));
      if (!value) delete next[item.id];
      else next[item.id] = value;
      return next;
    });
  };

  const removeItem = (id: string) => {
    setCart((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!acceptedTerms) {
      setMessage('Please accept the store terms and return policy before continuing.');
      return;
    }

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
            notes: form.get('notes'),
          },
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.href) {
        window.location.assign(result.href);
        return;
      }
      setMessage(result.message || 'Checkout could not be started.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="commerce-checkout-page">
      <header className="commerce-checkout-header">
        <Link href="/shop" className="commerce-checkout-brand" aria-label="Return to Pixel and Page shop">
          <img src="/pixel-page-logo.svg" alt="Pixel & Page - Every Story Has a Save Point" />
        </Link>
        <div className="commerce-checkout-secure"><LockKeyhole /> Secure checkout powered by Clover</div>
      </header>

      <div className="commerce-checkout-progress" aria-label="Checkout progress">
        <span className="active"><b>1</b> Information</span>
        <i />
        <span><b>2</b> Clover payment</span>
        <i />
        <span><b>3</b> Confirmation</span>
      </div>

      <div className="commerce-checkout-shell">
        <section className="commerce-checkout-main">
          <div className="commerce-checkout-title-row">
            <div>
              <Link href="/shop" className="commerce-breadcrumbs"><ArrowLeft /> Continue shopping</Link>
              <h1>Checkout</h1>
              <p>{itemCount} item{itemCount === 1 ? '' : 's'} in your order</p>
            </div>
            <button type="button" className="commerce-checkout-cart-button" onClick={() => document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth' })}>
              <ShoppingBag /> Review cart
            </button>
          </div>

          {loading ? (
            <div className="commerce-checkout-section"><h2>Loading your cart...</h2></div>
          ) : items.length === 0 ? (
            <div className="commerce-checkout-section commerce-checkout-empty">
              <ShoppingBag />
              <h2>Your cart is empty</h2>
              <p>Return to the shop to add live inventory.</p>
              <Link href="/shop" className="commerce-primary-button">Browse products</Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="commerce-checkout-section">
                <div className="commerce-checkout-section-heading"><span>1</span><div><h2>Contact information</h2><p>We use this for your receipt and order updates.</p></div></div>
                <div className="commerce-form-grid">
                  <label>First name<input name="firstName" autoComplete="given-name" required /></label>
                  <label>Last name<input name="lastName" autoComplete="family-name" required /></label>
                  <label className="full">Email<input type="email" name="email" autoComplete="email" required /></label>
                  <label className="full">Phone<input type="tel" name="phone" autoComplete="tel" /></label>
                </div>
              </div>

              <div className="commerce-checkout-section">
                <div className="commerce-checkout-section-heading"><span>2</span><div><h2>Delivery method</h2><p>Choose shipping or free pickup at Pixel & Page.</p></div></div>
                <div className="commerce-fulfillment-grid">
                  <button type="button" onClick={() => setFulfillment('shipping')} aria-pressed={fulfillment === 'shipping'}>
                    <Truck /><span><strong>Ship my order</strong><small>Available across the United States</small></span><b>{fulfillment === 'shipping' ? 'Selected' : 'Choose'}</b>
                  </button>
                  <button type="button" onClick={() => setFulfillment('pickup')} aria-pressed={fulfillment === 'pickup'}>
                    <MapPin /><span><strong>Free local pickup</strong><small>Daytona Flea Market location</small></span><b>{fulfillment === 'pickup' ? 'Selected' : 'Choose'}</b>
                  </button>
                </div>
              </div>

              {fulfillment === 'shipping' && (
                <div className="commerce-checkout-section">
                  <div className="commerce-checkout-section-heading"><span>3</span><div><h2>Shipping address</h2><p>Enter the address where this order should be delivered.</p></div></div>
                  <div className="commerce-form-grid">
                    <label className="full">Street address<input name="address1" autoComplete="address-line1" required /></label>
                    <label className="full">Apartment, suite, unit, etc.<input name="address2" autoComplete="address-line2" /></label>
                    <label>City<input name="city" autoComplete="address-level2" required /></label>
                    <label>State<input name="state" autoComplete="address-level1" maxLength={2} placeholder="FL" required /></label>
                    <label>ZIP code<input name="postalCode" autoComplete="postal-code" inputMode="numeric" required /></label>
                  </div>
                </div>
              )}

              <div className="commerce-checkout-section">
                <div className="commerce-checkout-section-heading"><span>{fulfillment === 'shipping' ? '4' : '3'}</span><div><h2>Order notes</h2><p>Optional details for pickup, delivery, or your order.</p></div></div>
                <label className="commerce-notes-label">Notes<textarea name="notes" rows={4} placeholder="Add any helpful order details" /></label>
                <label className="commerce-terms-check">
                  <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                  <span>I agree to the <Link href="/shop/pages/terms" target="_blank">store terms</Link> and <Link href="/shop/pages/returns" target="_blank">return policy</Link>.</span>
                </label>
              </div>

              {message && <div className="commerce-checkout-section commerce-checkout-message" role="alert"><strong>Checkout needs attention</strong><p>{message}</p></div>}

              <div className="commerce-checkout-actions">
                <Link href="/shop"><ArrowLeft /> Back to shop</Link>
                <button type="submit" className="commerce-checkout-submit" disabled={submitting || !acceptedTerms}>
                  <CreditCard /> {submitting ? 'Opening secure payment...' : 'Continue to Clover payment'}
                </button>
              </div>
              <p className="commerce-checkout-disclaimer"><ShieldCheck /> Your inventory and prices are checked again immediately before Clover opens.</p>
            </form>
          )}
        </section>

        <aside className="commerce-checkout-summary" id="order-summary">
          <div className="commerce-summary-heading"><h2>Order summary</h2><Link href="/shop">Add more items</Link></div>
          <div className="commerce-summary-items">
            {items.map((item) => {
              const quantity = Math.min(cart[item.id], item.quantity);
              const image = item.thumbnail_url || item.image_url;
              return (
                <article className="commerce-summary-item" key={item.id}>
                  <div className="commerce-summary-image">{image ? <img src={image} alt="" /> : <ShoppingBag />}</div>
                  <div className="commerce-summary-copy">
                    <strong>{item.title}</strong>
                    <small>{item.platform || 'Pixel & Page'} · {item.condition || 'Available'}</small>
                    <div className="commerce-summary-controls">
                      <button type="button" onClick={() => changeQuantity(item, -1)} aria-label={`Decrease ${item.title}`}><Minus /></button>
                      <b>{quantity}</b>
                      <button type="button" onClick={() => changeQuantity(item, 1)} disabled={quantity >= item.quantity} aria-label={`Increase ${item.title}`}><Plus /></button>
                      <button type="button" className="remove" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.title}`}><Trash2 /></button>
                    </div>
                  </div>
                  <span>${(item.price * quantity).toFixed(2)}</span>
                </article>
              );
            })}
          </div>
          <div className="commerce-summary-totals">
            <div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
            <div><span>{fulfillment === 'pickup' ? 'Local pickup' : 'Shipping'}</span><strong>{fulfillment === 'pickup' ? 'FREE' : 'Shown before payment'}</strong></div>
            <div><span>Tax</span><strong>Calculated at payment</strong></div>
            <div className="total"><span>Estimated total</span><strong>${subtotal.toFixed(2)}</strong></div>
          </div>
          <div className="commerce-summary-trust">
            <p><LockKeyhole /> Card details are entered securely on Clover.</p>
            <p><ShieldCheck /> Inventory is revalidated before payment.</p>
            <p><Truck /> Shipping or pickup updates are sent by email.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
