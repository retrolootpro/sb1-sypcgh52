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

function mapPlaidCategory(categories: string[]): string {
  const top = (categories[0] || "").toLowerCase();
  const sub = (categories[1] || "").toLowerCase();

  if (top === "transfer" || top === "payment") return "Transfer";
  if (top === "bank fees") return "Bank Fees";
  if (top === "interest") return "Interest";
  if (top === "shops" || top === "retail") {
    if (sub.includes("game") || sub.includes("electronic")) return "Inventory Purchase";
    return "Supplies";
  }
  if (top === "food and drink") return "Meals & Entertainment";
  if (top === "travel") return "Travel";
  if (top === "service") {
    if (sub.includes("shipping") || sub.includes("postal")) return "Shipping";
    if (sub.includes("software") || sub.includes("subscription")) return "Software & Subscriptions";
    return "Services";
  }
  if (top === "recreation") return "Entertainment";
  if (top === "healthcare") return "Healthcare";
  if (top === "tax") return "Taxes";
  return "Other";
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

    const body = await req.json().catch(() => ({}));
    const targetConnectionId: string | undefined = body.connection_id;

    const { clientId, secret, env } = await getPlaidCredentials(supabase, user.id);
    const plaidBaseUrl = `https://${env}.plaid.com`;

    const connectionsQuery = supabase
      .from("bank_connections")
      .select("id, plaid_access_token, plaid_item_id, institution_name, last_cursor")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (targetConnectionId) connectionsQuery.eq("id", targetConnectionId);

    const { data: connections, error: connErr } = await connectionsQuery;
    if (connErr) throw new Error(connErr.message);
    if (!connections?.length) return errResponse("No connected bank accounts found.");

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;

    for (const conn of connections) {
      let cursor: string | null = conn.last_cursor ?? null;
      let hasMore = true;

      while (hasMore) {
        const syncBody: Record<string, unknown> = {
          client_id: clientId,
          secret,
          access_token: conn.plaid_access_token,
          options: { include_personal_finance_category: true },
        };
        if (cursor) syncBody.cursor = cursor;

        const syncRes = await fetch(`${plaidBaseUrl}/transactions/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(syncBody),
        });
        const syncData = await syncRes.json();

        if (!syncRes.ok || syncData.error_code) {
          console.error("Plaid sync error:", syncData.error_message);
          break;
        }

        const added: unknown[] = syncData.added ?? [];
        const modified: unknown[] = syncData.modified ?? [];
        const removed: unknown[] = syncData.removed ?? [];

        for (const txn of added) {
          const t = txn as {
            transaction_id: string;
            account_id: string;
            date: string;
            name: string;
            merchant_name?: string;
            amount: number;
            personal_finance_category?: { primary: string; detailed: string };
            category?: string[];
          };
          const cats = t.category || [];
          const category = t.personal_finance_category?.primary
            ? mapPlaidCategory([t.personal_finance_category.primary, t.personal_finance_category.detailed])
            : mapPlaidCategory(cats);

          const isIncome = t.amount < 0;
          const amount = Math.abs(t.amount);

          await supabase.from("financial_transactions").upsert({
            user_id: user.id,
            plaid_transaction_id: t.transaction_id,
            plaid_account_id: t.account_id,
            date: t.date,
            description: t.name,
            merchant_name: t.merchant_name ?? null,
            amount: isIncome ? amount : -amount,
            type: isIncome ? "income" : "expense",
            category,
            source: "plaid",
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,plaid_transaction_id" });
        }
        totalAdded += added.length;

        for (const txn of modified) {
          const t = txn as {
            transaction_id: string;
            date: string;
            name: string;
            merchant_name?: string;
            amount: number;
            personal_finance_category?: { primary: string; detailed: string };
            category?: string[];
          };
          const cats = t.category || [];
          const category = t.personal_finance_category?.primary
            ? mapPlaidCategory([t.personal_finance_category.primary, t.personal_finance_category.detailed])
            : mapPlaidCategory(cats);
          const isIncome = t.amount < 0;
          const amount = Math.abs(t.amount);

          await supabase.from("financial_transactions")
            .update({
              date: t.date,
              description: t.name,
              merchant_name: t.merchant_name ?? null,
              amount: isIncome ? amount : -amount,
              type: isIncome ? "income" : "expense",
              category,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id)
            .eq("plaid_transaction_id", t.transaction_id);
        }
        totalModified += modified.length;

        for (const r of removed) {
          const rem = r as { transaction_id: string };
          await supabase.from("financial_transactions")
            .delete()
            .eq("user_id", user.id)
            .eq("plaid_transaction_id", rem.transaction_id);
        }
        totalRemoved += removed.length;

        cursor = syncData.next_cursor ?? cursor;
        hasMore = syncData.has_more ?? false;
      }

      await supabase.from("bank_connections").update({
        last_cursor: cursor,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conn.id);
    }

    return jsonResponse({ success: true, added: totalAdded, modified: totalModified, removed: totalRemoved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errResponse(message);
  }
});
