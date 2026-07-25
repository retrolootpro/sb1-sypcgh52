import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { syncInventoryItemToClover } from '@/lib/server/clover-sync';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  const secret = process.env.CLOVER_AUTO_SYNC_SECRET;
  if (secret && req.headers.get('x-retroloot-cron-secret') !== secret) {
    return json({ success: false, message: 'Unauthorized' }, 401);
  }

  const admin = createSupabaseAdmin();
  const { data: settings, error: settingsError } = await admin
    .from('clover_sync_settings')
    .select('*')
    .eq('auto_sync_enabled', true);
  if (settingsError) throw settingsError;

  const summary = { accounts: 0, processed: 0, synced: 0, failed: 0, skipped: 0 };
  const now = Date.now();
  for (const setting of settings || []) {
    const last = setting.last_auto_sync_at ? new Date(setting.last_auto_sync_at).getTime() : 0;
    const intervalMs = Number(setting.auto_sync_interval_minutes || 60) * 60_000;
    if (last && now - last < intervalMs) {
      summary.skipped += 1;
      continue;
    }
    summary.accounts += 1;
    const { data: items } = await admin
      .from('inventory_items')
      .select('*')
      .eq('user_id', setting.user_id)
      .eq('sync_to_clover', true)
      .in('clover_sync_status', ['pending', 'failed'])
      .not('status', 'in', '(sold,archived,deleted)')
      .limit(25);
    for (const item of items || []) {
      summary.processed += 1;
      try {
        const result = await syncInventoryItemToClover(admin, item, { conflictAction: 'update_existing' });
        if ('skipped' in result) summary.skipped += 1;
        else summary.synced += 1;
      } catch {
        summary.failed += 1;
      }
    }
    await admin
      .from('clover_sync_settings')
      .update({ last_auto_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', setting.user_id);
  }

  return json({ success: true, ...summary });
}
