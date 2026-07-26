import type { PrismaService } from '../prisma/prisma.service';
import type { ClipsService } from './clips.service';
import { ClipQueryParserService } from './clip-query-parser.service';

const isAiSearchEnabledMock = jest.fn();
const fakeOpenAiClient = {};
jest.mock('../openai', () => ({
  isAiSearchEnabled: (...args: unknown[]) => isAiSearchEnabledMock(...args),
  getOpenAiClient: () => fakeOpenAiClient,
}));

const parseClipQueryMock = jest.fn();
jest.mock('@speedora/clip-query-parser', () => ({
  parseClipQuery: (...args: unknown[]) => parseClipQueryMock(...args),
}));

describe('ClipQueryParserService', () => {
  let service: ClipQueryParserService;
  let prisma: { aiSearchRequest: { count: jest.Mock; create: jest.Mock } };
  let clipsService: { getTopicFacets: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    isAiSearchEnabledMock.mockReturnValue(true);
    prisma = {
      aiSearchRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    clipsService = {
      getTopicFacets: jest.fn().mockResolvedValue({ topics: [{ value: 'marketing', count: 5 }] }),
    };
    service = new ClipQueryParserService(
      prisma as unknown as PrismaService,
      clipsService as unknown as ClipsService,
    );
  });

  it('throws ServiceUnavailableException when OPENAI_API_KEY is unset, without touching the rate limit or the LLM', async () => {
    isAiSearchEnabledMock.mockReturnValue(false);

    await expect(service.parseQuery('user-1', 'funny clips', {})).rejects.toThrow(
      'Pencarian AI belum dikonfigurasi',
    );
    expect(prisma.aiSearchRequest.count).not.toHaveBeenCalled();
    expect(parseClipQueryMock).not.toHaveBeenCalled();
  });

  it('throws BadRequestException past the daily limit, without creating a row or calling the LLM', async () => {
    prisma.aiSearchRequest.count.mockResolvedValue(20);

    await expect(service.parseQuery('user-1', 'funny clips', {})).rejects.toThrow(
      'AI search limit reached (20/24h) - try again later.',
    );
    expect(prisma.aiSearchRequest.create).not.toHaveBeenCalled();
    expect(parseClipQueryMock).not.toHaveBeenCalled();
  });

  it('creates the rate-limit counter row even when the LLM call itself fails', async () => {
    parseClipQueryMock.mockRejectedValue(new Error('LLM boom'));

    await expect(service.parseQuery('user-1', 'funny clips', {})).rejects.toThrow();

    expect(prisma.aiSearchRequest.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', query: 'funny clips' },
    });
  });

  it('wraps any LLM failure (timeout, network error, etc.) into a clean 503, never the raw SDK error', async () => {
    parseClipQueryMock.mockRejectedValue(new Error('Request timed out.'));

    await expect(service.parseQuery('user-1', 'funny clips', {})).rejects.toThrow(
      'Pencarian AI sedang tidak tersedia, coba lagi sebentar lagi.',
    );
  });

  it('passes the target workspace/project through to getTopicFacets and forwards its topics as availableTopics', async () => {
    clipsService.getTopicFacets.mockResolvedValue({
      topics: [
        { value: 'marketing', count: 5 },
        { value: 'finance', count: 2 },
      ],
    });
    parseClipQueryMock.mockResolvedValue({ summary: 'Marketing clips.', topics: ['marketing'] });

    await service.parseQuery('user-1', 'marketing clips', {
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });

    expect(clipsService.getTopicFacets).toHaveBeenCalledWith('user-1', {
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });
    expect(parseClipQueryMock).toHaveBeenCalledWith(
      { query: 'marketing clips', availableTopics: ['marketing', 'finance'] },
      { openai: fakeOpenAiClient },
    );
  });

  it('splits the parsed summary out of the returned filters', async () => {
    parseClipQueryMock.mockResolvedValue({
      summary: 'Score >= 70, under 30s.',
      minScore: 70,
      maxDuration: 30,
    });

    const result = await service.parseQuery('user-1', 'best short clips', {});

    expect(result).toEqual({
      filters: { minScore: 70, maxDuration: 30 },
      summary: 'Score >= 70, under 30s.',
    });
  });
});
