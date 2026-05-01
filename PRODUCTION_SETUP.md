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

