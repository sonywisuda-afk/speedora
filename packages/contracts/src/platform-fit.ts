import { z } from 'zod';
import { clipScoresSchema } from './clip-scoring';

// Publishing Expansion Phase 7A (AI SEO - Platform-Fit Recommendation).
// Pure/deterministic: reuses the already-computed ClipScores 9-dimension
// breakdown (the frozen detect-clips LLM call's output, see clip-scoring.ts)
// to rank which platform a clip suits best. No new LLM call, no new
// detector - the actual per-platform weight vectors live in
// @speedora/platform-fit's weights.ts, injectable and hand-authored, same
// "collect first, calibrate later" precedent as
// @speedora/thumbnail-selection's/@speedora/fusion-engine's own weights -
// these are heuristic weights, not a trained/calibrated model (see
// docs/ai/llm.md's "LLM heuristics ... never presented as trained/
// calibrated predictions" posture).
//
// Mirrors packages/shared's SocialPlatform enum values. Duplicated here
// rather than imported, same convention as clip-scoring.ts's CLIP_INTENTS -
// this contract package has no dependency on packages/shared (a DB-facing
// package) in either direction.
export const SOCIAL_PLATFORMS = [
  'YOUTUBE',
  'TIKTOK',
  'INSTAGRAM',
  'FACEBOOK',
  'THREADS',
  'LINKEDIN',
  'PINTEREST',
  'X',
] as const;
export type ContractSocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// Mirrors clipScoresSchema's own field list - kept as a standalone tuple
// (rather than deriving from clipScoresSchema.keyof()) so it stays a plain
// readonly array usable as z.enum()'s argument and as topDimensions'
// element type.
export const CLIP_SCORE_DIMENSIONS = [
  'hookStrength',
  'educationalValue',
  'practicalValue',
  'curiosity',
  'emotion',
  'storytelling',
  'novelty',
  'trustAuthority',
  'ctaStrength',
] as const;
export type ClipScoreDimension = (typeof CLIP_SCORE_DIMENSIONS)[number];

export const platformFitScoreSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  // 0-100, a weighted sum of the clip's ClipScores dims using that
  // platform's weight vector - see weights.ts.
  score: z.number().min(0).max(100),
  // Top 2-3 dims that contributed most to `score`, worst-to-best is NOT the
  // ordering here (best-to-worst) - for explainability, same spirit as
  // ThumbnailContribution/HighlightExplainability elsewhere in this package.
  topDimensions: z.array(z.enum(CLIP_SCORE_DIMENSIONS)),
});
export type PlatformFitScore = z.infer<typeof platformFitScoreSchema>;

export const platformFitResultSchema = z.object({
  // All platforms with a defined weight vector, sorted descending by score.
  rankings: z.array(platformFitScoreSchema),
});
export type PlatformFitResult = z.infer<typeof platformFitResultSchema>;

// Injectable, same convention as thumbnailWeightsSchema/fusion-engine's
// weights - one weight vector per platform, each summing to 1 over the 9
// ClipScoreDimensions.
export const platformFitWeightsSchema = z.record(
  z.enum(SOCIAL_PLATFORMS),
  z.record(z.enum(CLIP_SCORE_DIMENSIONS), z.number().min(0)),
);
export type PlatformFitWeights = Record<
  ContractSocialPlatform,
  Partial<Record<ClipScoreDimension, number>>
>;

export const computePlatformFitInputSchema = clipScoresSchema;
export type ComputePlatformFitInput = z.infer<typeof computePlatformFitInputSchema>;
