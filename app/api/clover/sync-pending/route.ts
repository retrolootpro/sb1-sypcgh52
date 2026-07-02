import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { logCloverSync, syncInventoryItemToClover } from '@/lib/server/clover-sync';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);
    const account = await getServerAccountContext(supabase, user);

    const admin = createSupabaseAdmin();
    const { data: items, error } = await admin
      .from('inventory_items')
      .select('*')
      .eq('user_id', account.accountId)
      .eq('sync_to_clover', true)
      .in('clover_sync_status', ['pending', 'failed'])
      .not('status', 'in', '(sold,archived,deleted)')
      .limit(25);
    if (error) throw error;

    const summary = { processed: 0, synced: 0, failed: 0, skipped: 0 };
    for (const item of items || []) {
      summary.processed += 1;
      try {
        await syncInventoryItemToClover(admin, item);
        summary.synced += 1;
      } catch {
        summary.failed += 1;
      }
    }

    if ((items || []).length === 0) {
      summary.skipped = 1;
      await logCloverSync(admin, {
        userId: account.accountId,
        action: 'bulk_sync_pending',
        status: 'skipped',
        responseSummary: { reason: 'No pending items' },
      });
    }
    return json({ success: true, ...summary });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Bulk Clover sync failed' }, 500);
  }
}
