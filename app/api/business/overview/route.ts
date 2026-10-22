import { NextRequest, NextResponse } from 'next/server';
import { CommerceError, requireStoreAdmin } from '@/lib/server/storefront-http';
import { businessOverviewSchema } from '@/lib/business-overview';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { admin, accountId } = await requireStoreAdmin(request);
    const [paid, pending, shipped, requests, queue] = await Promise.all([
      admin.from('storefront_orders').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'paid'),
      admin.from('storefront_orders').select('id', { count: 'exact', head: true }).eq('account_id', accountId).in('status', ['pending', 'creating']),
      admin.from('storefront_orders').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'shipped'),
      admin.from('storefront_requests').select('id', { count: 'exact', head: true }).eq('account_id', accountId).in('status', ['new', 'reviewing']),
      admin.from('storefront_orders').select('id, created_at, shipping_quote')
        .eq('account_id', accountId).eq('status', 'paid')
        .order('created_at', { ascending: true }).order('id').limit(5),
    ]);
    for (const result of [paid, pending, shipped, requests, queue]) {
      if (result.error) throw result.error;
    }
    const overview = businessOverviewSchema.parse({
      readyToShip: paid.count,
      awaitingPayment: pending.count,
      shipped: shipped.count,
      openRequests: requests.count,
      orders: queue.data?.map(order => ({
        id: order.id,
        createdAt: order.created_at,
        shippingService: order.shipping_quote?.rate?.name || null,
      })),
    });
    return NextResponse.json({ success: true, overview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Business overview:', error);
    return NextResponse.json({
      success: false,
      message: error instanceof CommerceError ? error.message : 'Order activity could not be loaded. Please retry.',
    }, { status: error instanceof CommerceError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
