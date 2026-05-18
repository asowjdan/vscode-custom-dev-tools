# Auto pull -> build -> install when new commits arrive from GitHub.
# Usage:
#   .\scripts\sync-and-rebuild.ps1                  # build + install VSIX + marketplace
#   .\scripts\sync-and-rebuild.ps1 -SkipMarketplace # build + install VSIX only
#   .\scripts\sync-and-rebuild.ps1 -Force           # build/install even if no changes
#   .\scripts\sync-and-rebuild.ps1 -NoPull          # skip git pull (used by post-merge hook)
param(
  [switch]$SkipMarketplace,
  [switch]$Force,
  [switch]$NoPull
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root "logs\sync.log"

New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null

function Write-Log([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Host $line
  [System.IO.File]::AppendAllText($logFile, "$line`n", [System.Text.UTF8Encoding]::new($false))
}

Set-Location $root

Write-Log "=== sync-and-rebuild start ==="

git fetch origin 2>&1 | ForEach-Object { Write-Log "  fetch: $_" }

$localHash  = git rev-parse HEAD
$remoteHash = git rev-parse origin/main

if ($NoPull) {
  Write-Log "post-merge hook: skipping pull, proceeding with build/install"
} elseif ($localHash -eq $remoteHash -and -not $Force) {
  Write-Log "No changes (local = remote). Exiting."
  exit 0
} elseif ($Force) {
  Write-Log "-Force: building/installing regardless of changes"
} else {
  Write-Log "New commits detected: $($localHash.Substring(0,7)) -> $($remoteHash.Substring(0,7))"
}

if (-not $NoPull) {
  Write-Log "git pull origin main..."
  git pull origin main 2>&1 | ForEach-Object { Write-Log "  $_" }
}

Write-Log "Building: custom-dev-tools-theme-kit..."
& (Join-Path $PSScriptRoot "build-custom-dev-tools-vsix.ps1") 2>&1 | ForEach-Object { Write-Log "  $_" }

Write-Log "Building: workbench-background-mod..."
& (Join-Path $PSScriptRoot "build-workbench-background-mod-vsix.ps1") 2>&1 | ForEach-Object { Write-Log "  $_" }

Write-Log "Installing..."
if ($SkipMarketplace) {
  & (Join-Path $PSScriptRoot "install-extensions.ps1") -SkipMarketplace 2>&1 | ForEach-Object { Write-Log "  $_" }
} else {
  & (Join-Path $PSScriptRoot "install-extensions.ps1") 2>&1 | ForEach-Object { Write-Log "  $_" }
}

Write-Log "=== Done. Restart VS Code to apply all changes. ==="
