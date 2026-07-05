import type { TranscriptWord } from '@speedora/shared';

// Seconds, clip-relative (0 = clip start) - same convention as
// FaceSample.t/buildAss's internal shift. Callers pass words already
// shifted by -clipStart, so this module has no notion of absolute source
// time at all and stays simple, pure TypeScript to test.
export interface CutRange {
  start: number;
  end: number;
}

// A gap between two words shorter than this is a natural speech pause, not
// dead air worth cutting - only long silences get removed.
const MIN_SILENCE_GAP_SECONDS = 0.7;
// A cut silence keeps this much padding at each edge rather than a hard
// zero-gap splice - an instant jump-cut with literally no breathing room
// reads as more jarring than a short natural pause, even though the whole
// point is tightening pacing.
const SILENCE_EDGE_PADDING_SECONDS = 0.15;

// Deliberately just the um/uh family - NOT "like", "so", "actually",
// "basically", "right", "okay", etc, which are frequently real words doing
// real grammatical work ("I like this", "so then what happened") rather
// than disfluencies. A heuristic word-list can't tell those apart from
// context, so this stays to the narrow set that's a filler in essentially
// every occurrence - fewer fillers caught, but never butchers a sentence.
const FILLER_WORDS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'hmm']);

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

// Word timestamps arrive as floats already (Whisper's own output), and
// shifting them by -clipStart (done by the caller before these functions
// ever see them) compounds ordinary binary floating-point error (e.g.
// 10.6 - 10.3 -> 0.2999999999999998). Millisecond precision is already far
// finer than anything meaningful for a silence/filler cut, so rounding here
// avoids carrying that noise into the ffmpeg select expression this
// ultimately becomes.
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Long gaps between consecutive words (a pause longer than
// MIN_SILENCE_GAP_SECONDS) become cut ranges, trimmed down to
// SILENCE_EDGE_PADDING_SECONDS at each edge instead of removed entirely.
// words must already be clip-relative and need not be pre-sorted.
export function computeSilenceCuts(words: TranscriptWord[], clipDuration: number): CutRange[] {
  // No word-level data at all (older video transcribed before Fase 3 - see
  // CLAUDE.md - or a segment Whisper returned with no words) means there's
  // no basis to tell silence apart from untranscribed speech/music. Without
  // this guard, an empty word list would fall straight through to the
  // trailing-gap check below and read as one giant cut spanning the entire
  // clip - the opposite of "nothing to cut".
  if (words.length === 0) {
    return [];
  }

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const cuts: CutRange[] = [];

  let cursor = 0;
  for (const word of sorted) {
    const gap = word.start - cursor;
    if (gap > MIN_SILENCE_GAP_SECONDS) {
      cuts.push({
        start: round3(cursor + SILENCE_EDGE_PADDING_SECONDS),
        end: round3(word.start - SILENCE_EDGE_PADDING_SECONDS),
      });
    }
    cursor = Math.max(cursor, word.end);
  }

  const trailingGap = clipDuration - cursor;
  if (trailingGap > MIN_SILENCE_GAP_SECONDS) {
    cuts.push({ start: round3(cursor + SILENCE_EDGE_PADDING_SECONDS), end: round3(clipDuration) });
  }

  return cuts;
}

// Each um/uh-family word becomes its own cut range, start-to-end exactly -
// unlike silence gaps, no edge padding: the word itself (not a pause around
// it) is what's being removed.
export function computeFillerCuts(words: TranscriptWord[]): CutRange[] {
  return words
    .filter((word) => FILLER_WORDS.has(normalizeWord(word.word)))
    .map((word) => ({ start: round3(word.start), end: round3(word.end) }));
}

// Sorts and merges overlapping/adjacent ranges into the minimal equivalent
// set - silence and filler cuts are computed independently and can overlap
// (a filler word sitting right at the edge of a silence gap), and ffmpeg's
// select filter doesn't need or want redundant overlapping conditions.
export function mergeCutRanges(cuts: CutRange[]): CutRange[] {
  const valid = cuts.filter((cut) => cut.end > cut.start).sort((a, b) => a.start - b.start);
  if (valid.length === 0) return [];

  const merged: CutRange[] = [{ ...valid[0] }];
  for (const cut of valid.slice(1)) {
    const last = merged[merged.length - 1];
    if (cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ ...cut });
    }
  }
  return merged;
}

export function totalCutSeconds(cuts: CutRange[]): number {
  return cuts.reduce((sum, cut) => sum + (cut.end - cut.start), 0);
}

// Fase 14 (Smart Transitions) - where each cut (already merged/sorted by
// mergeCutRanges) lands on the OUTPUT timeline, i.e. after setpts/asetpts
// have compressed every earlier cut out of the timeline. This is exactly
// the point where content that used to be separated by a removed
// silence/filler range becomes a hard, back-to-back seam - ffmpeg.ts's
// trimCutRanges() anchors a quick dip-to-black/silence transition at each
// one of these to soften what would otherwise be an abrupt jump cut.
//
// cuts[i]'s own start hasn't shifted yet at the moment its cut takes effect
// (everything BEFORE it is still at its original position) - only cuts
// that already happened earlier in the list have compressed the timeline,
// so each junction is simply that cut's start minus the total duration of
// every cut before it.
export function computeCutJunctionTimestamps(cuts: CutRange[]): number[] {
  let removedBefore = 0;
  const junctions: number[] = [];
  for (const cut of cuts) {
    junctions.push(round3(cut.start - removedBefore));
    removedBefore += cut.end - cut.start;
  }
  return junctions;
}
