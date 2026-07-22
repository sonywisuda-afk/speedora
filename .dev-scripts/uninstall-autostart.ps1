# DEPRECATED (2026-07-22) - see watchdog.ps1's banner. Kept working (unlike
# its sibling scripts) because it's still the right tool for finishing the
# 2026-07-22 migration's one remaining manual step: this must be run from an
# ELEVATED shell (Unregister-ScheduledTask fails with Access Denied from a
# normal shell on this machine - confirmed during the migration). See
# ops/dev-server/MIGRATION.md.
#
# NOTE: this script sets $ErrorActionPreference = 'SilentlyContinue' below,
# which means an Access Denied failure from a non-elevated shell prints
# "Removed scheduled task" even though nothing was actually removed - always
# verify with: Get-ScheduledTask -TaskName 'SpeedoraDevWatchdogAutostart'
# (should error "not found" once it's genuinely gone).
#
# Removes the scheduled task registered by install-autostart.ps1.
#
# Usage: powershell -File .dev-scripts\uninstall-autostart.ps1

$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'SpeedoraDevWatchdogAutostart'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed scheduled task '$taskName'."
} else {
  Write-Host "Scheduled task '$taskName' was not registered - nothing to do."
}
