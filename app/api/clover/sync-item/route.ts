import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { syncInventoryItemToClover } from '@/lib/server/clover-sync';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);
    const { inventoryItemId, conflictAction } = await req.json().catch(() => ({}));
    if (!inventoryItemId) return json({ success: false, message: 'inventoryItemId is required' }, 400);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);
    const account = await getServerAccountContext(supabase, user);

    const admin = createSupabaseAdmin();
    const { data: item, error } = await admin
      .from('inventory_items')
      .select('*')
      .eq('id', inventoryItemId)
      .eq('user_id', account.accountId)
      .single();
    if (error || !item) return json({ success: false, message: 'Item not found' }, 404);

    const result = await syncInventoryItemToClover(admin, item, { conflictAction });
    if ('conflict' in result) return json({ success: false, ...result }, 409);
    return json({ success: true, ...result });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Clover sync failed' }, 500);
  }
}
