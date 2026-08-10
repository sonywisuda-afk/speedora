import { clipRankSchema, type ClipRank, type ComputeClipRankInput } from '@speedora/contracts';
import { deriveSubScores } from './derive-sub-scores';

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface ScoredClip {
  clipId: string;
  compositeScore: number | null;
  confidence: number;
  subScores: ReturnType<typeof deriveSubScores>;
}

// Composite - the average of every non-null dimension in subScores (all
// already 0-100), same "average of non-null" pattern
// ViralityPrediction.overallViralScore already established one level down
// (within a single phase's own sub-probabilities), applied here one level
// up across all 12 dimensions. `confidence` is CODE-COMPUTED coverage:
// count(non-null)/12, same "kind of confidence" as
// ViralityPrediction.confidence.
function scoreClip(input: ComputeClipRankInput): ScoredClip {
  const subScores = deriveSubScores(input);
  const values = Object.values(subScores).filter((value): value is number => value !== null);
  const compositeScore = values.length === 0 ? null : average(values);
  const confidence = values.length / Object.keys(subScores).length;

  return { clipId: input.clipId, compositeScore, confidence, subScores };
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter. Operates on a
// BATCH of already-rendered clips, mirroring @speedora/fusion-engine's own
// rankClips() shape: highest compositeScore first, clips with a null
// compositeScore ranked last in their original relative order among
// themselves (Array.prototype.sort's stability). AI Intelligence v4 Phase
// 14.1 (Clip Ranking Engine, Stage D scoring - see
// docs/ai/clip-ranking-engine.md) - this function is scoring only.
// Assembling the ComputeClipRankInput[] batch from real Clip rows, and
// deciding WHEN enough of a shortlist has finished rendering to call it,
// is Phase 14.2's own, separately-confirmed job.
export function rankClipCandidates(inputs: ComputeClipRankInput[]): ClipRank[] {
  const scored = inputs.map(scoreClip);
  const sorted = [...scored].sort((a, b) => {
    if (a.compositeScore === null && b.compositeScore === null) return 0;
    if (a.compositeScore === null) return 1;
    if (b.compositeScore === null) return -1;
    return b.compositeScore - a.compositeScore;
  });
  return sorted.map((clip, index) => clipRankSchema.parse({ ...clip, rank: index + 1 }));
}
