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
// accent.
const MAX_BROLL_MOMENTS = 2;
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

// Picks up to MAX_BROLL_MOMENTS keywords (in the order detect-clips.worker.ts's
// LLM call returned them - no re-ranking by "how visual" a keyword is, that
// would need a judgment call this heuristic doesn't try to make) that are
// actually said somewhere in this clip's transcript, spaced apart enough not
// to crowd each other, each with enough room left in the clip for the full
// cutaway duration. A keyword search returning nothing, or one that never
// appears in this clip's words at all, is simply skipped - not an error.
export function findBRollMoments(
  keywords: string[],
  words: TranscriptWord[],
  clipDurationSeconds: number,
): BRollMoment[] {
  const moments: BRollMoment[] = [];
  for (const keyword of keywords) {
    if (moments.length >= MAX_BROLL_MOMENTS) break;

    const t = findFirstMentionTime(keyword, words);
    if (t === null) continue;
    if (t + BROLL_DURATION_SECONDS > clipDurationSeconds) continue;
    if (moments.some((m) => Math.abs(m.t - t) < MIN_GAP_BETWEEN_MOMENTS_SECONDS)) continue;

    moments.push({ keyword, t });
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
