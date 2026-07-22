# ============================================================================
# DEPRECATED (2026-07-22) - retired in favor of the unified dev supervisor at
# ops/dev-server/ (`pnpm dev`, or `pnpm dev --supervise` for the
# auto-restart-on-crash behavior this script used to provide via
# watchdog.ps1). See watchdog.ps1's own banner for the full incident writeup.
#
# This script is intentionally neutered to a no-op below. It is still the
# target of the `SpeedoraDevWatchdogAutostart` Scheduled Task (AtLogOn
# trigger) - removing that registration requires an elevated shell, which
# the migration that retired this system did not have. Neutering the script
# itself (rather than relying on the task being removed) means the task can
# keep firing at every future logon completely harmlessly: it runs this
# file, this file prints a notice and exits, nothing is spawned.
#
# To finish the migration and remove the stale task registration itself,
# run ONE of these from an elevated ("Run as Administrator") PowerShell:
#   Unregister-ScheduledTask -TaskName 'SpeedoraDevWatchdogAutostart' -Confirm:$false
#   schtasks /Delete /TN "SpeedoraDevWatchdogAutostart" /F
# See ops/dev-server/MIGRATION.md for details.
# ============================================================================

Write-Host "[.dev-scripts/start.ps1] deprecated and neutered - this no longer starts anything."
Write-Host "Use 'pnpm dev' (or 'pnpm dev --supervise') from the repo root instead."
exit 0

# --- original body, retained for reference only, never executed above ---
#
# Starts apps/api and apps/worker, each supervised by its own watchdog.ps1
# instance, for resilient local development on this machine. Each watchdog
# is itself launched detached (Start-Process, not awaited) so it keeps
# running independent of whatever shell/tool session started it - see
# watchdog.ps1's own comment for why that matters.
#
# Also registered (see install-autostart.ps1) to run automatically at user
# logon, so a machine reboot doesn't silently leave api/worker down until
# someone remembers to run this by hand.
#
# Usage: powershell -File .dev-scripts\start.ps1
# Stop everything:  powershell -File .dev-scripts\stop.ps1
# Check status:      powershell -File .dev-scripts\status.ps1
#
# $ErrorActionPreference = 'Stop'
# $repoRoot = Split-Path $PSScriptRoot -Parent
#
# function Start-Watchdog {
#   param([string]$AppName, [string]$AppDir)
#
#   $existingPidFile = Join-Path $PSScriptRoot "$AppName.watchdog.pid"
#   if (Test-Path $existingPidFile) {
#     $existingPid = Get-Content $existingPidFile
#     if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
#       Write-Host "$AppName watchdog already running (pid $existingPid) - skipping"
#       return
#     }
#   }
#
#   $proc = Start-Process -FilePath 'powershell' -ArgumentList @(
#     '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
#     (Join-Path $PSScriptRoot 'watchdog.ps1'),
#     '-AppName', $AppName, '-AppDir', $AppDir
#   ) -WindowStyle Hidden -PassThru
#   Write-Host "$AppName watchdog launched (pid $($proc.Id))"
# }
#
# Start-Watchdog -AppName 'api' -AppDir (Join-Path $repoRoot 'apps\api')
# Start-Watchdog -AppName 'worker' -AppDir (Join-Path $repoRoot 'apps\worker')
#
# Write-Host "`nGive it a few seconds, then check: powershell -File .dev-scripts\status.ps1"
