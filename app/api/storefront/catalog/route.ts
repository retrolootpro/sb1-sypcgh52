import { NextResponse } from 'next/server';
import { loadStorefrontCatalog } from '@/lib/server/storefront-catalog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await loadStorefrontCatalog(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Storefront catalog:', error);
    return NextResponse.json({ success: false, message: 'Inventory is temporarily unavailable. Please try again or contact support@pixelandpagellc.com.' }, { status: 503 });
  }
}
