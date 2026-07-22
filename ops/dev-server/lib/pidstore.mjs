// Tracks the processes THIS supervisor has started, under .dev/pids/*.json
// (gitignored - machine-specific, like the old .dev-scripts/*.pid it
// replaces). This is the primary, exact mechanism idempotency and
// duplicate-prevention are built on: before starting a service, dev.mjs
// checks here first. The heuristic repo-wide process sweep (workspace.mjs +
// dev.mjs's sweepOrphans) is only a secondary safety net for processes that
// predate this pidstore or were started outside it.
import fs from 'node:fs';
import path from 'node:path';
import { pidDir } from './paths.mjs';
import { isAlive, commandOf } from './proc.mjs';

function entryPath(name) {
  return path.join(pidDir, `${name}.json`);
}

export function writeEntry(name, entry) {
  fs.mkdirSync(pidDir, { recursive: true });
  fs.writeFileSync(entryPath(name), JSON.stringify({ name, ...entry }, null, 2));
}

export function readEntry(name) {
  try {
    return JSON.parse(fs.readFileSync(entryPath(name), 'utf8'));
  } catch {
    return null;
  }
}

export function removeEntry(name) {
  try {
    fs.unlinkSync(entryPath(name));
  } catch {
    // already gone
  }
}

export function listEntries() {
  let files;
  try {
    files = fs.readdirSync(pidDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => readEntry(f.replace(/\.json$/, '')))
    .filter(Boolean);
}

/**
 * A pidstore entry is only trusted as "alive and ours" if the PID exists
 * AND its live command line still contains the fragment we recorded at
 * spawn time. The second check matters on Windows, where PIDs get reused
 * across reboots - without it, a stale entry could point at an unrelated
 * process that happens to have been assigned the same PID after a restart,
 * and we'd wrongly treat it as "our service, already running".
 */
export function isEntryLive(entry) {
  if (!entry || !isAlive(entry.pid)) return false;
  if (!entry.commandFragment) return true;
  const live = commandOf(entry.pid);
  return Boolean(live && live.includes(entry.commandFragment));
}
