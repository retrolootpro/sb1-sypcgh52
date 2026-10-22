'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, PackageCheck, RefreshCw, ShoppingBag, Truck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { businessOverviewSchema, type BusinessOverview } from '@/lib/business-overview';
import { Button } from '@/components/ui/button';

export function BusinessOrderOverview() {
  const { accountId, isAdmin } = useAuth();
  const [overview, setOverview] = useState<BusinessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef({});
  const load = useCallback(async () => {
    const current = {};
    generation.current = current;
    setOverview(null);
    setError('');
    if (!accountId || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Sign in again to review order activity.');
      const response = await fetch('/api/business/overview', {
        cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || 'Order activity could not be loaded.');
      const data = businessOverviewSchema.parse(result.overview);
      if (generation.current === current) setOverview(data);
    } catch (cause) {
      console.error('Order overview:', cause);
      if (generation.current === current) setError('Order activity could not be loaded. Retry to check what needs shipping.');
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [accountId, isAdmin]);
  useEffect(() => {
    void load();
    return () => { generation.current = {}; };
  }, [load]);

  if (!isAdmin) return <section className="business-order-overview" aria-label="Order activity">
    <p className="brand-eyebrow">ORDERS & FULFILLMENT</p>
    <h2>Keep every order moving.</h2>
    <p>Order management is currently limited to store administrators. Use your team workflows below, or contact an owner for fulfillment help.</p>
  </section>;

  return <section className="business-order-overview" aria-labelledby="order-overview-title">
    <header>
      <div><p className="brand-eyebrow">FIRST UP · ORDERS & FULFILLMENT</p><h2 id="order-overview-title">Keep every order moving.</h2>
        <p>Check paid orders first, then prepare the customer-selected shipping service.</p></div>
      <Button variant="outline" disabled={loading} onClick={load}><RefreshCw size={16} className="mr-2" />Refresh orders</Button>
    </header>
    {loading ? <p className="business-overview-message" role="status">Checking order activity...</p>
      : error ? <div className="business-overview-message"><p role="alert">{error}</p><Button variant="outline" onClick={load}>Retry order activity</Button></div>
      : overview && <>
        <div className="business-order-stats">
          {[
            { label: 'Ready to ship', value: overview.readyToShip, icon: PackageCheck, href: '/business/orders?status=paid', detail: 'Paid orders to fulfill' },
            { label: 'Awaiting payment', value: overview.awaitingPayment, icon: ShoppingBag, href: '/business/orders?status=pending', detail: 'Not ready for dispatch' },
            { label: 'Customer requests', value: overview.openRequests, icon: ShoppingBag, href: '/business/orders?view=requests', detail: 'New or under review' },
            { label: 'Shipped', value: overview.shipped, icon: Truck, href: '/business/orders?status=shipped', detail: 'All-time shipped orders' },
          ].map(({ label, value, icon: Icon, href, detail }) => <Link key={label} href={href}>
            <span><Icon size={19}/>{label}<ArrowRight size={15}/></span><strong>{value.toLocaleString()}</strong><small>{detail}</small>
          </Link>)}
        </div>
        <div className="business-dispatch-queue">
          <div className="business-section-heading"><div><h3>Pack & ship next</h3><p>Oldest paid orders first. Showing up to five; counts above cover all orders.</p></div><Link href="/business/orders?status=paid">All paid orders <ArrowRight size={16}/></Link></div>
          {overview.orders.length ? <ol>{overview.orders.map(order => <li key={order.id}>
            <div><Link href={`/business/orders?status=paid&order=${order.id}`}>Order #{order.id.slice(0, 8)}</Link>
              <small>Placed {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
            <div><span>{order.shippingService || 'Shipping service needs review'}</span><small>{order.shippingService ? 'Use the saved service; confirm packed measurements.' : 'Open the order to verify delivery details. Do not guess.'}</small></div>
            <Link className="business-queue-action" href={`/business/orders?status=paid&order=${order.id}`}>Review & pack <ArrowRight size={16}/></Link>
          </li>)}</ol> : <p className="business-overview-message">No paid orders waiting to ship. A good time to prepare your next listings.</p>}
        </div>
      </>}
  </section>;
}
