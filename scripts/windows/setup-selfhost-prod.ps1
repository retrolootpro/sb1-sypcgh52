<#
.SYNOPSIS
  Guided Windows/IIS self-host production setup for RetroLoot Pro.

.DESCRIPTION
  This script prepares a Windows server to host the Next.js app behind IIS.
  It can:
    - enable IIS features
    - write production .env files
    - install/build the app
    - install/start an NSSM Windows service for Next.js
    - create an IIS reverse-proxy site and web.config
    - optionally clone the official Supabase Docker self-hosting files

  It does not invent secrets, buy domains, create DNS records, or issue certs.
  You should create DNS/certs first, or run this with HTTP and add HTTPS later.

.EXAMPLE
  .\scripts\windows\setup-selfhost-prod.ps1 `
    -AppDomain app.example.com `
    -ApiDomain api.example.com `
    -SupabaseUrl https://api.example.com `
    -SupabaseAnonKey "YOUR_ANON_KEY" `
    -InstallIIS `
    -ConfigureIIS `
    -InstallService `
    -BuildApp
#>

[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$AppDomain = "",
  [string]$ApiDomain = "",
  [string]$SupabaseUrl = "",
  [string]$SupabaseAnonKey = "",
  [int]$AppPort = 3000,
  [string]$ServiceName = "RetroLootPro",
  [string]$AppSiteName = "RetroLoot Pro",
  [string]$IisProxyPath = "C:\inetpub\retroloot-pro-proxy",
  [string]$SupabaseInstallPath = "C:\SelfHosted\supabase",
  [string]$HttpsCertThumbprint = "",
  [switch]$InstallIIS,
  [switch]$ConfigureIIS,
  [switch]$InstallService,
  [switch]$BuildApp,
  [switch]$PrepareSupabaseDocker,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn($Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Require-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "Run this PowerShell session as Administrator."
  }
}

function Read-Required($Prompt, $CurrentValue = "") {
  if ($CurrentValue) { return $CurrentValue }
  do {
    $value = Read-Host $Prompt
  } while ([string]::IsNullOrWhiteSpace($value))
  return $value.Trim()
}

function Ensure-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Enable-IisFeatures {
  Write-Step "Enabling IIS features"
  $features = @(
    "IIS-WebServerRole",
    "IIS-WebServer",
    "IIS-CommonHttpFeatures",
    "IIS-DefaultDocument",
    "IIS-StaticContent",
    "IIS-HttpErrors",
    "IIS-HttpRedirect",
    "IIS-ApplicationDevelopment",
    "IIS-WebSockets",
    "IIS-HealthAndDiagnostics",
    "IIS-HttpLogging",
    "IIS-Security",
    "IIS-RequestFiltering",
    "IIS-Performance",
    "IIS-HttpCompressionDynamic",
    "IIS-ManagementConsole"
  )

  foreach ($feature in $features) {
    Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart | Out-Null
  }
}

function Write-ProductionEnv($RepoRoot, $Url, $AnonKey) {
  Write-Step "Writing production environment files"
  $envContent = @"
NEXT_PUBLIC_SUPABASE_URL=$Url
NEXT_PUBLIC_SUPABASE_ANON_KEY=$AnonKey
"@

  Set-Content -Path (Join-Path $RepoRoot ".env.production") -Value $envContent -Encoding UTF8
  Set-Content -Path (Join-Path $RepoRoot ".env") -Value $envContent -Encoding UTF8
  Write-Host "Wrote .env and .env.production"
}

function Build-NextApp($RepoRoot) {
  Write-Step "Installing dependencies and building Next.js app"
  Ensure-Command "node" "Install Node.js 20 LTS."
  Ensure-Command "npm" "Install Node.js 20 LTS, then reopen PowerShell."

  Push-Location $RepoRoot
  try {
    npm ci
    npm run build
  } finally {
    Pop-Location
  }
}

function Install-AppService($RepoRoot, $Name, $Port) {
  Write-Step "Installing Windows service with NSSM"
  Ensure-Command "nssm" "Install NSSM and add nssm.exe to PATH."

  $logs = Join-Path $RepoRoot "logs"
  New-Item -ItemType Directory -Force -Path $logs | Out-Null

  $startScript = Join-Path $RepoRoot "scripts\windows\start-prod.ps1"
  if (-not (Test-Path $startScript)) {
    throw "Missing $startScript"
  }

  $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($existing) {
    if (-not $Force) {
      throw "Service $Name already exists. Re-run with -Force to replace settings."
    }
    nssm stop $Name | Out-Null
    nssm remove $Name confirm | Out-Null
  }

  nssm install $Name "powershell.exe" "-ExecutionPolicy Bypass -File `"$startScript`" -Port $Port"
  nssm set $Name AppDirectory $RepoRoot | Out-Null
  nssm set $Name DisplayName "RetroLoot Pro" | Out-Null
  nssm set $Name Description "RetroLoot Pro Next.js production server" | Out-Null
  nssm set $Name Start SERVICE_AUTO_START | Out-Null
  nssm set $Name AppStdout (Join-Path $logs "retroloot.out.log") | Out-Null
  nssm set $Name AppStderr (Join-Path $logs "retroloot.err.log") | Out-Null

  Start-Service $Name
  Write-Host "Started service $Name"
}

function Ensure-IisReverseProxyPrereqs {
  Import-Module WebAdministration

  $rewriteModule = Get-WebGlobalModule | Where-Object { $_.Name -eq "RewriteModule" }
  if (-not $rewriteModule) {
    Write-Warn "IIS URL Rewrite does not appear to be installed."
    Write-Warn "Install URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite"
  }

  try {
    Get-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "enabled" | Out-Null
    Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "enabled" -Value "True"
  } catch {
    Write-Warn "IIS ARR proxy settings were not available."
    Write-Warn "Install ARR: https://www.iis.net/downloads/microsoft/application-request-routing"
  }
}

function Configure-IisSite($SiteName, $Domain, $ProxyPath, $Port, $CertThumbprint) {
  Write-Step "Configuring IIS reverse-proxy site"
  Ensure-IisReverseProxyPrereqs

  New-Item -ItemType Directory -Force -Path $ProxyPath | Out-Null

  $webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToNext" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:$Port/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <webSocket enabled="true" />
  </system.webServer>
</configuration>
"@
  Set-Content -Path (Join-Path $ProxyPath "web.config") -Value $webConfig -Encoding UTF8

  Import-Module WebAdministration

  if (Test-Path "IIS:\Sites\$SiteName") {
    if (-not $Force) {
      throw "IIS site '$SiteName' already exists. Re-run with -Force to replace it."
    }
    Remove-Website -Name $SiteName
  }

  New-Website -Name $SiteName -PhysicalPath $ProxyPath -Port 80 -HostHeader $Domain | Out-Null

  if ($CertThumbprint) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $Domain -SslFlags 1 | Out-Null
    Push-Location IIS:\SslBindings
    try {
      if (Test-Path "0.0.0.0!443!$Domain") {
        Remove-Item "0.0.0.0!443!$Domain" -Force
      }
      Get-Item "Cert:\LocalMachine\My\$CertThumbprint" | New-Item "0.0.0.0!443!$Domain" -SslFlags 1 | Out-Null
    } finally {
      Pop-Location
    }
    Write-Host "Configured HTTPS binding for $Domain"
  } else {
    Write-Warn "No HTTPS cert thumbprint provided. Site is HTTP only until you add a certificate."
  }
}

function Prepare-Supabase($InstallPath, $AppUrl, $ApiUrl) {
  Write-Step "Preparing self-hosted Supabase Docker folder"
  Ensure-Command "git" "Install Git."
  Ensure-Command "docker" "Install Docker Desktop or Docker Engine."

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallPath) | Out-Null

  if (Test-Path $InstallPath) {
    if (-not $Force) {
      Write-Warn "$InstallPath already exists. Skipping clone. Use -Force to replace manually."
      return
    }
  } else {
    git clone --depth 1 https://github.com/supabase/supabase $InstallPath
  }

  $dockerPath = Join-Path $InstallPath "docker"
  $example = Join-Path $dockerPath ".env.example"
  $env = Join-Path $dockerPath ".env"

  if ((Test-Path $example) -and -not (Test-Path $env)) {
    Copy-Item $example $env
  }

  Write-Warn "Supabase .env created at: $env"
  Write-Warn "Before running docker compose up -d, edit secrets in that .env."
  Write-Warn "Set SITE_URL=$AppUrl, API_EXTERNAL_URL=$ApiUrl, SUPABASE_PUBLIC_URL=$ApiUrl."
  Write-Host ""
  Write-Host "Next command after editing secrets:"
  Write-Host "  cd `"$dockerPath`""
  Write-Host "  docker compose up -d"
}

Require-Admin

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$AppDomain = Read-Required "App domain, e.g. app.example.com" $AppDomain
$ApiDomain = Read-Required "API domain, e.g. api.example.com" $ApiDomain
$SupabaseUrl = Read-Required "Self-hosted Supabase URL, e.g. https://api.example.com" $SupabaseUrl
$SupabaseAnonKey = Read-Required "Self-hosted Supabase anon key" $SupabaseAnonKey

Write-Host ""
Write-Host "RetroLoot Pro self-host setup" -ForegroundColor Green
Write-Host "Repo:       $repoRoot"
Write-Host "App:        https://$AppDomain"
Write-Host "Supabase:   $SupabaseUrl"
Write-Host "App port:   $AppPort"
Write-Host "IIS path:   $IisProxyPath"
Write-Host ""

if ($InstallIIS) {
  Enable-IisFeatures
}

Write-ProductionEnv -RepoRoot $repoRoot -Url $SupabaseUrl -AnonKey $SupabaseAnonKey

if ($BuildApp) {
  Build-NextApp -RepoRoot $repoRoot
}

if ($InstallService) {
  Install-AppService -RepoRoot $repoRoot -Name $ServiceName -Port $AppPort
}

if ($ConfigureIIS) {
  Configure-IisSite -SiteName $AppSiteName -Domain $AppDomain -ProxyPath $IisProxyPath -Port $AppPort -CertThumbprint $HttpsCertThumbprint
}

if ($PrepareSupabaseDocker) {
  Prepare-Supabase -InstallPath $SupabaseInstallPath -AppUrl "https://$AppDomain" -ApiUrl $SupabaseUrl
}

Write-Step "Done"
Write-Host "Open the app site after DNS/cert/proxy are ready:"
Write-Host "  https://$AppDomain"
Write-Host ""
Write-Host "If you prepared Supabase Docker, edit its .env before starting Docker Compose."

