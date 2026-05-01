import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getLwaCredentials(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: apiKeys } = await supabase
    .from("user_api_keys")
    .select("provider, api_key")
    .eq("user_id", userId)
    .in("provider", ["amazon_lwa_client_id", "amazon_lwa_client_secret"]);

  const keys: Record<string, string> = {};
  for (const k of (apiKeys || [])) keys[k.provider] = k.api_key;

  if (!keys["amazon_lwa_client_id"] || !keys["amazon_lwa_client_secret"]) {
    throw new Error("Amazon credentials not configured. Please add your LWA Client ID and Secret in Settings.");
  }
  return keys;
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

    const body = await req.json();
    const { action } = body;

    if (action === "exchange") {
      const { code, redirect_uri } = body;
      if (!code || !redirect_uri) return jsonResponse({ error: "Missing code or redirect_uri" }, 400);

      const keys = await getLwaCredentials(supabase, user.id);
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: keys["amazon_lwa_client_id"],
        client_secret: keys["amazon_lwa_client_secret"],
      });

      const tokenRes = await fetch(LWA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || tokenData.error) {
        return jsonResponse({ error: tokenData.error_description || "Token exchange failed" }, 400);
      }

      const expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();
      await supabase
        .from("platform_connections")
        .upsert({
          user_id: user.id,
          platform: "amazon",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          is_active: true,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,platform" });

      return jsonResponse({ success: true });
    }

    if (action === "refresh") {
      const { data: conn } = await supabase
        .from("platform_connections")
        .select("refresh_token")
        .eq("user_id", user.id)
        .eq("platform", "amazon")
        .maybeSingle();

      if (!conn?.refresh_token) return jsonResponse({ error: "No Amazon connection found" }, 400);

      const keys = await getLwaCredentials(supabase, user.id);
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

      if (!tokenRes.ok || tokenData.error) {
        return jsonResponse({ error: tokenData.error_description || "Token refresh failed" }, 400);
      }

      const expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();
      await supabase
        .from("platform_connections")
        .update({ access_token: tokenData.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("platform", "amazon");

      return jsonResponse({ access_token: tokenData.access_token, expires_at: expiresAt });
    }

    if (action === "disconnect") {
      await supabase.from("platform_connections").delete().eq("user_id", user.id).eq("platform", "amazon");
      return jsonResponse({ success: true });
    }

    if (action === "status") {
      const { data: conn } = await supabase
        .from("platform_connections")
        .select("is_active, account_name, connected_at, token_expires_at")
        .eq("user_id", user.id)
        .eq("platform", "amazon")
        .maybeSingle();
      return jsonResponse({ connected: !!conn?.is_active, connection: conn });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});
