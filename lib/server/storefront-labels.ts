import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { CommerceError, fingerprint } from './storefront-http';
import { createSupabaseAdmin } from './supabase-admin';
import { loadShippingSettings, quoteSignature, shippoShipment } from './storefront-shipping';
import { shippingCustomerSchema } from '@/lib/storefront-shipping';
import { labelParcelSchema, type LabelParcel, type ShippingLabel } from '@/lib/storefront-labels';

const rateSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1), amount: z.number().int().positive(), estimatedDays: z.number().nullable() });
const tokenSchema = z.object({
  order: z.string().uuid(), account: z.string().uuid(), index: z.number().int().min(0).max(9), expires: z.number(),
  context: z.string(), parcel: labelParcelSchema, rates: z.array(rateSchema).min(1).max(20),
});
const purpose = 'storefront-label-v1';
type LabelOrder = {
  id: string; status: string; refunded_cents: number; shipping_quote: {
    customer: unknown; rate: { name: string }; parcels: number;
  } | null;
};
const safeUrl = z.string().url().refine(value => new URL(value).protocol === 'https:');
const optionalUrl = z.preprocess(value => value === '' ? null : value, safeUrl.nullish());
const transactionSchema = z.object({
  object_id: z.string().regex(/^[a-f0-9]{32}$/), status: z.enum(['WAITING','QUEUED','SUCCESS','ERROR','REFUNDED','REFUNDPENDING','REFUNDREJECTED']),
  amount: z.union([z.string(), z.number()]), currency: z.string().length(3),
  metadata: z.string(), rate: z.union([z.string(), z.object({ object_id: z.string() }).transform(rate => rate.object_id)]), test: z.boolean(),
  label_url: optionalUrl, tracking_number: z.string().max(200).nullish(),
  tracking_url_provider: optionalUrl,
  messages: z.array(z.object({ text: z.string().optional() })).optional(),
});

export function shippoAmountCents(amount: string | number): number {
  const value = String(amount);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || /[1-9]/.test((match[2] || '').slice(2))) throw new CommerceError('Shippo returned an invalid label amount. Reconcile this purchase manually.', 503);
  const cents = Number(match[1]) * 100 + Number((match[2] || '').slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new CommerceError('Shippo returned an invalid label amount. Reconcile this purchase manually.', 503);
  return cents;
}

export async function labelOrder(orderId: string, accountId: string) {
  const { data, error } = await createSupabaseAdmin().from('storefront_orders').select('*')
    .eq('id', orderId).eq('account_id', accountId).single();
  if (error || !data) throw new CommerceError('Order not found.', 404);
  return data as LabelOrder;
}

function purchasable(order: LabelOrder, index: number) {
  if (order.status !== 'paid' || order.refunded_cents !== 0) throw new CommerceError('Only paid, unrefunded orders can purchase postage.', 409);
  if (!order.shipping_quote || !Number.isInteger(order.shipping_quote.parcels) || !Number.isInteger(index) || index < 0 || index > 9 || index >= order.shipping_quote.parcels) {
    throw new CommerceError('This order has no saved carrier-shipping package. Purchase its label externally.', 409);
  }
}

function providerKey() {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new CommerceError('Shippo is not configured.', 503);
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && !key.startsWith('shippo_live_')) {
    throw new CommerceError('Live orders require a live Shippo key.', 503);
  }
  return key;
}

export async function listLabels(orderId: string, accountId: string): Promise<ShippingLabel[]> {
  const { data, error } = await createSupabaseAdmin().from('storefront_labels').select('*')
    .eq('order_id', orderId).eq('account_id', accountId).order('parcel_index');
  if (error) throw error;
  return data;
}

export async function quoteLabel(orderId: string, accountId: string, index: number, parcel: LabelParcel) {
  providerKey();
  const [order, settings, labels] = await Promise.all([labelOrder(orderId, accountId), loadShippingSettings(accountId), listLabels(orderId, accountId)]);
  purchasable(order, index);
  if (labels.some(label => label.parcel_index === index)) throw new CommerceError('This package already has a label purchase record. Refresh or reconcile it; do not buy another label.', 409);
  const destination = shippingCustomerSchema.parse(order.shipping_quote!.customer);
  const providerRates = await shippoShipment(settings.origin, destination, {
    length: String(parcel.length), width: String(parcel.width), height: String(parcel.height), weight: String(parcel.weight),
    distance_unit: 'in', mass_unit: 'oz',
  });
  const rates = providerRates.map(rate => ({ id: rate.object_id, name: `${rate.provider} ${rate.servicelevel.name}`,
    amount: Math.round(Number(rate.amount) * 100), estimatedDays: rate.estimated_days ?? null }))
    .filter(rate => Number.isSafeInteger(rate.amount) && rate.amount > 0 && rate.amount <= 10000000)
    .sort((a, b) => a.amount - b.amount).slice(0, 20);
  if (!rates.length) throw new CommerceError('No supported label service is available for this package and address.', 409);
  const expires = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ order: orderId, account: accountId, index, parcel, rates, expires,
    context: fingerprint({ shipping: order.shipping_quote, origin: settings.origin }) })).toString('base64url');
  return { token: `${payload}.${quoteSignature(payload, purpose).toString('base64url')}`, rates, expires,
    origin: settings.origin, destination, purchasedService: order.shipping_quote!.rate.name };
}

async function providerTransaction(path: string, body?: object) {
  const response = await fetch(`https://api.goshippo.com/transactions/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `ShippoToken ${providerKey()}`, 'Content-Type': 'application/json', 'SHIPPO-API-VERSION': '2018-02-08' },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new CommerceError(`Shippo transaction request failed (${response.status}). Reconcile this purchase before any further postage purchase.`, 503);
  return transactionSchema.parse(await response.json());
}

async function saveTransaction(label: ShippingLabel, transaction: z.infer<typeof transactionSchema>) {
  const expectedMetadata = `storefront-label:${label.id}`;
  if (transaction.metadata !== expectedMetadata || transaction.rate !== label.rate.id || transaction.test !== !providerKey().startsWith('shippo_live_')
    || label.transaction_id && label.transaction_id !== transaction.object_id) {
    throw new CommerceError('Shippo transaction does not match this label purchase. No record was changed.', 409);
  }
  const refunded = ['REFUNDED','REFUNDPENDING'].includes(transaction.status);
  const complete = ['SUCCESS','REFUNDREJECTED'].includes(transaction.status) && transaction.label_url && transaction.tracking_number;
  const amountCents = complete ? shippoAmountCents(transaction.amount) : label.actual_amount_cents;
  const currency = complete ? transaction.currency.toUpperCase() : label.currency;
  if (complete && currency !== 'USD') throw new CommerceError('Shippo label currency is not USD. Reconcile this purchase manually.', 503);
  const patch = {
    transaction_id: transaction.object_id,
    status: transaction.status === 'ERROR' || refunded ? 'error' : complete ? 'success' : 'pending',
    actual_amount_cents: amountCents ?? null, currency: currency ?? null,
    label_url: transaction.label_url ?? null, tracking_number: transaction.tracking_number ?? null,
    tracking_url: transaction.tracking_url_provider ?? null,
    message: refunded ? 'This label has a refund requested or completed in Shippo. Do not use it. Review the transaction before fulfillment.'
      : transaction.status === 'ERROR' ? (transaction.messages?.map(m => m.text).filter(Boolean).join('; ').slice(0, 1000) || 'Shippo rejected the label. Review this transaction in Shippo; no automatic repurchase is allowed.')
      : refunded ? 'Shippo refunded or is refunding this label. The original postage expense remains recorded; reconcile the refund in Finance before closing the books.'
      : complete ? null : 'Shippo is still processing this transaction. Refresh its status; do not purchase again.',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await createSupabaseAdmin().from('storefront_labels').update(patch).eq('id', label.id).eq('status', label.status).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new CommerceError('Label changed during reconciliation. Refresh its records; do not purchase again.', 409);
  if (complete && amountCents) {
    const { error: financeError } = await createSupabaseAdmin().rpc('storefront_record_postage', {
      p_label: label.id, p_transaction: transaction.object_id, p_amount_cents: amountCents,
      p_date: new Date(label.created_at).toISOString().slice(0, 10),
    });
    if (financeError) throw financeError;
  }
  return { ...label, ...patch };
}

export async function buyLabel(orderId: string, accountId: string, token: string, rateId: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw new CommerceError('Get a new label quote.', 409);
  const expected = quoteSignature(payload, purpose), supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new CommerceError('Invalid label quote.', 409);
  const quote = tokenSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  if (quote.order !== orderId || quote.account !== accountId || quote.expires <= Date.now()) throw new CommerceError('Label quote expired or belongs to another order. Get a new quote.', 409);
  const [order, settings] = await Promise.all([labelOrder(orderId, accountId), loadShippingSettings(accountId)]);
  purchasable(order, quote.index);
  if (quote.context !== fingerprint({ shipping: order.shipping_quote, origin: settings.origin })) throw new CommerceError('Shipping details changed. Get a new label quote.', 409);
  const rate = quote.rates.find(r => r.id === rateId);
  if (!rate) throw new CommerceError('Choose a quoted label service.', 409);
  providerKey();
  const { data, error } = await createSupabaseAdmin().rpc('storefront_claim_label', {
    p_order: orderId, p_account: accountId, p_index: quote.index, p_rate: rate, p_parcel: quote.parcel,
  });
  if (error) throw error;
  if (!data?.claimed) throw new CommerceError('This package already has a purchase in progress or completed. Refresh its label record; no duplicate purchase was made.', 409);
  const label: ShippingLabel = data.label;
  // A durable claim precedes the single non-retried charge request. Ambiguous outcomes stay locked.
  try {
    const transaction = await providerTransaction('', { rate: rate.id, label_file_type: 'PDF_4x6', async: false, metadata: `storefront-label:${label.id}` });
    return await saveTransaction(label, transaction);
  } catch (cause) {
    console.error('Shipping label purchase requires reconciliation:', label.id, cause instanceof Error ? cause.message : 'Unknown failure');
    throw new CommerceError(`Label purchase outcome needs review. Purchase reference ${label.id}. Refresh the record or reconcile its Shippo transaction; do not buy another label.`, 503);
  }
}

export async function refreshLabel(orderId: string, accountId: string, labelId: string, transactionId?: string) {
  const labels = await listLabels(orderId, accountId);
  const label = labels.find(row => row.id === labelId);
  if (!label) throw new CommerceError('Label purchase not found.', 404);
  const id = label.transaction_id || transactionId;
  if (!id) throw new CommerceError('Purchase outcome is unknown. Find the transaction in Shippo using this purchase reference, then enter its transaction ID. Do not purchase again.', 409);
  return saveTransaction(label, await providerTransaction(`${id}/`));
}
