import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { businessMembership } from '@/lib/server/business-access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ success: false, message: 'Sign in to the business workspace.' }, 401);
    const { data: { user }, error } = await createSupabaseAdmin().auth.getUser(token);
    if (error || !user) return json({ success: false, message: 'Your session expired. Sign in again.' }, 401);
    const account = await businessMembership(user);
    if (!account) return json({ success: false, message: 'This login does not have active Pixel & Page team access. Ask an owner for an invitation.' }, 403);
    return json({ success: true, ...account });
  } catch (error) {
    console.error('Business session verification failed:', error);
    return json({ success: false, message: 'Team access could not be verified. Please retry; no account has been created or changed.' }, 503);
  }
}
