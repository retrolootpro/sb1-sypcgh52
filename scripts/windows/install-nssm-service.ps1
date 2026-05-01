param(
  [string]$ServiceName = "RetroLootPro",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$startScript = Join-Path $repoRoot "scripts\windows\start-prod.ps1"

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
  throw "NSSM was not found on PATH. Install NSSM first, then rerun this script."
}

& nssm install $ServiceName "powershell.exe" "-ExecutionPolicy Bypass -File `"$startScript`" -Port $Port"
& nssm set $ServiceName AppDirectory $repoRoot
& nssm set $ServiceName DisplayName "RetroLoot Pro"
& nssm set $ServiceName Description "RetroLoot Pro Next.js production server"
& nssm set $ServiceName Start SERVICE_AUTO_START
& nssm set $ServiceName AppStdout (Join-Path $repoRoot "logs\retroloot.out.log")
& nssm set $ServiceName AppStderr (Join-Path $repoRoot "logs\retroloot.err.log")

New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "logs") | Out-Null

Write-Host "Installed $ServiceName. Start it with:"
Write-Host "  Start-Service $ServiceName"

