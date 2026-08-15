// Editorial Director Phase A. Follows isNarrativeGraphEnabled()'s/
// isHookPredictionEnabled()'s exact shape (ADR D8): a boolean env var, read
// lazily (function body, not a module-level const) so it isn't captured
// before dotenv's config() call runs elsewhere in the process.
//
// Unlike most v4 flags, this one has TWO distinct meanings depending on
// where it's checked (see docs/ai/editorial-director.md):
// - @speedora/candidate-shortlist's select-shortlist.ts: gates REAL
//   BEHAVIOR - off means today's shortlist selection/boundaries exactly,
//   byte-for-byte.
// - render-clip.worker.ts: does NOT gate computation - Clip.editorialDecision
//   is always computed and persisted once the migration ships (same
//   "compute always, flag gates exposure only" ADR D8 posture as every
//   other v4 render-graph node), only future API exposure is gated by this
//   flag.
export function isEditorialDirectorEnabled(): boolean {
  return process.env.EDITORIAL_DIRECTOR_ENABLED === 'true';
}
