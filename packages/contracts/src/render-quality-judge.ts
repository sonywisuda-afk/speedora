import { z } from 'zod';

// Render Quality Judge Phase C1 ("Render QA" - see docs/ai/render-quality-judge.md) of the
// mission's own 30-section "Speedora Editorial Operating System" roadmap. The mission's original
// Section 17 ask was a full auto-reject + safe-fallback re-render loop; a 3-way parallel audit
// (pre-render validation hooks, post-render quality measurement infrastructure, retry/re-render
// mechanics) found that ask isn't safely buildable in one pass: the 45-minute job timeout is sized
// for exactly one render pass with no stated headroom for a second, `renderClip()` is a monolithic
// non-reusable ffmpeg call, no `Clip` status/verdict column exists anywhere, and most of the named
// Quality Judge inputs (VisualQuality/AudioQuality/CaptionQuality) have no real detector behind
// them - only weak, indirectly-related proxies or nothing at all.
//
// Phase C1 scopes to what the audit confirmed is genuinely free: an additive, OBSERVATIONAL
// FinalClipQualityAssessment composed entirely from already-computed data (Editorial Director
// Phase A's EditorialDecision, the render pipeline's own probeVideoMetadata()/
// RenderVerificationResult/duration columns). No gating, no auto-reject, no re-render - this
// mirrors the "data first" precedent both Phase A's EditorialDecision and the separate Visual
// Emphasis Engine's own C1 phase already established. See this contract's own `basis` field below
// for how each dimension honestly reports whether it's a real measurement, a weak proxy, or simply
// unavailable - never silently blending the three.
//
// Every numeric field here is a documented HEURISTIC (ADR D4, docs/coding-standards.md's "scale
// honesty") - no production engagement data exists yet to validate whether this composite score
// correlates with anything worth acting on (same 0-usable-samples blocker every other phase in
// this roadmap already documents). Never present this downstream (UI copy, API docs) as a
// calibrated quality verdict without this caveat.

export const QUALITY_DIMENSIONS = [
  'editorialQuality',
  'narrativeQuality',
  'technicalQuality',
  'visualQuality',
  'audioQuality',
  'captionQuality',
] as const;
export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

// What kind of signal actually backs this dimension's score - the honesty mechanism this phase is
// built around:
// - 'measured': composed directly from a real, already-computed value that measures what its name
//   claims (editorialScore, category scores, ffprobe/RenderVerificationResult/duration-drift).
// - 'proxy': composed from a real value that measures something ADJACENT, not the dimension
//   itself (e.g. visualEngagement measures how much our own editor acted on the clip, not
//   perceptual picture quality; speakerClarity measures turn-taking overlap, not audio fidelity).
//   Weighted down accordingly in compose-quality-assessment.ts - see that file's own comment.
// - 'unavailable': no signal exists at all (captionQuality, always - no caption-accuracy or
//   transcript-to-audio alignment detector exists anywhere in this codebase). Excluded from the
//   composite entirely, never coerced to a fabricated middling score.
export const QUALITY_DIMENSION_BASES = ['measured', 'proxy', 'unavailable'] as const;
export type QualityDimensionBasis = (typeof QUALITY_DIMENSION_BASES)[number];

export const qualityDimensionScoreSchema = z.object({
  // null only when basis is 'unavailable'.
  score: z.number().min(0).max(100).nullable(),
  basis: z.enum(QUALITY_DIMENSION_BASES),
  // Human-readable explanation of what this score actually measures and why - same "written for a
  // human, not a log message" convention as Editorial Director's own NegativeSignal.reason.
  notes: z.string(),
});
export type QualityDimensionScore = z.infer<typeof qualityDimensionScoreSchema>;

export const qualityDimensionScoresSchema = z.object({
  editorialQuality: qualityDimensionScoreSchema,
  narrativeQuality: qualityDimensionScoreSchema,
  technicalQuality: qualityDimensionScoreSchema,
  visualQuality: qualityDimensionScoreSchema,
  audioQuality: qualityDimensionScoreSchema,
  captionQuality: qualityDimensionScoreSchema,
});
export type QualityDimensionScores = z.infer<typeof qualityDimensionScoresSchema>;

export const finalClipQualityAssessmentSchema = z.object({
  dimensions: qualityDimensionScoresSchema,
  // Weighted average over every non-'unavailable' dimension (measured weight 1.0, proxy weight
  // 0.5 - see compose-quality-assessment.ts), clamped to [0, 100].
  compositeScore: z.number().min(0).max(100),
  // CODE-COMPUTED coverage, discounted for proxy-heavy coverage - same "kind of confidence" as
  // EditorialDecision.confidence/ClipRank.confidence, not an LLM self-report.
  confidence: z.number().min(0).max(1),
});
export type FinalClipQualityAssessment = z.infer<typeof finalClipQualityAssessmentSchema>;
