import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

type CheckoutItem = { id: string; quantity: number };

function getPrice(item: Record<string, any>) {
  const condition = String(item.condition || '').toLowerCase();
  const values = [
    item.storefront_price,
    item.selected_market_value,
    condition.includes('new') ? item.price_new : null,
    condition.includes('complete') || condition.includes('cib') ? item.price_cib : null,
    item.price_loose,
    item.price_cib,
    item.price_new,
  ];
  for (const value of values) {
    const amount = Number(value || 0);
    if (amount > 0) return amount;
  }
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items as CheckoutItem[] : [];
    const customer = body.customer || {};

    if (!items.length) return NextResponse.json({ success: false, message: 'Your cart is empty.' }, { status: 400 });
    if (!customer.email || !customer.firstName || !customer.lastName) {
      return NextResponse.json({ success: false, message: 'Name and email are required.' }, { status: 400 });
    }

    const ids = items.map((item) => item.id);
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from('inventory_items')
      .select('id,product_name,console,category,condition,quantity,status,storefront_price,selected_market_value,price_loose,price_cib,price_new')
      .in('id', ids);
    if (error) throw error;

    const products = new Map((data || []).map((item: any) => [String(item.id), item]));
    const lineItems = items.map((requested) => {
      const product: any = products.get(String(requested.id));
      if (!product || ['sold', 'archived', 'deleted'].includes(String(product.status || 'available')) || Number(product.quantity || 0) < 1) {
        throw new Error('One of the products in your cart is no longer available.');
      }
      const price = getPrice(product);
      if (price <= 0) throw new Error(`${product.product_name} does not currently have a valid selling price.`);
      const quantity = Math.min(Math.max(1, Number(requested.quantity) || 1), Number(product.quantity));
      return {
        name: String(product.product_name).slice(0, 127),
        note: `${product.console || product.category || 'Pixel & Page'} - ${product.condition || 'Available'}`.slice(0, 255),
        price: Math.round(price * 100),
        unitQty: quantity,
      };
    });

    const merchantId = process.env.CLOVER_HOSTED_CHECKOUT_MERCHANT_ID;
    const privateKey = process.env.CLOVER_HOSTED_CHECKOUT_PRIVATE_KEY;
    if (!merchantId || !privateKey) {
      return NextResponse.json({
        success: false,
        configurationRequired: true,
        message: 'Secure payment is not active yet because Clover Hosted Checkout credentials are missing from Netlify.',
      }, { status: 503 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
    const endpoint = process.env.CLOVER_HOSTED_CHECKOUT_URL || 'https://api.clover.com/invoicingcheckoutservice/v1/checkouts';
    const cloverResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'PixelAndPageStorefront/1.0',
        'X-Clover-Merchant-Id': merchantId,
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({
        customer: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phoneNumber: customer.phone || undefined,
        },
        redirectUrls: {
          success: `${origin}/shop/checkout/success`,
          failure: `${origin}/shop/checkout?payment=failed`,
        },
        shoppingCart: { lineItems },
      }),
    });

    const result = await cloverResponse.json().catch(() => ({}));
    if (!cloverResponse.ok || !result.href) {
      throw new Error(result.message || result.error?.message || 'Clover could not start checkout.');
    }

    return NextResponse.json({ success: true, href: result.href, checkoutSessionId: result.checkoutSessionId });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Checkout failed.' }, { status: 500 });
  }
}
