import { rankedClipSchema, type RankedClip } from '@speedora/contracts';

export interface RankableClip {
  clipId: string;
  highlightScore: number | null;
}

// Step 7: Ranking. A clip's highlightScore only really means something
// relative to its siblings in the same video (the whole point of this
// pipeline is picking the BEST moments to publish) - a separate, tiny pure
// function rather than folded into computeHighlightScore, since it operates
// on a BATCH of already-scored clips, not one clip in isolation. Called
// once every clip in a video has finished rendering (see
// apps/worker/src/workers/render-clip.worker.ts) - not per-clip.
//
// Highest highlightScore first; clips with a null score (no signal was
// available at all) are ranked last, in their original relative order
// among themselves (Array.prototype.sort is a stable sort in modern JS
// engines, so this falls out naturally rather than needing a tie-break
// rule of its own).
export function rankClips(clips: RankableClip[]): RankedClip[] {
  const sorted = [...clips].sort((a, b) => {
    if (a.highlightScore === null && b.highlightScore === null) return 0;
    if (a.highlightScore === null) return 1;
    if (b.highlightScore === null) return -1;
    return b.highlightScore - a.highlightScore;
  });

  return sorted.map((clip, index) => rankedClipSchema.parse({ ...clip, rank: index + 1 }));
}
