import { NextRequest } from 'next/server';
import { z } from 'zod';
import { cartSchema } from '@/lib/storefront-model';
import { commerceRoute, CommerceError, readCommerceBody, storeAccount, limitCommerce, fingerprint } from '@/lib/server/storefront-http';
import { paymentConfig, requirePaymentsEnabled, createCheckout, type Order } from '@/lib/server/storefront-payments';
import { loadStorefrontCatalog } from '@/lib/server/storefront-catalog';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { loadShippingSettings, verifyShippingQuote } from '@/lib/server/storefront-shipping';

export const dynamic = 'force-dynamic';
const schema = z.object({ orderId: z.string().uuid(), items: cartSchema, action: z.literal('cancel').optional(),
  shippingToken: z.string().max(12000).optional(), shippingRate: z.string().max(100).optional() });

export async function POST(request: NextRequest) {
  return commerceRoute(async () => {
    const body = schema.parse(await readCommerceBody(request));
    await limitCommerce(request, 'checkout');
    const admin = createSupabaseAdmin();
    const accountId = await storeAccount();
    const items = [...body.items].sort((a, b) => a.id.localeCompare(b.id));
    const carrierShipping = process.env.STOREFRONT_SHIPPING_PROVIDER === 'shippo';
    const hash = fingerprint({ kind: 'checkout', items, ...(body.shippingToken ? { shippingToken: body.shippingToken, shippingRate: body.shippingRate } : {}) });
    if (body.action === 'cancel') {
      const absent = await admin.rpc('storefront_cancel_unstarted', { p_id:body.orderId });
      if (absent.error) throw absent.error;
      if (absent.data) return { cancelled:true };
    }
    const { data: existing, error: lookupError } = await admin.from('storefront_orders').select('*').eq('id', body.orderId).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (existing.fingerprint !== hash || existing.account_id !== accountId) throw new CommerceError('Checkout key already used. Refresh your cart.', 409);
      if (body.action === 'cancel') {
        if (existing.status === 'cancelled') return {cancelled:true};
        if (!['creating','pending'].includes(existing.status)) throw new CommerceError('Payment may already be completed. Contact support; do not pay again.',409);
        if (!existing.stripe_id) throw new CommerceError('Payment was interrupted. Resume checkout first to recover the Stripe session, then cancel it. Contact support if recovery fails.',409);
        const {stripe}=paymentConfig();
        const session=await stripe.checkout.sessions.retrieve(existing.stripe_id);
        if (session.status==='open') await stripe.checkout.sessions.expire(session.id);
        else if (session.status!=='expired') throw new CommerceError('This payment cannot be cancelled. Contact support.',409);
        const release=await admin.rpc('storefront_apply_payment',{p_event:`cancel-${session.id}`,p_order:existing.id,p_stripe:session.id,p_action:'cancel'});
        if (release.error) throw release.error;
        return {cancelled:true};
      }
      return { url: await createCheckout(existing as Order) };
    }
    requirePaymentsEnabled();
    paymentConfig();
    if (carrierShipping && (!body.shippingToken || !body.shippingRate)) throw new CommerceError('Choose a shipping service before checkout.', 409);
    const quoted = carrierShipping ? await verifyShippingQuote(body.shippingToken!, body.shippingRate!, items) : null;
    const catalog = quoted ? null : await loadStorefrontCatalog();
    const lines = quoted?.lines || items.map((line) => {
      const item = catalog!.products.find((product) => product.id === line.id);
      if (!item || item.quantity < line.quantity) throw new CommerceError('An item sold out or its quantity changed. Refresh your cart before checkout.', 409);
      return { ...line, unit_amount: Math.round(item.price * 100) };
    });
    const { data: order, error } = await admin.rpc(quoted ? 'storefront_reserve_shipping' : 'storefront_reserve', {
      p_id: body.orderId, p_account: accountId, p_kind: 'checkout', p_request: null, p_fingerprint: hash, p_items: lines,
      ...(quoted ? { p_shipping: quoted.shipping } : {}),
    });
    if (error) throw new CommerceError('Stock changed or checkout could not be reserved. Refresh your cart or contact support.', 409);
    return { url: await createCheckout(order as Order) };
  });
}

export async function GET(request: NextRequest) {
  return commerceRoute(async () => {
    if (!request.nextUrl.searchParams.has('session_id')) {
      try {
        requirePaymentsEnabled();
        const { carrierShipping } = paymentConfig();
        if (carrierShipping) await loadShippingSettings(await storeAccount());
        return { paymentReady: true, carrierShipping };
      }
      catch (error) {
        if (!(error instanceof CommerceError)) throw error;
        return {paymentReady:false,message:error.message,carrierShipping:process.env.STOREFRONT_SHIPPING_PROVIDER === 'shippo'};
      }
    }
    const { stripe } = paymentConfig();
    const sessionId = z.string().regex(/^cs_(test_|live_)?[a-zA-Z0-9]+$/).parse(request.nextUrl.searchParams.get('session_id'));
    await limitCommerce(request, 'checkout-status');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const { data: order, error } = await createSupabaseAdmin().from('storefront_orders').select('status,items')
      .eq('stripe_id', session.id).maybeSingle();
    if (error) throw error;
    return { status: order?.status || 'processing', paymentStatus: session.payment_status,
      purchased: order && ['paid','shipped'].includes(order.status) ? (order.items as Order['items']).map(({ id, quantity }) => ({ id, quantity })) : [] };
  });
}
