import { ClipPlatformCopyStatus } from '@speedora/database';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../openai', () => ({ openai: { fake: 'client' } }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const generatePlatformCopyMock = jest.fn();
jest.mock('@speedora/seo-copy', () => ({
  generatePlatformCopy: (...args: unknown[]) => generatePlatformCopyMock(...args),
}));

const clipPlatformCopyUpdateManyMock = jest.fn();
const clipPlatformCopyFindUniqueOrThrowMock = jest.fn();
const clipPlatformCopyUpdateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    clipPlatformCopy: {
      updateMany: (...args: unknown[]) => clipPlatformCopyUpdateManyMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => clipPlatformCopyFindUniqueOrThrowMock(...args),
      update: (...args: unknown[]) => clipPlatformCopyUpdateMock(...args),
    },
  },
}));

import { createGeneratePlatformCopyWorker } from './generate-platform-copy.worker';

interface GeneratePlatformCopyJobData {
  clipPlatformCopyId: string;
}

function getProcessor() {
  createGeneratePlatformCopyWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: GeneratePlatformCopyJobData;
  }) => Promise<unknown>;
}

const baseRow = {
  id: 'copy-1',
  clipId: 'clip-1',
  platform: 'TIKTOK',
  status: ClipPlatformCopyStatus.PROCESSING,
  clip: {
    id: 'clip-1',
    hookText: 'Wait for it',
    topics: ['productivity'],
    keywords: ['focus'],
    ctaText: 'follow for part 2',
    reason: 'a strong self-contained moment',
  },
};

function baseJob(): { data: GeneratePlatformCopyJobData } {
  return { data: { clipPlatformCopyId: 'copy-1' } };
}

describe('generate-platform-copy worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clipPlatformCopyUpdateManyMock.mockResolvedValue({ count: 1 });
    clipPlatformCopyFindUniqueOrThrowMock.mockResolvedValue(baseRow);
    clipPlatformCopyUpdateMock.mockResolvedValue({});
    generatePlatformCopyMock.mockResolvedValue({
      caption: 'Stop scrolling',
      hashtags: ['focus', 'productivity'],
      description: null,
    });
  });

  it('claims the row, generates copy, and marks it READY with the result', async () => {
    const processor = getProcessor();

    await processor(baseJob());

    expect(clipPlatformCopyUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'copy-1', status: ClipPlatformCopyStatus.PENDING },
      data: { status: ClipPlatformCopyStatus.PROCESSING },
    });
    expect(clipPlatformCopyFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      include: { clip: true },
    });
    expect(generatePlatformCopyMock).toHaveBeenCalledWith(
      {
        platform: 'TIKTOK',
        hookText: 'Wait for it',
        topics: ['productivity'],
        keywords: ['focus'],
        ctaText: 'follow for part 2',
        reason: 'a strong self-contained moment',
      },
      { openai: { fake: 'client' } },
    );
    expect(clipPlatformCopyUpdateMock).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: {
        status: ClipPlatformCopyStatus.READY,
        caption: 'Stop scrolling',
        hashtags: ['focus', 'productivity'],
        description: null,
        failReason: null,
      },
    });
  });

  it('skips a row that is not PENDING (already claimed or finished), without calling the LLM', async () => {
    clipPlatformCopyUpdateManyMock.mockResolvedValue({ count: 0 });

    const processor = getProcessor();
    const result = await processor(baseJob());

    expect(clipPlatformCopyFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(generatePlatformCopyMock).not.toHaveBeenCalled();
    expect(clipPlatformCopyUpdateMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('marks the row FAILED with the error message and rethrows on failure', async () => {
    generatePlatformCopyMock.mockRejectedValue(new Error('OpenAI request failed'));

    const processor = getProcessor();

    await expect(processor(baseJob())).rejects.toThrow('OpenAI request failed');

    expect(clipPlatformCopyUpdateMock).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: {
        status: ClipPlatformCopyStatus.FAILED,
        failReason: 'OpenAI request failed',
      },
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { clipPlatformCopyId: 'copy-1' } }),
    );
  });

  it('defaults null hookText/ctaText/reason to empty strings when calling generatePlatformCopy', async () => {
    clipPlatformCopyFindUniqueOrThrowMock.mockResolvedValue({
      ...baseRow,
      clip: { ...baseRow.clip, hookText: null, ctaText: null, reason: null },
    });

    const processor = getProcessor();
    await processor(baseJob());

    expect(generatePlatformCopyMock).toHaveBeenCalledWith(
      expect.objectContaining({ hookText: '', ctaText: '', reason: '' }),
      expect.anything(),
    );
  });
});
