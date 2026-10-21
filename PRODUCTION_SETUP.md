# Production Setup

This project should use separate environments:

- **Development:** this local workspace and the current Supabase project.
- **Production:** a fresh Supabase project and a public HTTPS deployment.

The production app should be accessed from a hosted HTTPS URL, not `127.0.0.1`. That gives you a stable URL that works from both phone and PC, and it allows mobile browsers to use camera scanning.

## 1. Create A Fresh Supabase Production Project

1. Go to Supabase and create a new project for production.
2. Copy the production project URL and anon key from the Supabase API settings.
3. Keep the production service role key private. Never put it in the browser app or any `NEXT_PUBLIC_` variable.

## 2. Apply Database Migrations To Production

From this repo, use Supabase CLI against the production project:

```powershell
supabase login
supabase link --project-ref YOUR_PROD_PROJECT_REF
supabase db push
supabase functions deploy
```

If you deploy functions one at a time, deploy these:

```text
amazon-auth
amazon-sync-orders
backfill-inventory
ebay-auth
ebay-sync-orders
lookup-pricing
lookup-upc
plaid-exchange-token
plaid-link-token
plaid-sync-transactions
search-market-prices
whatnot-auth
whatnot-sync-orders
```

## 3. Configure Production Secrets In Supabase

Set function secrets in the production Supabase project for any integrations you want live.

Common production secrets:

```text
PRICECHARTING_API_KEY
BARCODE_LOOKUP_API_KEY
UPCITEMDB_API_KEY
GOOGLE_SEARCH_API_KEY
GOOGLE_SEARCH_CX
RAWG_API_KEY
PLAID_CLIENT_ID
PLAID_SECRET
PLAID_ENV
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
AMAZON_CLIENT_ID
AMAZON_CLIENT_SECRET
WHATNOT_CLIENT_ID
WHATNOT_CLIENT_SECRET
```

Only add the services you actively use. The app can still run without every integration configured.

## 4. Deploy The App To Netlify

This repo already has `netlify.toml` and `@netlify/plugin-nextjs`.

Recommended Netlify settings:

```text
Build command: npm run build
Publish directory: .next
Production branch: main
```

In Netlify environment variables, set production values:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-prod-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-prod-anon-key
```

Set these for the **Production** deploy context. Do not use your development Supabase project values.

## 5. Configure Supabase Auth URLs

In the production Supabase project, set:

```text
Site URL: https://your-production-domain.netlify.app
Redirect URLs:
https://your-production-domain.netlify.app/*
```

If you add a custom domain, add that domain too.

## 6. Day-To-Day Workflow

Use this split:

```text
Local dev:
  URL: http://127.0.0.1:3000
  Env: .env
  Supabase: development project

Production:
  URL: https://your-production-domain.netlify.app
  Env: Netlify Production env vars
  Supabase: production project
```

Develop locally, test locally, then deploy to production when ready.

## 7. Production Smoke Test

After deployment:

1. Open the production URL on PC.
2. Sign up or sign in.
3. Open the same URL on mobile.
4. Open **Deal Check** and confirm the camera prompt appears.
5. Add one test inventory item.
6. Refresh pricing.
7. Confirm Finance loads.

Do not import real ledgers or connect real bank accounts until the production database and Auth URL are confirmed.

## Storefront API And Scanner Lab

### Storefront catalog requests

The existing `/api/storefront/catalog` API enriches inventory in batches of 100
IDs so Supabase REST URLs stay below common request-size limits. Pricing history
is paged in groups of 500, ordered newest first with a stable ID tie-breaker.
Items keep their latest dated pricing row; undated rows sort last. Pricing
failures return an explicit error rather than a partial successful catalog.
Category enrichment remains optional and logs failures before using the existing
title/platform fallback. Run `node --test scripts/test-storefront-catalog.mjs`
to verify request lengths, history pagination, and the storefront response shape.

### Isolated scanner

Scanner Lab is a separate authenticated page at `/scanner-lab`, under **Experimental**
in the sidebar. It does not replace Scan Intake, Deal Check, or the Whatnot scanners.

Apply `supabase/migrations/20261020060000_add_scanner_lab_sessions.sql` to the
target database before deploying Scanner Lab. The migration adds only
`scanner_lab_sessions` and `scanner_lab_entries`, with row-level policies scoped
to the current account and the signed-in session creator. It adds no inventory
or finance triggers. Test in a preview environment first, and obtain approval
before applying the migration or deploying to production.

Start a named session, then scan a barcode or SKU using the camera, keyboard, or
a USB scanner that sends Enter. Camera scanning continues until stopped.
Repeated camera reads are suppressed for five seconds; intentional typed or USB
rescans are saved separately. All matching inventory rows (up to 50) are saved as
snapshots, including quantity, condition, status, cost, and sale price. No match
is saved as an empty result, not converted into a new inventory item. Lookup or
save errors are shown explicitly and do not produce successful scan entries.

Only Scanner Lab tables are written. No stock, sale, listing, or finance record
is changed. Sessions can be reopened for viewing; closing a session makes it
read-only. Session history is private to its creator, including within a shared
account. Inventory snapshots are historical, not live stock counts.

The **Sell** sidebar group links to **Storefront Manager** (`/storefront`) and
**View Online Store** (`/shop`). These expose the existing Pixel & Page ecommerce
screens; the navigation change does not publish inventory or alter checkout.

Before release, verify session creation, exact barcode/SKU lookup, duplicate
inventory matches, no-match and database-error states, reload persistence,
closed-session restrictions, and isolation between users/accounts. Confirm
inventory quantities and finance records remain unchanged. Run the focused
checks with `node --test scripts/test-scanner-lab.mjs` and `npm run typecheck`.
