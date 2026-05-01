param(
  [int]$Port = 3000,
  [string]$HostName = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js was not found on PATH. Install Node.js 20 LTS and reopen PowerShell."
}

if (-not (Test-Path ".next\BUILD_ID")) {
  & npm ci
  & npm run build
}

& node "node_modules\next\dist\bin\next" start -H $HostName -p $Port

