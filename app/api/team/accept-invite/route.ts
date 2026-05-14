import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.email) return json({ success: false, message: 'Auth failed' }, 401);

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return json({ success: false, message: 'SUPABASE_SERVICE_ROLE_KEY is required to accept team invites.' }, 500);
    }

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: invite, error: findError } = await admin
      .from('user_account_memberships')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .eq('status', 'invited')
      .order('invited_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;
    if (!invite) return json({ success: true, message: 'No pending invite found.' });

    const { error: updateError } = await admin
      .from('user_account_memberships')
      .update({
        user_id: user.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (updateError) throw updateError;

    return json({ success: true, message: 'Invite accepted.' });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to accept invite',
    }, 500);
  }
}
