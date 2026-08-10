import type { TranscriptWord } from '@speedora/shared';

const fetchMock = jest.fn();
(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

jest.mock('node:fs', () => ({
  createWriteStream: jest.fn().mockReturnValue({ fake: 'writable' }),
}));

const fromWebMock = jest.fn().mockReturnValue({ fake: 'readable' });
jest.mock('node:stream', () => ({
  Readable: { fromWeb: (...args: unknown[]) => fromWebMock(...args) },
}));

const pipelineMock = jest.fn().mockResolvedValue(undefined);
jest.mock('node:stream/promises', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

import {
  downloadStockAsset,
  findBRollMoments,
  looksLikeBrandName,
  matchesNamedEntity,
} from './broll';

function word(text: string, start: number, end: number): TranscriptWord {
  return { word: text, start, end };
}

describe('findBRollMoments', () => {
  const words = [
    word('so', 0, 0.3),
    word('the', 0.3, 0.5),
    word('sunset', 0.5, 1.0),
    word('was', 1.0, 1.2),
    word('beautiful', 1.2, 1.8),
    word('over', 5, 5.3),
    word('the', 5.3, 5.5),
    word('mountain', 5.5, 6.0),
    word('range', 6.0, 6.4),
  ];

  it('finds the first mention time of each keyword actually said in the clip', () => {
    const moments = findBRollMoments(['sunset', 'mountain range'], words, 20);

    expect(moments).toEqual([
      { keyword: 'sunset', t: 0.5, isBrandCandidate: false },
      { keyword: 'mountain range', t: 5.5, isBrandCandidate: false },
    ]);
  });

  it('is case-insensitive when matching the transcript, and tags the moment with isBrandCandidate', () => {
    expect(findBRollMoments(['SUNSET'], words, 20)).toEqual([
      // All-caps still matches looksLikeBrandName's own "starts with an
      // uppercase letter" check - see its own describe block below for
      // why that's an accepted, not-worried-about heuristic quirk.
      { keyword: 'SUNSET', t: 0.5, isBrandCandidate: true },
    ]);
  });

  it('skips a keyword never said in this clip', () => {
    expect(findBRollMoments(['ocean'], words, 20)).toEqual([]);
  });

  it('skips a keyword with too little clip remaining for the full cutaway', () => {
    // "range" is mentioned at t=6.0, but the clip is only 6.5s long - not
    // enough room for a 2.5s cutaway (BROLL_DURATION_SECONDS).
    expect(findBRollMoments(['range'], words, 6.5)).toEqual([]);
  });

  it('caps at 2 moments even when more keywords match (default maxMoments, matching MAX_BROLL_MOMENTS)', () => {
    const manyWords = [word('alpha', 0, 0.3), word('beta', 10, 10.3), word('gamma', 20, 20.3)];
    const moments = findBRollMoments(['alpha', 'beta', 'gamma'], manyWords, 30);

    expect(moments).toHaveLength(2);
    expect(moments.map((m) => m.keyword)).toEqual(['alpha', 'beta']);
  });

  // AI B-roll Recommendation UI control (Pre-Processing Settings' broll.maxCutaways) - an
  // explicit maxMoments overrides the default cap, both up and down.
  it('honors an explicit maxMoments override, capping below the default', () => {
    const words2 = [word('alpha', 0, 0.3), word('beta', 10, 10.3), word('gamma', 20, 20.3)];
    const moments = findBRollMoments(['alpha', 'beta', 'gamma'], words2, 30, 1);

    expect(moments).toHaveLength(1);
    expect(moments.map((m) => m.keyword)).toEqual(['alpha']);
  });

  it('honors an explicit maxMoments override, allowing more than the default', () => {
    const words3 = [word('alpha', 0, 0.3), word('beta', 10, 10.3), word('gamma', 20, 20.3)];
    const moments = findBRollMoments(['alpha', 'beta', 'gamma'], words3, 30, 3);

    expect(moments).toHaveLength(3);
    expect(moments.map((m) => m.keyword)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('skips a keyword whose moment would crowd an already-chosen one', () => {
    const closeWords = [word('alpha', 0, 0.3), word('beta', 1, 1.3)];
    // alpha at t=0 and beta at t=1 are less than BROLL_DURATION_SECONDS+1
    // apart - beta should be skipped rather than overlapping alpha's cutaway.
    const moments = findBRollMoments(['alpha', 'beta'], closeWords, 20);

    expect(moments).toEqual([{ keyword: 'alpha', t: 0, isBrandCandidate: false }]);
  });

  it('returns an empty array for no keywords or no words', () => {
    expect(findBRollMoments([], words, 20)).toEqual([]);
    expect(findBRollMoments(['sunset'], [], 20)).toEqual([]);
  });

  // AI B-roll Recommendation - item 3 follow-up (real namedEntities signal, now that the
  // pipeline-order constraint that used to block it no longer applies).
  it('tags isBrandCandidate true when the keyword matches a real namedEntity, even though the keyword itself is lowercase (a false negative for looksLikeBrandName alone)', () => {
    const brandWords = [word('so', 0, 0.3), word('sunset', 0.5, 1.0)];
    const moments = findBRollMoments(['sunset'], brandWords, 20, undefined, ['Sunset Corp']);

    expect(moments).toEqual([{ keyword: 'sunset', t: 0.5, isBrandCandidate: true }]);
  });

  it('still tags isBrandCandidate true via looksLikeBrandName when namedEntities has no match (the fallback signal)', () => {
    expect(findBRollMoments(['SUNSET'], words, 20, undefined, ['unrelated entity'])).toEqual([
      { keyword: 'SUNSET', t: 0.5, isBrandCandidate: true },
    ]);
  });

  it('tags isBrandCandidate false when neither signal matches', () => {
    expect(findBRollMoments(['sunset'], words, 20, undefined, ['unrelated entity'])).toEqual([
      { keyword: 'sunset', t: 0.5, isBrandCandidate: false },
    ]);
  });

  it('defaults namedEntities to empty (existing behavior unchanged) when the parameter is omitted', () => {
    expect(findBRollMoments(['sunset'], words, 20)).toEqual([
      { keyword: 'sunset', t: 0.5, isBrandCandidate: false },
    ]);
  });
});

// AI B-roll Recommendation (item 8) - see this function's own comment in
// broll.ts for why it's a cheap capitalization heuristic, not an LLM call.
describe('looksLikeBrandName', () => {
  it('returns true for a single capitalized word', () => {
    expect(looksLikeBrandName('OpenAI')).toBe(true);
  });

  it('returns true for a multi-word phrase where every word is capitalized', () => {
    expect(looksLikeBrandName('Elon Musk')).toBe(true);
  });

  it('returns false for a plain lowercase word', () => {
    expect(looksLikeBrandName('coffee')).toBe(false);
  });

  it('returns false when only some words in a phrase are capitalized', () => {
    expect(looksLikeBrandName('climate change')).toBe(false);
    expect(looksLikeBrandName('the Future')).toBe(false);
  });

  it('returns false for an empty or whitespace-only string', () => {
    expect(looksLikeBrandName('')).toBe(false);
    expect(looksLikeBrandName('   ')).toBe(false);
  });

  it('returns true for an all-caps acronym (e.g. NASA) - a deliberate, accepted false-positive class', () => {
    expect(looksLikeBrandName('NASA')).toBe(true);
  });
});

// AI B-roll Recommendation - item 3 follow-up: the real classification signal, now that Hook
// Prediction's namedEntities is genuinely available at this call site (see this function's own
// comment in broll.ts for the pipeline-order history).
describe('matchesNamedEntity', () => {
  it('returns true for a case-insensitive exact match', () => {
    expect(matchesNamedEntity('openai', ['OpenAI'])).toBe(true);
    expect(matchesNamedEntity('OPENAI', ['openai'])).toBe(true);
  });

  it('returns true when the entity is a longer phrase containing the keyword', () => {
    expect(matchesNamedEntity('Musk', ['Elon Musk'])).toBe(true);
  });

  it('returns true when the keyword is a longer phrase containing the entity', () => {
    expect(matchesNamedEntity('Open AI Inc', ['Open AI'])).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesNamedEntity('coffee', ['OpenAI', 'Elon Musk'])).toBe(false);
  });

  it('returns false for an empty keyword or an empty namedEntities list', () => {
    expect(matchesNamedEntity('', ['OpenAI'])).toBe(false);
    expect(matchesNamedEntity('OpenAI', [])).toBe(false);
  });

  it('ignores a blank entry in namedEntities rather than matching everything against it', () => {
    expect(matchesNamedEntity('anything', ['', '   '])).toBe(false);
  });
});

describe('downloadStockAsset', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    pipelineMock.mockClear();
  });

  it('streams the response body to the destination path', async () => {
    fetchMock.mockResolvedValue({ ok: true, body: 'fake-web-stream' });

    await downloadStockAsset('https://example.com/video.mp4', '/tmp/broll.mp4');

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/video.mp4');
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the download fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, body: null });

    await expect(
      downloadStockAsset('https://example.com/video.mp4', '/tmp/broll.mp4'),
    ).rejects.toThrow('Failed to download stock asset');
  });
});
