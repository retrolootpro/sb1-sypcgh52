import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WHATNOT_GQL = "https://api.whatnot.com/seller-api/graphql";
const WHATNOT_TOKEN_URL = "https://api.whatnot.com/seller-api/rest/oauth/token";

const ORDERS_QUERY = `
  query GetOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          status
          isGiveaway
          total {
            amount
            currency
          }
          subtotal {
            amount
            currency
          }
          createdAt
          updatedAt
          cancelledAt
          customer {
            id
            username
          }
          shippingAddress {
            name
            line1
            line2
            city
            state
            zip
            country
          }
          items(first: 1) {
            edges {
              node {
                quantity
                price {
                  amount
                  currency
                }
                product {
                  title
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getValidToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: conn } = await supabase
    .from("platform_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("platform", "whatnot")
    .eq("is_active", true)
    .maybeSingle();

  if (!conn) throw new Error("Whatnot account not connected. Please connect in Settings.");

  const isExpired = conn.token_expires_at && new Date(conn.token_expires_at) <= new Date();
  if (!isExpired) return conn.access_token;

  const { data: apiKeys } = await supabase
    .from("user_api_keys")
    .select("provider, api_key")
    .eq("user_id", userId)
    .in("provider", ["whatnot_client_id", "whatnot_client_secret"]);

  const keys: Record<string, string> = {};
  for (const k of (apiKeys || [])) keys[k.provider] = k.api_key;

  if (!keys["whatnot_client_id"] || !keys["whatnot_client_secret"]) {
    throw new Error("Whatnot credentials not configured");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
    client_id: keys["whatnot_client_id"],
    client_secret: keys["whatnot_client_secret"],
  });

  const tokenRes = await fetch(WHATNOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error_description || "Token refresh failed");

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString()
    : null;

  await supabase
    .from("platform_connections")
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", "whatnot");

  return tokenData.access_token;
}

async function fetchOrders(token: string, cursor?: string) {
  const res = await fetch(WHATNOT_GQL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { first: 50, after: cursor ?? null },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Whatnot API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data?.orders;
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

    const token = await getValidToken(supabase, user.id);

    let imported = 0;
    let skipped = 0;
    let cursor: string | undefined;
    let pageCount = 0;
    const MAX_PAGES = 3;

    do {
      const ordersPage = await fetchOrders(token, cursor);
      if (!ordersPage) break;

      const edges = ordersPage.edges ?? [];
      for (const { node: order } of edges) {
        if (order.isGiveaway || order.cancelledAt) {
          skipped++;
          continue;
        }

        const firstItem = order.items?.edges?.[0]?.node;
        const itemTitle = firstItem?.product?.title || `Whatnot Order #${order.id.slice(-6)}`;
        const salePrice = parseFloat(firstItem?.price?.amount ?? order.total?.amount ?? "0") || null;
        const addr = order.shippingAddress;

        const record = {
          user_id: user.id,
          platform: "whatnot",
          platform_order_id: order.id,
          buyer_username: order.customer?.username || null,
          item_title: itemTitle,
          item_sku: null,
          quantity: firstItem?.quantity || 1,
          sale_price: salePrice,
          shipping_address: addr?.city ? {
            name: addr.name,
            line1: addr.line1,
            line2: addr.line2,
            city: addr.city,
            state: addr.state,
            zip: addr.zip,
            country: addr.country,
          } : null,
          order_status: (order.status ?? "").toLowerCase() || "pending",
          shipping_status: "pending",
          order_created_at: order.createdAt || null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from("platform_orders")
          .upsert(record, { onConflict: "user_id,platform,platform_order_id" });

        if (error) skipped++; else imported++;
      }

      const pageInfo = ordersPage.pageInfo;
      cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : undefined;
      pageCount++;
    } while (cursor && pageCount < MAX_PAGES);

    return jsonResponse({ success: true, imported, skipped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});
