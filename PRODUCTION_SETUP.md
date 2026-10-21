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
Both public Supabase variables must also be present during the build because
Next.js embeds them into browser assets. Missing values fail explicitly; do not
substitute dummy credentials to make a deploy pass. The browser client keeps
Supabase's default session persistence and token refresh behavior.

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

## Pixel & Page Storefront Design

The `/shop` homepage follows the supplied Pixel & Page visual reference:
navy/orange header, illustrated highlights, seven category tiles, six live
featured products, service strip, and game/book promotional banners. Decorative
artwork in `public/storefront/` is cropped from the user-supplied reference;
product cards always use catalog inventory, never mockup merchandise.

The full catalog opens through search, category buttons, **View All**, or the
existing `/shop#catalog` links. Search, platform/category filters, sorting,
product-detail links, cart persistence, and quantity limits remain available.
Accessories and Apparel also match descriptive product names when the existing
catalog classifies them under a broader category. Missing categories show an
empty result rather than placeholder products.

No newsletter subscription, wishlist, or free-shipping offer is implied by the
redesign. Contact/support links replace unsupported reference controls. Product
details, cart, guest requests, support, and policy pages use the same public-shop
theme. Shop styling does not change the authenticated business application's theme.

For local browser checks, start the app on port 3218, then run:

```sh
npm exec --package=playwright -- node scripts/test-storefront-design.mjs http://127.0.0.1:3218
```

These checks intercept catalog and commerce requests with fixtures. They cover
desktop/mobile layouts, linked shop pages, navigation, carousel controls,
filtering, cart limits/persistence, guest-request errors/retry/submission,
checkout readiness, confirmation, cancellation, and receipt reload behavior.
They do not contact Stripe, prove live inventory synchronization, or write
production data.

## Storefront Commerce And Stripe

The shop is shipping-only. Customers submit item requests without an account at
`/shop/request`. Administrators use **Storefront Manager → Requests & invoices**
(`/storefront/requests`) to review requests and select real, priced inventory.
Source missing items into RetroLoot first, then create the invoice. Stripe emails
the invoice; its hosted payment link also appears in the order card for copying
or sharing. Do not send payment-card details through request notes or email.

### Deployment prerequisites

1. If the storefront settings/metadata are absent, first apply
   `supabase/migrations/20261021164500_storefront_catalog_settings.sql`.
   This adds metadata and account settings without backfilling prices, changing
   stock, installing sync triggers, or publishing inventory.
   Apply `supabase/migrations/20261021170000_storefront_commerce.sql` to the
   intended database after validating it in a preview/test environment and
   obtaining approval for production. It creates the request, order, event, and
   rate-limit tables and atomic inventory/payment functions. Do not blindly
   reapply an already-applied migration.
2. Verify that `storefront_settings` contains exactly one active row with
   `public_slug = 'pixel-and-page'` and the intended RetroLoot owner `user_id`.
   The catalog and order endpoints use that account, never the largest account.
3. Configure the server-only `SUPABASE_SERVICE_ROLE_KEY` in Netlify for the same
   Supabase project as the public URL. Never expose it through `NEXT_PUBLIC_`.
4. Set `STOREFRONT_SITE_URL` to the canonical HTTPS shop origin, without a path.
5. In Stripe test mode, configure Tax and create active USD fixed-amount shipping
   rates. Set `STRIPE_SECRET_KEY`, `STRIPE_SHIPPING_RATE_IDS` (comma-separated
   `shr_...` IDs), and `STRIPE_SHIPPING_COUNTRIES` (comma-separated ISO country
   codes matching your supported destinations). Rates must belong to the same
   Stripe account and mode as the key.
6. Register `https://YOUR_DOMAIN/api/storefront/webhook` in that Stripe mode.
   Subscribe to `checkout.session.completed`, `checkout.session.expired`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.voided`,
   `invoice.marked_uncollectible`, and `charge.refunded`. Store that endpoint's
   signing secret as `STRIPE_WEBHOOK_SECRET`.
7. The checked-in Netlify production context sets
   `STOREFRONT_PAYMENTS_ENABLED=false` and `STRIPE_LIVE_PAYMENTS_ENABLED=false`.
   Keep them disabled for the initial production release. Guest requests remain
   available, but checkout/invoice creation cannot reserve stock or create new
   payments. Existing payment status checks, signed webhook reconciliation, and
   unpaid-order cancellation remain available when their Stripe configuration
   is present.
   The runtime also defaults to disabled if `STOREFRONT_PAYMENTS_ENABLED` is
   absent; enabling payments requires the explicit string `true` in the
   Functions runtime environment, not just the build environment.
8. Run acceptance in a preview/test environment with test-only credentials and
   `STOREFRONT_PAYMENTS_ENABLED=true`. Never expose test-mode purchases against
   real production stock. Keep `STRIPE_LIVE_PAYMENTS_ENABLED=false` until the
   test-mode flow below passes.
   Live mode requires separate live keys, rates, and webhook signing secret, plus
   `STOREFRONT_PAYMENTS_ENABLED=true` and `STRIPE_LIVE_PAYMENTS_ENABLED=true`.
   Change the production gates only with explicit approval. Netlify environment
   overrides must not accidentally enable payments. Do not commit credentials.

Checkout remains disabled when required configuration is missing. A readiness
response only validates configuration presence/shape; it does not prove that a
key, tax registration, destination, or shipping rate works in Stripe.

### Test-mode acceptance

- Confirm that a known RetroLoot stock/price change appears in the public
  catalog after refresh. Confirm unrelated accounts and internal notes are absent.
- Submit a guest request, review it as the configured account administrator,
  select inventory, create an invoice, and confirm delivery of the Stripe email.
- Open the hosted invoice and pay using Stripe test-mode payment details.
  Verify successful webhook delivery, paid order/request status, one inventory
  reservation, and one revenue entry excluding tax. Mark a paid order shipped
  with carrier/tracking details.
- Complete a normal cart checkout and verify shipping and tax in Stripe before
  payment. A redirect alone must not mark the order paid or clear purchased cart
  quantities before server-side confirmation.
- Cancel an unpaid checkout/invoice and verify stock is restored once. Replay
  its webhook and confirm no duplicate stock adjustment or revenue. Refunds
  require business review; they do not automatically restock merchandise.

Local regression commands:

```sh
node --test scripts/test-supabase-config.mjs scripts/test-storefront-catalog.mjs scripts/test-storefront-payments.mjs
npm exec --package=@electric-sql/pglite -- node --test scripts/test-storefront-commerce-db.mjs
npm run build
```

The route tests use mocked Stripe/Supabase responses; the database tests run the
commerce migration in an isolated local PostgreSQL-compatible database. Neither
replaces an actual Stripe test-mode acceptance run.
