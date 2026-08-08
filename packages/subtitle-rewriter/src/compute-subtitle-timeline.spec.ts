import type { ComputeSubtitleTimelineInput, TranscriptWordInput } from '@speedora/contracts';
import { computeSubtitleTimeline } from './compute-subtitle-timeline';

function word(text: string, start: number, duration = 0.3): TranscriptWordInput {
  return { word: text, start, end: start + duration };
}

function baseInput(
  overrides: Partial<ComputeSubtitleTimelineInput> = {},
): ComputeSubtitleTimelineInput {
  return {
    clipId: 'clip-1',
    segments: [],
    momentumCurve: [],
    emotionalArc: [],
    semanticEvents: null,
    averageSpeakingRateWordsPerSecond: null,
    ...overrides,
  };
}

describe('computeSubtitleTimeline', () => {
  it('returns an empty timeline/highlights for a clip with no segments', () => {
    const result = computeSubtitleTimeline(baseInput());
    expect(result).toEqual({ clipId: 'clip-1', timeline: [], highlights: [] });
  });

  it('re-chunks a segment with word-level data into one or more lines', () => {
    const words = [word('hello', 0), word('there', 0.3), word('friend', 0.6)];
    const segments = [{ start: 0, end: 0.9, text: 'hello there friend', words }];
    const result = computeSubtitleTimeline(baseInput({ segments }));
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].text).toBe('hello there friend');
    expect(result.timeline[0].words).toEqual(words);
  });

  it('falls back to one unrewritten line for a segment with no word-level data (Tech Debt #8)', () => {
    const segments = [{ start: 0, end: 2, text: 'no word timestamps here' }];
    const result = computeSubtitleTimeline(baseInput({ segments }));
    expect(result.timeline).toEqual([
      {
        start: 0,
        end: 2,
        text: 'no word timestamps here',
        words: [],
        speaker: undefined,
        emphasisWordIndices: [],
      },
    ]);
  });

  it('falls back the same way for a segment whose words array is empty', () => {
    const segments = [{ start: 0, end: 1, text: 'empty words', words: [] }];
    const result = computeSubtitleTimeline(baseInput({ segments }));
    expect(result.timeline[0].words).toEqual([]);
    expect(result.timeline[0].text).toBe('empty words');
  });

  it('processes multiple segments in order, keeping every word unchanged (ADR DB1)', () => {
    const wordsA = [word('first', 0), word('segment', 0.3)];
    const wordsB = [word('second', 5), word('segment', 5.3)];
    const segments = [
      { start: 0, end: 0.6, text: 'first segment', words: wordsA },
      { start: 5, end: 5.6, text: 'second segment', words: wordsB },
    ];
    const result = computeSubtitleTimeline(baseInput({ segments }));
    const reassembled = result.timeline.flatMap((line) => line.words);
    expect(reassembled).toEqual([...wordsA, ...wordsB]);
  });

  it('passes clipId through to the output', () => {
    const result = computeSubtitleTimeline(baseInput({ clipId: 'clip-xyz' }));
    expect(result.clipId).toBe('clip-xyz');
  });

  it('derives a non-empty highlights array when a segment lands in a high-emotion window', () => {
    const words = [word('wow', 0), word('incredible', 0.3), word('news', 0.6)];
    const segments = [{ start: 0, end: 0.9, text: 'wow incredible news', words }];
    const result = computeSubtitleTimeline(
      baseInput({ segments, emotionalArc: [{ t: 0, emotion: 'hap', intensity: 0.9 }] }),
    );
    expect(result.highlights.length).toBeGreaterThan(0);
  });
});
