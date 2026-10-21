import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { paymentConfig } from '@/lib/server/storefront-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let stripe: Stripe;
  try { stripe = paymentConfig().stripe; }
  catch { return NextResponse.json({ message: 'Payments are not configured.' }, { status: 503 }); }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ message: 'Missing signature.' }, { status: 400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET!); }
  catch { return NextResponse.json({ message: 'Invalid signature.' }, { status: 400 }); }
  try {
    const admin = createSupabaseAdmin();
    let orderId: string | undefined;
    let stripeId: string;
    let action: 'paid' | 'cancel' | 'refund';
    let total = 0;
    let tax = 0;
    let shipping = 0;
    let refunded = 0;
    let customer: unknown = null;
    let intent: string | null = null;
    if (['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type)) {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
      orderId = session.metadata?.order_id;
      if (!orderId) return NextResponse.json({ received: true });
      stripeId = session.id;
      if (session.payment_status === 'paid') {
        if (session.currency !== 'usd') throw new Error('Unexpected payment currency.');
        action = 'paid'; total = session.amount_total || 0; tax = session.total_details?.amount_tax || 0;
        shipping = session.shipping_cost?.amount_subtotal || 0;
        const saved = await admin.from('storefront_orders').select('shipping_quote').eq('stripe_id', session.id).maybeSingle();
        if (saved.error) throw saved.error;
        customer = { contact: session.customer_details, shipping: session.collected_information?.shipping_details
          || (saved.data?.shipping_quote ? { name: saved.data.shipping_quote.customer.name, address: saved.data.shipping_quote.customer.address } : null) };
        intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
      } else if (session.status === 'expired') action = 'cancel';
      else return NextResponse.json({ received: true });
    } else if (['invoice.paid','invoice.voided','invoice.marked_uncollectible'].includes(event.type)) {
      const invoice = await stripe.invoices.retrieve((event.data.object as Stripe.Invoice).id!);
      orderId = invoice.metadata?.order_id;
      if (!orderId) return NextResponse.json({ received: true });
      stripeId = invoice.id!;
      if (invoice.status === 'paid') {
        if (invoice.currency !== 'usd' || invoice.amount_paid !== invoice.total) throw new Error('Invoice paid outside the supported card flow; manual reconciliation required.');
        action = 'paid'; total = invoice.total;
        tax = (invoice.total_taxes || []).reduce((sum, value) => sum + value.amount, 0);
        shipping = invoice.shipping_cost?.amount_subtotal || 0;
        customer = { name: invoice.customer_name, email: invoice.customer_email, shipping: invoice.customer_shipping };
        const payments = await stripe.invoicePayments.list({ invoice: invoice.id!, limit: 10 });
        const payment = payments.data.find((entry) => entry.status === 'paid');
        intent = typeof payment?.payment.payment_intent === 'string' ? payment.payment.payment_intent : payment?.payment.payment_intent?.id || null;
        if (!intent || payment?.amount_paid !== invoice.total) throw new Error('Invoice requires manual payment reconciliation.');
        const pi = await stripe.paymentIntents.retrieve(intent);
        if (pi.status !== 'succeeded' || pi.currency !== 'usd' || pi.amount_received < invoice.total) throw new Error('Invoice card payment not confirmed.');
        await stripe.paymentIntents.update(intent, {metadata:{order_id:orderId}});
      } else if (['void','uncollectible'].includes(invoice.status || '')) action = 'cancel';
      else return NextResponse.json({ received: true });
    } else if (event.type === 'charge.refunded') {
      const charge = await stripe.charges.retrieve((event.data.object as Stripe.Charge).id);
      const pi = typeof charge.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(charge.payment_intent) : charge.payment_intent;
      orderId = pi?.metadata.order_id;
      if (!orderId && pi?.id) {
        const lookup = await admin.from('storefront_orders').select('id').eq('payment_intent',pi.id).maybeSingle();
        if (lookup.error) throw lookup.error;
        orderId = lookup.data?.id;
      }
      if (!orderId) return NextResponse.json({ received: true });
      const lookup = await admin.from('storefront_orders').select('stripe_id').eq('id',orderId).single();
      if (lookup.error || !lookup.data?.stripe_id) throw new Error('Refund order is not ready for reconciliation.');
      stripeId = lookup.data.stripe_id;
      action = 'refund'; refunded = charge.amount_refunded;
    } else return NextResponse.json({ received: true });
    const result = await admin.rpc('storefront_apply_payment', {
      p_event: event.id, p_order: orderId, p_stripe: stripeId, p_action: action,
      p_total: total, p_tax: tax, p_shipping: shipping, p_customer: customer, p_intent: intent, p_refunded: refunded,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook reconciliation failed:', event.id, error instanceof Error ? error.message : 'Database failure');
    return NextResponse.json({ message: 'Reconciliation failed; retry this event.' }, { status: 500 });
  }
}
