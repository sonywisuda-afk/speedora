import { computeSilenceCuts } from '@speedora/cutlist';
import type {
  CutRange,
  MomentumSample,
  SubtitleLine,
  SubtitleSegment,
  TranscriptWordInput,
} from '@speedora/contracts';
import { selectEmphasisWordIndices } from './select-emphasis-words';
import { nearestByTime } from './nearest-by-time';

// "Short phrases"/"smart line breaking" (spec Part 7) - every constant
// below is a documented HEURISTIC (ADR D4), with no engagement/readability
// data behind it, same honesty as every other threshold in this codebase's
// v4 modules.

// A caption line longer than this reads as a wall of text on a vertical
// short-form video, regardless of how fast/slow the speaker talks.
const ABSOLUTE_MAX_WORDS_PER_LINE = 8;
// The word budget at a "normal" conversational speaking rate - shrinks for
// a faster speaker, grows (capped at ABSOLUTE_MAX_WORDS_PER_LINE) for a
// slower one ("speaking speed aware").
const DEFAULT_MAX_WORDS_PER_LINE = 6;
const MIN_WORDS_PER_LINE = 2;
// ~150 words per minute - a commonly cited average conversational English
// speaking rate, used only as this modulation's own reference point, not a
// claim of correctness for any given speaker/language.
const NORMAL_SPEAKING_RATE_WPS = 2.5;
// A line held on screen longer than this starts to lag behind a fast-moving
// clip regardless of word count (e.g. a few very long words).
const MAX_LINE_DURATION_SECONDS = 2.5;
// MomentumCurve.momentumScore (0-1) at/above this shrinks the word budget
// further ("rhythm aware") - a high-energy moment reads better with
// punchier, more frequent line changes than a calm one.
const HIGH_MOMENTUM_THRESHOLD = 0.7;
const HIGH_MOMENTUM_BUDGET_MULTIPLIER = 0.7;
// computeSilenceCuts pads each cut's start by its own edge-padding constant
// past the preceding word's end - this window absorbs that padding (plus
// ordinary floating-point slop) when checking "is there a pause right after
// this word".
const PAUSE_MATCH_WINDOW_SECONDS = 0.25;

function wordBudgetFor(
  speakingRateWordsPerSecond: number | null,
  nearestMomentum: MomentumSample | null,
): number {
  let budget = DEFAULT_MAX_WORDS_PER_LINE;
  if (speakingRateWordsPerSecond != null && speakingRateWordsPerSecond > 0) {
    budget = Math.round(
      DEFAULT_MAX_WORDS_PER_LINE * (NORMAL_SPEAKING_RATE_WPS / speakingRateWordsPerSecond),
    );
  }
  if (nearestMomentum != null && nearestMomentum.momentumScore >= HIGH_MOMENTUM_THRESHOLD) {
    budget = Math.round(budget * HIGH_MOMENTUM_BUDGET_MULTIPLIER);
  }
  return Math.max(MIN_WORDS_PER_LINE, Math.min(ABSOLUTE_MAX_WORDS_PER_LINE, budget));
}

function endsSentence(word: string): boolean {
  return /[.!?]["'”’]*$/.test(word);
}

function hasPauseRightAfter(pauseGaps: CutRange[], wordEnd: number): boolean {
  return pauseGaps.some(
    (gap) => gap.start >= wordEnd && gap.start - wordEnd <= PAUSE_MATCH_WINDOW_SECONDS,
  );
}

// Splits one already-transcribed segment's word list into short lines,
// preferring to break at a natural pause (a real gap @speedora/cutlist's own
// computeSilenceCuts detects - "natural breathing", the same >0.7s bar
// @speedora/hook-prediction's derivePauseFeatures already reuses this exact
// function for) or a sentence boundary before hitting the word/duration
// budget - never mid-budget-only unless neither natural break is
// available. Every word/timestamp is carried through COMPLETELY UNCHANGED
// (ADR DB1) - this function only decides GROUPING, never rewrites text.
// `words` must be non-empty and belong to `segment` - the caller
// (computeSubtitleTimeline) owns the "segment has no word-level data at
// all" fallback.
export function chunkSegmentIntoLines(
  segment: SubtitleSegment,
  words: TranscriptWordInput[],
  speakingRateWordsPerSecond: number | null,
  momentumCurve: MomentumSample[],
): SubtitleLine[] {
  const segmentDuration = segment.end - segment.start;
  // computeSilenceCuts expects segment-relative (0 = this segment's own
  // start) words, same convention @speedora/hook-prediction's
  // derivePauseFeatures already uses when it reuses this exact function.
  const relativeWords = words.map((word) => ({
    ...word,
    start: word.start - segment.start,
    end: word.end - segment.start,
  }));
  const pauseGaps = computeSilenceCuts(relativeWords, segmentDuration);

  const lines: SubtitleLine[] = [];
  let current: TranscriptWordInput[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    lines.push({
      start: segment.start + first.start,
      end: segment.start + last.end,
      text: current.map((word) => word.word).join(' '),
      words: current.map((word) => ({
        word: word.word,
        start: segment.start + word.start,
        end: segment.start + word.end,
      })),
      speaker: segment.speaker,
      emphasisWordIndices: selectEmphasisWordIndices(current),
    });
    current = [];
  };

  for (let i = 0; i < relativeWords.length; i++) {
    const word = relativeWords[i];
    current.push(word);

    const nearestMomentum = nearestByTime(momentumCurve, segment.start + word.start);
    const budget = wordBudgetFor(speakingRateWordsPerSecond, nearestMomentum);
    const lineDuration = word.end - current[0].start;
    const isLastWord = i === relativeWords.length - 1;

    const atBudget = current.length >= budget || lineDuration >= MAX_LINE_DURATION_SECONDS;
    const atNaturalBreak =
      current.length >= MIN_WORDS_PER_LINE &&
      (hasPauseRightAfter(pauseGaps, word.end) || endsSentence(word.word));

    if (!isLastWord && (atBudget || atNaturalBreak)) {
      flush();
    }
  }
  flush();

  return lines;
}
