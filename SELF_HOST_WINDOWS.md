# Self-Hosting On A Windows Server

This is the lowest-rewrite, no-hosted-SaaS approach for RetroLoot Pro.

## Recommended Architecture

```text
Phone / PC
  -> https://app.yourdomain.com
  -> IIS reverse proxy
  -> Next.js app on 127.0.0.1:3000
  -> self-hosted Supabase API/Postgres/Auth/Functions
```

You avoid Netlify and hosted Supabase costs, while keeping the app's current Supabase client, auth, database, and function code.

## Why Not Remove Supabase Completely?

The app currently uses Supabase for:

- authentication
- database access
- row-level security
- Edge Functions for pricing, UPC lookup, Plaid, eBay, Amazon, Whatnot

Removing Supabase entirely would mean replacing auth, database access, security rules, and every function integration. That is a rewrite.

Self-hosting Supabase is the practical middle path: no Supabase cloud bill, minimal code change.

## Server Layout

Recommended on one Windows machine:

- Windows Server or Windows Pro
- IIS for public HTTPS
- Node.js 20 LTS for the Next app
- NSSM to run the Next app as a Windows service
- Docker-backed self-hosted Supabase

Most stable database option:

- Run self-hosted Supabase in an Ubuntu VM or WSL2/Linux Docker environment on the same server.
- Keep IIS and the Next app on Windows.

Supabase's official self-hosting docs recommend Docker Compose.

## Domain Plan

Use two hostnames:

```text
https://app.yourdomain.com   -> RetroLoot Pro app
https://api.yourdomain.com   -> self-hosted Supabase API gateway
```

You can also use different ports, but subdomains are cleaner and better for mobile.

## Step 1: Install Windows Dependencies

Install:

- Node.js 20 LTS
- Git
- IIS
- IIS URL Rewrite
- IIS Application Request Routing
- NSSM

In IIS Application Request Routing, enable proxying:

```text
IIS Manager -> Server node -> Application Request Routing Cache -> Server Proxy Settings -> Enable Proxy
```

## One-Command Guided Setup Script

This repo includes a guided setup script:

```powershell
.\scripts\windows\setup-selfhost-prod.ps1 `
  -AppDomain app.yourdomain.com `
  -ApiDomain api.yourdomain.com `
  -SupabaseUrl https://api.yourdomain.com `
  -SupabaseAnonKey "YOUR_SELF_HOSTED_ANON_KEY" `
  -InstallIIS `
  -ConfigureIIS `
  -BuildApp `
  -InstallService `
  -PrepareSupabaseDocker
```

Run PowerShell as Administrator.

The script can automate the Windows/IIS/Next service pieces. It will still require you to edit self-hosted Supabase secrets before starting Docker Compose. Do not run Supabase with default secrets.

## Step 2: Put The App On The Server

Clone or copy the project to something like:

```text
C:\Sites\retroloot-pro
```

Create production env:

```powershell
Copy-Item .env.selfhost.example .env.production
```

Edit `.env.production`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-self-hosted-anon-key
```

For Next.js runtime, also create `.env` on the production server with the same production values, or ensure the service process receives those variables.

## Step 3: Build The App

```powershell
npm ci
npm run build
```

Test locally:

```powershell
.\scripts\windows\start-prod.ps1 -Port 3000
```

Open:

```text
http://127.0.0.1:3000
```

## Step 4: Run The App As A Windows Service

Install NSSM and make sure `nssm.exe` is on PATH.

From the project folder:

```powershell
.\scripts\windows\install-nssm-service.ps1 -ServiceName RetroLootPro -Port 3000
Start-Service RetroLootPro
```

Logs will be written to:

```text
logs\retroloot.out.log
logs\retroloot.err.log
```

## Step 5: Configure IIS For The App

Create an IIS site:

```text
Site name: RetroLoot Pro
Binding: https app.yourdomain.com
Physical path: C:\inetpub\retroloot-pro-proxy
```

Create a `web.config` in that physical path:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToNext" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <webSocket enabled="true" />
  </system.webServer>
</configuration>
```

Add an SSL certificate for `app.yourdomain.com`.

## Step 6: Self-Host Supabase

Use the official Supabase Docker Compose self-hosting flow.

At a high level:

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Before starting it, change all default passwords and secrets in `.env`.

Important values:

```text
POSTGRES_PASSWORD
JWT_SECRET
ANON_KEY
SERVICE_ROLE_KEY
DASHBOARD_USERNAME
DASHBOARD_PASSWORD
SITE_URL=https://app.yourdomain.com
API_EXTERNAL_URL=https://api.yourdomain.com
SUPABASE_PUBLIC_URL=https://api.yourdomain.com
```

Start:

```bash
docker compose up -d
```

Supabase Studio/API gateway normally comes up through port `8000`. Put IIS or another reverse proxy in front of it so:

```text
https://api.yourdomain.com -> http://127.0.0.1:8000
```

## Step 7: Apply Database Schema

Apply this repo's SQL migrations to the self-hosted Supabase database.

Simple approach:

1. Open Supabase Studio.
2. Go to SQL Editor.
3. Run each file in `supabase/migrations` in timestamp order.

Repeatable CLI approach:

```powershell
supabase db push --db-url "postgresql://postgres:YOUR_PASSWORD@YOUR_DB_HOST:5432/postgres"
```

## Step 8: Deploy Edge Functions

The app uses functions in:

```text
supabase/functions
```

Deploy them to your self-hosted Supabase function runtime using the Supabase CLI or copy them into your self-hosted functions workflow.

Functions used by the app:

```text
lookup-pricing
lookup-upc
search-market-prices
backfill-inventory
plaid-link-token
plaid-exchange-token
plaid-sync-transactions
ebay-auth
ebay-sync-orders
amazon-auth
amazon-sync-orders
whatnot-auth
whatnot-sync-orders
```

For Phase 1, you can start with:

```text
lookup-pricing
lookup-upc
search-market-prices
backfill-inventory
```

## Step 9: Mobile Access

Use the public HTTPS app URL from your phone:

```text
https://app.yourdomain.com
```

Mobile camera scanning generally requires HTTPS.

## Backup Plan

At minimum, back up:

- Supabase Postgres database
- Supabase storage volumes, if you use storage
- app `.env` files
- self-hosted Supabase `.env`

Suggested daily Postgres backup:

```bash
pg_dump "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres" > backup-$(date +%F).sql
```

Store backups somewhere other than the server.

There is also a Windows backup helper:

```powershell
.\scripts\windows\backup-selfhost-postgres.ps1 `
  -ConnectionString "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres" `
  -BackupDir "D:\Backups\retroloot"
```

## Simplest First Milestone

1. Get `https://app.yourdomain.com` loading the app through IIS.
2. Get `https://api.yourdomain.com` loading self-hosted Supabase Studio/API.
3. Run migrations.
4. Create a user.
5. Add one inventory item.
6. Test Deal Check.
7. Set up backups.

Do not connect real bank/platform integrations until the app, database, and backups are stable.
