import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function siteUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const { email, role } = await req.json().catch(() => ({}));
    const inviteEmail = String(email || '').trim().toLowerCase();
    const inviteRole = role === 'admin' ? 'admin' : 'user';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      return json({ success: false, message: 'Enter a valid email address.' }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const account = await getServerAccountContext(supabase, user);
    if (account.role !== 'admin') {
      return json({ success: false, message: 'Only admins can invite users.' }, 403);
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return json({
        success: false,
        message: 'SUPABASE_SERVICE_ROLE_KEY is required on Netlify before invitations can be sent.',
      }, 500);
    }

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existingMembership } = await admin
      .from('user_account_memberships')
      .select('id')
      .eq('account_owner_id', account.accountId)
      .eq('email', inviteEmail)
      .neq('status', 'revoked')
      .maybeSingle();

    const membershipWrite = existingMembership
      ? admin
          .from('user_account_memberships')
          .update({
            role: inviteRole,
            status: 'invited',
            invited_by: user.id,
            invited_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingMembership.id)
      : admin
          .from('user_account_memberships')
          .insert({
          account_owner_id: account.accountId,
          email: inviteEmail,
          role: inviteRole,
          status: 'invited',
          invited_by: user.id,
          invited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          });

    const { error: membershipError } = await membershipWrite;

    if (membershipError) throw membershipError;

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(inviteEmail, {
      redirectTo: `${siteUrl(req)}/auth/callback?next=/dashboard`,
      data: {
        account_owner_id: account.accountId,
        account_role: inviteRole,
      },
    });

    if (inviteError) throw inviteError;

    return json({
      success: true,
      message: `Invitation sent to ${inviteEmail}.`,
    });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'Invite failed',
    }, 500);
  }
}
