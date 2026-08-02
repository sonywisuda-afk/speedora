import { QueueName } from '@speedora/shared';
import { buildWorkerHealthEntry, parseHeartbeatPayload } from './worker-heartbeat-reader';

describe('parseHeartbeatPayload', () => {
  it('returns null for null/empty input', () => {
    expect(parseHeartbeatPayload(null)).toBeNull();
    expect(parseHeartbeatPayload('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseHeartbeatPayload('not json')).toBeNull();
  });

  it('returns null when required fields are missing or the wrong type', () => {
    expect(parseHeartbeatPayload(JSON.stringify({ workerId: 'w1' }))).toBeNull();
    expect(
      parseHeartbeatPayload(JSON.stringify({ workerId: 1, queues: [], startedAt: 'x' })),
    ).toBeNull();
    expect(
      parseHeartbeatPayload(
        JSON.stringify({ workerId: 'w1', queues: 'not-an-array', startedAt: 'x' }),
      ),
    ).toBeNull();
  });

  it('parses a valid payload', () => {
    const raw = JSON.stringify({
      workerId: 'worker-render',
      queues: [QueueName.RENDER_CLIP],
      startedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(parseHeartbeatPayload(raw)).toEqual({
      workerId: 'worker-render',
      queues: [QueueName.RENDER_CLIP],
      startedAt: '2026-08-02T00:00:00.000Z',
    });
  });
});

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
