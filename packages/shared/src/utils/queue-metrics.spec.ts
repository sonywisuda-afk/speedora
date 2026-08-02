import {
  computeAvgProcessingTimeMs,
  computeAvgQueueWaitMs,
  computeFailureRate,
  countRetriedJobs,
  type JobSample,
} from './queue-metrics';

describe('computeFailureRate', () => {
  it('returns null when there is no completed or failed data', () => {
    expect(computeFailureRate(0, 0)).toBeNull();
  });

  it('computes failed / (failed + completed)', () => {
    expect(computeFailureRate(1, 3)).toBe(0.25);
    expect(computeFailureRate(0, 10)).toBe(0);
    expect(computeFailureRate(10, 0)).toBe(1);
  });
});

describe('computeAvgProcessingTimeMs', () => {
  it('returns null for an empty sample', () => {
    expect(computeAvgProcessingTimeMs([])).toBeNull();
  });

  it('returns null when no job in the sample has both timestamps', () => {
    const sample: JobSample[] = [
      { processedOn: undefined, finishedOn: undefined, attemptsMade: 1 },
      { processedOn: 100, finishedOn: undefined, attemptsMade: 1 },
    ];
    expect(computeAvgProcessingTimeMs(sample)).toBeNull();
  });

  it('averages finishedOn - processedOn across the sample', () => {
    const sample: JobSample[] = [
      { processedOn: 1000, finishedOn: 3000, attemptsMade: 1 }, // 2000ms
      { processedOn: 5000, finishedOn: 9000, attemptsMade: 1 }, // 4000ms
    ];
    expect(computeAvgProcessingTimeMs(sample)).toBe(3000);
  });

  it('ignores jobs missing either timestamp rather than treating them as 0', () => {
    const sample: JobSample[] = [
      { processedOn: 1000, finishedOn: 3000, attemptsMade: 1 }, // 2000ms
      { processedOn: undefined, finishedOn: 9000, attemptsMade: 1 },
    ];
    expect(computeAvgProcessingTimeMs(sample)).toBe(2000);
  });
});

describe('computeAvgQueueWaitMs', () => {
  it('returns null for an empty sample', () => {
    expect(computeAvgQueueWaitMs([])).toBeNull();
  });

  it('returns null when no job in the sample has both timestamps', () => {
    const sample: JobSample[] = [
      { timestamp: undefined, processedOn: undefined, attemptsMade: 1 },
      { timestamp: 100, processedOn: undefined, attemptsMade: 1 },
    ];
    expect(computeAvgQueueWaitMs(sample)).toBeNull();
  });

  it('averages processedOn - timestamp across the sample', () => {
    const sample: JobSample[] = [
      { timestamp: 1000, processedOn: 1500, attemptsMade: 1 }, // 500ms wait
      { timestamp: 5000, processedOn: 7000, attemptsMade: 1 }, // 2000ms wait
    ];
    expect(computeAvgQueueWaitMs(sample)).toBe(1250);
  });

  it('ignores jobs missing either timestamp rather than treating them as 0', () => {
    const sample: JobSample[] = [
      { timestamp: 1000, processedOn: 1500, attemptsMade: 1 }, // 500ms wait
      { timestamp: undefined, processedOn: 9000, attemptsMade: 1 },
    ];
    expect(computeAvgQueueWaitMs(sample)).toBe(500);
  });

  it('is independent from processing time - a fast-processing, slow-to-start job still shows a wait', () => {
    const sample: JobSample[] = [
      { timestamp: 0, processedOn: 10_000, finishedOn: 10_050, attemptsMade: 1 },
    ];
    expect(computeAvgQueueWaitMs(sample)).toBe(10_000);
    expect(computeAvgProcessingTimeMs(sample)).toBe(50);
  });
});

describe('countRetriedJobs', () => {
  it('counts only jobs with more than one attempt', () => {
    const sample: JobSample[] = [
      { processedOn: undefined, finishedOn: undefined, attemptsMade: 1 },
      { processedOn: undefined, finishedOn: undefined, attemptsMade: 2 },
      { processedOn: undefined, finishedOn: undefined, attemptsMade: 3 },
    ];
    expect(countRetriedJobs(sample)).toBe(2);
  });

  it('returns 0 for an empty sample', () => {
    expect(countRetriedJobs([])).toBe(0);
  });
});
