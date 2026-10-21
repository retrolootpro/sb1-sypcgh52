import { NextRequest } from 'next/server';
import { z } from 'zod';
import { cartSchema, addressSchema } from '@/lib/storefront-model';
import { commerceRoute, CommerceError, readCommerceBody, requireStoreAdmin, fingerprint } from '@/lib/server/storefront-http';
import { createRequestInvoice, createCheckout, saveOrder, paymentConfig, requirePaymentsEnabled, type Order } from '@/lib/server/storefront-payments';
import { loadStorefrontCatalog } from '@/lib/server/storefront-catalog';
import { loadShippingSettings, verifyShippingQuote } from '@/lib/server/storefront-shipping';
import { shippingCustomerSchema } from '@/lib/storefront-shipping';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return commerceRoute(async () => {
    const { admin, accountId } = await requireStoreAdmin(request);
    const page = z.coerce.number().int().min(0).max(10000).parse(request.nextUrl.searchParams.get('page') || 0);
    const [requests, orders] = await Promise.all([
      admin.from('storefront_requests').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).order('id').range(page*50,page*50+49),
      admin.from('storefront_orders').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).order('id').range(page*50,page*50+49),
    ]);
    if (requests.error) throw requests.error;
    if (orders.error) throw orders.error;
    let shippingRates: { id: string; name: string; amount: number }[] = [];
    let paymentReady = false;
    let setupMessage = '';
    try {
      const { stripe, rates, carrierShipping } = paymentConfig();
      if (carrierShipping) await loadShippingSettings(accountId);
      shippingRates = await Promise.all(rates.map(async (id) => {
        const rate = await stripe.shippingRates.retrieve(id);
        if (!rate.active || rate.type !== 'fixed_amount' || rate.fixed_amount?.currency !== 'usd') throw new Error('Configure active USD fixed-amount Stripe shipping rates.');
        return { id, name: rate.display_name || id, amount: rate.fixed_amount.amount };
      }));
      requirePaymentsEnabled();
      paymentReady = true;
    } catch (error) {
      setupMessage = error instanceof Error ? error.message : 'Stripe configuration unavailable.';
      console.warn('Storefront payment configuration:', setupMessage);
    }
    return { requests: requests.data, orders: orders.data, shippingRates, paymentReady, setupMessage, carrierShipping: process.env.STOREFRONT_SHIPPING_PROVIDER === 'shippo' };
  });
}

const invoiceSchema = z.object({ action: z.literal('invoice'), orderId: z.string().uuid(), requestId: z.string().uuid(),
  items: cartSchema, shippingRate: z.string().min(1).max(100), shippingToken: z.string().max(12000).optional() });
const actionSchema = z.object({ action: z.enum(['review','close','retry','cancel','ship']), id: z.string().uuid(),
  tracking: z.string().trim().min(3).max(200).optional() });

export async function POST(request: NextRequest) {
  return commerceRoute(async () => {
    const { admin, accountId } = await requireStoreAdmin(request);
    const body = z.union([invoiceSchema, actionSchema]).parse(await readCommerceBody(request));
    if (body.action === 'review' || body.action === 'close') {
      const { data, error } = await admin.from('storefront_requests').update({ status: body.action === 'review' ? 'reviewing' : 'closed' })
        .eq('id', body.id).eq('account_id', accountId).in('status', ['new','reviewing']).select('id').single();
      if (error || !data) throw new CommerceError('This request cannot be changed in its current state.', 409);
      return {};
    }
    if (body.action === 'invoice') {
      requirePaymentsEnabled();
      const { rates, countries, carrierShipping } = paymentConfig();
      if (!carrierShipping && !rates.includes(body.shippingRate)) throw new CommerceError('Choose a configured shipping rate.');
      if (carrierShipping && !body.shippingToken) throw new CommerceError('Get a shipping quote before creating an invoice.');
      const { data: customer, error } = await admin.from('storefront_requests').select('*').eq('id', body.requestId).eq('account_id', accountId).single();
      if (error || !customer) throw new CommerceError('Request not found.', 404);
      const address = addressSchema.parse(customer.address);
      if (!countries.includes(address.country)) throw new CommerceError('Address is outside your shipping regions.');
      const items = [...body.items].sort((a,b) => a.id.localeCompare(b.id));
      const hash = fingerprint({ kind: 'invoice', requestId: body.requestId, items, rate: body.shippingRate, ...(body.shippingToken ? { shippingToken: body.shippingToken } : {}) });
      const { data: existing, error: existingError } = await admin.from('storefront_orders').select('*').eq('id', body.orderId).maybeSingle();
      if (existingError) throw existingError;
      let order = existing as Order | null;
      if (order && (order.account_id !== accountId || order.fingerprint !== hash)) throw new CommerceError('Invoice key already used.', 409);
      if (!order) {
        const quoted = carrierShipping ? await verifyShippingQuote(body.shippingToken!, body.shippingRate, items, shippingCustomerSchema.parse(customer)) : null;
        const catalog = quoted ? null : await loadStorefrontCatalog();
        const lines = quoted?.lines || items.map((line) => {
          const item = catalog!.products.find((row) => row.id === line.id);
          if (!item || item.quantity < line.quantity) throw new CommerceError('Select in-stock, priced RetroLoot inventory.', 409);
          return { ...line, unit_amount: Math.round(item.price * 100) };
        });
        const reserved = await admin.rpc(quoted ? 'storefront_reserve_shipping' : 'storefront_reserve', {
          p_id: body.orderId, p_account: accountId, p_kind: 'invoice', p_request: body.requestId, p_fingerprint: hash, p_items: lines,
          ...(quoted ? { p_shipping: quoted.shipping } : {}),
        });
        if (reserved.error) throw new CommerceError('Request already has an invoice, or stock changed. Refresh before trying again.', 409);
        order = reserved.data as Order;
        if (!quoted) await saveOrder(order.id, { shipping_rate: body.shippingRate });
      }
      const url = await createRequestInvoice(order, { ...customer, address }, body.shippingRate);
      const { error: statusError } = await admin.from('storefront_requests').update({ status: 'invoiced' })
        .eq('id', body.requestId).in('status', ['new','reviewing']);
      if (statusError) throw statusError;
      return { url };
    }
    const { data, error } = await admin.from('storefront_orders').select('*').eq('id', body.id).eq('account_id', accountId).single();
    if (error || !data) throw new CommerceError('Order not found.', 404);
    const order = data as Order;
    if (body.action === 'ship') {
      if (!body.tracking) throw new CommerceError('Enter the carrier and tracking number.');
      const { error: updateError } = await admin.rpc('storefront_ship',{p_id:order.id,p_account:accountId,p_tracking:body.tracking});
      if (updateError) throw new CommerceError('Only paid orders can be marked shipped.', 409);
      return {};
    }
    const { stripe } = paymentConfig();
    if (body.action === 'retry') {
      if (order.kind === 'checkout') return { url: await createCheckout(order) };
      const customer = await admin.from('storefront_requests').select('*').eq('id',order.request_id).eq('account_id',accountId).single();
      if (customer.error || !customer.data || (!order.shipping_rate && !order.shipping_quote)) throw new CommerceError('Invoice needs reconciliation. Verify the shipping rate and customer details.', 409);
      const url = await createRequestInvoice(order, { ...customer.data, address: addressSchema.parse(customer.data.address) }, order.shipping_rate || order.shipping_quote!.rate.id);
      const update = await admin.from('storefront_requests').update({ status: 'invoiced' }).eq('id',order.request_id).in('status',['new','reviewing']);
      if (update.error) throw update.error;
      return { url };
    }
    if (!order.stripe_id) throw new CommerceError('Recover this interrupted payment using Retry before cancelling. Never release stock while a payment may still be open in Stripe.', 409);
    if (!['creating','pending'].includes(order.status)) throw new CommerceError('Only unpaid orders can be cancelled.', 409);
    if (order.kind === 'checkout') {
      const session = await stripe.checkout.sessions.retrieve(order.stripe_id);
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      else if (session.status !== 'expired') throw new CommerceError('This checkout cannot be cancelled. Reconcile payment first.', 409);
    } else {
      let invoice = await stripe.invoices.retrieve(order.stripe_id);
      if (invoice.status === 'draft') {
        invoice = await stripe.invoices.finalizeInvoice(order.stripe_id, { auto_advance: false });
      }
      if (invoice.status === 'open') await stripe.invoices.voidInvoice(order.stripe_id);
      else if (!['void','uncollectible'].includes(invoice.status || '')) throw new CommerceError('This invoice cannot be cancelled. Reconcile payment first.', 409);
    }
    const released = await admin.rpc('storefront_apply_payment', {
      p_event: `cancel-${order.stripe_id}`, p_order: order.id, p_stripe: order.stripe_id, p_action: 'cancel',
    });
    if (released.error) throw released.error;
    return {};
  });
}
