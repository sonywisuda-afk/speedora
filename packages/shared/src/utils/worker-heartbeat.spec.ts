import { QueueName } from '../types/job';
import { heartbeatKey, heartbeatKeyPattern, parseHeartbeatPayload } from './worker-heartbeat';

describe('heartbeatKey / heartbeatKeyPattern', () => {
  it('namespaces a worker id under the shared prefix', () => {
    expect(heartbeatKey('worker-render')).toBe('speedora:worker:heartbeat:worker-render');
  });

  it('produces distinct keys for distinct worker ids', () => {
    expect(heartbeatKey('worker-a')).not.toBe(heartbeatKey('worker-b'));
  });

  it('produces a pattern that matches every key heartbeatKey() can produce', () => {
    const pattern = heartbeatKeyPattern();
    const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
    expect(regex.test(heartbeatKey('worker-render'))).toBe(true);
    expect(regex.test(heartbeatKey('worker-light-01'))).toBe(true);
  });

  it('the pattern does not match an unrelated key', () => {
    const pattern = heartbeatKeyPattern();
    const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
    expect(regex.test('speedora:video-import:total')).toBe(false);
  });
});

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
