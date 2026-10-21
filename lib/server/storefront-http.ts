import { createHash, createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdmin } from './supabase-admin';
import { getServerAccountContext } from '@/lib/server-account';

export class CommerceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function commerceRoute(action: () => Promise<unknown>) {
  try {
    return NextResponse.json({ success: true, ...await action() as object }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400 });
    console.error('Storefront request:', error instanceof Error ? error.message : 'Unknown failure');
    return NextResponse.json({ success: false, message: error instanceof CommerceError ? error.message : 'Unable to complete this action. Contact support@pixelandpagellc.com before retrying a payment.' }, { status: error instanceof CommerceError ? error.status : 503 });
  }
}

export async function readCommerceBody(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin && origin !== process.env.STOREFRONT_SITE_URL) throw new CommerceError('Request origin not allowed.', 403);
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new CommerceError('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CommerceError('Request body is required.');
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new CommerceError('Request too large.', 413); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; } catch { throw new CommerceError('Invalid JSON.'); }
}

export async function storeAccount() {
  const { data, error } = await createSupabaseAdmin().from('storefront_settings').select('user_id')
    .eq('public_slug', 'pixel-and-page').eq('is_active', true).single();
  if (error || !data) throw new CommerceError('The online store is not configured yet.', 503);
  return String(data.user_id);
}

export async function requireStoreAdmin(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) throw new CommerceError('Sign in to manage the storefront.', 401);
  const admin = createSupabaseAdmin();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new CommerceError('Your session expired. Sign in again.', 401);
  const client = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const account = await getServerAccountContext(client, user);
  if (account.role !== 'admin' || account.accountId !== await storeAccount()) throw new CommerceError('Store administrator access required.', 403);
  return { admin, accountId: account.accountId };
}

export async function limitCommerce(request: NextRequest, scope: string, email?: string) {
  const admin = createSupabaseAdmin();
  const ip = request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const values = [{ value: ip, limit: 20, seconds: 3600 }, ...(email ? [{ value: email.toLowerCase(), limit: 5, seconds: 86400 }] : [])];
  for (const entry of values) {
    const key = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!).update(`${scope}:${entry.value}`).digest('hex');
    const { data, error } = await admin.rpc('storefront_rate_limit', { p_key: key, p_limit: entry.limit, p_seconds: entry.seconds });
    if (error) throw error;
    if (!data) throw new CommerceError('Too many attempts. Please try again later or email support.', 429);
  }
}

export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
