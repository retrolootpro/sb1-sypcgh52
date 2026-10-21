import { NextRequest } from 'next/server';
import { requestSchema } from '@/lib/storefront-model';
import { commerceRoute, readCommerceBody, storeAccount, limitCommerce } from '@/lib/server/storefront-http';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return commerceRoute(async () => {
    const input = requestSchema.parse(await readCommerceBody(request));
    await limitCommerce(request, 'request', input.email);
    const { website, ...customer } = input;
    const { error } = await createSupabaseAdmin().from('storefront_requests').insert({
      ...customer, email: customer.email.toLowerCase(), account_id: await storeAccount(),
    });
    if (error) throw error;
    return { message: 'Request received. We will email you after reviewing availability and pricing. No payment has been taken.' };
  });
}
