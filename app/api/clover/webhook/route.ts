import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';
import { logCloverSync } from '@/lib/server/clover-sync';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function verifySignature(rawBody: string, signature: string | null) {
  const secret = process.env.CLOVER_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get('x-clover-signature'))) {
    return json({ success: false, message: 'Invalid signature' }, 401);
  }

  const event = rawBody ? JSON.parse(rawBody) : {};
  const eventId = String(event.id || event.eventId || event.event_id || '');
  const admin = createSupabaseAdmin();

  if (eventId) {
    const { data: existing } = await admin.from('clover_sync_logs').select('id').eq('clover_event_id', eventId).maybeSingle();
    if (existing) return json({ success: true, skipped: true });
  }

  await logCloverSync(admin, {
    cloverEventId: eventId || null,
    action: 'webhook_received',
    status: 'skipped',
    requestSummary: { objectId: event.objectId || event.itemId || null, type: event.type || event.eventType || null },
    responseSummary: { note: 'Webhook logged with idempotency. Quantity/status reconciliation waits for confirmed Clover payload shape.' },
  });

  return json({ success: true });
}
