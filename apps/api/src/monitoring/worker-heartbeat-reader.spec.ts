import { QueueName } from '@speedora/shared';
import { buildWorkerHealthEntry } from './worker-heartbeat-reader';

// parseHeartbeatPayload's own tests moved to
// packages/shared/src/utils/worker-heartbeat.spec.ts as of PR #45
// (Production Metrics Collection) - it's still re-exported from this
// module (see worker-heartbeat-reader.ts's own comment), just implemented
// and tested at its new home.

describe('buildWorkerHealthEntry', () => {
  it('sums job counts across every queue the worker claims', () => {
    const payload = {
      workerId: 'worker-light',
      queues: [QueueName.PROBE_VIDEO, QueueName.TRANSCRIBE],
      startedAt: '2026-08-02T00:00:00.000Z',
    };
    const jobCountsByQueue = new Map([
      [QueueName.PROBE_VIDEO, { active: 1, waiting: 2 }],
      [QueueName.TRANSCRIBE, { active: 3, waiting: 4 }],
    ]);

    expect(buildWorkerHealthEntry(payload, 45, jobCountsByQueue)).toEqual({
      worker: 'worker-light',
      queues: [QueueName.PROBE_VIDEO, QueueName.TRANSCRIBE],
      jobsActive: 4,
      jobsWaiting: 6,
      startedAt: '2026-08-02T00:00:00.000Z',
      heartbeatTtlSeconds: 45,
    });
  });

  it('treats a queue with no known counts as contributing 0', () => {
    const payload = {
      workerId: 'worker-render',
      queues: [QueueName.RENDER_CLIP],
      startedAt: '2026-08-02T00:00:00.000Z',
    };
    const entry = buildWorkerHealthEntry(payload, 45, new Map());
    expect(entry.jobsActive).toBe(0);
    expect(entry.jobsWaiting).toBe(0);
  });
});
