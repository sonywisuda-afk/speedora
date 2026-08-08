import type { MomentumSample, SubtitleSegment, TranscriptWordInput } from '@speedora/contracts';
import { chunkSegmentIntoLines } from './chunk-segment';

function word(text: string, start: number, duration = 0.3): TranscriptWordInput {
  return { word: text, start, end: start + duration };
}

// Contiguous words (each starts exactly where the previous ends) - well
// under cutlist's own 0.7s "worth cutting" gap threshold, so
// computeSilenceCuts never reports a pause between any of them.
function contiguousWords(texts: string[], startAt = 0, duration = 0.3): TranscriptWordInput[] {
  return texts.map((text, i) => word(text, startAt + i * duration, duration));
}

function segment(words: TranscriptWordInput[], overrides: Partial<SubtitleSegment> = {}) {
  return {
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.word).join(' '),
    speaker: undefined,
    ...overrides,
  } as SubtitleSegment;
}

describe('chunkSegmentIntoLines', () => {
  it('keeps every word/order/timestamp completely unchanged when reassembled (ADR DB1)', () => {
    const words = contiguousWords(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    const reassembled = lines.flatMap((line) => line.words);
    expect(reassembled).toEqual(words);
  });

  it('produces one line for a short segment well under the default budget', () => {
    const words = contiguousWords(['hello', 'there', 'friend']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('hello there friend');
    expect(lines[0].start).toBe(words[0].start);
    expect(lines[0].end).toBe(words[words.length - 1].end);
  });

  it('splits at the default 6-word budget when no natural break is available', () => {
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines.map((l) => l.words.length)).toEqual([6, 2]);
  });

  it('breaks early at a real pause even under budget ("natural breathing")', () => {
    const before = contiguousWords(['this', 'is', 'fine']);
    // A 1.1s gap after "fine" - clears cutlist's own 0.7s threshold.
    const after = contiguousWords(['then', 'silence', 'happened'], before[2].end + 1.1);
    const words = [...before, ...after];
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines.map((l) => l.text)).toEqual(['this is fine', 'then silence happened']);
  });

  it('breaks at a sentence-ending word even under budget', () => {
    const words = contiguousWords(['this', 'is', 'done.', 'continuing', 'right', 'after']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines.map((l) => l.text)).toEqual(['this is done.', 'continuing right after']);
  });

  it('never breaks before MIN_WORDS_PER_LINE (2), even at a sentence end', () => {
    // "Hi." alone ends a sentence on the very first word - must not produce
    // a 1-word line.
    const words = contiguousWords(['Hi.', 'friend', 'how', 'are', 'you']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines[0].words.length).toBeGreaterThanOrEqual(2);
  });

  it('shrinks the word budget for a faster-than-normal speaking rate', () => {
    // 5 wps is double NORMAL_SPEAKING_RATE_WPS (2.5) -> budget round(6 * 2.5/5) = 3.
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f']);
    const lines = chunkSegmentIntoLines(segment(words), words, 5, []);
    expect(lines.map((l) => l.words.length)).toEqual([3, 3]);
  });

  it('grows the word budget for a slower-than-normal speaking rate, capped at the absolute max (8)', () => {
    // 1 wps -> budget round(6 * 2.5/1) = 15, capped to 8.
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const lines = chunkSegmentIntoLines(segment(words), words, 1, []);
    expect(lines.map((l) => l.words.length)).toEqual([8, 2]);
  });

  it('shrinks the budget further during a high-momentum moment ("rhythm aware")', () => {
    // round(6 * 0.7) = 4, at the single momentum sample's 0.9 score (>= the
    // 0.7 threshold) - nearestByTime picks this lone sample for every word
    // regardless of distance.
    const momentum: MomentumSample[] = [{ t: 0, momentumScore: 0.9 }];
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, momentum);
    expect(lines.map((l) => l.words.length)).toEqual([4, 2]);
  });

  it('does not shrink the budget when momentum is below the high-momentum threshold', () => {
    const momentum: MomentumSample[] = [{ t: 0, momentumScore: 0.5 }];
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, momentum);
    expect(lines.map((l) => l.words.length)).toEqual([6]);
  });

  it('scopes emphasisWordIndices to each line, not the whole segment', () => {
    // "100" is the 2nd word of the SECOND line (index 6 overall, budget 6
    // per line with no rate/momentum modulation).
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f', 'g', '100']);
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines[0].emphasisWordIndices).toEqual([]);
    expect(lines[1].emphasisWordIndices).toEqual([1]);
    expect(lines[1].words[1].word).toBe('100');
  });

  it('carries the segment speaker through to every produced line unchanged', () => {
    const words = contiguousWords(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const lines = chunkSegmentIntoLines(segment(words, { speaker: 'Speaker A' }), words, null, []);
    expect(lines.every((l) => l.speaker === 'Speaker A')).toBe(true);
  });

  it('breaks on line duration even under the word budget, for a few very long words', () => {
    // 3 words of 1s each = 3s, past MAX_LINE_DURATION_SECONDS (2.5), well
    // under the 6-word budget. A 4th word follows so the duration-triggered
    // break has somewhere real to land (a break on the very last word of a
    // segment is a no-op - there's nothing left to flush separately).
    const words = [
      word('looooong', 0, 1),
      word('woooords', 1, 1),
      word('heeeere', 2, 1),
      word('done', 3, 1),
    ];
    const lines = chunkSegmentIntoLines(segment(words), words, null, []);
    expect(lines.map((l) => l.words.length)).toEqual([3, 1]);
  });
});
