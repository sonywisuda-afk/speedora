# DEPRECATED (2026-07-22) - do not run this. See watchdog.ps1's banner for
# why the legacy watchdog system was retired. The Scheduled Task this
# registers is being removed as part of that migration - see
# ops/dev-server/MIGRATION.md. If you're looking for "start dev tools
# automatically," there is deliberately no replacement for this at the
# Scheduled-Task/reboot level in the new system - `pnpm dev` is a single
# explicit command precisely so there is one obvious way to start things and
# no silent background process a future session might forget about.
#
# Registers a Windows Scheduled Task that runs start.ps1 automatically at
# user logon, so a machine reboot doesn't silently leave apps/api and
# apps/worker down until someone remembers to run start.ps1 by hand.
#
# Deliberately triggered AtLogOn for the current user, not AtStartup as
# SYSTEM - AtStartup runs before any user profile loads and under a SYSTEM
# account whose PATH/environment doesn't necessarily have node/pnpm set up
# the way an interactive login shell does; AtLogOn for this user matches the
# environment start.ps1/watchdog.ps1 are actually meant to run in, and
# doesn't require elevation to register.
#
# Usage: powershell -File .dev-scripts\install-autostart.ps1
# Remove: powershell -File .dev-scripts\uninstall-autostart.ps1
# Check:  powershell -File .dev-scripts\status.ps1 (reports registered or not)

$ErrorActionPreference = 'Stop'
$taskName = 'SpeedoraDevWatchdogAutostart'
$startScript = Join-Path $PSScriptRoot 'start.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Starts Speedora dev api/worker watchdogs at logon' `
  -Force | Out-Null

Write-Host "Registered scheduled task '$taskName' (runs start.ps1 at your next logon)."
Write-Host "It will also run right now if you want to verify it - or just run start.ps1 yourself as usual."
