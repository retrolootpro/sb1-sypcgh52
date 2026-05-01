param(
  [string]$ConnectionString,
  [string]$BackupDir = "C:\Backups\retroloot",
  [string]$PgDumpPath = "pg_dump"
)

$ErrorActionPreference = "Stop"

if (-not $ConnectionString) {
  throw "Pass -ConnectionString with your self-hosted Postgres connection string."
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$backupFile = Join-Path $BackupDir "retroloot-postgres-$stamp.sql"

& $PgDumpPath $ConnectionString "--file=$backupFile"

Write-Host "Backup written to $backupFile"

