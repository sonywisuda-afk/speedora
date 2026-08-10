import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TranscriptWord } from '@speedora/shared';

// Total length of one B-roll cutaway, including its fade-in/out (see
// ffmpeg.ts's trimAndFadeInBRoll/fadeOutBRoll) - short enough to read as a
// quick cutaway, not a scene change.
export const BROLL_DURATION_SECONDS = 2.5;
export const BROLL_FADE_SECONDS = 0.3;
// At most this many cutaways per clip - more than that starts to feel like
// a slideshow rather than a talking-head clip with the occasional B-roll
// accent. The default when Pre-Processing Settings' ProcessingOptions.broll
// .maxCutaways is null (see findBRollMoments' own maxMoments parameter) -
// exported so render-clip.worker.ts's resolveBRollOptions() can fall back to
// the exact same number rather than a second, independently-chosen constant.
export const MAX_BROLL_MOMENTS = 2;
// Two cutaways within this of each other would visually crowd/overlap -
// skip the second rather than let that happen.
const MIN_GAP_BETWEEN_MOMENTS_SECONDS = BROLL_DURATION_SECONDS + 1;

export interface BRollMoment {
  keyword: string;
  // Clip-relative seconds (0 = clip start) - same convention as
  // FaceSample.t/buildAss's internal shift/reframe.ts's emphasis words.
  // This is when the cutaway BEGINS (the keyword's own first mention
  // start), not its center.
  t: number;
  // AI B-roll Recommendation (item 8) - see looksLikeBrandName()'s own
  // comment. Threaded through to stockAssetService.searchAssets() so it
  // knows whether to try the logo tier first.
  isBrandCandidate: boolean;
}

// A deliberately cheap heuristic, not an LLM call - see
// docs/ai/broll-recommendation.md for why this exists at all. Originally
// the ONLY brand-classification signal, because at the time this shipped,
// B-roll's own overlay build ran BEFORE the render graph. That pipeline
// order changed later (Visual Emphasis Engine Phase C2 reordered things so
// buildReframePlan() could consume the render graph's own output) - as a
// side effect, render-clip.worker.ts now calls buildBRollOverlays() AFTER
// the render graph, making Hook Prediction's real namedEntities genuinely
// available for free (see matchesNamedEntity() below). This heuristic stays
// as a SECOND signal, not replaced - it still catches proper nouns Hook
// Prediction's LLM call didn't happen to extract, and is the only signal
// left when hookPrediction is null (that LLM call failed/never ran).
// `keywords` itself already comes from an LLM (clip-scoring), so a real
// proper noun is very likely already properly capitalized by that model,
// not raw ASR text where capitalization is far less reliable. False
// positives are cheap (one extra Clearbit lookup that finds nothing
// useful, falling through to the exact same stock-footage tiers as
// today - see stockAssetService.ts); false negatives just mean this
// keyword gets today's baseline behavior. Single common words that
// happen to be capitalized (e.g. a sentence-initial word) are the main
// known false-positive source - accepted given the fallback is free.
export function looksLikeBrandName(keyword: string): boolean {
  const words = keyword.trim().split(/\s+/);
  return words.length > 0 && words.every((word) => /^[A-Z]/.test(word));
}

// The real signal, now that it's genuinely available (see looksLikeBrandName's
// own comment above for the pipeline-order history). Case-insensitive exact
// match first (the common case: clip-scoring's `keyword` and Hook
// Prediction's own extracted entity name the same real-world thing the same
// way), then a bidirectional substring check as a deliberate loosening - the
// two LLM calls are independent and can phrase the same entity differently
// ("OpenAI" vs "Open AI", "Elon Musk" vs just "Musk"). Not real fuzzy/token
// matching - a cheap string check is enough here since a false positive is
// harmless (see looksLikeBrandName's own cost framing) and a namedEntities
// list is already short (per-clip, not per-corpus).
export function matchesNamedEntity(keyword: string, namedEntities: string[]): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return false;
  return namedEntities.some((entity) => {
    const normalizedEntity = entity.trim().toLowerCase();
    if (!normalizedEntity) return false;
    return (
      normalizedEntity === normalizedKeyword ||
      normalizedEntity.includes(normalizedKeyword) ||
      normalizedKeyword.includes(normalizedEntity)
    );
  });
}

// First character offset of `keyword` (case-insensitive) in the words
// joined back into a single space-separated string, mapped back to the
// word whose span contains that offset - handles both single-word
// keywords and multi-word phrases (detect-clips.worker.ts's `keywords`
// field explicitly allows "keywords/phrases") without needing n-gram
// window matching.
function findFirstMentionTime(keyword: string, words: TranscriptWord[]): number | null {
  const normalized = keyword.toLowerCase().trim();
  if (!normalized || words.length === 0) return null;

  let text = '';
  const offsets: Array<{ charStart: number; wordStart: number }> = [];
  for (const word of words) {
    offsets.push({ charStart: text.length, wordStart: word.start });
    text += `${word.word.toLowerCase()} `;
  }

  const matchIndex = text.indexOf(normalized);
  if (matchIndex === -1) return null;

  let wordStart = offsets[0].wordStart;
  for (const offset of offsets) {
    if (offset.charStart > matchIndex) break;
    wordStart = offset.wordStart;
  }
  return wordStart;
}

// Picks up to maxMoments keywords (in the order detect-clips.worker.ts's
// LLM call returned them - no re-ranking by "how visual" a keyword is, that
// would need a judgment call this heuristic doesn't try to make) that are
// actually said somewhere in this clip's transcript, spaced apart enough not
// to crowd each other, each with enough room left in the clip for the full
// cutaway duration. A keyword search returning nothing, or one that never
// appears in this clip's words at all, is simply skipped - not an error.
// maxMoments defaults to MAX_BROLL_MOMENTS (every pre-existing call site's
// exact prior behavior); render-clip.worker.ts passes an explicit override
// when ProcessingOptions.broll.maxCutaways is set.
// namedEntities defaults to an empty array (every pre-existing call site's
// exact prior behavior, and the correct fallback when Hook Prediction's own
// render-graph node returned null) - isBrandCandidate is true when EITHER
// signal says so (matchesNamedEntity - the real AI signal - OR
// looksLikeBrandName - the cheap fallback), never requiring both.
export function findBRollMoments(
  keywords: string[],
  words: TranscriptWord[],
  clipDurationSeconds: number,
  maxMoments: number = MAX_BROLL_MOMENTS,
  namedEntities: string[] = [],
): BRollMoment[] {
  const moments: BRollMoment[] = [];
  for (const keyword of keywords) {
    if (moments.length >= maxMoments) break;

    const t = findFirstMentionTime(keyword, words);
    if (t === null) continue;
    if (t + BROLL_DURATION_SECONDS > clipDurationSeconds) continue;
    if (moments.some((m) => Math.abs(m.t - t) < MIN_GAP_BETWEEN_MOMENTS_SECONDS)) continue;

    const isBrandCandidate =
      matchesNamedEntity(keyword, namedEntities) || looksLikeBrandName(keyword);
    moments.push({ keyword, t, isBrandCandidate });
  }
  return moments;
}

// Stock asset SEARCHING is now handled by StockAssetService (Fase 16 -
// Multi-Provider Stock Assets - see apps/worker/src/assets/), which tries
// Pexels/Pixabay/Unsplash behind the Adapter pattern and returns a single
// normalized StockAsset. This module keeps only what's specific to B-roll
// itself: finding WHERE in a clip to place a cutaway (findBRollMoments
// above) and downloading whichever asset the service found.

// Streams a StockAsset's file URL straight to a local scratch path - ffmpeg
// (like the rest of this pipeline) needs a real local file, not a remote
// URL, to run multiple filter passes against it. Works for both 'video'
// and 'image' assets identically (same plain byte-stream download either
// way) - ffmpeg.ts's trimAndFadeInBRoll is what actually branches on the
// asset's type.
export async function downloadStockAsset(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download stock asset (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
}
