import { NextRequest } from 'next/server';
import { z } from 'zod';
import { commerceRoute, readCommerceBody, requireStoreAdmin } from '@/lib/server/storefront-http';
import { buyLabel, labelOrder, listLabels, quoteLabel, refreshLabel } from '@/lib/server/storefront-labels';
import { labelParcelSchema } from '@/lib/storefront-labels';

export const dynamic = 'force-dynamic';
const order = { orderId: z.string().uuid() };
const schema = z.discriminatedUnion('action', [
  z.object({ ...order, action: z.literal('quote'), index: z.number().int().min(0).max(9), parcel: labelParcelSchema }),
  z.object({ ...order, action: z.literal('buy'), token: z.string().min(1).max(12000), rateId: z.string().min(1).max(100), confirm: z.literal(true) }),
  z.object({ ...order, action: z.literal('refresh'), labelId: z.string().uuid(), transactionId: z.string().regex(/^[a-f0-9]{32}$/).optional() }),
]);

export async function GET(request: NextRequest) {
  return commerceRoute(async () => {
    const { accountId } = await requireStoreAdmin(request);
    const orderId = z.string().uuid().parse(request.nextUrl.searchParams.get('orderId'));
    await labelOrder(orderId, accountId);
    return { labels: await listLabels(orderId, accountId) };
  });
}

export async function POST(request: NextRequest) {
  return commerceRoute(async () => {
    const { accountId } = await requireStoreAdmin(request);
    const input = schema.parse(await readCommerceBody(request));
    if (input.action === 'quote') return quoteLabel(input.orderId, accountId, input.index, input.parcel);
    if (input.action === 'buy') return { label: await buyLabel(input.orderId, accountId, input.token, input.rateId) };
    return { label: await refreshLabel(input.orderId, accountId, input.labelId, input.transactionId) };
  });
}
