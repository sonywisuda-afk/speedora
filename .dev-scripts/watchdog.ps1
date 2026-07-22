# ============================================================================
# DEPRECATED (2026-07-22) - retired in favor of the unified dev supervisor at
# ops/dev-server/. Do not start this manually and do not re-register its
# autostart task.
#
# Why it was retired: this watchdog supervises a COMPILED, non-watching
# `node dist/main.js` copy of api/worker - it never picks up source changes,
# so whatever build happened to be on disk when it last (re)started keeps
# running indefinitely. Combined with the separate AtLogOn autostart task
# (install-autostart.ps1) and ad-hoc `pnpm dev`/`corepack pnpm --filter dev`
# invocations from unrelated sessions never checking whether this was already
# running, this became a SECOND, independent supervisor for the same
# services with no coordination between the two - the direct cause of a
# 2026-07-22 incident where a worker instance running 12-day-stale compiled
# code was silently alive via this watchdog the whole time, while everyone
# believed only the `pnpm dev`-started instance was active, plus ~20 orphaned
# duplicate Next.js/NestJS/worker processes accumulated from repeated
# uncoordinated restarts.
#
# What replaced it: ops/dev-server/dev.mjs is now the single authoritative
# process manager for web/api/worker/packages. It reuses this file's own
# ideas - single-instance guard via pidfile, and crash-loop-backoff restart -
# but as ONE in-process mechanism (`pnpm dev --supervise`) instead of a
# separate detached PowerShell tree per service, and it runs the actual
# dev/watch scripts (`next dev`, `nest start --watch`, `tsx watch`) so code
# changes are always picked up, never a stale compiled snapshot.
#
# The AtLogOn Scheduled Task (`SpeedoraDevWatchdogAutostart`) that used to
# invoke start.ps1 -> this file has been disabled by neutering start.ps1
# into a no-op (see start.ps1's own banner) - full removal of the task
# registration itself requires an elevated shell, see
# ops/dev-server/MIGRATION.md for the one command to run.
# ============================================================================
#
# Keeps one Speedora backend process (apps/api or apps/worker) alive on this
# dev machine. Not part of the deployable app - a local dev-machine
# convenience only, same spirit as .dev-storage/.
#
# Why this exists: node dist/main.js processes started directly from an
# agent's shell tool calls have repeatedly died on their own mid-session in
# this environment (observed multiple times - see project memory), with no
# crash/error from the app itself. Launching THIS script once via
# Start-Process (detached, not awaited) puts it outside that lifecycle
# entirely; it then supervises the real process from a loop that never
# returns control to whatever launched it. If the real process dies for any
# reason (that same environment quirk, or a genuine crash), this restarts it
# within a few seconds and logs the restart - so a crash never turns into an
# indefinitely stuck pipeline that requires a human to notice and restart by
# hand.
#
# Hardening (added for longer-lived/production-adjacent local use, on
# explicit user request):
#   - single instance per AppName, enforced HERE (not just by start.ps1's own
#     check) - this script refuses to run a second copy for the same AppName
#     even if launched directly, bypassing start.ps1.
#   - crash-loop backoff: more than $MaxRestarts restarts within
#     $RestartWindowSeconds trips a cooldown instead of restarting forever in
#     a tight loop.
#   - every restart logs WHY (the dead process's exit code, plus a tail of
#     its own stderr log) - not just "it's gone".
#   - a crash-loop trip sends a best-effort local notification (Windows
#     toast if available) in addition to the log, so a human actually
#     notices instead of having to go looking for it.
#
# Usage (from a detached launcher, not directly):
#   powershell -File watchdog.ps1 -AppName worker -AppDir C:\...\apps\worker

param(
  [Parameter(Mandatory = $true)][string]$AppName,
  [Parameter(Mandatory = $true)][string]$AppDir,
  [int]$CheckIntervalSeconds = 5,
  # Crash-loop backoff thresholds - deliberately generous (a normal restart
  # from the documented "process just disappears" quirk is a one-off, not a
  # loop) so a genuinely broken build (crashes every few seconds) is what
  # actually trips this, not ordinary occasional flakiness.
  [int]$MaxRestarts = 5,
  [int]$RestartWindowSeconds = 60,
  [int]$CooldownSeconds = 300
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$watchdogLog = Join-Path $logDir "$AppName.watchdog.log"
$alertsLog = Join-Path $logDir 'ALERTS.log'
$pidFile = Join-Path $PSScriptRoot "$AppName.watchdog.pid"

function Write-WatchdogLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) [$AppName] $Message"
  Add-Content -Path $watchdogLog -Value $line
}

function Write-Alert {
  param([string]$Message)
  $line = "$(Get-Date -Format o) [$AppName] ALERT: $Message"
  Add-Content -Path $watchdogLog -Value $line
  # Separate, cross-service alerts log - so a human (or a future monitoring
  # script) can tail/grep ONE file for "something needs attention" instead
  # of wading through routine per-restart lines across both services.
  Add-Content -Path $alertsLog -Value $line
  Send-Notification -Message $Message
}

function Send-Notification {
  param([string]$Message)
  # Best-effort only - a notification failing must never take down the
  # watchdog itself. Tries, in order: BurntToast (if the user happens to
  # have it installed), then a native WinRT toast (no extra module needed
  # on Windows 10/11), then gives up silently - the log/ALERTS.log write
  # above already happened regardless, so the information is never lost
  # even if no GUI notification is possible (e.g. running headless/SSH).
  $title = "Speedora dev watchdog - $AppName"
  try {
    if (Get-Module -ListAvailable -Name BurntToast) {
      Import-Module BurntToast -ErrorAction Stop
      New-BurntToastNotification -Text $title, $Message
      return
    }
  } catch {
    # fall through to the native-toast attempt below
  }
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
      [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName('text')
    $texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
    $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PowerShell').Show($toast)
  } catch {
    # No toast backend available - the log/ALERTS.log write already
    # captured this, so silently give up on the GUI notification.
  }
}

function Get-ErrorTail {
  param([string]$ErrLogPath, [int]$Lines = 10)
  if (-not (Test-Path $ErrLogPath)) { return '(no stderr log)' }
  $tail = Get-Content -Path $ErrLogPath -Tail $Lines -ErrorAction SilentlyContinue
  if (-not $tail) { return '(stderr log empty)' }
  return ($tail -join ' | ')
}

# Single instance per AppName, enforced here (not just by start.ps1's own
# check) - refuses to run a second watchdog for the same service even if
# launched directly, bypassing start.ps1's own guard.
if (Test-Path $pidFile) {
  $existingWatchdogPid = Get-Content $pidFile
  $existingProc = Get-Process -Id $existingWatchdogPid -ErrorAction SilentlyContinue
  if ($existingProc -and $existingProc.Id -ne $PID) {
    Write-WatchdogLog "refusing to start - another watchdog for $AppName is already running (pid $existingWatchdogPid)"
    exit 1
  }
}
Set-Content -Path $pidFile -Value $PID

# One Process object per (re)start, kept alive in $currentProc for the
# whole loop iteration - NOT re-fetched via Get-Process, because once a
# process has actually exited, Get-Process -Id can no longer find it at all
# (so it could never report WHY). The .NET Process object handle returned
# by Start-Process, by contrast, keeps ExitCode available after exit as
# long as this same handle is what's queried.
function Start-App {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $appLog = Join-Path $logDir "$AppName.$timestamp.log"
  $appErrLog = Join-Path $logDir "$AppName.$timestamp.err.log"
  $proc = Start-Process -FilePath 'node' -ArgumentList 'dist/main.js' `
    -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $appLog -RedirectStandardError $appErrLog
  # Touching .Handle while the process is still alive is required for a
  # known .NET quirk - without it, $proc.ExitCode reads back empty once the
  # process has exited, even though the object itself is still valid.
  $proc.Handle | Out-Null
  Set-Content -Path (Join-Path $PSScriptRoot "$AppName.pid") -Value $proc.Id
  Write-WatchdogLog "started $AppName, pid $($proc.Id), logging to $appLog"
  return [PSCustomObject]@{ Proc = $proc; ErrLog = $appErrLog }
}

Write-WatchdogLog "watchdog started for $AppName (pid $PID, checking every ${CheckIntervalSeconds}s, max $MaxRestarts restarts / ${RestartWindowSeconds}s before a ${CooldownSeconds}s cooldown)"
$current = Start-App
$restartTimestamps = [System.Collections.Generic.List[datetime]]::new()

while ($true) {
  Start-Sleep -Seconds $CheckIntervalSeconds
  if (-not $current.Proc.HasExited) { continue }

  $exitCode = $current.Proc.ExitCode
  $errTail = Get-ErrorTail -ErrLogPath $current.ErrLog
  Write-WatchdogLog "$AppName (pid $($current.Proc.Id)) exited with code $exitCode - last stderr: $errTail"

  $now = Get-Date
  $restartTimestamps.Add($now)
  $cutoff = $now.AddSeconds(-$RestartWindowSeconds)
  $restartTimestamps.RemoveAll({ param($t) $t -lt $cutoff }) | Out-Null

  if ($restartTimestamps.Count -gt $MaxRestarts) {
    Write-Alert "$AppName crashed $($restartTimestamps.Count) times in the last ${RestartWindowSeconds}s (exit code $exitCode, last stderr: $errTail) - backing off for ${CooldownSeconds}s instead of restart-looping"
    Start-Sleep -Seconds $CooldownSeconds
    $restartTimestamps.Clear()
    Write-WatchdogLog "cooldown finished - resuming supervision of $AppName"
  }

  $current = Start-App
}
