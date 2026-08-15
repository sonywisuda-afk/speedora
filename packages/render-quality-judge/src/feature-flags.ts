// Render Quality Judge Phase C1 (docs/ai/render-quality-judge.md). Follows
// isEditorialDirectorEnabled()'s exact shape (ADR D8): a boolean env var, read lazily (function
// body, not a module-level const) so it isn't captured before dotenv's config() call runs
// elsewhere in the process.
//
// Gates API/DTO exposure only - Clip.qualityAssessment is ALWAYS computed and persisted regardless
// of this flag (same "compute always, flag gates exposure only" posture as Phase A's
// render-mode editorialDecision), since this phase ships no gating/reject/re-render behavior at
// all yet (see docs/ai/render-quality-judge.md's own explicit non-goals).
export function isRenderQualityJudgeEnabled(): boolean {
  return process.env.RENDER_QUALITY_JUDGE_ENABLED === 'true';
}
