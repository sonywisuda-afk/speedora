// Shared service-state resolution and shutdown logic used by both dev.mjs
// (startup sweep + Ctrl+C handler) and stop.mjs, so there is exactly one
// place that decides "is this a healthy running instance, a stale
// duplicate, or nothing" - the same question asked at both start and stop
// time.
import { killTree, killSingle, isAlive, listProcesses } from './proc.mjs';
import { readEntry, removeEntry, listEntries, isEntryLive } from './pidstore.mjs';
import { findRepoDevProcesses } from './sweep.mjs';

const ORCHESTRATOR_PATTERN = /ops[\\/]dev-server[\\/]dev\.mjs/i;

/**
 * Other running `dev.mjs` orchestrator processes (not this one). Stopping
 * every service they manage (via pidstore/sweep) still leaves the
 * orchestrator process itself running as an idle husk - sitting in its
 * keep-alive loop with nothing left to supervise. That's exactly the class
 * of process accumulation this whole system exists to prevent, so both
 * `dev:stop` and `dev.mjs`'s own startup (taking over from a previous,
 * possibly forgotten, instance) need to clean these up too, not just the
 * services underneath them.
 */
export function findOtherOrchestrators() {
  return listProcesses().filter((p) => p.pid !== process.pid && ORCHESTRATOR_PATTERN.test(p.command ?? ''));
}

/**
 * Groups repo-scoped sweep matches by resolved package name, and picks the
 * "root" pid of each match-set via a full ancestor-chain walk (using the
 * COMPLETE process table, not just the matched pids) rather than a
 * single-hop "is ppid also in the matched set" check.
 *
 * The single-hop version looked correct but produced real false positives:
 * pnpm re-shells each package's script through its OWN intermediate
 * `cmd.exe /d /s /c "<script>"` (e.g. `cmd.exe ... "tsc -p tsconfig.json
 * --watch"`) with no repo path or `--filter` text in its command line, so
 * it never matches a sweep signature itself - creating an unmatched "gap"
 * node in the middle of an otherwise perfectly real, single process tree
 * (spawned cmd.exe -> corepack -> [gap cmd.exe] -> tsc). A single-hop check
 * sees tsc's immediate ppid pointing at something outside the matched set
 * and wrongly concludes tsc is a second, independent root - which showed up
 * live during testing as `object-intelligence` reporting "2 instances"
 * when exactly one was ever spawned. Walking the full ancestor chain
 * (matched or not) finds the real matched ancestor on the other side of
 * the gap and correctly treats it as one process tree.
 */
export function groupSweepMatches() {
  const matches = findRepoDevProcesses();
  const byPackage = new Map();
  for (const m of matches) {
    if (!m.matchedPackage) continue;
    if (!byPackage.has(m.matchedPackage)) byPackage.set(m.matchedPackage, []);
    byPackage.get(m.matchedPackage).push(m);
  }
  if (byPackage.size === 0) return new Map();

  const allProcs = listProcesses();
  const ppidOf = new Map(allProcs.map((p) => [p.pid, p.ppid]));

  function hasMatchedAncestor(pid, matchedPidSet, maxHops = 20) {
    let current = ppidOf.get(pid);
    for (let hop = 0; hop < maxHops && current != null; hop++) {
      if (matchedPidSet.has(current)) return true;
      current = ppidOf.get(current);
    }
    return false;
  }

  const result = new Map();
  for (const [pkg, group] of byPackage) {
    const pids = new Set(group.map((g) => g.pid));
    const roots = group.filter((g) => !hasMatchedAncestor(g.pid, pids));
    result.set(pkg, { all: group, roots: roots.length ? roots : group });
  }
  return result;
}

/**
 * For one service: is there already a live, verified pidstore-tracked
 * instance ('tracked'), exactly one untracked-but-running instance safe to
 * adopt rather than restart ('adoptable'), more than one untracked instance
 * ('duplicate' - needs a clean kill-and-restart), or nothing at all
 * ('none').
 */
export function resolveServiceState(service, sweepByPackage) {
  const entry = readEntry(service.shortName);
  if (isEntryLive(entry)) {
    return { status: 'tracked', entry };
  }
  if (entry) removeEntry(service.shortName); // stale pidstore entry, PID reused/dead

  const group = sweepByPackage.get(service.name);
  if (!group || group.roots.length === 0) {
    return { status: 'none' };
  }
  if (group.roots.length === 1) {
    return { status: 'adoptable', roots: group.roots };
  }
  return { status: 'duplicate', roots: group.roots };
}

export function stopEntry(entry) {
  if (entry?.pid && isAlive(entry.pid)) killTree(entry.pid);
  if (entry?.name) removeEntry(entry.name);
}

/**
 * Stops everything this supervisor knows about: every live pidstore entry,
 * PLUS a final repo-wide sweep for anything untracked left running (the
 * safety net for processes started outside `pnpm dev`, or a pidstore entry
 * that went stale mid-session). Returns a report of what was actually
 * stopped for callers to print.
 */
export function stopAll() {
  const stopped = [];

  for (const entry of listEntries()) {
    if (isAlive(entry.pid)) {
      killTree(entry.pid);
      stopped.push({ name: entry.name, pid: entry.pid, source: 'pidstore' });
    }
    removeEntry(entry.name);
  }

  for (const [pkg, group] of groupSweepMatches()) {
    for (const root of group.roots) {
      if (isAlive(root.pid)) {
        killTree(root.pid);
        stopped.push({ name: pkg, pid: root.pid, source: 'sweep' });
      }
    }
  }

  // By this point every real service has already been killed above (via
  // pidstore + sweep), so killSingle vs killTree makes no practical
  // difference here - killSingle is still used for consistency with
  // dev.mjs's takeover path, where the distinction is load-bearing (see
  // proc.mjs's killSingle doc comment).
  for (const orch of findOtherOrchestrators()) {
    killSingle(orch.pid);
    stopped.push({ name: 'dev.mjs orchestrator', pid: orch.pid, source: 'orchestrator' });
  }

  return stopped;
}
