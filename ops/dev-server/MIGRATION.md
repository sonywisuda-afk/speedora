# Migration: `.dev-scripts/` watchdog → unified dev supervisor

Date: 2026-07-22

## What happened (incident summary)

A dev session found `apps/web` accepting TCP connections on port 3000 but never
returning an HTTP response. Investigation found ~20 orphaned Node.js processes on the
machine: three full duplicate trees each of `next dev`, `nest start --watch`, and
`tsx watch` (worker), all left over from previous sessions that had each run
`pnpm dev` / `pnpm --filter <app> dev` without checking whether an instance was
already running. The three `next dev` copies were fighting over the same `.next`
build cache, which is the immediate cause of the hang.

While cleaning this up, a **second, independent supervisor** was found already
running on the machine: `.dev-scripts/watchdog.ps1`, registered to auto-start at
every Windows logon via a Scheduled Task (`SpeedoraDevWatchdogAutostart`). It was
keeping a **compiled `apps/worker/dist/main.js` alive since 2026-07-10** —
12 days of stale compiled code, silently processing real BullMQ jobs the whole
time, while every session assumed only the `tsx watch`-started instance was
active. This is a real, more serious problem than the orphan processes: two
uncoordinated systems were both trying to keep the same services running, neither
aware of the other, and the older one was silently serving stale logic.

## What was removed / stopped

| Item | Action | Result |
|---|---|---|
| `worker` watchdog process (pid 13356) | `Stop-Process -Force` | stopped |
| `worker` app process it supervised (pid 8372, `dist/main.js` from 2026-07-10) | `Stop-Process -Force` | stopped |
| `api` watchdog process (pid 14220) | `Stop-Process -Force` | already dead, confirmed |
| `api` app process it supervised (pid 5436) | `Stop-Process -Force` | already dead, confirmed |
| Scheduled Task `SpeedoraDevWatchdogAutostart` | `Unregister-ScheduledTask` / `schtasks /Delete` | **Access Denied — requires an elevated shell.** Neutralized instead (see below); the task registration itself is still present and needs one manual elevated command to fully remove. |
| ~20 ad-hoc orphaned `next dev`/`nest start --watch`/`tsx watch` processes | `taskkill /T /F` per process tree | stopped |

### One remaining manual step

Unregistering a Scheduled Task on this machine requires elevation that this session
does not have (confirmed via both `Unregister-ScheduledTask` and `schtasks /Delete`,
both returning `Access is denied`). From an **elevated** ("Run as Administrator")
PowerShell, run one of:

```powershell
Unregister-ScheduledTask -TaskName 'SpeedoraDevWatchdogAutostart' -Confirm:$false
# or
schtasks /Delete /TN "SpeedoraDevWatchdogAutostart" /F
```

Until that's run, the task registration still exists but is **harmless**: its
target, `.dev-scripts/start.ps1`, has been rewritten to a no-op that prints a
deprecation notice and exits immediately (verified live by triggering the task
on-demand via `Start-ScheduledTask` — no watchdog or app process was spawned).
So even across a reboot, at next logon the task fires, runs the neutered script,
and does nothing. `pnpm doctor` does not currently check for this task's
registration (Scheduled Task auditing was out of scope for the 9 required doctor
checks) — treat the command above as the last checklist item for this migration,
not something tooling will remind you about.

## How duplicate workers are now prevented

Three layers, in order:

1. **Exact tracking (`ops/dev-server/lib/pidstore.mjs`)** — every service `pnpm dev`
   starts gets a `.dev/pids/<service>.json` entry recording its PID and a command-line
   fragment. Before starting anything, the entry is checked: alive + command still
   matches → reused, not restarted. This is what makes running `pnpm dev` twice in a
   row a no-op for already-healthy services (idempotency, requirement #8).
2. **Repo-scoped sweep (`ops/dev-server/lib/sweep.mjs` + `lifecycle.mjs`)** — a
   secondary safety net for processes that predate the pidstore or were started
   outside it (a manual `pnpm --filter web dev` in another terminal, or a session
   that crashed before writing its own entry). Matching requires either this repo's
   own absolute path or an `@speedora/<pkg>` `--filter` argument in the command
   line — both effectively unique to this repo, so an unrelated Node process (an
   IDE language server, another project) can never match. If exactly one untracked
   instance is found for a service, it's **adopted** (recorded, left running) rather
   than killed — restarting a perfectly healthy dev server just because the tooling
   changed would be needlessly disruptive. More than one untracked instance for the
   same service is treated as a genuine duplicate and all of them are stopped before
   a fresh one is spawned.
3. **Tree-kill, always (`ops/dev-server/lib/proc.mjs`'s `killTree`)** — every stop
   path (`pnpm dev:stop`, Ctrl+C, a duplicate cleanup before restart) kills the
   *entire* process subtree (`taskkill /PID <pid> /T /F` on Windows), not just the
   top-level PID. Since every service is spawned via `corepack pnpm --filter <name>
   <script>` (necessary because bare `pnpm` isn't reliably on PATH — see the root
   package.json's `setup:path` script), the recorded PID is a wrapper process with
   the real dev server several layers below it as a descendant. Killing only the
   wrapper, as ad-hoc `Stop-Process`/Ctrl+C on a shell historically did, is exactly
   how the orphans in this incident accumulated in the first place.

## Why the new architecture eliminates stale compiled workers permanently

The old watchdog's entire failure mode was structural, not a bug to patch: it always
ran `node dist/main.js` — a **compiled, non-watching** snapshot — specifically for
resilience against an observed environment quirk (dev processes dying unexpectedly
mid-session, per `watchdog.ps1`'s own original comment). Nothing about that design
ever re-ran `tsc`/`nest build`, so whatever was on disk when it last (re)started is
what keeps running, indefinitely, even as source files change underneath it.

`ops/dev-server/dev.mjs` only ever spawns the actual **watch-mode** scripts
(`next dev`, `nest start --watch`, `tsx watch`, `tsc --watch`) — the same commands a
developer would run by hand — so there is no separate "compiled snapshot" code path
that can silently drift out of date. The old watchdog's one genuinely useful
property, auto-restart after an unexpected crash, is preserved as `pnpm
dev:supervise` (`--supervise` flag): it re-runs the same watch-mode command on
crash, inside the same process, with the same crash-loop backoff thresholds
(5 restarts / 60s before a 300s cooldown) the old `watchdog.ps1` used — so the
resilience isn't lost, only the parallel-supervisor-running-stale-code failure mode
is, since a restarted service is still the watch-mode command, still picking up
current source.

## Verified

- Only one worker process can exist at a time: `pnpm dev` run twice in a row
  reuses/adopts the already-running instance instead of spawning a second one (see
  `lib/lifecycle.mjs`'s `resolveServiceState`); if more than one untracked instance
  is ever found, all of them are stopped before a single fresh one is spawned.
- No legacy worker or watchdog starts automatically after a reboot: the Scheduled
  Task's target script (`start.ps1`) is now a verified no-op (triggered on-demand via
  `Start-ScheduledTask` as a live proxy for "fires at next logon" — no process was
  spawned). Full removal of the task registration itself is the one manual elevated
  step above.
