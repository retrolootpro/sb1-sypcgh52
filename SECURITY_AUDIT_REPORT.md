# RetroLootPro Security Audit

Date: 2026-05-14

## Scope Reviewed

- Supabase RLS policies and advisor output
- Team invite/auth acceptance flow
- Settings/API key exposure surfaces
- Netlify response headers
- Storage model for sensitive business documents
- MFA readiness and enforcement flow

## Changes Made

### Transport and Browser Hardening

- Added Netlify-wide security headers:
  - `Strict-Transport-Security`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - restrictive `Permissions-Policy`
- Added `Cache-Control: no-store` for `/api/*`.

### Supabase Policy Hardening

- Restricted `user_api_keys` so only account admins can read, insert, update, or delete raw marketplace/API keys.
- Removed permissive authenticated write policies from barcode and market-price cache tables.
- Limited cache writes to `service_role`.
- Revoked anonymous execution on account helper RPC functions.

### MFA Controls

- Added account security settings table.
- Added Settings → Security Controls:
  - Require MFA for the account
  - Enroll authenticator app/TOTP
  - Enroll SMS/phone MFA if Supabase phone MFA provider is configured
  - Verify an existing MFA factor for the current session
  - Show passkey as planned/not active
- Added route-level client enforcement that redirects users to Settings when MFA is required but the session is still `aal1`.

### Encrypted Document Vault

- Added Documents page to main navigation.
- Added `business_documents` metadata table with RLS.
- Added private Supabase Storage bucket `business-documents`.
- Added Storage RLS policies for account-member upload/read/update and admin delete.
- Added client-side AES-GCM encryption before upload.
- Added PBKDF2 key derivation with 250,000 iterations.
- The vault passphrase is not stored by the app or database.

## Remaining Risks / Follow-Up

- Supabase advisor still warns that authenticated users can execute account helper `SECURITY DEFINER` functions. These functions are intentionally used by RLS policies. A future hardening pass should move helper functions to a private schema or replace them with policy-local SQL.
- Supabase leaked password protection is disabled at the project level. Enable it in Supabase Dashboard → Authentication → Security.
- Passkeys/WebAuthn are not active. Supabase app auth docs currently expose TOTP and phone MFA as first-class MFA paths. Passkey support should be added through a vetted provider or a dedicated WebAuthn implementation later.
- Some legacy platform integration UI still uses client-side Supabase reads for admin-managed keys. RLS now prevents non-admin reads, but a future pass should move all secret read/write operations behind server routes and stop returning raw key values to the browser.
- Document vault security depends on the vault passphrase. If the passphrase is lost, files cannot be recovered.

## Verification

- Production build passed.
- Supabase migrations applied to `retrolootpro-prod`.
- Supabase Storage bucket verified as private.
- Supabase advisor re-run after policy hardening.
