# DEPRECATED (2026-07-22) - see watchdog.ps1's banner. Use `pnpm dev:status`
# (ops/dev-server/status.mjs) going forward, which covers web too and reads
# the new supervisor's pidstore instead of this legacy pid-file layout.
#
# Reports whether each watchdog and its supervised app process is actually
# alive right now - the source of truth is Get-Process against the PIDs
# each watchdog/start.ps1 recorded, not just "a pid file exists" (a stale
# file from a process that already died would otherwise read as healthy).
#
# Also surfaces the most recent crash-loop ALERT (if any) per service, and
# whether autostart-at-logon is registered - see install-autostart.ps1.
#
# Usage: powershell -File .dev-scripts\status.ps1

$alertsLog = Join-Path $PSScriptRoot 'logs\ALERTS.log'

foreach ($appName in @('api', 'worker')) {
  $watchdogPidFile = Join-Path $PSScriptRoot "$appName.watchdog.pid"
  $appPidFile = Join-Path $PSScriptRoot "$appName.pid"

  $watchdogStatus = 'not running'
  if (Test-Path $watchdogPidFile) {
    $watchdogPid = Get-Content $watchdogPidFile
    if (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue) {
      $watchdogStatus = "alive (pid $watchdogPid)"
    }
  }

  $appStatus = 'not running'
  if (Test-Path $appPidFile) {
    $appPid = Get-Content $appPidFile
    if (Get-Process -Id $appPid -ErrorAction SilentlyContinue) {
      $appStatus = "alive (pid $appPid)"
    }
  }

  Write-Host "${appName}: watchdog=$watchdogStatus app=$appStatus"

  if (Test-Path $alertsLog) {
    $lastAlert = Get-Content $alertsLog | Where-Object { $_ -match "\[$appName\]" } | Select-Object -Last 1
    if ($lastAlert) { Write-Host "  last alert: $lastAlert" }
  }
}

$taskName = 'SpeedoraDevWatchdogAutostart'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Write-Host "`nautostart-at-logon: registered (state: $($task.State))"
} else {
  Write-Host "`nautostart-at-logon: not registered - see install-autostart.ps1"
}
