import { NextRequest } from 'next/server';
import { z } from 'zod';
import { cartSchema } from '@/lib/storefront-model';
import { shippingCustomerSchema, shippingSettingsSchema } from '@/lib/storefront-shipping';
import { commerceRoute, readCommerceBody, requireStoreAdmin, limitCommerce, CommerceError } from '@/lib/server/storefront-http';
import { shippingQuote, verifyShippingConnections } from '@/lib/server/storefront-shipping';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return commerceRoute(async () => {
    const { admin, accountId } = await requireStoreAdmin(request);
    const { data, error } = await admin.from('storefront_settings').select('shipping_config')
      .eq('user_id', accountId).eq('public_slug', 'pixel-and-page').eq('is_active', true).single();
    if (error) throw error;
    return { settings: data.shipping_config };
  });
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('save'), settings: shippingSettingsSchema }),
  z.object({ action: z.literal('quote'), items: cartSchema, customer: shippingCustomerSchema }),
  z.object({ action: z.literal('invoice-quote'), items: cartSchema, requestId: z.string().uuid() }),
]);

export async function POST(request: NextRequest) {
  return commerceRoute(async () => {
    const body = bodySchema.parse(await readCommerceBody(request));
    if (body.action === 'verify') {
      await requireStoreAdmin(request);
      await limitCommerce(request, 'shipping-connection');
      return verifyShippingConnections();
    }
    if (body.action === 'save') {
      const { admin, accountId } = await requireStoreAdmin(request);
      const { data, error } = await admin.from('storefront_settings').update({ shipping_config: body.settings })
        .eq('user_id', accountId).eq('public_slug', 'pixel-and-page').eq('is_active', true).select('user_id').single();
      if (error || !data) throw error || new Error('Shipping settings were not saved.');
      return {};
    }
    await limitCommerce(request, 'shipping-quote');
    if (body.action === 'invoice-quote') {
      const { admin, accountId } = await requireStoreAdmin(request);
      const { data, error } = await admin.from('storefront_requests').select('name,email,address').eq('id', body.requestId).eq('account_id', accountId).single();
      if (error || !data) throw new CommerceError('Request not found.', 404);
      return shippingQuote(body.items, shippingCustomerSchema.parse(data));
    }
    return shippingQuote(body.items, body.customer);
  });
}
