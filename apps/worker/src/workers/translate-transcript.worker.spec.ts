import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../openai', () => ({ openai: { fake: 'client' } }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const translateSegmentsMock = jest.fn();
jest.mock('@speedora/subtitle-translate', () => ({
  translateSegments: (...args: unknown[]) => translateSegmentsMock(...args),
}));

const transcriptSegmentFindManyMock = jest.fn();
const transcriptSegmentUpdateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    transcriptSegment: {
      findMany: (...args: unknown[]) => transcriptSegmentFindManyMock(...args),
      update: (...args: unknown[]) => transcriptSegmentUpdateMock(...args),
    },
  },
}));

import { createTranslateTranscriptWorker } from './translate-transcript.worker';

interface TranslateTranscriptJobData {
  videoId: string;
  languageCode: string;
}

function getProcessor() {
  createTranslateTranscriptWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: TranslateTranscriptJobData;
  }) => Promise<unknown>;
}

function baseJob(): { data: TranslateTranscriptJobData } {
  return { data: { videoId: 'video-1', languageCode: 'en' } };
}

describe('translate-transcript worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transcriptSegmentUpdateMock.mockResolvedValue({});
  });

  it('translates every segment and merges the new language into each row without a prior translations map', async () => {
    transcriptSegmentFindManyMock.mockResolvedValue([
      { id: 'seg-1', text: 'Halo', translations: null },
      { id: 'seg-2', text: 'Dunia', translations: null },
    ]);
    translateSegmentsMock.mockResolvedValue({
      translations: [
        { id: 'seg-1', text: 'Hello' },
        { id: 'seg-2', text: 'World' },
      ],
    });

    const processor = getProcessor();
    await processor(baseJob());

    expect(translateSegmentsMock).toHaveBeenCalledWith(
      {
        segments: [
          { id: 'seg-1', text: 'Halo' },
          { id: 'seg-2', text: 'Dunia' },
        ],
        languageCode: 'en',
      },
      { openai: { fake: 'client' } },
    );
    expect(transcriptSegmentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'seg-1' },
      data: { translations: { en: 'Hello' } },
    });
    expect(transcriptSegmentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'seg-2' },
      data: { translations: { en: 'World' } },
    });
  });

  it('merges into an existing translations map rather than overwriting other languages', async () => {
    transcriptSegmentFindManyMock.mockResolvedValue([
      { id: 'seg-1', text: 'Halo', translations: { es: 'Hola' } },
    ]);
    translateSegmentsMock.mockResolvedValue({ translations: [{ id: 'seg-1', text: 'Hello' }] });

    const processor = getProcessor();
    await processor(baseJob());

    expect(transcriptSegmentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'seg-1' },
      data: { translations: { es: 'Hola', en: 'Hello' } },
    });
  });

  it('does nothing (no LLM call) when the video has no transcript segments', async () => {
    transcriptSegmentFindManyMock.mockResolvedValue([]);

    const processor = getProcessor();
    const result = await processor(baseJob());

    expect(translateSegmentsMock).not.toHaveBeenCalled();
    expect(transcriptSegmentUpdateMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('reports to Sentry and rethrows when the LLM call fails, without updating any segment', async () => {
    transcriptSegmentFindManyMock.mockResolvedValue([{ id: 'seg-1', text: 'Halo' }]);
    translateSegmentsMock.mockRejectedValue(new Error('OpenAI request failed'));

    const processor = getProcessor();

    await expect(processor(baseJob())).rejects.toThrow('OpenAI request failed');
    expect(transcriptSegmentUpdateMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { videoId: 'video-1', languageCode: 'en' } }),
    );
  });
});
