# RetroLootPro Codex Handoff

Last updated: 2026-06-20

This file is a handoff for continuing RetroLootPro work in a new Codex thread or on another machine.

## Project

RetroLootPro is a Next.js operations command center for a resale business focused on video games, books, collectibles, inventory intake, pricing, prep workflow, finance, employees, POS, and reports.

Repository:

- GitHub: `retrolootpro/sb1-sypcgh52`
- Main working branch: `dev`
- Netlify site: `retrolootpro`
- Production URL: `https://retrolootpro.com`
- Netlify project URL: `https://app.netlify.com/projects/retrolootpro`

Local project path from the original machine:

```text
C:\Users\JoshuaPhillips\Documents\Codex\2026-04-24\files-mentioned-by-the-user-sb1\sb1-sypcgh52
```

## Stack

- Next.js 13.5.1 App Router
- React 18
- TypeScript
- Supabase Auth and database
- Netlify hosting with `@netlify/plugin-nextjs`
- Barcode scanning via `@zxing/browser`
- Styling uses the existing Tailwind/Radix UI component patterns

Useful scripts:

```bash
npm run build
npm run typecheck
npm run lint
node scripts/test-book-metadata.mjs
```

Known verification state as of this handoff:

- `node scripts/test-book-metadata.mjs` passed.
- `tsc --noEmit` passed.
- `next build` passed.
- `next lint` fails due to existing unrelated lint errors in finance, shipping, home, and connect-card files. Do not treat those as caused by the book intake repair unless they are newly touched.

## Environment

Required Netlify/Supabase environment variables have been configured in Netlify during prior work. Do not commit secrets.

Expected public variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only variables used by some app features:

- `SUPABASE_SERVICE_ROLE_KEY`
- OpenAI key or AI gateway configuration, if AI Assistant is used
- Marketplace/API keys configured by user in app Settings where applicable

## Important Recent Work

The most recent major repair was for Books inventory intake.

Recent commit:

```text
befb0a5 Complete book ISBN metadata intake
```

Files involved:

- `lib/book-metadata-service.ts`
- `app/api/local-upc-lookup/route.ts`
- `app/api/local-metadata-refresh/route.ts`
- `lib/api-services.ts`
- `app/scan/page.tsx`
- `components/scan-item-dialog.tsx`
- `lib/item-taxonomy.ts`
- `scripts/test-book-metadata.mjs`

What changed:

- Added real ISBN-10 and ISBN-13 normalization and checksum validation.
- Added ISBN-10 to ISBN-13 conversion.
- Treats Bookland EAN values starting with `978` or `979` as ISBNs.
- Strips scanner noise, spaces, dashes, prefixes, and suffixes where safe.
- Uses Google Books first with `isbn:<normalized ISBN>`.
- Uses Open Library as fallback.
- Does not use PriceCharting, eBay, Amazon, GameStop, or paid APIs for books.
- Preserves rich book metadata in `inventory_items.raw_lookup_payload`.
- Book default condition changed from `Used` to `Loose` because the existing DB constraint does not allow `Used`.
- Book scans open a confirmation dialog with editable title/subtitle/authors/publisher/date/pages/categories/language/ISBN/cover/description.

Book metadata stored in `raw_lookup_payload`:

- `type`
- `barcode`
- `title`
- `subtitle`
- `authors`
- `publisher`
- `publishedDate`
- `publishedYear`
- `description`
- `pageCount`
- `categories`
- `language`
- `isbn10`
- `isbn13`
- `coverImageUrl`
- `source`
- `sourcesTried`

## Current Open Issue

The user reported after the book repair:

1. Manually typing an ISBN finds more metadata.
2. Scanning the UPC gets nothing.
3. On phone, the scan confirmation popup does not format correctly.
4. On phone, the user cannot scroll or close the popup.

This was not fixed yet. It should be the next task.

Likely causes to inspect:

- Scanner may be returning a retail UPC instead of the book ISBN.
- Scanner may include unexpected prefix/suffix/control characters.
- Some older Scholastic or Goosebumps books use retail UPCs that are not valid ISBNs. Example previously reported:
  - `078073003501`
  - This appears not to be a reliable ISBN. The app should not map it to random UPC database metadata.
- The Radix dialog content in `components/scan-item-dialog.tsx` may be too tall for mobile and lacks a constrained max height/scrollable body.
- Dialog close affordance may be hidden/off-screen on mobile.

Recommended next fix:

- Add debug-safe logging or UI display of the exact scanned value in Book mode.
- If scanned value is a non-ISBN retail UPC, keep the barcode and immediately show the editable manual book metadata dialog.
- Make `ScanItemDialog` mobile-safe:
  - `max-h-[calc(100dvh-2rem)]`
  - scrollable content area
  - sticky footer
  - visible cancel/close action
  - avoid fields extending beyond viewport width

## Inventory Model Notes

`inventory_items` is the central table. It is game-shaped historically.

Important existing fields used for books:

- `product_name`: display title
- `console`: use `Book`, `Manga`, `Comic`, etc.
- `condition`: must satisfy existing constraint. Use `Loose` for used books unless schema is deliberately changed later.
- `barcode`: scanned UPC/ISBN
- `category`: `Books`, `Books & Media`, or richer category string
- `brand`: publisher/author fallback
- `description`: book description
- `image_url` / `thumbnail_url`: cover image
- `genre`: categories joined as text
- `raw_lookup_payload`: rich book metadata JSON
- `pricing_status`: `manual` for books
- `pricing_source`: `Manual / book metadata` for books

The `item_type` DB constraint historically only allows:

- `game`
- `console`
- `accessory`
- `unknown`

Because of that, books are currently saved through existing compatibility logic as `accessory`, while the app identifies them by `console/category/source` using `isBookLikeItem`.

Do not blindly set `item_type = 'book'` unless you also create and apply a safe migration that updates the DB check constraint and audits all existing logic.

## Book Intake Flow

Primary UI:

- `app/scan/page.tsx`
- Select `Books / Manga`
- Scan or manually enter ISBN/UPC
- `lookupUPC(..., lookupMode='book')`
- Route: `app/api/local-upc-lookup/route.ts`
- Service: `lib/book-metadata-service.ts`
- Confirmation UI: `components/scan-item-dialog.tsx`
- Save inserts into `inventory_items`

Manual no-match behavior:

- If a book scan has no reliable metadata, the app should keep the barcode and open the editable book dialog.
- Do not trust generic UPC databases for books unless a very strong match strategy is added.

## Netlify Deployment

Netlify is linked locally on the original machine.

Prior successful deploy watch command:

```powershell
$env:PATH = "C:\Users\JoshuaPhillips\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
C:\Users\JoshuaPhillips\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd --package=netlify-cli@17.38.1 dlx netlify watch
```

Normal flow:

1. Commit to `dev`.
2. Push to GitHub.
3. Netlify auto-deploys.
4. Use `netlify watch` to confirm deploy completion.

## Git Commands Used on Original Machine

Git binary path used by Codex:

```powershell
& "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe" status --short
& "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe" add <files>
& "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe" commit -m "<message>"
& "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe" push origin dev
```

## Supabase Notes

Supabase MCP was difficult to authorize in the original Codex environment. The user supplied Supabase API values earlier, but do not expose or recommit them. Prefer using Netlify environment variables and the Supabase dashboard when needed.

If schema changes are needed:

- Create a migration under `supabase/migrations`.
- Keep RLS/security in mind.
- Avoid broad service-role usage in client code.
- Never commit service-role keys.

## App Areas Already Built

High-level app areas include:

- Dashboard
- AI Assistant
- Inventory
- Scan Intake
- Prep Workflow
- Tasks
- Review
- Lot Analyzer / Planning
- Whatnot Shows
- Bundles
- Disputes
- Finance
- Reports / Insights
- Team / Employees
- Shipping
- POS
- Documents
- Settings
- Help / User Manual

## Known Product Direction

The app is intended to be a full business hub for resale operations. The user prefers:

- Surgical changes over broad rewrites.
- Clean, simple UI for non-technical users.
- Mobile and iPad-friendly flows.
- Big touch targets in POS/scanning contexts.
- Avoiding paid APIs when practical.
- Keeping Netlify/Supabase/GitHub deployment working.
- Committing and deploying changes after meaningful fixes when the user is testing live.

## How To Continue In A New Codex Thread

Start with:

```text
Read CODEX_HANDOFF.md. Continue RetroLootPro work from there. The current open issue is book scan behavior on phone: manually entered ISBN finds metadata, scanned UPC gets nothing, and the popup is not mobile-scrollable/closable.
```

Then inspect these files first:

- `lib/book-metadata-service.ts`
- `app/scan/page.tsx`
- `components/scan-item-dialog.tsx`
- `app/api/local-upc-lookup/route.ts`
- `lib/item-taxonomy.ts`

