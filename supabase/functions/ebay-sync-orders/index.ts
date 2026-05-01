import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EBAY_ORDERS_URL = "https://api.ebay.com/sell/fulfillment/v1/order";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getValidAccessToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: conn } = await supabase
    .from("platform_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("platform", "ebay")
    .eq("is_active", true)
    .maybeSingle();

  if (!conn) {
    throw new Error("eBay account not connected. Please connect your eBay account in Settings.");
  }

  const isExpired = !conn.token_expires_at || new Date(conn.token_expires_at) <= new Date();

  if (!isExpired) {
    return conn.access_token;
  }

  const { data: apiKeys } = await supabase
    .from("user_api_keys")
    .select("provider, api_key")
    .eq("user_id", userId)
    .in("provider", ["ebay_client_id", "ebay_client_secret"]);

  const keys: Record<string, string> = {};
  for (const k of (apiKeys || [])) {
    keys[k.provider] = k.api_key;
  }

  if (!keys["ebay_client_id"] || !keys["ebay_client_secret"]) {
    throw new Error("eBay credentials not configured");
  }

  const credentials = btoa(`${keys["ebay_client_id"]}:${keys["ebay_client_secret"]}`);
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
    scope: "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  });

  const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData.error_description || "Token refresh failed. Please reconnect your eBay account.");
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();
  await supabase
    .from("platform_connections")
    .update({ access_token: tokenData.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("platform", "ebay");

  return tokenData.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const accessToken = await getValidAccessToken(supabase, user.id);

    const filterParam = "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}";
    const url = `${EBAY_ORDERS_URL}?filter=${encodeURIComponent(filterParam)}&limit=50`;

    const ordersRes = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!ordersRes.ok) {
      const errBody = await ordersRes.json().catch(() => ({}));
      return jsonResponse({ error: errBody.errors?.[0]?.message || "Failed to fetch eBay orders" }, 400);
    }

    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];

    let imported = 0;
    let skipped = 0;

    for (const order of orders) {
      try {
        const lineItem = order.lineItems?.[0] || {};
        const shippingAddr = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || {};

        const record = {
          user_id: user.id,
          platform: "ebay",
          platform_order_id: order.orderId,
          buyer_username: order.buyer?.username || null,
          item_title: lineItem.title || "eBay Item",
          item_sku: lineItem.sku || null,
          quantity: lineItem.quantity || 1,
          sale_price: parseFloat(order.pricingSummary?.total?.value || "0") || null,
          shipping_cost: parseFloat(order.pricingSummary?.deliveryCost?.value || "0") || null,
          shipping_address: shippingAddr
            ? {
                name: shippingAddr.fullName,
                line1: shippingAddr.contactAddress?.addressLine1,
                line2: shippingAddr.contactAddress?.addressLine2,
                city: shippingAddr.contactAddress?.city,
                state: shippingAddr.contactAddress?.stateOrProvince,
                zip: shippingAddr.contactAddress?.postalCode,
                country: shippingAddr.contactAddress?.countryCode,
              }
            : null,
          order_status: order.orderFulfillmentStatus?.toLowerCase() || "awaiting_shipment",
          shipping_status: "pending",
          order_created_at: order.creationDate || null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("platform_orders")
          .upsert(record, { onConflict: "user_id,platform,platform_order_id" });

        if (error) {
          skipped++;
        } else {
          imported++;
        }
      } catch {
        skipped++;
      }
    }

    await supabase
      .from("platform_connections")
      .update({ updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("platform", "ebay");

    return jsonResponse({ success: true, imported, skipped, total: orders.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});
