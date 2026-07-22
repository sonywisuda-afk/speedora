# DEPRECATED (2026-07-22) - see watchdog.ps1's banner. Retained only in case
# a watchdog instance from before the migration is somehow still alive on
# this machine; the supported way to stop dev processes going forward is
# `pnpm dev:stop` (ops/dev-server/stop.mjs).
#
# Stops both watchdogs AND the app processes they supervise - stopping only
# the watchdog would leave api/worker running unsupervised (harmless but
# confusing), and stopping only the app would just have the watchdog
# immediately restart it.
#
# Usage: powershell -File .dev-scripts\stop.ps1

$ErrorActionPreference = 'SilentlyContinue'

foreach ($appName in @('api', 'worker')) {
  $watchdogPidFile = Join-Path $PSScriptRoot "$appName.watchdog.pid"
  if (Test-Path $watchdogPidFile) {
    $watchdogPid = Get-Content $watchdogPidFile
    Stop-Process -Id $watchdogPid -Force
    Remove-Item $watchdogPidFile
    Write-Host "$appName watchdog (pid $watchdogPid) stopped"
  }

  $appPidFile = Join-Path $PSScriptRoot "$appName.pid"
  if (Test-Path $appPidFile) {
    $appPid = Get-Content $appPidFile
    Stop-Process -Id $appPid -Force
    Remove-Item $appPidFile
    Write-Host "$appName (pid $appPid) stopped"
  }
}
