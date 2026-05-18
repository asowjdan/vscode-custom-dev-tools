# .git/FETCH_HEAD 변경을 감지해 새 커밋이 내려오면 자동 빌드/설치
# 로그인 시 백그라운드에서 실행됩니다.

$repoPath  = "C:\Users\asowj\OneDrive\바탕 화면\custom\vscode-custom-dev-tools"
$gitDir    = Join-Path $repoPath ".git"
$script    = Join-Path $repoPath "scripts\sync-and-rebuild.ps1"
$logFile   = Join-Path $repoPath "logs\sync.log"

New-Item -ItemType Directory -Force -Path (Join-Path $repoPath "logs") | Out-Null

function Write-Log([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  [System.IO.File]::AppendAllText($logFile, "$line`n", [System.Text.UTF8Encoding]::new($false))
}

Write-Log "=== watch-and-rebuild started ==="

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path   = $gitDir
$watcher.Filter = "FETCH_HEAD"
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

$lastRunHash = ""

$action = {
  Start-Sleep -Milliseconds 1500

  $local  = git -C $repoPath rev-parse HEAD 2>$null
  $remote = git -C $repoPath rev-parse origin/main 2>$null

  if (-not $local -or -not $remote) { return }
  if ($local -eq $remote)           { return }
  if ($local -eq $script:lastRunHash) { return }

  $script:lastRunHash = $remote
  Write-Log "New commits detected: $($local.Substring(0,7)) -> $($remote.Substring(0,7)). Starting build..."
  & $script -SkipMarketplace -NoPull
}

Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action | Out-Null

Write-Log "Watching $gitDir\FETCH_HEAD for changes..."

# 프로세스가 종료되지 않도록 대기
while ($true) { Start-Sleep -Seconds 30 }
