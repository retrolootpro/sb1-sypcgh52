import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errResponse(message: string) {
  return jsonResponse({ error: message });
}

async function getPlaidCredentials(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: keys } = await supabase
    .from("user_api_keys")
    .select("provider, api_key")
    .eq("user_id", userId)
    .in("provider", ["plaid_client_id", "plaid_secret", "plaid_env"]);

  const kv: Record<string, string> = {};
  for (const k of (keys || [])) kv[k.provider] = k.api_key;

  if (!kv["plaid_client_id"] || !kv["plaid_secret"]) {
    throw new Error("Plaid credentials not configured.");
  }

  return {
    clientId: kv["plaid_client_id"],
    secret: kv["plaid_secret"],
    env: kv["plaid_env"] || "sandbox",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errResponse("Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) return errResponse("Unauthorized");

    const { public_token } = await req.json();
    if (!public_token) return errResponse("Missing public_token");

    const { clientId, secret, env } = await getPlaidCredentials(supabase, user.id);
    const plaidBaseUrl = `https://${env}.plaid.com`;

    const exchangeRes = await fetch(`${plaidBaseUrl}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, secret, public_token }),
    });
    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok || exchangeData.error_code) {
      return errResponse(exchangeData.error_message || exchangeData.error_code || "Token exchange failed");
    }

    const accessToken = exchangeData.access_token;
    const itemId = exchangeData.item_id;

    const [itemRes, accountsRes] = await Promise.all([
      fetch(`${plaidBaseUrl}/item/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, secret, access_token: accessToken }),
      }),
      fetch(`${plaidBaseUrl}/accounts/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, secret, access_token: accessToken }),
      }),
    ]);

    const itemData = await itemRes.json();
    const accountsData = await accountsRes.json();

    const institutionName = itemData.item?.institution_id ?? "Unknown Bank";
    const institutionId = itemData.item?.institution_id ?? null;

    const accounts: { account_id: string; name: string; type: string }[] =
      (accountsData.accounts || []).map((a: { account_id: string; name: string; type: string }) => ({
        account_id: a.account_id,
        name: a.name,
        type: a.type,
      }));

    await supabase.from("bank_connections").upsert({
      user_id: user.id,
      plaid_item_id: itemId,
      plaid_access_token: accessToken,
      institution_name: institutionName,
      institution_id: institutionId,
      account_ids: accounts.map((a) => a.account_id),
      account_names: accounts.map((a) => a.name),
      account_types: accounts.map((a) => a.type),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,plaid_item_id" });

    return jsonResponse({
      success: true,
      institution_name: institutionName,
      accounts: accounts.map((a) => a.name),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errResponse(message);
  }
});
