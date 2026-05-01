import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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
    throw new Error("Plaid credentials not configured. Please save your Client ID and Secret first.");
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

    const { clientId, secret, env } = await getPlaidCredentials(supabase, user.id);
    const plaidBaseUrl = `https://${env}.plaid.com`;

    const res = await fetch(`${plaidBaseUrl}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        client_name: "RetroLoot Pro",
        user: { client_user_id: user.id },
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error_code) {
      return errResponse(data.error_message || data.error_code || "Plaid rejected the request — check your credentials and environment.");
    }

    return jsonResponse({ link_token: data.link_token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errResponse(message);
  }
});
