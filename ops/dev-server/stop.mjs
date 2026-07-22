#!/usr/bin/env node
// `pnpm dev:stop` - stops every service the pidstore knows about, plus a
// final repo-wide sweep for anything untracked still running. Cross
// platform equivalent of the old .dev-scripts/stop.ps1, but covers web too
// (the old system never did) and needs no separate watchdog-pid dance.
import { stopAll } from './lib/lifecycle.mjs';
import * as log from './lib/log.mjs';

const stopped = stopAll();
if (stopped.length === 0) {
  log.info('nothing was running.');
} else {
  for (const s of stopped) {
    log.ok(`stopped ${s.name} (pid ${s.pid}, via ${s.source})`);
  }
  log.ok(`${stopped.length} process(es) stopped.`);
}
