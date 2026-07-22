// Discovers every dev-able workspace package instead of hand-maintaining a
// list. The list this replaces (root package.json's old `dev` script) had
// drifted: 5 packages added since (analytics-report, platform-fit,
// report-builder, seo-copy, thumbnail-selection) were never added to it and
// so never ran in watch mode under `pnpm dev` at all. Auto-discovery means
// a new package with a "dev" script is picked up automatically the next
// time `pnpm dev` runs - no one has to remember to edit an orchestrator
// script when adding a package.
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './paths.mjs';

// Per-app behavior that can't be inferred generically: which script to run
// (api's watch script is "start:dev", not "dev"), what port it binds (if
// any), and how to tell it's actually ready.
const APP_OVERRIDES = {
  '@speedora/web': {
    script: 'dev',
    port: 3000,
    kind: 'http',
  },
  '@speedora/api': {
    script: 'start:dev',
    port: Number(process.env.API_PORT) || 3001,
    kind: 'http',
  },
  '@speedora/worker': {
    script: 'dev',
    port: null,
    kind: 'log',
    readyPattern: /worker started/i,
  },
};

function readPackageJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function scanGroup(groupDir, group) {
  const base = path.join(repoRoot, groupDir);
  let names;
  try {
    names = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }

  const services = [];
  for (const dirent of names) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(base, dirent.name);
    const pkg = readPackageJson(dir);
    if (!pkg?.name) continue;

    const override = APP_OVERRIDES[pkg.name];
    const script = override?.script ?? 'dev';
    if (!pkg.scripts?.[script]) continue; // nothing to run for this package

    services.push({
      name: pkg.name,
      shortName: dirent.name,
      cwd: dir,
      script,
      group, // 'package' | 'app'
      port: override?.port ?? null,
      kind: override?.kind ?? 'background',
      readyPattern: override?.readyPattern ?? null,
    });
  }
  return services;
}

/**
 * Ordered so package watch-builders (shared libs consumed by the apps)
 * start before the apps that import them - matches the old concurrently
 * script's ordering intent, though pnpm/tsc project references tolerate
 * either order in practice.
 */
export function discoverServices() {
  const packages = scanGroup('packages', 'package').sort((a, b) => a.name.localeCompare(b.name));
  const apps = scanGroup('apps', 'app').sort((a, b) => a.name.localeCompare(b.name));
  return [...packages, ...apps];
}
