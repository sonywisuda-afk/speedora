#!/usr/bin/env node
// `pnpm dev:status` - cross-platform equivalent of the old
// .dev-scripts/status.ps1, extended to cover every discovered service (not
// just api/worker) and to also report Docker infra + port ownership.
import { discoverServices } from './lib/workspace.mjs';
import { groupSweepMatches, resolveServiceState } from './lib/lifecycle.mjs';
import { portInUse } from './lib/proc.mjs';
import { composeStatus, isHealthy, INFRA_SERVICES, isDockerAvailable } from './lib/docker.mjs';
import * as log from './lib/log.mjs';

async function main() {
  log.info('docker infra:');
  if (!isDockerAvailable()) {
    log.error('  docker not reachable');
  } else {
    const status = composeStatus(INFRA_SERVICES);
    for (const name of INFRA_SERVICES) {
      const s = status[name];
      const healthy = isHealthy(s);
      console.log(`  ${name}: ${s.state} / ${s.health}${healthy ? '' : '  <-- not healthy'}`);
    }
  }

  console.log('');
  log.info('services:');
  const services = discoverServices();
  const sweepByPackage = groupSweepMatches();

  for (const service of services) {
    const state = resolveServiceState(service, sweepByPackage);
    let statusText;
    switch (state.status) {
      case 'tracked':
        statusText = `running (pid ${state.entry.pid})`;
        break;
      case 'adoptable':
        statusText = `running, untracked (pid ${state.roots[0].pid}) - will be adopted by \`pnpm dev\``;
        break;
      case 'duplicate':
        statusText = `DUPLICATE - ${state.roots.length} instances (pids ${state.roots.map((r) => r.pid).join(', ')})`;
        break;
      default:
        statusText = 'not running';
    }

    let portText = '';
    if (service.port) {
      const inUse = await portInUse(service.port);
      portText = `  port ${service.port}: ${inUse ? 'in use' : 'free'}`;
    }
    console.log(`  ${service.shortName} (${service.group}): ${statusText}${portText}`);
  }
}

main();
