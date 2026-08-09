import type { CutRange, TranscriptWordInput } from '@speedora/contracts';

// Seconds, clip-relative (0 = clip start) - same convention as
// FaceSample.t/buildAss's internal shift. Callers pass words already
// shifted by -clipStart, so this module has no notion of absolute source
// time at all and stays simple, pure TypeScript to test.
export type { CutRange };

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
export function computeSilenceCuts(words: TranscriptWordInput[], clipDuration: number): CutRange[] {
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
export function computeFillerCuts(words: TranscriptWordInput[]): CutRange[] {
  return words
    .filter((word) => FILLER_WORDS.has(normalizeWord(word.word)))
    .map((word) => ({ start: round3(word.start), end: round3(word.end) }));
}

// Visual Emphasis Engine Phase C7 ("Pause Hold", docs/ai/visual-emphasis-
// engine.md) - removes any silence cut that exactly matches a protected
// window (@speedora/visual-emphasis's own pause_hold EditingSuggestion,
// {start, end} - always derived from THIS SAME computeSilenceCuts() call
// in that package's fromPauses(), so an EXACT match - not a loose overlap
// check - is the correct, conservative comparison: "protect THIS pause",
// never "protect anything near it" (the roadmap's own "protect rarely,
// not liberally" instruction). Must run BEFORE mergeCutRanges() combines
// silence cuts with filler-word cuts - a protected silence gap sitting
// right next to an unrelated filler cut must never accidentally protect
// the filler cut too (filler words are always removed regardless of
// dramatic-pause proximity; pause protection only ever applies to actual
// silence gaps). Floating-point tolerance (1e-6) accounts for the same
// ordinary binary rounding round3() above already exists to smooth over.
export function protectPauseHolds(
  silenceCuts: CutRange[],
  protectedWindows: Array<{ start: number; end: number }>,
): CutRange[] {
  return silenceCuts.filter(
    (cut) =>
      !protectedWindows.some(
        (window) =>
          Math.abs(window.start - cut.start) < 1e-6 && Math.abs(window.end - cut.end) < 1e-6,
      ),
  );
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

// Visual Emphasis Engine Phase C6R.1 ("Reaction Hold Temporal Extension" -
// see docs/ai/visual-emphasis-engine.md's "C6R design" section) - the
// reusable temporal-remapping primitive that section called for,
// generalizing computeCutJunctionTimestamps() below from "map a cut's own
// start" to "map ANY original clip-relative instant onto its position on
// the POST-CUT timeline" (the timeline trimCutRanges()'s own
// select/aselect + setpts/asetpts filters actually produce). Returns
// `null` when `t` itself falls inside a cut range - that content was
// removed entirely, so there's no surviving position to map it to; it's
// the CALLER's job to decide what "no surviving position" means for its
// own use case (C6R.3's reaction-hold wiring skips that hold entirely
// rather than fabricating a nearby position, the same "protect rarely,
// don't guess" conservatism protectPauseHolds() above already
// established). Order-independent - each cut is checked against `t`
// independently, not via a cumulative left-to-right walk - so `cuts`
// need not be pre-sorted, only non-overlapping (mergeCutRanges()'s own
// guarantee; overlapping input would double-count).
//
// Deliberately NOT used to reimplement computeCutJunctionTimestamps()
// below, despite the surface-level similarity - a cut's own `start` is,
// by this function's own definition, INSIDE that same cut's range
// (`t >= cut.start && t < cut.end`), so `remapTimestamp(cut.start, cuts)`
// would return `null` for every cut, not the junction position
// computeCutJunctionTimestamps() actually wants (the boundary position
// right as a cut BEGINS, counting only EARLIER cuts' already-removed
// time - a different, narrower question than "does this timestamp
// survive at all"). Two related but genuinely different questions, kept
// as two functions rather than forcing a shared implementation that
// would silently get one of them wrong.
export function remapTimestamp(t: number, cuts: CutRange[]): number | null {
  let removedBefore = 0;
  for (const cut of cuts) {
    if (t >= cut.start && t < cut.end) {
      return null;
    }
    if (cut.end <= t) {
      removedBefore += cut.end - cut.start;
    }
  }
  return round3(t - removedBefore);
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
