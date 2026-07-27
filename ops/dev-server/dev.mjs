#!/usr/bin/env node
// The single entrypoint behind `pnpm dev`. Replaces both the old
// concurrently-based root script (which hardcoded a package list that had
// already drifted out of date - see workspace.mjs) and the separate
// .dev-scripts/ PowerShell watchdog system (see watchdog.ps1's deprecation
// banner for that migration's history).
//
// Startup sequence, every single run, unconditionally: sweep for
// stale/duplicate processes -> verify Docker infra is healthy -> verify
// ports -> spawn/reuse/adopt each service -> readiness check -> attach
// signal handlers. Running this twice in a row, or after a previous run
// died without cleaning up, never produces duplicates - see
// lifecycle.mjs's resolveServiceState for the exact reused/adopted/
// duplicate/none decision.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from './lib/paths.mjs';
import { discoverServices } from './lib/workspace.mjs';
import {
  groupSweepMatches,
  resolveServiceState,
  stopEntry,
  findOtherOrchestrators,
} from './lib/lifecycle.mjs';
import { writeEntry, removeEntry } from './lib/pidstore.mjs';
import {
  killTree,
  killSingle,
  isAlive,
  verifyProcessAlive,
  portInUse,
  findPidsOnPort,
} from './lib/proc.mjs';
import {
  isDockerAvailable,
  composeStatus,
  isHealthy,
  upDetached,
  waitForHealthy,
  INFRA_SERVICES,
} from './lib/docker.mjs';
import { getNpmPrefix, isOnPath } from './lib/npmpath.mjs';
import * as log from './lib/log.mjs';

const args = process.argv.slice(2);
const FORCE_RESTART = args.includes('--restart') || args.includes('--fresh');
const SUPERVISE = args.includes('--supervise');

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const COOLDOWN_MS = 300_000;

let shuttingDown = false;
const active = new Map(); // shortName -> { pid, child|null, service, verifyFragment }

async function preflightDocker() {
  if (!isDockerAvailable()) {
    log.error('Docker does not appear to be running - start Docker Desktop and re-run `pnpm dev`.');
    process.exit(1);
  }
  let status = composeStatus(INFRA_SERVICES);
  const allHealthy = INFRA_SERVICES.every((s) => isHealthy(status[s]));
  if (allHealthy) {
    log.ok(`docker infra healthy: ${INFRA_SERVICES.join(', ')}`);
    return;
  }
  log.warn(
    `docker infra not all healthy yet (${JSON.stringify(status)}) - running docker compose up -d`,
  );
  upDetached();
  status = await waitForHealthy(INFRA_SERVICES, { timeoutMs: 60_000 });
  const nowHealthy = INFRA_SERVICES.every((s) => isHealthy(status[s]));
  if (!nowHealthy) {
    log.error(`docker infra still not healthy after 60s: ${JSON.stringify(status)}`);
    process.exit(1);
  }
  log.ok('docker infra healthy');
}

function preflightPath() {
  const prefix = getNpmPrefix();
  if (prefix && !isOnPath(prefix)) {
    log.warn(`pnpm's global install dir (${prefix}) is not on PATH - bare \`pnpm\` won't resolve.`);
    log.warn('Run `pnpm run setup:path` once (then open a new terminal) to fix this permanently.');
    log.warn('Falling back to `corepack pnpm`, which works regardless, for this run.');
  }
}

function spawnService(service) {
  const command = `corepack pnpm --filter ${service.name} run ${service.script}`;
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });

  child.stdout.on('data', (buf) =>
    process.stdout.write(log.line(service.shortName, '') + ' ' + buf),
  );
  child.stderr.on('data', (buf) =>
    process.stderr.write(log.line(service.shortName, '') + ' ' + buf),
  );

  return child;
}

function commandFragmentFor(service) {
  return `--filter ${service.name}`;
}

function recordEntry(service, pid) {
  writeEntry(service.shortName, {
    pid,
    port: service.port,
    role: service.group,
    commandFragment: commandFragmentFor(service),
    startedAt: new Date().toISOString(),
  });
}

/**
 * Re-verifies a tracked `active` entry is still the same live process, using
 * whatever command-line signature was captured for it at settle time (see
 * `verifyFragment` on the values stored into `active`). Deliberately NOT a
 * fixed `--filter <name>` fragment for every entry: a sweep-adopted "root"
 * candidate can legitimately be a bare `tsc --watch` grandchild whose own
 * command line never contains `--filter` (pnpm re-shells through an
 * intermediate cmd.exe that loses it - see lifecycle.mjs's groupSweepMatches
 * doc comment) even though it's a perfectly healthy instance of the service.
 * Using the exact line captured for THIS candidate, whatever shape it is,
 * avoids false-failing that case while still catching real PID reuse
 * (an unrelated process's command line won't contain the old one) and dead/
 * zombie PIDs (verifyProcessAlive rejects both).
 */
function verifyEntry(entry) {
  return verifyProcessAlive(entry.pid, entry.verifyFragment);
}

function restartTracker() {
  const timestamps = [];
  let cooldownUntil = 0;
  return {
    shouldCooldown() {
      return Date.now() < cooldownUntil;
    },
    recordAndCheck() {
      const now = Date.now();
      timestamps.push(now);
      while (timestamps.length && timestamps[0] < now - RESTART_WINDOW_MS) timestamps.shift();
      if (timestamps.length > MAX_RESTARTS) {
        cooldownUntil = now + COOLDOWN_MS;
        timestamps.length = 0;
        return true; // tripped
      }
      return false;
    },
  };
}

function attachSupervision(service) {
  const tracker = restartTracker();

  const launch = () => {
    const child = spawnService(service);
    active.set(service.shortName, {
      pid: child.pid,
      child,
      service,
      verifyFragment: commandFragmentFor(service),
    });
    recordEntry(service, child.pid);

    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      log.warn(`${service.shortName} exited (code=${code} signal=${signal})`);
      if (!SUPERVISE) return;

      if (tracker.shouldCooldown()) {
        log.warn(`${service.shortName} is in crash-loop cooldown - not restarting yet`);
        return;
      }
      if (tracker.recordAndCheck()) {
        log.error(
          `${service.shortName} crashed more than ${MAX_RESTARTS} times in ${RESTART_WINDOW_MS / 1000}s - ` +
            `backing off for ${COOLDOWN_MS / 1000}s`,
        );
        setTimeout(launch, COOLDOWN_MS);
        return;
      }
      log.info(`--supervise: restarting ${service.shortName}`);
      launch();
    });
  };

  launch();
}

async function settleService(service, sweepByPackage) {
  const state = resolveServiceState(service, sweepByPackage);

  if (state.status === 'tracked' && !FORCE_RESTART) {
    log.ok(`${service.shortName}: already running (pid ${state.entry.pid}) - reusing`);
    active.set(service.shortName, {
      pid: state.entry.pid,
      child: null,
      service,
      verifyFragment: state.entry.commandFragment,
    });
    return;
  }

  if (state.status === 'adoptable' && !FORCE_RESTART) {
    const root = state.roots[0];
    if (verifyProcessAlive(root.pid, root.command)) {
      log.ok(
        `${service.shortName}: found an existing untracked instance (pid ${root.pid}) - adopting it`,
      );
      recordEntry(service, root.pid);
      active.set(service.shortName, {
        pid: root.pid,
        child: null,
        service,
        verifyFragment: root.command,
      });
      return;
    }
    log.warn(
      `${service.shortName}: candidate pid ${root.pid} failed verification (dead, zombie, or PID reused since ` +
        'the sweep) - spawning a fresh instance instead',
    );
    // Deliberately no `return` here: falls through to the kill+spawn path
    // below, which already treats `state.roots` (this same dead pid) as
    // something to clean up before spawning fresh.
  }

  const rootsToKill = state.status === 'tracked' ? [{ pid: state.entry.pid }] : (state.roots ?? []);
  if (rootsToKill.length > 0) {
    const reason =
      state.status === 'duplicate'
        ? 'stale duplicate(s)'
        : state.status === 'adoptable'
          ? 'failed verification'
          : 'restart requested';
    log.warn(
      `${service.shortName}: stopping ${rootsToKill.length} existing process(es) (${reason})`,
    );
    for (const r of rootsToKill) killTree(r.pid);
  }

  if (service.kind === 'http' && service.port) {
    if (await portInUse(service.port)) {
      const owners = findPidsOnPort(service.port).filter(
        (pid) => !rootsToKill.some((r) => r.pid === pid),
      );
      if (owners.length > 0) {
        log.error(
          `${service.shortName}: port ${service.port} is occupied by an unrelated process (pid ${owners.join(
            ', ',
          )}) - not touching it. Free the port manually or set a different port and retry.`,
        );
        return;
      }
    }
  }

  spawnAndTrack(service);
}

/** Spawns `service` fresh and records it in both `active` and the pidstore. */
function spawnAndTrack(service) {
  if (SUPERVISE) {
    attachSupervision(service);
    return;
  }

  const child = spawnService(service);
  active.set(service.shortName, {
    pid: child.pid,
    child,
    service,
    verifyFragment: commandFragmentFor(service),
  });
  recordEntry(service, child.pid);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) log.warn(`${service.shortName} exited (code=${code} signal=${signal})`);
  });
}

async function waitReady(service) {
  if (service.kind === 'http' && service.port) {
    // Generous timeout: a cold start compiles all ~30 packages plus
    // web/api/worker simultaneously (observed pegging CPU at ~99% on a
    // typical dev laptop), which is much heavier than steady-state
    // incremental rebuilds - 45s was measured to be too short and produced
    // a false "not ready" while api was still legitimately compiling.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await portInUse(service.port)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }
  // 'log' and 'background' kinds: no reliable external readiness signal to
  // poll (worker's own readyPattern would require capturing stdout, which
  // adopted/reused instances don't give us access to) - just confirm alive.
  const entry = active.get(service.shortName);
  return entry ? isAlive(entry.pid) : false;
}

function installShutdownHandlers() {
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down - stopping all services...');
    for (const { pid, service } of active.values()) {
      if (isAlive(pid)) killTree(pid);
      stopEntry({ name: service.shortName, pid });
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
}

function takeOverFromOtherOrchestrators() {
  const others = findOtherOrchestrators();
  if (others.length === 0) return;
  log.warn(
    `found ${others.length} other running dev.mjs instance(s) (pid ${others.map((o) => o.pid).join(', ')}) - ` +
      'taking over (their supervised services are left running and adopted below, not restarted)',
  );
  // killSingle, deliberately NOT killTree: the other orchestrator's
  // children are the actual healthy dev servers we want to KEEP and adopt
  // via the pidstore/sweep checks right after this - tree-killing it would
  // take its whole subtree down too, restarting everything for no reason.
  for (const o of others) killSingle(o.pid);
}

async function main() {
  log.info(`Speedora dev supervisor - repo: ${repoRoot}`);
  if (FORCE_RESTART) log.info('--restart: forcing a clean restart of every service');
  if (SUPERVISE) log.info('--supervise: crash-restart enabled for freshly spawned services');

  takeOverFromOtherOrchestrators();
  await preflightDocker();
  preflightPath();

  const services = discoverServices();
  const sweepByPackage = groupSweepMatches();

  for (const service of services) {
    await settleService(service, sweepByPackage);
  }

  log.info('waiting for web/api to accept connections...');
  const readiness = await Promise.all(
    services
      .filter((s) => s.kind === 'http')
      .map(async (s) => ({ name: s.shortName, ok: await waitReady(s) })),
  );
  for (const r of readiness) {
    (r.ok ? log.ok : log.error)(`${r.name}: ${r.ok ? 'ready' : 'did not become ready within 45s'}`);
  }

  await verifyAndRespawnDeadServices(services);

  log.ok(`${active.size}/${services.length} services running. Press Ctrl+C to stop everything.`);
  installShutdownHandlers();

  // Keep the event loop alive even if every service was reused/adopted
  // (i.e. nothing we spawned ourselves is holding stdio open), and
  // periodically notice if something we're tracking died outside our
  // control. Uses the same PID+cmdline identity check as adoption, not a
  // bare isAlive() - otherwise a recycled PID now belonging to an unrelated
  // process would be misreported as "still running".
  setInterval(() => {
    for (const [name, entry] of active) {
      if (!verifyEntry(entry)) {
        log.warn(`${name} (pid ${entry.pid}) is no longer running`);
        active.delete(name);
      }
    }
  }, 10_000);
}

/**
 * A second-pass liveness+identity re-check of every settled service,
 * immediately before the startup summary is printed - and an immediate
 * respawn of anything that fails it, so the summary reflects reality rather
 * than a stale snapshot.
 *
 * This exists because a real run showed ~20 sweep-adopted services logged
 * as "adopting it" and counted in "N/N services running", only to be
 * reported dead by the very next 10s health tick: the sweep's process
 * snapshot can catch a candidate mid-teardown, where isAlive() briefly
 * still returns true before the OS finishes reclaiming the PID. A short
 * settle delay plus a real re-verification (PID alive AND live command line
 * still matches, not just "something responded to signal 0") catches that
 * before it's ever reported as a success.
 */
async function verifyAndRespawnDeadServices(services) {
  // Let anything mid-teardown at settle time actually finish dying before
  // re-checking - re-verifying immediately would just race the same
  // condition that caused the false "adopted" read in the first place.
  await new Promise((r) => setTimeout(r, 2000));

  const dead = [...active.entries()].filter(([, entry]) => !verifyEntry(entry));
  if (dead.length === 0) return;

  const servicesByShortName = new Map(services.map((s) => [s.shortName, s]));
  for (const [name, entry] of dead) {
    log.warn(
      `${name}: pid ${entry.pid} did not survive verification (dead/zombie/PID reused) - respawning`,
    );
    active.delete(name);
    removeEntry(name);
    spawnAndTrack(servicesByShortName.get(name));
  }

  const respawnedHttp = dead
    .map(([name]) => servicesByShortName.get(name))
    .filter((s) => s.kind === 'http');
  const readiness = await Promise.all(
    respawnedHttp.map(async (s) => ({ name: s.shortName, ok: await waitReady(s) })),
  );
  for (const r of readiness) {
    (r.ok ? log.ok : log.error)(
      `${r.name}: ${r.ok ? 'ready (respawned)' : 'did not become ready after respawn'}`,
    );
  }
}

main().catch((err) => {
  log.error(err.stack ?? String(err));
  process.exit(1);
});
