import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SP_API_HOST = "sellingpartnerapi-na.amazon.com";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSHA256(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const keyMaterial = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", keyMaterial, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function buildAuthHeader(
  method: string,
  url: URL,
  headersMap: Record<string, string>,
  awsAccessKey: string,
  awsSecretKey: string,
  region: string,
  service: string
): Promise<{ authorization: string; amzDate: string }> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const allHeaders: Record<string, string> = { ...headersMap, "x-amz-date": amzDate };
  const sortedKeys = Object.keys(allHeaders).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const canonicalHeaders = sortedKeys.map(k => `${k.toLowerCase()}:${allHeaders[k].trim()}`).join("\n") + "\n";
  const signedHeaders = sortedKeys.map(k => k.toLowerCase()).join(";");

  const sortedParams = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const payloadHash = await sha256Hex("");
  const canonicalRequest = [method, url.pathname, sortedParams, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSHA256(`AWS4${awsSecretKey}`, dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  const kSigning = await hmacSHA256(kService, "aws4_request");
  const signature = toHex(await hmacSHA256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${awsAccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate };
}

async function getValidLwaToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: conn } = await supabase
    .from("platform_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("platform", "amazon")
    .eq("is_active", true)
    .maybeSingle();

  if (!conn) throw new Error("Amazon account not connected. Please connect in Settings.");

  const isExpired = !conn.token_expires_at || new Date(conn.token_expires_at) <= new Date();
  if (!isExpired) return conn.access_token;

  const { data: apiKeys } = await supabase
    .from("user_api_keys")
    .select("provider, api_key")
    .eq("user_id", userId)
    .in("provider", ["amazon_lwa_client_id", "amazon_lwa_client_secret"]);

  const keys: Record<string, string> = {};
  for (const k of (apiKeys || [])) keys[k.provider] = k.api_key;

  if (!keys["amazon_lwa_client_id"] || !keys["amazon_lwa_client_secret"]) {
    throw new Error("Amazon LWA credentials not configured");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
    client_id: keys["amazon_lwa_client_id"],
    client_secret: keys["amazon_lwa_client_secret"],
  });

  const tokenRes = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error_description || "LWA token refresh failed");

  const expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();
  await supabase
    .from("platform_connections")
    .update({ access_token: tokenData.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("platform", "amazon");

  return tokenData.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: apiKeys } = await supabase
      .from("user_api_keys")
      .select("provider, api_key")
      .eq("user_id", user.id)
      .in("provider", ["amazon_aws_access_key", "amazon_aws_secret_key", "amazon_marketplace_id"]);

    const keys: Record<string, string> = {};
    for (const k of (apiKeys || [])) keys[k.provider] = k.api_key;

    if (!keys["amazon_aws_access_key"] || !keys["amazon_aws_secret_key"]) {
      return jsonResponse({ error: "Amazon AWS credentials not configured. Please add them in Settings." }, 400);
    }

    const marketplaceId = keys["amazon_marketplace_id"] || "ATVPDKIKX0DER";
    const lwaToken = await getValidLwaToken(supabase, user.id);

    const url = new URL(`https://${SP_API_HOST}/orders/v0/orders`);
    url.searchParams.set("MarketplaceIds", marketplaceId);
    url.searchParams.set("OrderStatuses", "Unshipped,PartiallyShipped");
    url.searchParams.set("MaxResultsPerPage", "50");

    const baseHeaders: Record<string, string> = {
      "host": SP_API_HOST,
      "x-amz-access-token": lwaToken,
    };

    const { authorization, amzDate } = await buildAuthHeader(
      "GET", url, baseHeaders,
      keys["amazon_aws_access_key"], keys["amazon_aws_secret_key"],
      "us-east-1", "execute-api"
    );

    const ordersRes = await fetch(url.toString(), {
      headers: {
        ...baseHeaders,
        "x-amz-date": amzDate,
        "Authorization": authorization,
      },
    });

    if (!ordersRes.ok) {
      const errBody = await ordersRes.json().catch(() => ({}));
      const msg = errBody.errors?.[0]?.message || errBody.message || `SP-API error ${ordersRes.status}`;
      return jsonResponse({ error: msg }, 400);
    }

    const ordersData = await ordersRes.json();
    const orders = ordersData.payload?.Orders || [];

    let imported = 0;
    let skipped = 0;

    for (const order of orders) {
      try {
        const orderItems = await fetchOrderItems(
          order.AmazonOrderId, lwaToken,
          keys["amazon_aws_access_key"], keys["amazon_aws_secret_key"]
        );
        const firstItem = orderItems[0];
        const itemTitle = firstItem?.Title || `Amazon Order #${order.AmazonOrderId.slice(-6)}`;

        const addr = order.ShippingAddress || {};
        const record = {
          user_id: user.id,
          platform: "amazon",
          platform_order_id: order.AmazonOrderId,
          buyer_username: order.BuyerInfo?.BuyerName || null,
          item_title: itemTitle,
          item_sku: firstItem?.SellerSKU || null,
          quantity: firstItem?.QuantityOrdered || 1,
          sale_price: parseFloat(order.OrderTotal?.Amount || "0") || null,
          shipping_address: addr.Name ? {
            name: addr.Name,
            line1: addr.AddressLine1,
            line2: addr.AddressLine2,
            city: addr.City,
            state: addr.StateOrRegion,
            zip: addr.PostalCode,
            country: addr.CountryCode,
          } : null,
          order_status: order.OrderStatus?.toLowerCase() || "unshipped",
          shipping_status: "pending",
          order_created_at: order.PurchaseDate || null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("platform_orders")
          .upsert(record, { onConflict: "user_id,platform,platform_order_id" });

        if (error) skipped++; else imported++;
      } catch {
        skipped++;
      }
    }

    return jsonResponse({ success: true, imported, skipped, total: orders.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});

async function fetchOrderItems(
  orderId: string,
  lwaToken: string,
  awsAccessKey: string,
  awsSecretKey: string
): Promise<Array<{ Title: string; SellerSKU: string; QuantityOrdered: number }>> {
  try {
    const url = new URL(`https://${SP_API_HOST}/orders/v0/orders/${orderId}/orderItems`);
    const baseHeaders: Record<string, string> = {
      "host": SP_API_HOST,
      "x-amz-access-token": lwaToken,
    };

    const { authorization, amzDate } = await buildAuthHeader(
      "GET", url, baseHeaders, awsAccessKey, awsSecretKey, "us-east-1", "execute-api"
    );

    const res = await fetch(url.toString(), {
      headers: { ...baseHeaders, "x-amz-date": amzDate, "Authorization": authorization },
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.payload?.OrderItems || [];
  } catch {
    return [];
  }
}
