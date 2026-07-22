// Health checks against docker-compose.yml's postgres/redis/minio services -
// all three define real `healthcheck:` blocks already, so we just read them
// via `docker compose ps` rather than reimplementing readiness probes.
import { execFileSync } from 'node:child_process';
import { repoRoot } from './paths.mjs';

export const INFRA_SERVICES = ['postgres', 'redis', 'minio'];

export function isDockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Returns { [serviceName]: { state, health } } for the requested services. */
export function composeStatus(services = INFRA_SERVICES) {
  let out;
  try {
    out = execFileSync('docker', ['compose', 'ps', '--format', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (err) {
    throw new Error(`docker compose ps failed: ${err.message}`);
  }

  // docker compose ps --format json emits one JSON object per line (not a
  // single array) on the compose v2 versions in use here.
  const rows = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const result = {};
  for (const name of services) {
    const row = rows.find((r) => r.Service === name);
    result[name] = row
      ? { state: row.State, health: row.Health || (row.State === 'running' ? 'n/a' : row.State) }
      : { state: 'missing', health: 'missing' };
  }
  return result;
}

export function isHealthy(status) {
  // A service with no healthcheck reports Health: '' from compose; treat a
  // plain "running" state as acceptable in that case (redis/postgres/minio
  // all define healthchecks so this only matters for services that don't).
  return status.state === 'running' && (status.health === 'healthy' || status.health === 'n/a');
}

export function upDetached() {
  execFileSync('docker', ['compose', 'up', '-d', ...INFRA_SERVICES], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
}

export async function waitForHealthy(services = INFRA_SERVICES, { timeoutMs = 60_000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = composeStatus(services);
    if (services.every((s) => isHealthy(status[s]))) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return composeStatus(services);
}
