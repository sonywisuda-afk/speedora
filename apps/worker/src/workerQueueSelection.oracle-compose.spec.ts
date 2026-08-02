import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueueName } from '@speedora/shared';
import { parseWorkerQueues } from './workerQueueSelection';

// Oracle Cloud Free hybrid deployment (Fase 3 - Queue Specialization) - locks
// each docker-compose.oracle-worker-{light,ai,render}.yml's WORKER_QUEUES
// value against the real QueueName enum at CI time, not just at container
// boot (env.ts's validateEnv() only catches a typo once something actually
// tries to run that file). Also proves the three files partition all 16
// queues exactly once each - no queue left unassigned to any worker role,
// and no queue double-assigned to two roles, which WORKER_QUEUES' own
// per-process filtering can't detect by itself since each compose file is a
// separate process with no visibility into the others' assignment.
//
// Regex-extracted rather than parsed as YAML - no YAML parser is a
// dependency anywhere in this repo yet, and each file's WORKER_QUEUES line
// is a single fixed-format `WORKER_QUEUES: value` (not env-overridable, see
// those files' own comments on why), so a full parser would be more
// machinery than this needs.
const REPO_ROOT = path.resolve(__dirname, '../../..');

function readWorkerQueuesFromCompose(fileName: string): string {
  const contents = fs.readFileSync(path.join(REPO_ROOT, fileName), 'utf-8');
  const match = /^\s*WORKER_QUEUES:\s*(\S+)\s*$/m.exec(contents);
  if (!match) {
    throw new Error(`Could not find a WORKER_QUEUES line in ${fileName}`);
  }
  return match[1];
}

describe('Oracle worker-specialization compose files (Fase 3)', () => {
  const roles = [
    { file: 'docker-compose.oracle-worker-light.yml', role: 'light' },
    { file: 'docker-compose.oracle-worker-ai.yml', role: 'ai' },
    { file: 'docker-compose.oracle-worker-render.yml', role: 'render' },
  ] as const;

  it.each(roles)('$file has a valid, non-empty WORKER_QUEUES value', ({ file }) => {
    const raw = readWorkerQueuesFromCompose(file);
    expect(() => parseWorkerQueues(raw)).not.toThrow();
    expect(parseWorkerQueues(raw)!.size).toBeGreaterThan(0);
  });

  it('render role is exactly render-clip, alone', () => {
    const raw = readWorkerQueuesFromCompose('docker-compose.oracle-worker-render.yml');
    expect(parseWorkerQueues(raw)).toEqual(new Set([QueueName.RENDER_CLIP]));
  });

  it('ai role is exactly detect-clips and generate-more-clips', () => {
    const raw = readWorkerQueuesFromCompose('docker-compose.oracle-worker-ai.yml');
    expect(parseWorkerQueues(raw)).toEqual(
      new Set([QueueName.DETECT_CLIPS, QueueName.GENERATE_MORE_CLIPS]),
    );
  });

  it('the three roles together cover every QueueName exactly once', () => {
    const sets = roles.map(({ file }) => parseWorkerQueues(readWorkerQueuesFromCompose(file))!);
    const combined = sets.flatMap((set) => [...set]);

    // No duplicates across roles - a queue assigned to two roles would mean
    // two separate worker processes both consuming it, silently doubling
    // its effective concurrency rather than the deliberate 1-consumer-per-
    // queue split Queue Specialization is meant to guarantee.
    expect(new Set(combined).size).toBe(combined.length);

    // Nothing left unassigned - a queue in none of the three roles would
    // never be consumed at all if these three files are the whole
    // deployment (see docker-compose.oracle-worker.yml as the alternative,
    // non-specialized single-VM option, which remains valid on its own).
    expect(new Set(combined)).toEqual(new Set(Object.values(QueueName)));
  });
});
