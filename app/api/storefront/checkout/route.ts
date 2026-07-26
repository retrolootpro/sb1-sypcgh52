import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

type CheckoutItem = { id: string; quantity: number };

function priceForCondition(condition: unknown, pricing: Record<string, any> | undefined) {
  if (!pricing) return 0;
  const value = String(condition || '').toLowerCase();
  const candidates = value.includes('new') || value.includes('sealed')
    ? [pricing.new_price, pricing.cib_price, pricing.loose_price]
    : value.includes('cib') || value.includes('complete')
      ? [pricing.cib_price, pricing.loose_price, pricing.new_price]
      : [pricing.loose_price, pricing.cib_price, pricing.new_price];

  for (const candidate of candidates) {
    const amount = Number(candidate || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function errorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return String(error || 'Unknown error');
  const value = error as Record<string, unknown>;
  return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' | ') || 'Unknown database error';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items as CheckoutItem[] : [];
    const customer = body.customer || {};
    const fulfillment = body.fulfillment === 'pickup' ? 'pickup' : 'shipping';

    if (!items.length) {
      return NextResponse.json({ success: false, message: 'Your cart is empty.' }, { status: 400 });
    }
    if (!customer.email || !customer.firstName || !customer.lastName) {
      return NextResponse.json({ success: false, message: 'First name, last name, and email are required.' }, { status: 400 });
    }
    if (fulfillment === 'shipping' && (!customer.address1 || !customer.city || !customer.state || !customer.postalCode)) {
      return NextResponse.json({ success: false, message: 'A complete shipping address is required.' }, { status: 400 });
    }

    const ids = items.map((item) => item.id);
    const admin = createSupabaseAdmin();
    const { data: inventoryRows, error: inventoryError } = await admin
      .from('inventory_items')
      .select('id,product_name,console,condition,quantity')
      .in('id', ids);

    if (inventoryError) throw new Error(`Inventory validation failed: ${errorDetails(inventoryError)}`);

    const { data: pricingRows, error: pricingError } = await admin
      .from('pricing_data')
      .select('item_id,loose_price,cib_price,new_price,fetched_at')
      .in('item_id', ids)
      .order('fetched_at', { ascending: false });

    if (pricingError) throw new Error(`Pricing validation failed: ${errorDetails(pricingError)}`);

    const inventory = new Map((inventoryRows || []).map((item: any) => [String(item.id), item]));
    const pricing = new Map<string, Record<string, any>>();
    for (const row of pricingRows || []) {
      if (!pricing.has(String(row.item_id))) pricing.set(String(row.item_id), row);
    }

    const taxRate = Number(process.env.CLOVER_SALES_TAX_RATE || 0);
    const taxRates = Number.isFinite(taxRate) && taxRate > 0
      ? [{ name: process.env.CLOVER_SALES_TAX_NAME || 'Sales tax', rate: Math.round(taxRate * 100000) }]
      : undefined;

    const lineItems = items.map((requested) => {
      const product: any = inventory.get(String(requested.id));
      if (!product || Number(product.quantity || 0) < 1) {
        throw new Error('One of the products in your cart is no longer available. Please return to the cart and refresh it.');
      }

      const price = priceForCondition(product.condition, pricing.get(String(product.id)));
      if (price <= 0) throw new Error(`${product.product_name} does not currently have a valid selling price.`);

      const quantity = Math.min(Math.max(1, Number(requested.quantity) || 1), Number(product.quantity));
      return {
        name: String(product.product_name || 'Pixel & Page item').slice(0, 127),
        note: `${product.console || 'Pixel & Page'} - ${product.condition || 'Available'}`.slice(0, 255),
        price: Math.round(price * 100),
        unitQty: quantity,
        ...(taxRates ? { taxRates } : {}),
      };
    });

    const shippingCents = fulfillment === 'shipping'
      ? Math.max(0, Number(process.env.STOREFRONT_FLAT_SHIPPING_CENTS || 0))
      : 0;

    if (shippingCents > 0) {
      lineItems.push({
        name: 'Shipping',
        note: 'Pixel & Page order shipping',
        price: Math.round(shippingCents),
        unitQty: 1,
        ...(taxRates ? { taxRates } : {}),
      });
    }

    const merchantId = process.env.CLOVER_HOSTED_CHECKOUT_MERCHANT_ID
      || process.env.CLOVER_MERCHANT_ID
      || process.env.NEXT_PUBLIC_CLOVER_MERCHANT_ID;
    const privateKey = process.env.CLOVER_HOSTED_CHECKOUT_PRIVATE_KEY
      || process.env.CLOVER_ECOM_PRIVATE_KEY
      || process.env.CLOVER_PRIVATE_KEY;

    if (!merchantId || !privateKey) {
      return NextResponse.json({
        success: false,
        configurationRequired: true,
        missing: [!merchantId ? 'Clover merchant ID' : null, !privateKey ? 'Clover Hosted Checkout private key' : null].filter(Boolean),
        message: 'Online payment is not active yet. Add the Clover Hosted Checkout merchant ID and private key to the Netlify environment variables, then redeploy.',
      }, { status: 503 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
    const endpoint = process.env.CLOVER_HOSTED_CHECKOUT_URL || 'https://api.clover.com/invoicingcheckoutservice/v1/checkouts';
    const pageConfigUuid = process.env.CLOVER_HOSTED_CHECKOUT_PAGE_CONFIG_UUID;

    const cloverResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'PixelAndPageStorefront/1.1',
        'X-Clover-Merchant-Id': merchantId,
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({
        ...(pageConfigUuid ? { pageConfigUuid } : {}),
        customer: {
          firstName: String(customer.firstName),
          lastName: String(customer.lastName),
          email: String(customer.email),
          phoneNumber: customer.phone ? String(customer.phone) : undefined,
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
      const detail = result.message || result.error?.message || result.details || `Clover returned HTTP ${cloverResponse.status}`;
      throw new Error(`Clover could not start checkout: ${detail}`);
    }

    return NextResponse.json({
      success: true,
      href: result.href,
      checkoutSessionId: result.checkoutSessionId,
      fulfillment,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : errorDetails(error),
    }, { status: 500 });
  }
}
