import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { testCloverConnection } from '@/lib/server/clover-client';

export const dynamic = 'force-dynamic';

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
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ success: false, message: 'Auth failed' }, 401);

    const result = await testCloverConnection();
    return json(result, result.success ? 200 : 400);
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Clover diagnostic failed' }, 500);
  }
}
