#!/usr/bin/env node
// `pnpm doctor` (`pnpm doctor:fix` for --fix). One command that answers
// "is my local dev environment actually set up correctly", covering every
// piece that contributed to the 2026-07-22 "app won't start" incident:
// pnpm-not-on-PATH, Docker infra health, port conflicts, and stale
// workspace deps, plus baseline Node/pnpm version checks.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib/paths.mjs';
import { getNpmPrefix, isOnPath, fixPath } from './lib/npmpath.mjs';
import { isDockerAvailable, composeStatus, isHealthy, upDetached, waitForHealthy, INFRA_SERVICES } from './lib/docker.mjs';
import { portInUse, findPidsOnPort, killTree } from './lib/proc.mjs';
import { discoverServices } from './lib/workspace.mjs';
import * as log from './lib/log.mjs';

const FIX = process.argv.includes('--fix');
const results = []; // { name, status: 'pass'|'warn'|'fail', detail, fixed? }

function report(name, status, detail) {
  results.push({ name, status, detail });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkPnpm() {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const pinned = pkg.packageManager?.split('@')[1];
  let corepackVersion = null;
  try {
    corepackVersion = execFileSync('corepack', ['pnpm', '--version'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32', // corepack.cmd requires cmd.exe on Windows
    }).trim();
  } catch {
    report('pnpm installation', 'fail', 'corepack could not run pnpm at all - check Node/corepack installation');
    return;
  }

  const onPath = (() => {
    try {
      // `where`/`which` are themselves native executables, not shell
      // built-ins - no shell wrapping needed on either platform.
      execFileSync(process.platform === 'win32' ? 'where' : 'which', ['pnpm'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  if (corepackVersion !== pinned) {
    report('pnpm installation', 'warn', `corepack resolves pnpm@${corepackVersion}, package.json pins @${pinned}`);
  } else if (!onPath) {
    report('pnpm installation', 'warn', `pnpm@${corepackVersion} works via corepack, but bare \`pnpm\` is not on PATH`);
  } else {
    report('pnpm installation', 'pass', `pnpm@${corepackVersion}, resolves on PATH`);
  }
}

function checkPath() {
  const prefix = getNpmPrefix();
  if (!prefix) {
    report('PATH', 'warn', 'could not determine npm prefix');
    return;
  }
  if (isOnPath(prefix)) {
    report('PATH', 'pass', `npm global prefix (${prefix}) is on PATH`);
    return;
  }
  if (FIX) {
    const result = fixPath(prefix);
    report('PATH', result.changed ? 'pass' : 'warn', `${result.reason} - open a NEW terminal for this to take effect`);
  } else {
    report('PATH', 'warn', `npm global prefix (${prefix}) is NOT on PATH - run \`pnpm doctor:fix\` to fix permanently`);
  }
}

function checkNode() {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const required = pkg.engines?.node?.match(/(\d+)/)?.[1];
  const actual = process.versions.node.split('.')[0];
  if (required && Number(actual) < Number(required)) {
    report('Node version', 'fail', `running Node ${process.versions.node}, requires >= ${required}`);
  } else {
    report('Node version', 'pass', `Node ${process.versions.node} (requires >= ${required ?? '?'})`);
  }
}

async function checkDocker() {
  if (!isDockerAvailable()) {
    report('Docker daemon', 'fail', 'not reachable - is Docker Desktop running?');
    for (const name of INFRA_SERVICES) report(name, 'fail', 'skipped - Docker not reachable');
    return;
  }
  report('Docker daemon', 'pass', 'reachable');

  let status = composeStatus(INFRA_SERVICES);
  const unhealthy = INFRA_SERVICES.filter((s) => !isHealthy(status[s]));
  if (unhealthy.length > 0 && FIX) {
    log.info(`starting/repairing: ${unhealthy.join(', ')}`);
    upDetached();
    status = await waitForHealthy(INFRA_SERVICES, { timeoutMs: 60_000 });
  }
  for (const name of INFRA_SERVICES) {
    const s = status[name];
    report(name, isHealthy(s) ? 'pass' : 'fail', `${s.state} / ${s.health}`);
  }
}

async function checkPorts() {
  const services = discoverServices().filter((s) => s.kind === 'http');
  for (const service of services) {
    const inUse = await portInUse(service.port);
    if (!inUse) {
      report(`port ${service.port} (${service.shortName})`, 'pass', 'free');
      continue;
    }
    const owners = findPidsOnPort(service.port);
    report(`port ${service.port} (${service.shortName})`, 'warn', `in use by pid(s) ${owners.join(', ') || '?'}`);
  }
}

function checkWorkspaceDeps() {
  const rootModules = path.join(repoRoot, 'node_modules');
  if (!fs.existsSync(rootModules)) {
    if (FIX) {
      log.info('running `corepack pnpm install`...');
      try {
        execFileSync('corepack', ['pnpm', 'install'], {
          cwd: repoRoot,
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
        report('workspace dependencies', 'pass', 'installed via corepack pnpm install');
        return;
      } catch (err) {
        report('workspace dependencies', 'fail', `install failed: ${err.message}`);
        return;
      }
    }
    report('workspace dependencies', 'fail', 'root node_modules missing - run `pnpm doctor:fix` or `pnpm install`');
    return;
  }

  const services = discoverServices();
  const missing = services.filter((s) => !fs.existsSync(path.join(s.cwd, 'node_modules')) && s.group !== 'package');
  // packages/* commonly rely on the hoisted root node_modules only; apps
  // typically have their own too. Only flag apps missing node_modules as a
  // hard signal.
  if (missing.length > 0) {
    report('workspace dependencies', 'warn', `missing node_modules in: ${missing.map((s) => s.shortName).join(', ')}`);
  } else {
    report('workspace dependencies', 'pass', `${services.length} workspace packages resolved`);
  }
}

function printReport() {
  console.log('');
  const icon = { pass: '✓', warn: '!', fail: '✗' };
  const color = { pass: 32, warn: 33, fail: 31 };
  for (const r of results) {
    console.log(`\x1b[${color[r.status]}m${icon[r.status]}\x1b[0m ${r.name}: ${r.detail}`);
  }
  console.log('');
  const failed = results.filter((r) => r.status === 'fail');
  const warned = results.filter((r) => r.status === 'warn');
  if (failed.length) {
    log.error(`${failed.length} check(s) failed, ${warned.length} warning(s).`);
    process.exitCode = 1;
  } else if (warned.length) {
    log.warn(`all critical checks passed, ${warned.length} warning(s).`);
  } else {
    log.ok('all checks passed.');
  }
}

async function main() {
  log.info(`pnpm doctor${FIX ? ' --fix' : ''}`);
  checkPnpm();
  checkPath();
  checkNode();
  await checkDocker();
  await checkPorts();
  checkWorkspaceDeps();
  printReport();
}

main();
