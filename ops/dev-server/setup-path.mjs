#!/usr/bin/env node
// `pnpm setup:path` - standalone one-shot version of doctor.mjs's PATH fix,
// for when you just want the PATH problem gone without running every other
// doctor check.
import { getNpmPrefix, isOnPath, fixPath } from './lib/npmpath.mjs';
import * as log from './lib/log.mjs';

const prefix = getNpmPrefix();
if (!prefix) {
  log.error('could not determine npm prefix (`npm config get prefix` failed)');
  process.exit(1);
}

if (isOnPath(prefix)) {
  log.ok(`${prefix} is already on PATH - nothing to do.`);
  process.exit(0);
}

const result = fixPath(prefix);
if (result.changed) {
  log.ok(result.reason);
  log.warn('Open a NEW terminal for this to take effect (already-running shells keep their old PATH).');
} else {
  log.warn(result.reason);
}
