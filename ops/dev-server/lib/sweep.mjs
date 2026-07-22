// Repo-scoped duplicate/orphan detection. This is the secondary safety net
// (the primary mechanism is the exact pidstore check in dev.mjs) - it exists
// for processes that predate this supervisor or were started outside it
// (manual `pnpm --filter X dev` in another terminal, an old session that
// never got a chance to record a pidstore entry, etc.).
//
// Matching is deliberately conservative: every pattern below requires
// either this repo's own absolute path OR an `@speedora/<pkg>` filter
// argument to appear in the command line. Both are effectively unique to
// this repo (`@speedora/*` is this monorepo's own package scope), so a
// completely unrelated Node process - another project, an IDE language
// server, Adobe's background helper, etc. - can never match and is never
// touched. This directly satisfies "terminate only stale duplicates while
// leaving unrelated Node processes untouched."
import { listProcesses } from './proc.mjs';
import { discoverServices } from './workspace.mjs';

const repoRootPattern = /apps[\\/]([^\\/]+)[\\/]|packages[\\/]([^\\/]+)[\\/]/i;

// Generic tool signatures (no --filter argv, e.g. spawned directly rather
// than through a corepack/pnpm wrapper). Deliberately loose (just the tool
// name, not an exact path shape) - the repoRootPattern gate above already
// requires an apps/<x>/ or packages/<x>/ path segment, which makes a false
// positive vanishingly unlikely on its own; over-fitting this regex to one
// exact observed path shape is what caused a real miss during testing
// (`@nestjs\cli\bin\nest.js` didn't match a pattern written for
// `nest\cli\bin\nest`) that would have left `nest start --watch`'s own
// process un-swept - only its child getting caught, orphaning the parent.
const TOOL_SIGNATURES = [/next/i, /nest/i, /tsx/i, /tsc\b/i, /dist[\\/]main/i, /start-server/i];

const FILTER_PATTERN = /--filter\s+(@speedora\/[a-z0-9-]+)/i;

let shortNameToFullName = null;
function resolveFullName(shortName) {
  if (!shortNameToFullName) {
    shortNameToFullName = new Map(discoverServices().map((s) => [s.shortName, s.name]));
  }
  return shortNameToFullName.get(shortName) ?? null;
}

/**
 * Returns every currently-running process that looks like it belongs to
 * this repo's dev tooling: { pid, command, matchedPackage } where
 * matchedPackage is the @speedora/* name whenever it can be determined
 * (from either a `--filter` argument or an apps/<x>|packages/<x> path
 * segment), so callers can group an entire wrapper -> tool process chain
 * under one service key regardless of how many layers deep it is.
 */
export function findRepoDevProcesses() {
  const all = listProcesses();
  const matches = [];

  for (const proc of all) {
    if (!proc.command) continue;

    const filterMatch = proc.command.match(FILTER_PATTERN);
    if (filterMatch) {
      matches.push({ pid: proc.pid, ppid: proc.ppid, command: proc.command, matchedPackage: filterMatch[1] });
      continue;
    }

    const pathMatch = proc.command.match(repoRootPattern);
    if (pathMatch && TOOL_SIGNATURES.some((re) => re.test(proc.command))) {
      const shortName = pathMatch[1] ?? pathMatch[2];
      matches.push({
        pid: proc.pid,
        ppid: proc.ppid,
        command: proc.command,
        matchedPackage: resolveFullName(shortName),
      });
    }
  }

  return matches;
}
