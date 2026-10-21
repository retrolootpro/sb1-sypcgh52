import Stripe from 'stripe';
import { z } from 'zod';
import { addressSchema } from '@/lib/storefront-model';
import { createSupabaseAdmin } from './supabase-admin';
import { CommerceError } from './storefront-http';

export type Order = {
  id: string; account_id: string; kind: 'checkout' | 'invoice'; request_id: string | null;
  status: string; stripe_id: string | null; payment_url: string | null; email_sent: boolean;
  subtotal_cents: number; stripe_customer_id: string | null; fingerprint: string;
  created_at: string; shipping_rate: string | null;
  items: { id: string; title: string; platform: string; condition: string; quantity: number; unit_amount: number }[];
};

export function requirePaymentsEnabled() {
  if (process.env.STOREFRONT_PAYMENTS_ENABLED === 'false') {
    throw new CommerceError('Online payments are not enabled yet. Please submit an item request or email support.', 503);
  }
}

export function paymentConfig() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const rates = (process.env.STRIPE_SHIPPING_RATE_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const countries = (process.env.STRIPE_SHIPPING_COUNTRIES || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  const site = process.env.STOREFRONT_SITE_URL || '';
  if (!key || !process.env.STRIPE_WEBHOOK_SECRET || !rates.length || !countries.length || !site
    || !rates.every((id) => /^shr_[a-zA-Z0-9]+$/.test(id))
    || !countries.every((code) => /^[A-Z]{2}$/.test(code))
    || !/^https:\/\//.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1):/.test(site)
    || key.startsWith('sk_live_') && process.env.STRIPE_LIVE_PAYMENTS_ENABLED !== 'true') {
    throw new CommerceError('Online payment is not configured yet. Please submit an item request or email support.', 503);
  }
  return { stripe: new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 }), rates, countries, site: site.replace(/\/$/, '') };
}

export async function saveOrder(id: string, patch: Record<string, unknown>) {
  const {status,...details}=patch;
  const admin=createSupabaseAdmin();
  if (Object.keys(details).length) {
    const { error } = await admin.from('storefront_orders').update(details).eq('id', id);
    if (error) throw error;
  }
  if (status === 'pending') {
    const {error}=await admin.from('storefront_orders').update({status}).eq('id',id).in('status',['creating','pending']);
    if (error) throw error;
  }
}

export async function createCheckout(order: Order) {
  requirePaymentsEnabled();
  const { stripe, rates, countries, site } = paymentConfig();
  if (order.status === 'cancelled') throw new CommerceError('This checkout expired. Refresh your cart and start again.', 409);
  if (order.stripe_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_id);
    if (session.status !== 'open' || !session.url) throw new CommerceError('This checkout is already completed or expired. Check your email or refresh the cart.', 409);
    return session.url;
  }
  if (Date.now() - new Date(order.created_at).getTime() > 23 * 3600000) throw new CommerceError('This interrupted payment needs manual Stripe reconciliation before stock can be released.', 409);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id,
    metadata: { order_id: order.id }, payment_intent_data: { metadata: { order_id: order.id } },
    automatic_tax: { enabled: true }, billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
    shipping_options: rates.map((shipping_rate) => ({ shipping_rate })),
    line_items: order.items.map((item) => ({
      quantity: item.quantity, price_data: { currency: 'usd', unit_amount: item.unit_amount,
        tax_behavior: 'exclusive', product_data: { name: item.title, description: `${item.platform || 'Inventory item'} - ${item.condition}` } },
    })),
    expires_at: Math.floor(new Date(order.created_at).getTime() / 1000) + 86400,
    success_url: `${site}/shop/checkout?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/shop/checkout?cancelled=1`,
  }, { idempotencyKey: `checkout-${order.id}` });
  if (!session.url) throw new Error('Stripe did not return a checkout URL.');
  await saveOrder(order.id, { stripe_id: session.id, payment_url: session.url, status: 'pending' });
  return session.url;
}

type RequestedCustomer = { name: string; email: string; address: z.infer<typeof addressSchema> };

export async function createRequestInvoice(order: Order, customer: RequestedCustomer, shippingRate: string) {
  requirePaymentsEnabled();
  const { stripe, rates, countries } = paymentConfig();
  if (!rates.includes(shippingRate)) throw new CommerceError('Choose a configured shipping rate.');
  if (!countries.includes(customer.address.country)) throw new CommerceError('This address is outside your configured shipping countries.');
  if (order.status === 'cancelled') throw new CommerceError('This invoice was cancelled. Start a new invoice.', 409);
  let customerId = order.stripe_customer_id;
  if (!customerId) {
    const created = await stripe.customers.create({
      name: customer.name, email: customer.email, address: customer.address,
      shipping: { name: customer.name, address: customer.address },
    }, { idempotencyKey: `customer-${order.id}` });
    customerId = created.id;
    await saveOrder(order.id, { stripe_customer_id: customerId });
  }
  let invoice = order.stripe_id ? await stripe.invoices.retrieve(order.stripe_id) : await stripe.invoices.create({
    customer: customerId, collection_method: 'send_invoice', days_until_due: 7, auto_advance: false,
    automatic_tax: { enabled: true }, metadata: { order_id: order.id },
    shipping_cost: { shipping_rate: shippingRate },
    pending_invoice_items_behavior: 'exclude',
    payment_settings: { payment_method_types: ['card'] },
    description: `Pixel & Page requested items. Order ${order.id}`,
  }, { idempotencyKey: `invoice-${order.id}` });
  if (!invoice.id) throw new Error('Stripe invoice ID missing.');
  await saveOrder(order.id, { stripe_id: invoice.id });
  if (invoice.status === 'draft') {
    for (const item of order.items) {
      await stripe.invoiceItems.create({
        customer: customerId, invoice: invoice.id, currency: 'usd',
        amount: item.quantity * item.unit_amount, description: `${item.title} (${item.condition}) x ${item.quantity}`,
        tax_behavior: 'exclusive',
      }, { idempotencyKey: `invoice-item-${order.id}-${item.id}` });
    }
    invoice = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: `finalize-${order.id}` });
  }
  if (invoice.status !== 'open' && invoice.status !== 'paid') throw new CommerceError(`Invoice is ${invoice.status}. Review it in Stripe.`, 409);
  if (!order.email_sent && invoice.status === 'open') {
    await stripe.invoices.sendInvoice(invoice.id!, {}, { idempotencyKey: `email-${order.id}` });
    await saveOrder(order.id, { email_sent: true });
  }
  await saveOrder(order.id, { payment_url: invoice.hosted_invoice_url, ...(invoice.status==='open'?{status:'pending'}:{}) });
  return invoice.hosted_invoice_url;
}
