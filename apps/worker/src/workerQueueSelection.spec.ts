import { QueueName } from '@speedora/shared';
import {
  InvalidWorkerQueuesError,
  isQueueEnabled,
  parseWorkerQueues,
} from './workerQueueSelection';

describe('parseWorkerQueues', () => {
  it('returns null when unset (every queue runs, pre-Fase-2 behavior)', () => {
    expect(parseWorkerQueues(undefined)).toBeNull();
  });

  it('returns null when set to an empty/whitespace-only string', () => {
    expect(parseWorkerQueues('')).toBeNull();
    expect(parseWorkerQueues('   ')).toBeNull();
  });

  it('parses a single queue name', () => {
    const result = parseWorkerQueues('render-clip');
    expect(result).toEqual(new Set([QueueName.RENDER_CLIP]));
  });

  it('parses a comma-separated list, trimming whitespace around each name', () => {
    const result = parseWorkerQueues(' render-clip , detect-clips ,probe-video');
    expect(result).toEqual(
      new Set([QueueName.RENDER_CLIP, QueueName.DETECT_CLIPS, QueueName.PROBE_VIDEO]),
    );
  });

  it('ignores empty entries from stray commas', () => {
    const result = parseWorkerQueues('render-clip,,detect-clips,');
    expect(result).toEqual(new Set([QueueName.RENDER_CLIP, QueueName.DETECT_CLIPS]));
  });

  it('throws InvalidWorkerQueuesError naming the bad value on an unknown queue name', () => {
    expect(() => parseWorkerQueues('render-clip,not-a-real-queue')).toThrow(
      InvalidWorkerQueuesError,
    );
    expect(() => parseWorkerQueues('render-clip,not-a-real-queue')).toThrow(/not-a-real-queue/);
  });

  it('throws when every entry is invalid', () => {
    expect(() => parseWorkerQueues('bogus')).toThrow(InvalidWorkerQueuesError);
  });
});

describe('isQueueEnabled', () => {
  it('treats null (unset WORKER_QUEUES) as every queue enabled', () => {
    expect(isQueueEnabled(QueueName.RENDER_CLIP, null)).toBe(true);
    expect(isQueueEnabled(QueueName.TRANSCRIBE, null)).toBe(true);
  });

  it('returns true only for queues present in the enabled set', () => {
    const enabled = new Set([QueueName.RENDER_CLIP]);
    expect(isQueueEnabled(QueueName.RENDER_CLIP, enabled)).toBe(true);
    expect(isQueueEnabled(QueueName.TRANSCRIBE, enabled)).toBe(false);
  });
});
