# Edit Plan Director — Phase B ("Edit Orchestration")

> **Status: Phase B shipped, flag-gated (`EDIT_BUDGET_ENABLED`, `EFFECT_CONFLICT_RESOLUTION_ENABLED`,
> both default off).** The second phase of the user's 30-section "Speedora Editorial Operating
> System" mission, building on Phase A (`docs/ai/editorial-director.md`, merged). Phases C (Render
> QA/auto-reject/fallback) and D (real-video benchmark/human evaluation) remain the roadmap's next
> phases, not started.

## 1. What this phase builds on

Phase A gave Speedora a real per-clip editorial score. It deliberately left the render pipeline's
own behavior untouched — every Visual Emphasis technique still fires unconditionally the instant its
flag+signal are present, with zero shared budget and zero conflict arbitration. This is not a new
finding: `docs/ai/visual-emphasis-integration-audit.md`'s Gate A/B (a prior, separate initiative,
already merged) did the exact audit-and-measure work this phase needed a foundation from — it
identified all 9 Visual Emphasis techniques' real interaction risks and **quantified** them against
real ffmpeg renders:

- **Focus Shift × Digital Push** (the one HIGH/unmitigated finding): both apply unconditionally,
  always — a worst-case overlap measured 531px/s peak combined crop velocity and a 160px/0.4s
  displacement (>100% of the crop's own width).
- **OCR Highlight × moving crop**: the static-highlight-box design drifts 3.7% (Low movement, still
  acceptable) → 33% (Medium, questionable) → 40%+ or the tracked box leaving the frame entirely
  (Large/Extreme) — explicitly coupled to the Focus Shift × Digital Push finding above.
- **Reaction Hold × Pause Hold**: confirmed a genuine, **intentional, correct-by-design product
  dependency** (toggling Pause Hold changes what Reaction Hold can observe, via
  `remapTimestamp()`'s own null-for-cut-away-instant semantics) — not a bug needing a resolver rule.

That audit explicitly declined to build an arbitration rule, calling it premature without real
footage (Gate C, still blocked, not started). The user confirmed this session that Phase B is a
different question: Gate B was about calibrating a specific existing technique's threshold; Phase B
is about building the governing **mechanism**, with rules informed by Gate B's real numbers rather
than guessed, following this codebase's established "heuristic now (ADR D4), calibrate with real
data later" posture. Gate C remains where these specific thresholds eventually get tuned — it is not
a precondition for building the mechanism itself.

## 2. A real data-availability constraint found during design

Gate B's own velocity/drift numbers came from actually running `buildCropPath()` and sampling pixel
output — spatial data that does not exist at the point a new arbitration layer runs (it only ever
sees the abstract `EditingSuggestion[]` timeline: `{technique, start, end, score, reason}`, no
positions). Rather than fake a velocity estimate the mechanism can't actually compute, the conflict
rules below use **time overlap** as the trigger condition — a conservative, honest proxy directly
grounded in Gate B's own test construction (B1's worst-case fixture *was* a full-overlap case; B2's
"Large/Extreme" cases were built from that same overlap). This is a real, named limitation, not
hidden.

## 3. What shipped

New package **`packages/edit-plan-director`** (pure, synchronous, no LLM/I/O — same posture as
`@speedora/editorial-director`):

- **Edit Budget** (`EDIT_BUDGET_ENABLED`) — `computeEditBudget()`: adaptive per-technique caps
  (`focus_shift`, `speaker_focus_shift`, `digital_push`, `ocr_highlight`, `reaction_hold`),
  baseline calibrated for a ~45s clip, scaled by `clipDurationSeconds` (clamped 0.5x-2x). Two real
  cross-signal integration points, not independent re-derivations: caps are **halved** when Phase
  A's own `EditorialDecision.negativeSignals` already flagged `visualInstability`/`overEditingRisk`
  for this clip (Edit Budget consumes Phase A's own finding directly, avoiding the exact
  double-counting mistake `docs/ai/clip-ranking-engine.md`'s audit found in `clip-ranking`), and
  `maxSpeakerFocusShifts` is **zeroed** when `speakerCount <= 1` (nothing to shift between, same
  non-penalization convention `clip-ranking`'s `conversationEngagementScore` already established).
  Pause Hold is excluded from budget caps entirely — protecting a pause isn't *adding* a visible
  effect, the same methodological distinction Gate B's own B5 measurements already used.
- **Effect Conflict Resolver** (`EFFECT_CONFLICT_RESOLUTION_ENABLED`) — `resolveConflicts()`,
  implementing exactly the pairwise rules Gate B's evidence grounds:
  - **Focus Shift/Speaker Focus Shift × Digital Push time-overlap** → suppress the overlapping
    `digital_push` trigger, keep the shift. "REDUCE INTENSITY" per the mission's own KEEP A/KEEP
    B/KEEP BOTH/MERGE/REDUCE INTENSITY/MOVE TIMING/DROP BOTH taxonomy, **implemented as
    suppression, not continuous magnitude damping** — `buildCropPath()` has no per-trigger
    intensity channel today, only one global `zoomInFraction`; adding one would mean extending an
    already-shipped, real-ffmpeg-verified rendering primitive
    (`packages/reframe/src/crop-path.ts`), a materially bigger and riskier change than this phase's
    scope. A real, named fidelity/safety tradeoff, not silently substituted.
  - **OCR Highlight × a SURVIVING (post-above-rule) Focus Shift/Digital Push overlap** → suppress
    the `ocr_highlight` suggestion (a static highlight box during large crop movement reads worse
    than no highlight at all, per Gate B2's own Large/Extreme measurements). Evaluated after the
    first rule so an already-suppressed `digital_push` doesn't also suppress a co-occurring OCR
    highlight it no longer conflicts with.
  - **Reaction Hold × Pause Hold** → **no suggestion is ever dropped or changed** by this rule
    (Gate B3 already proved the existing `remapTimestamp()` mechanism handles this correctly) — an
    explicit `kept`/`reaction_hold_pause_hold_product_dependency` decision is still recorded,
    satisfying the mission's own observability ask (Section 20: "why effect applied/skipped")
    without touching already-verified rendering code.
  - Every decision (suppressed or kept) produces a `ConflictDecision`
    (`{action, reasonCode, technique, start, end, relatedTechnique, reason}`) — mirrors Phase A's
    own `NegativeSignal` explainability shape.
- **Budget enforcement** — runs after conflict resolution; if a technique's surviving count still
  exceeds its `EditBudget` cap, drops the LOWEST-`score` suggestions of that technique first. This
  finally gives `EditingSuggestion.score` (`packages/contracts/src/visual-emphasis.ts`) real teeth
  — it had been a pure relative-ranking display field with no consumer since Phase C1.
- **Orchestrator** — `planEdits(input): EditPlanResult` (`{suggestions, budget, decisions}`), the
  module's single entry point. `budget` is always computed (cheap, pure — ADR D8 posture);
  `suggestions` is the identical input array, value-unchanged, whenever both flags are off (the
  default) — same "default off, zero behavior change" discipline as Phase A.

**New additive `Clip.editPlan` column** (`Json?`) persists `{budget, decisions}` — `suggestions`
itself is deliberately NOT duplicated into it (already covered by the pre-existing
`Clip.editingSuggestions` column plus this new decision trail explaining what changed from it).

## 4. Wiring

Confirmed by audit: Pause Hold and Reaction Hold read `graphResult.editingSuggestions` **directly**,
independently of `buildReframePlan()` — `computeClipCuts()` (one call site) and Reaction Hold (TWO
call sites, for the compiler-flag-on/off branches). A single arbitration point had to feed all four
consumers, not just `buildReframePlan()`'s three internal per-technique filters:

- `planEdits()` is computed once, immediately after `graphResult` resolves in
  `render-clip.worker.ts` — the same spot Phase A's `editorialDecision` already sits, reusing its
  own duration/speaker-count/negative-signal inputs directly (no new upstream computation).
- Every downstream read of `graphResult.editingSuggestions` (the `buildReframePlan()` call,
  `computeClipCuts()`, and both Reaction Hold call sites) was redirected to `editPlan.suggestions`.
  `buildReframePlan()`'s own internal `isFocusShiftEnabled()`/etc. per-technique flags are
  unaffected — they still apply on top of the already-arbitrated array (a harmless no-op filter
  when a technique was already removed).
- `editPlan` is folded into the existing `extra` object passed to `toClipUpdateData()`, same pattern
  as `editorialDecision`.

## 5. A real, pre-existing TS2742 pitfall hit twice while wiring this phase

`docs/coding-standards.md`'s own documented pitfall: adding a new `Json?` column to `Clip` reliably
breaks `apps/api`'s `nest build` wherever it leaks through `VideosService.mapVideoWithClips`'s
unnarrowed `...clip` spread. Fixed with the established pattern — destructure `editPlan` out of the
spread, narrow it through a new `toSharedEditPlan()` in `transcript-segment.util.ts`. The type
mirror itself (`EditBudget`/`ConflictDecision`/`EditPlan`) was added to `packages/shared/src/types/
video.ts` (not imported from `@speedora/contracts` — `packages/shared` has zero cross-package
dependencies, mirroring every v4 type by hand, the same lesson Phase A's own equivalent fix
re-learned). Verified against the actual `nest build` (declaration emit) both times, not just
`tsc --noEmit`, per that doc's own explicit warning that a plain typecheck can miss this.

## 6. Test coverage

- `packages/edit-plan-director` — 27 unit tests across 4 spec files (budget scaling/clamping/
  instability-halving/speaker-zeroing; each conflict rule's overlap/no-overlap/already-suppressed
  cases; budget enforcement's lowest-score-drops-first behavior + independent-per-technique
  enforcement + ordering preservation; the orchestrator's flag-off passthrough and all 4 flag
  on/off combinations).
- `apps/worker/src/workers/render-clip.worker.spec.ts` — a new "Edit Plan Director Phase B" wiring
  block (3 tests) proving the arbitration reaches BOTH real, externally-mockable seams the render
  pipeline exposes: `buildCropPath()` (via `buildReframePlan()`) and `applyReactionHolds()` (via the
  local `computeReactionHoldInstants()`) — not just asserting at the orchestrator level. Plus the
  existing 5 full-object-equality tests updated for the new field (mechanical, non-behavioral).
- `apps/api/src/videos/videos.service.spec.ts` — the one full-object-equality test needing the new
  `editPlan: null` field, same mechanical update.
- Full `apps/worker` (222/222), `packages/edit-plan-director` (27/27), `packages/shared` (89/89),
  and the specific `apps/api` test file (102/102) all pass; both `nest build` and repo-wide
  `pnpm format:check` verified clean before push.

## 7. Explicit non-goals for this phase

- **True continuous zoom-magnitude damping** — would require extending `packages/reframe`'s
  `buildCropPath()` itself with a per-trigger intensity channel it doesn't have today. Deferred,
  documented as a fidelity tradeoff in §3 above.
- **Caption emphasis / B-roll conditional-inclusion logic** (mission Sections 14/15) — B-roll
  already has its own `maxCutaways` setting from a prior initiative; folding it into this budget
  mechanism is a separate, later scope decision, not assumed here.
- **A full cross-domain `EditPlan` data structure** spanning captions/B-roll/reframing as one
  unified object (mission Section 10's broadest framing) — this phase scopes to the visual-effects
  domain (the one with real, already-quantified conflict evidence to build against); broadening to
  other domains is a possible future follow-up, not bundled here.
- **Gate C real-footage calibration** of the specific thresholds chosen here — still blocked on
  real footage, as before; this phase ships the mechanism Gate C will eventually calibrate.
