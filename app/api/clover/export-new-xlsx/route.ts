import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { buildCloverItemRows, buildCloverWorkbook, type InventoryExportItem } from '@/lib/server/clover-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest) {
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
    const { data, error } = await admin
      .from('inventory_items')
      .select('id, product_name, console, condition, barcode, sku, quantity, sell_price, selected_market_value, price_cib, price_loose, price_new, price_graded, purchase_price, status, category, item_type, clover_item_id, clover_sync_status')
      .eq('user_id', account.accountId)
      .or('clover_item_id.is.null,clover_sync_status.neq.synced')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = buildCloverItemRows((data || []) as InventoryExportItem[]);
    if (rows.length === 0) {
      return json({ success: false, message: 'No newly added Clover items are pending export.' }, 400);
    }

    const workbook = buildCloverWorkbook(rows);
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(workbook, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="retrolootpro-clover-new-items-${date}.xlsx"`,
        'Cache-Control': 'no-store',
        'X-Clover-Total': String(rows.length),
      },
    });
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Clover new-items export failed' }, 500);
  }
}
