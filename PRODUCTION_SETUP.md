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
Production branch: dev
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
The catalog uses numbered pages starting at 24 products, with 48 and 96 options.
Category, platform/book format, condition, inclusive minimum/maximum price, and
sale-only filters combine with search. Active filters can be removed individually
or cleared together. Filter/sort/page-size changes reset to page one; catalog
refreshes clamp unavailable pages. All available platforms are listed, without
the former 16-platform cap.

The default **Newest & deals** order puts genuine discounts (compare-at price
greater than current price) first, then sorts by inventory creation date, title,
and ID for predictable browsing. Missing dates sort last within each group.
Price, name, and staff-pick sorting are also available. Homepage staff picks
remain a separate six-item preview. Filter, sort, page, and page-size selections
are encoded in shop URLs and restored on reload/back navigation.

Run `node --test scripts/test-storefront-browse.mjs` for sorting, combined-filter,
pagination, and URL-state regressions. The browser suite also exercises a
73-product catalog, first/middle/last pages, quantity selectors, product/back
navigation, all 20 fixture platforms, filter resets, and narrow mobile layouts.
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
5. For the Shippo carrier-rate integration, follow **Live carrier shipping**
   below. For legacy fixed-rate shipping, in Stripe test mode configure Tax and create active USD fixed-amount shipping
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
7. Payment switches are managed in Netlify's environment-variable settings,
   not the checked-in build context, so they can also reach Functions runtime.
   Start with `STOREFRONT_PAYMENTS_ENABLED=false` and
   `STRIPE_LIVE_PAYMENTS_ENABLED=false`. Guest requests remain
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
   The owner explicitly approved production live activation for a supervised
   acceptance checkout on October 21, 2026. This approval is not evidence that
   an actual charge or signed payment reconciliation has passed. Keep other
   deploy contexts disabled; use the Production-only runtime switches.

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

### Live carrier shipping

Set `STOREFRONT_SHIPPING_PROVIDER=shippo`, `SHIPPO_API_KEY`,
`STRIPE_SHIPPING_COUNTRIES=US`, the canonical `STOREFRONT_SITE_URL`, and the
Stripe key/webhook secret in Netlify's **Production Functions** environment.
Store secrets directly in Netlify, never in source or chat. Live Stripe requires
a live Shippo key. No `STRIPE_SHIPPING_RATE_IDS` are needed in Shippo mode.
Keep both payment gates disabled during configuration and validation.

With approval, apply `20261021200000_storefront_shipping.sql` once. It adds
shipping configuration and accepted-order snapshots, plus a service-only
reservation wrapper that saves the shipping snapshot atomically with stock
reservation. It does not backfill profiles or change existing stock/prices.

In **Storefront Manager → Shipping & packages** (`/storefront/shipping`):

- Check service connections to verify key access, Stripe mode/Tax readiness,
  and enabled Shippo carriers without creating payments or labels. This does
  not prove signed webhook delivery or assess tax-registration obligations.
- Enter the real dispatch/return address and measured package profiles.
  Profiles select an exact catalog category with optional platform/condition
  refinements. The most-specific match wins; ambiguous matches fail explicitly.
- Each profile defines per-item weight, empty packaging weight, packed
  dimensions, and items-per-package capacity. Items sharing a profile are
  grouped up to that capacity; different profiles ship separately. Start with
  capacity one unless staff have measured a suitable multi-item package.
- No defaults are guessed. Missing profiles, invalid measurements, carts
  requiring more than ten packages, or unavailable services block quotes.

Buyers enter their address before Stripe and choose an available USPS, UPS or
FedEx service. Shippo rates are requested per package, then summed only for
services available across every package. Media Mail and other restricted
printed-matter services are excluded because catalog classification does not
prove eligibility. Carrier setup, negotiated rates and supported destinations
determine which services appear; all three carriers are not guaranteed.

Quotes are server-signed and bound to the store, current item prices/quantities,
customer address and settings, and expire after 15 minutes. Changes require
a new quote. The accepted shipping snapshot is stored on the reserved order.
Retries use the snapshot, not a fresh rate or a new customer address.

The existing Stripe-hosted page does not dynamically recalculate rates after
address changes. The app therefore passes the selected shipping charge and an
existing Stripe Customer with the **locked quoted shipping address**, displays
that address in Checkout, and does not collect an editable shipping address in
Stripe. Stripe uses that saved shipping address for automatic tax; the billing
address can still differ. To change delivery details, cancel the unpaid order
and request new shipping options. The webhook preserves the accepted delivery
address for staff fulfillment. Requested-item invoices use the same rate
service, based on the saved guest-request address.

Customer checkout only quotes shipping; it never purchases labels. Authorized
staff can explicitly buy postage on paid orders using the fulfillment flow below.
Pirate Ship remains an alternative; its prices can differ from checkout quotes.

Public checkout uses a delivery/shipping panel and a separate order summary
(stacked on mobile). The summary shows selected shipping and the total before
tax; Stripe calculates the final tax-inclusive total. Public form controls use
explicit light colors independent of the business app's dark/light/Apple theme.
When payment creation is disabled, a prominent notice and disabled
**Online payments unavailable** button explain why Stripe cannot open. Saving
a shipping address or receiving carrier quotes does not enable payments.

Before enabling payments, verify actual profiles and carrier quotes, Stripe
Tax settings, hosted checkout totals/address, signed webhook reconciliation,
and cancellation/retry behavior. Prefer an isolated test database and test keys
for complete payment acceptance. Never make test-mode purchases against real
production stock, and never claim a successful real charge from mocked tests
or configuration-presence checks.

### Staff fulfillment and shipping labels

With approval, apply `20261021230000_storefront_labels.sql` before deploying the
label UI/API. It adds service-only fulfillment records and an atomic, order-locked
claim for each package. It does not change existing stock, finance, or orders.
Dispatch now rejects refunded orders and unresolved/incomplete package labels.

**Shop Requests & Orders** opens on the order queue rather than an empty
requests column. Paid orders come first, with page-scoped status/search filters,
customer-selected shipping service, shipping collected, formatted delivery
address/contact, and totals. Requests/invoice creation remain in a separate view.
This screen and label purchasing retain the existing store-administrator access
requirement; ordinary account members are not newly authorized to spend money.

For a paid, unrefunded carrier-shipping order:

1. Open **Manage postage & labels** and choose the package (up to the original
   checkout's ten-package limit). Measure the actual packed dimensions in inches
   and packed weight in ounces. No item-only weights or measurements are guessed.
2. **Get label prices** requests fresh supported USPS/UPS/FedEx rates from Shippo
   using the saved delivery address and current return address. It does not charge.
   The original customer service is preferred if available. A different selected
   service shows a warning. Staff must review any service/cost difference.
3. Review origin, destination, packed measurements, service, and postage cost.
   Tick the explicit purchase authorization and click **Buy label**. This makes
   a real charge against the configured Shippo account; it is not another customer
   Stripe charge. Quotes expire after 15 minutes and changes invalidate consent.
4. Successful purchases save the 4x6 PDF URL, carrier tracking URL/number and
   transaction ID. Print the PDF. Refreshing or reopening never buys another label.
5. Repeat for each package. Once all labels succeed, their tracking pre-fills the
   dispatch field. **Mark shipped** remains a separate action for actual dispatch.
   Customer shipping emails and automatic carrier-delivery updates are not included.

A durable database claim is saved **before** a single, non-retried Shippo
transaction POST. Duplicate clicks and concurrent requests cannot purchase the
same package twice. A timeout, invalid response, or database save failure leaves
the package locked, not retryable. Known transactions can be refreshed without a
charge. For an unknown outcome, find the transaction in Shippo by metadata
`storefront-label:<purchase-reference>` and reconcile its transaction ID. The
server verifies rate, metadata and live/test mode before accepting it. If there
is no matching transaction, an administrator must investigate with Shippo; do not
delete the claim or blindly retry. Replacements, label refunds/voids and package
count changes are deliberately not automatic. Review these in Shippo/support.

Orders without a saved carrier quote require external postage. Tracking from an
external label can still be entered when no integrated purchase was started.
Label cost is saved separately from customer shipping collected; this release
does not automatically book postage expenses in Finance. Carrier billing
adjustments for inaccurate measurements can occur later.

Validate without live purchases:
`node --test scripts/test-storefront-payments.mjs`,
`npm exec --package=@electric-sql/pglite -- node --test scripts/test-storefront-commerce-db.mjs`,
and `npm exec --package=playwright -- node scripts/test-storefront-fulfillment.mjs http://127.0.0.1:3218`.
The browser fixture uses a local test Supabase build and intercepts all staff,
auth, payment and carrier requests. A live label acceptance requires separate
staff confirmation; a paid Stripe order alone does not mean postage was bought.

### Optional address search

Set `NEXT_PUBLIC_GEOAPIFY_API_KEY` in Netlify Production (including Builds scope)
and rebuild. This browser key is intentionally public; restrict allowed website
origins in Geoapify and monitor the Free plan quota. No Google billing setup is
needed. Without the key, only normal manual/browser-autofill address fields appear.

Checkout and guest item requests share an optional US address search. After at
least four characters and a 450ms typing pause, the browser sends search text to
Geoapify; names, email and apartment/suite are not included automatically. No
lookup is made on focus alone. Results require street number, street, city,
two-letter state and ZIP; incomplete or non-US results are not used to guess
missing fields. Selection fills editable address fields and preserves the
separately entered apartment/suite. At checkout, changing address fields clears
the old shipping choice and requires a new shipping quote.

The control supports keyboard selection, Escape, screen-reader status, touch/click
and manual entry. Requests are aborted on changes/blur; late responses cannot
replace newer results. Provider/network errors are visible and never prevent
manual entry. No address history is stored by the lookup component. Geoapify and
OpenStreetMap attribution is displayed beside the search, with disclosure in the
privacy page. Suggestions are not postal deliverability validation.

### Free-shipping offers and progress

Apply `20261022000000_storefront_shipping_promotion.sql` with approval before
deploying the promotion code. It adds one inventory metadata field with modes
`eligible` (default), `free` (individual offer), and `excluded`. Manage it per item
in Storefront Manager. It does not change prices, quantities, orders or finance.

The server discounts only the cheapest supported standard service available for
every parcel: USPS Ground Advantage, UPS Ground, FedEx Ground or Home Delivery.
All other services remain full-price options; no standard service means no offer.
The $50 minimum uses eligible merchandise at current selling prices, before tax
or shipping. Whole-order free shipping requires no excluded packages, at least
$50, and combined standard postage no more than both $8 and 15% of eligible value.
At $50 the effective postage cap is $7.50; $8 requires at least $53.34.

Individual `free` items waive only the $50 minimum. In mixed orders, only parcels
containing exclusively such items qualify; their combined postage must fit both
the $8 cap and 15% of their combined merchandise value. Mixed-content parcels
do not inherit individual free shipping. The cap is not applied separately per
parcel (which could accidentally multiply the subsidy).

The signed shipping quote stores customer amount, original carrier amount,
subsidy and the current quote's spend target. Quotes bind current item modes,
prices/quantities and parcel contents. The same server path handles checkout and
requested-item invoices. A zero shipping charge goes to Stripe; the staff order
still shows the selected service, real quoted postage and shop subsidy. Label
purchase remains separate at its fresh actual price.

Product badges are conditional (“Free shipping eligible on $50+ orders” or “Free
shipping eligible”), with no numeric shipping-cap comment on the badge. The
shipping-policy page discloses all conditions. Cart and checkout progress show
remaining eligible spend, not a guaranteed unlock. Before a quote, the target is
$50. After a standard quote, it also accounts for the 15% limit (rounded up to a
cent). Quotes over $8 or containing excluded packages do not promise that adding
money will unlock the offer. Cart/address changes require re-quoting; extra items
can add parcels and change the result. Excluded products never count toward
progress. Eligibility is destination-dependent, not inferred from an item price.

Run `node --test scripts/test-storefront-shipping-promotion.mjs` for exact
thresholds, mixed packages, subsidy limits and parcel attribution.
