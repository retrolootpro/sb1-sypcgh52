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

function isAlreadyRegisteredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /already.*registered|already.*exists|user.*exists/i.test(message);
}

async function findAuthUserByEmail(admin: any, email: string) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const match = data.users.find((candidate: { email?: string | null }) => candidate.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (data.users.length < 1000) break;
  }

  return null;
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
      .select('id, status, user_id')
      .eq('account_owner_id', account.accountId)
      .eq('email', inviteEmail)
      .neq('status', 'revoked')
      .maybeSingle();

    if (existingMembership?.status === 'active') {
      const { error: roleUpdateError } = await admin
        .from('user_account_memberships')
        .update({
          role: inviteRole,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingMembership.id);

      if (roleUpdateError) throw roleUpdateError;

      return json({
        success: true,
        message: `${inviteEmail} already has active access. Role updated to ${inviteRole}.`,
      });
    }

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
        app_name: 'RetroLootPro',
        account_owner_id: account.accountId,
        account_role: inviteRole,
      },
    });

    if (inviteError) {
      if (!isAlreadyRegisteredError(inviteError)) throw inviteError;

      const existingUser = await findAuthUserByEmail(admin, inviteEmail);
      if (!existingUser) throw inviteError;

      const { error: activateError } = await admin
        .from('user_account_memberships')
        .update({
          user_id: existingUser.id,
          role: inviteRole,
          status: 'active',
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('account_owner_id', account.accountId)
        .eq('email', inviteEmail)
        .neq('status', 'revoked');

      if (activateError) throw activateError;

      return json({
        success: true,
        message: `${inviteEmail} already has a login, so team access was activated. They can sign in normally.`,
      });
    }

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

export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const { membershipId } = await req.json().catch(() => ({}));
    const inviteId = String(membershipId || '').trim();
    if (!inviteId) return json({ success: false, message: 'Missing invitation id.' }, 400);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const account = await getServerAccountContext(supabase, user);
    if (account.role !== 'admin') {
      return json({ success: false, message: 'Only admins can delete invitations.' }, 403);
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return json({
        success: false,
        message: 'SUPABASE_SERVICE_ROLE_KEY is required on Netlify before invitations can be changed.',
      }, 500);
    }

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: revokeError } = await admin
      .from('user_account_memberships')
      .update({
        status: 'revoked',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .eq('account_owner_id', account.accountId)
      .eq('status', 'invited');

    if (revokeError) throw revokeError;

    return json({
      success: true,
      message: 'Invitation deleted.',
    });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'Delete invitation failed',
    }, 500);
  }
}
