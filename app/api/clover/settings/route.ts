import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

async function auth(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader) throw new Error('Missing authorization');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Auth failed');
  return getServerAccountContext(supabase, user);
}

export async function GET(req: NextRequest) {
  try {
    const account = await auth(req);
    const admin = createSupabaseAdmin();
    const { data } = await admin.from('clover_sync_settings').select('*').eq('user_id', account.accountId).maybeSingle();
    return json({ success: true, settings: data || { auto_sync_enabled: false, auto_sync_interval_minutes: 60 } });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Settings failed' }, 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = await auth(req);
    const body = await req.json().catch(() => ({}));
    const admin = createSupabaseAdmin();
    const interval = Math.max(15, Number(body.auto_sync_interval_minutes) || 60);
    const { data, error } = await admin
      .from('clover_sync_settings')
      .upsert({
        user_id: account.accountId,
        auto_sync_enabled: Boolean(body.auto_sync_enabled),
        auto_sync_interval_minutes: interval,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return json({ success: true, settings: data });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Settings failed' }, 500);
  }
}
