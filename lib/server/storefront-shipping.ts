import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import Stripe from 'stripe';
import { createSupabaseAdmin } from './supabase-admin';
import { CommerceError, fingerprint, storeAccount } from './storefront-http';
import { loadStorefrontCatalog } from '@/lib/server/storefront-catalog';
import { cartSchema } from '@/lib/storefront-model';
import { shippingCustomerSchema, shippingParcels, shippingSettingsSchema, type ShippingCustomer, type ShippingRate, type QuotedShipping, type ShippingSettings } from '@/lib/storefront-shipping';

const providerRateSchema = z.object({
  object_id: z.string().min(1).max(100), provider: z.string(), currency: z.string(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  servicelevel: z.object({ name: z.string(), token: z.string() }),
  estimated_days: z.number().int().nonnegative().nullable().optional(),
});
const shipmentSchema = z.object({ rates: z.array(providerRateSchema), messages: z.array(z.unknown()).optional() });
const quoteSchema = z.object({
  version: z.literal(1), account: z.string().uuid(), expires: z.number(),
  cart: z.string(), settings: z.string(), customer: shippingCustomerSchema, parcels: z.number().int().min(1).max(10),
  rates: z.array(z.object({ id: z.string(), name: z.string(), amount: z.number().int().positive().max(10000000), estimatedDays: z.number().nullable() })).min(1).max(20),
});

export async function loadShippingSettings(accountId: string): Promise<ShippingSettings> {
  const { data, error } = await createSupabaseAdmin().from('storefront_settings').select('shipping_config')
    .eq('user_id', accountId).eq('public_slug', 'pixel-and-page').eq('is_active', true).single();
  if (error) throw error;
  const parsed = shippingSettingsSchema.safeParse(data?.shipping_config);
  if (!parsed.success) throw new CommerceError('Shipping package profiles and ship-from address are not configured. Please request an item or contact support.', 503);
  return parsed.data;
}

export async function pricedShippingLines(items: z.infer<typeof cartSchema>) {
  const { products } = await loadStorefrontCatalog();
  return [...items].sort((a, b) => a.id.localeCompare(b.id)).map(line => {
    const item = products.find(p => p.id === line.id);
    if (!item || item.quantity < line.quantity) throw new CommerceError('Stock changed. Refresh your cart and request new shipping rates.', 409);
    return { ...line, title: item.title, category: item.category, platform: item.platform, condition: item.condition, unit_amount: Math.round(item.price * 100) };
  });
}

function quoteSignature(payload: string) {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new CommerceError('Carrier shipping is not configured. Contact support.', 503);
  return createHmac('sha256', key).update(`storefront-shipping-v1:${payload}`).digest();
}

async function shippoShipment(origin: ShippingCustomer, destination: ShippingCustomer, parcel: ReturnType<typeof shippingParcels>[number]) {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new CommerceError('Carrier shipping is not configured. Contact support.', 503);
  const address = (customer: ShippingCustomer) => ({
    name: customer.name, email: customer.email, street1: customer.address.line1, street2: customer.address.line2,
    city: customer.address.city, state: customer.address.state, zip: customer.address.postal_code, country: customer.address.country,
  });
  let response: Response;
  try {
    response = await fetch('https://api.goshippo.com/shipments/', {
      method: 'POST', headers: { Authorization: `ShippoToken ${key}`, 'Content-Type': 'application/json', 'SHIPPO-API-VERSION': '2018-02-08' },
      body: JSON.stringify({ address_from: address(origin), address_to: address(destination), parcels: [parcel], async: false }),
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    console.error('Shippo shipment request failed:', error instanceof Error ? error.name : 'Network error');
    throw new CommerceError('Shipping carriers did not respond. Please retry the shipping quote.', 503);
  }
  if (!response.ok) {
    console.error('Shippo shipment rejected:', response.status);
    throw new CommerceError('Shipping rates could not be retrieved. Check the delivery address or contact support.', 503);
  }
  const result = shipmentSchema.safeParse(await response.json());
  if (!result.success) throw new Error('Shippo returned an invalid shipment response.');
  if (result.data.messages?.length) console.warn('Shippo reported carrier messages for a shipping quote.');
  return result.data.rates.filter(rate => rate.currency === 'USD' && ['usps', 'ups', 'fedex'].includes(rate.provider.toLowerCase())
    && Number(rate.amount) > 0 && !/media.?mail|bound.?printed|library.?mail/i.test(`${rate.servicelevel.name} ${rate.servicelevel.token}`));
}

export async function shippingQuote(items: z.infer<typeof cartSchema>, customer: ShippingCustomer) {
  const account = await storeAccount();
  const [settings, lines] = await Promise.all([loadShippingSettings(account), pricedShippingLines(items)]);
  let parcels: ReturnType<typeof shippingParcels>;
  try { parcels = shippingParcels(lines, settings.profiles); }
  catch (error) { throw new CommerceError(error instanceof Error ? error.message : 'Package configuration failed.', 409); }
  // Separate single-parcel quotes support USPS, which cannot rate a multipiece shipment.
  const shipments = await Promise.all(parcels.map(parcel => shippoShipment(settings.origin, customer, parcel)));
  const rates: ShippingRate[] = [];
  for (const first of shipments[0] || []) {
    const matching = shipments.map(rates => rates.find(rate => rate.provider === first.provider && rate.servicelevel.token === first.servicelevel.token));
    if (matching.some(rate => !rate)) continue;
    const amount = matching.reduce((sum, rate) => sum + Math.round(Number(rate!.amount) * 100), 0);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Carrier quote exceeds supported shipping limits.');
    const days = matching.map(rate => rate!.estimated_days);
    rates.push({ id: fingerprint(matching.map(rate => rate!.object_id)), name: `${first.provider} ${first.servicelevel.name}`,
      amount, estimatedDays: days.every(value => typeof value === 'number') ? Math.max(...days.map(value => value!)) : null });
  }
  rates.sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
  const unique = rates.filter((rate, index) => rates.findIndex(other => other.name === rate.name) === index).slice(0, 20);
  if (!unique.length) throw new CommerceError('No supported USPS, UPS or FedEx service is available for every package in this cart. Check your address or request an item for a staff quote.', 409);
  const expires = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ version: 1, account, expires, cart: fingerprint(lines), settings: fingerprint(settings), customer, parcels: parcels.length, rates: unique })).toString('base64url');
  return { token: `${payload}.${quoteSignature(payload).toString('base64url')}`, rates: unique, parcels: parcels.length, expires };
}

export async function verifyShippingQuote(token: string, rateId: string, items: z.infer<typeof cartSchema>, expectedCustomer?: ShippingCustomer) {
  const parts = token.split('.');
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature) throw new CommerceError('Request a new shipping quote.', 409);
  const expected = quoteSignature(payload);
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new CommerceError('Shipping quote is invalid. Request a new quote.', 409);
  const parsed = quoteSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  if (!parsed.success || parsed.data.expires <= Date.now()) throw new CommerceError('Shipping quote expired. Request a new quote.', 409);
  const quote = parsed.data;
  const account = await storeAccount();
  if (quote.account !== account) throw new CommerceError('Shipping quote belongs to a different store.', 409);
  const [settings, lines] = await Promise.all([loadShippingSettings(account), pricedShippingLines(items)]);
  if (quote.settings !== fingerprint(settings) || quote.cart !== fingerprint(lines)
    || expectedCustomer && fingerprint(expectedCustomer) !== fingerprint(quote.customer)) {
    throw new CommerceError('Cart, prices, address or shipping setup changed. Request a new quote.', 409);
  }
  const rate = quote.rates.find(rate => rate.id === rateId);
  if (!rate) throw new CommerceError('Select a quoted shipping service.', 409);
  const shipping: QuotedShipping = { customer: quote.customer, rate, parcels: quote.parcels };
  return { shipping, lines };
}

export async function verifyShippingConnections() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const shippoKey = process.env.SHIPPO_API_KEY;
  if (!stripeKey || !shippoKey || !process.env.STRIPE_WEBHOOK_SECRET) throw new CommerceError('Stripe, webhook and Shippo secrets must all be configured.', 503);
  const stripe = new Stripe(stripeKey, { maxNetworkRetries: 1, timeout: 20000 });
  const [balance, tax, carriers] = await Promise.all([
    stripe.balance.retrieve(), stripe.tax.settings.retrieve(),
    fetch('https://api.goshippo.com/carrier_accounts/?results=100', {
      headers: { Authorization: `ShippoToken ${shippoKey}`, 'SHIPPO-API-VERSION': '2018-02-08' },
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    }),
  ]);
  if (!carriers.ok) throw new CommerceError('Shippo rejected the configured API key or carrier request. Check its API access.', 503);
  const result = z.object({ results: z.array(z.object({ carrier: z.string(), active: z.boolean(), test: z.boolean().optional() })) }).parse(await carriers.json());
  const active = Array.from(new Set(result.results.filter(c => c.active && c.test !== true).map(c => c.carrier.toLowerCase())));
  const desired = ['usps', 'ups', 'fedex'];
  return {
    stripeMode: balance.livemode ? 'live' : 'test', shippoMode: shippoKey.startsWith('shippo_live_') ? 'live' : 'test',
    taxStatus: tax.status, carriers: desired.filter(c => active.includes(c)), missingCarriers: desired.filter(c => !active.includes(c)),
    message: 'Keys were checked without creating payments, orders or labels. This does not verify webhook delivery, destination-specific rates or your legal tax obligations.',
  };
}
