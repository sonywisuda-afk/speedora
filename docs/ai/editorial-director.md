# Editorial Director — Phase A ("Editorial Intelligence 2.0")

> **Status: Phase A shipped, flag-gated (`EDITORIAL_DIRECTOR_ENABLED`, default off).** This is the
> first phase of a much larger user-supplied 30-section mission ("Speedora Editorial Operating
> System") aimed at moving Speedora's clip quality toward Opus Clip parity by making the AI
> pipeline behave like one editorial decision-maker instead of a pile of independently-triggering
> signals — summarized by the mission's own diagnosis: **"feature-rich, decision-poor."** Phases B
> (Edit Orchestration/Budget/Conflict Resolver), C (Render QA/Auto-reject/Fallback), and D
> (Real-video benchmark/human evaluation) are explicitly out of scope for this pass, per the
> mission's own "don't do everything at once" instruction (Section 27).

## 1. Audit: the real starting condition

A 4-way parallel code audit (the actual code, not the docs) confirmed the mission's own diagnosis
and found Phase A was buildable almost entirely as an **orchestration layer over already-shipped
signals** — no new detector needed:

- **Real double-counting exists in `packages/clip-ranking`.** Its "12-13 dimension"
  `compositeScore` (`rank-clips.ts`) is a plain unweighted mean of `virality`, `hook`, `narrative`,
  `retention`, `semanticImportance`, `fusion`, and 6 `ClipScores` fields. Tracing each dimension's
  data dependencies found `virality`, `hook`, `narrative`, and `retention` all share the same
  upstream ancestors (`hookPrediction`, `narrativeGraph`, `momentumCurve`, `emotionalArc` — see
  `packages/virality-engine/src/compute-virality-prediction.ts`), and 6 `ClipScores` fields are
  *also* folded into `fusion` a second time via the Fusion Engine's own `llm: 0.05` weight
  (`packages/fusion-engine/src/feature-pipeline.ts`). This composite is also **inert** — it's
  computed and persisted (`Clip.compositeRank*`) but never used to pick a cover clip or order clips
  for the user; that decision still runs through the older, separate `highlightRank`/
  `highlightScore` path (`render-clip.worker.ts`'s Fase 31 block).
- **No semantic dedup, no diversity selection, no narrative-boundary optimization exist anywhere.**
  Only a timestamp-overlap dedup (`packages/clip-scoring/src/score-clip-candidates.ts`'s
  `deduplicateOverlappingCandidates`) and word-level boundary snapping (`snapToWordBoundaries`)
  exist.
- **No `EditorialDirector`-equivalent exists.** Nothing combines signals into one accept/reject/
  adjust decision. `detect-clips.worker.ts` (where clip boundaries are actually chosen) uses none
  of the v4 intelligence signals at all.
- **All 9 real AI Intelligence v4 signals** (hook prediction, semantic events, narrative graph,
  contextual momentum, emotional arc, multi-speaker reasoning, virality engine, retention curve
  insights, multimodal reasoning) **already compute on every render, unconditionally** — their own
  `isXEnabled()` flags gate `GET /clips/:id/intelligence` API exposure only (ADR D8), confirmed by
  reading every render-graph node file directly. They are genuinely free inputs for a new
  orchestration layer.
- **Every Visual Emphasis technique fires unconditionally** once its own flag+signal are present —
  zero benefit/cost scoring, zero shared budget, zero conflict resolver. An existing internal audit
  (`docs/ai/visual-emphasis-integration-audit.md`) already found and documented this precisely
  (Gate B1: "no arbitration rule exists between Focus Shift and Digital Push today"), deferring any
  arbitration rule to a not-yet-started Gate C. Phase A does not build that resolver (Phase B's job)
  — it operationalizes the SAME finding as a `visualInstability` negative-signal *score* instead.
- **`RenderVerificationResult` never gates or rejects anything** — purely observational. No
  pre-render validation, no quality-driven fallback/re-render exists anywhere in the render
  pipeline (confirmed by reading `render-clip.worker.ts`/`render-plan-compiler.ts`/
  `execute-render-plan.ts` directly — every quality check is explicitly best-effort/non-fatal by
  design, with explicit code comments to that effect).
- **Conversation-type classification already exists and is wired**
  (`packages/conversation-intelligence`'s `classifyConversationType()`: monologue/interview/
  discussion/debate/podcast). Speaker *roles* (questioner/answerer/host/guest) do not —
  `packages/speaker-scoring`'s `role` field is a hardcoded-null passthrough, never inferred.

## 2. Scope decisions (resolved with the user, not decided unilaterally)

Three real forks were surfaced during design and resolved via `AskUserQuestion` before
implementation, matching this repo's established practice for genuinely open architectural
questions:

1. **Boundary optimization stays pre-render, using ungrounded (transcript-only) signals.** The
   rich, GROUNDED v4 signals only exist *after* a `Clip` row with a fixed `startTime`/`endTime`
   already exists (they're computed inside `render-clip.worker.ts`'s render graph). True
   grounded-signal boundary re-cutting would require a genuinely new capability — a render-time
   feedback loop that re-cuts and re-renders — which is a materially bigger, separately-scoped
   phase. Phase A does boundary nudging *before* a `Clip` row is created, at the candidate-shortlist
   stage, using only the cheap transcript-only `NarrativeGraph`/`SemanticEvent[]` already computed
   there (Stage B, `packages/candidate-shortlist`).
2. **Candidate diversity uses heuristic text/topic overlap, not real embeddings.** No
   embedding/vector-similarity infrastructure exists anywhere in this codebase today. Adding one
   would be a new external dependency/cost line, out of proportion with this phase's other items —
   same "avoid a new capability without a proven gap" posture as the B-roll AI-illustration
   deferral (`docs/ai/broll-recommendation.md`). Phase A uses keyword/n-gram Jaccard +
   semantic-event-type overlap instead.
3. **Editorial Director only activates on the path that already pays for its LLM calls today.**
   `packages/candidate-shortlist/src/select-shortlist.ts` has a zero-LLM-call no-op passthrough
   whenever the candidate pool is already at or under the shortlist target (the common case
   whenever Candidate Expansion is off, which is the default). Editorial Director's negative-signal/
   boundary-nudge/diversity logic needs `semanticEvents`/`narrativeGraph` as inputs, which that
   no-op branch never computes. Rather than force a new, ongoing per-video LLM cost that doesn't
   exist in the pipeline today, Editorial Director only runs on the branch that already pays for
   those two calls — a real, deliberate scope boundary, not an oversight.

## 3. What shipped

A new package, **`packages/editorial-director`** (no LLM dependency — pure, synchronous
composition over already-computed inputs, same posture as `@speedora/virality-engine`), producing
one `EditorialDecision` (`packages/contracts/src/editorial-director.ts`) per candidate in two
modes sharing one contract:

- **`mode: 'shortlist'`** — runs inside `select-shortlist.ts`, using `ClipScores`, transcript-only
  `SemanticEvent[]`, transcript-only `NarrativeGraph`. Produces real behavior changes, gated behind
  `EDITORIAL_DIRECTOR_ENABLED` (default off → today's `select-shortlist.ts` behavior byte-for-byte,
  proven by a regression test):
  - **Negative-signal penalties** (`contextDependency`, `deadAir`, `confusion`, `incompleteThought`,
    `abruptEnding`, `setupTooLong`, `payoffMissing`) fold into each candidate's `editorialScore`.
  - **A bounded boundary nudge** (`nudge-boundaries.ts`, ±3s heuristic, capped by a configurable
    `maxExpansionSeconds`, default 6s) — fires only when BOTH a lexical signal (the candidate's own
    first/last transcript segment looks like it starts/ends mid-sentence) and a structural signal
    (`NarrativeGraph`'s own first/last segment isn't a setup/context or payoff-like type) agree,
    reducing false positives either alone would produce. `detect-clips.worker.ts`'s
    `shortlistRawCandidates()` applies an `applied: true` nudge to the candidate's own
    `startTime`/`endTime` before it becomes a persisted `Clip` row — the one real
    behavior-changing line outside `packages/candidate-shortlist` itself.
  - **Diversity-aware re-selection** (`compute-candidate-similarity.ts`'s `selectDiverseShortlist()`)
    — sorts by a blend of the unchanged Tier-1/2 `preRankScore` and the new
    `EditorialDecision.editorialScore` (averaging keeps BOTH the existing signal and the new
    negative-signal information meaningful, rather than one silently overriding the other), then
    skips a candidate redundant (keyword/n-gram Jaccard + semantic-event-type overlap ≥ 0.5) with
    an already-selected higher-scored one at a DIFFERENT, non-overlapping timestamp — true
    time-range overlaps are already handled upstream by `deduplicateOverlappingCandidates`.
- **`mode: 'render'`** — runs inside `render-clip.worker.ts`, immediately after the render graph's
  `graphResult` resolves (not inside the existing `compositeRank` block further down — that block
  re-queries sibling clips without transcript text, so it structurally can't run the
  `contextDependency` scan). Uses the full GROUNDED v4 signals (`hookPrediction`, `narrativeGraph`,
  `semanticEvents`, `retentionCurveInsights.dropPoints`, `emotionalArc`,
  `conversationIntelligence`) plus `editingSuggestions` density/clustering (for
  `visualInstability`/`overEditingRisk` — the two render-mode-only negative signals) and
  `conversationDynamics`-derived speaker clarity. **Computed always** (cheap, pure, no I/O — ADR D8
  posture, same as every other v4 render-graph node) and written to a new additive
  `Clip.editorialDecision` column; `EDITORIAL_DIRECTOR_ENABLED` gates only future API exposure, not
  computation. Scoring/observability only this phase — does **not** gate or reject rendering
  (that's Phase C's job). `editorialDecision` is `null` only when the clip's own `ClipScores` were
  never persisted (never fabricated).

### Fixing the double-counting problem (Editorial Score Calibration)

Instead of naively averaging correlated raw sub-scores (`clip-ranking`'s own documented bug),
`editorial-director` composes a **smaller set of 8 named editorial categories**
(`packages/contracts/src/editorial-director.ts`'s `EDITORIAL_CATEGORIES`): Content Value, Hook
Strength, Narrative Completeness, Context Completeness, Emotional Payoff, Visual Engagement*,
Speaker Clarity* (*render-mode only, `null` in shortlist mode — see §6), Platform Fit. Each has a
documented, mostly-non-overlapping source-signal mapping
(`packages/editorial-director/src/compose-editorial-score.ts`):

| Category | Source signals |
|---|---|
| `contentValue` | `ClipScores`' own "Knowledge" domain (educational/practical/novelty/trust) |
| `hookStrength` | `ClipScores`' "Engagement" domain (hookStrength/curiosity), + render mode's real `hookPrediction.hookProbability` |
| `narrativeCompleteness` | `deriveNarrativeGraphScore()` (reused directly from `@speedora/virality-engine`, zero new logic) |
| `contextCompleteness` | NEW `deriveContextCompletenessScore()` — a STRUCTURAL read of `NarrativeGraph` (does a `setup`/`context` segment exist), deliberately distinct BY METHOD from the `contextDependency` penalty (a LEXICAL pronoun/antecedent scan) to avoid recreating the exact hidden-ancestor bug the ranking audit found |
| `emotionalPayoff` | `ClipScores.emotion`, + render mode's real `EmotionalArc` peak intensity |
| `visualEngagement` | render mode only — average `editingSuggestions[].score` |
| `speakerClarity` | render mode only — derived from `ConversationDynamics.overlapRatio`, `null` for `speakerCount <= 1` (same non-penalization convention `clip-ranking`'s own `conversationEngagementScore` already established for monologues) |
| `platformFit` | `@speedora/platform-fit`'s `computePlatformFit(scores)`, unchanged, best-fit platform's score |

Categories are re-normalized over whichever are non-null for the mode (same "average of non-null"
convention `rank-clips.ts`'s own `compositeScore` already uses), minus the capped sum of
`negativeSignals[].penalty` (`MAX_TOTAL_PENALTY = 40` — a clip tripping several signals at once
reads as "meaningfully worse," not "impossible"). Weights live in one `weights.ts`, hand-authored
and labeled HEURISTIC (ADR D4 "scale honesty" convention, matching
`packages/fusion-engine/src/weights.ts`) — real ML calibration stays blocked on the same
0-production-engagement-samples constraint every other phase in this roadmap already documents;
this is the STRUCTURAL fix (stop re-counting the same ancestor signal under different names), not a
weight-tuning claim.

`packages/clip-ranking`'s existing `compositeRank` is left **untouched** — still inert, not fixed,
not removed this phase (a documented, known follow-up, not silently ignored — see §7).

## 4. Negative-signal detectors (`packages/editorial-director/src/detect-*.ts`)

Section 7 of the mission ("Negative Intelligence") — "what makes this clip bad?", not just "what is
good?":

- **`contextDependency`** (`detect-context-dependency.ts`) — scans the opening ~15 words of the
  candidate's own transcript text for ambiguous 3rd-person pronouns (`this`/`that`/`it`/`he`/
  `she`/`they`/…, deliberately excluding 1st/2nd-person) lacking a preceding antecedent. Render
  mode checks against `hookPrediction.linguisticFeatures.namedEntities` (real, already-computed);
  shortlist mode falls back to a proper-noun-shaped regex + a small hand-authored role-noun list —
  documented as a weaker, false-negative-prone proxy in that mode.
- **`deadAir`** — render mode reads `retentionCurveInsights.dropPoints`' own severity directly;
  shortlist mode falls back to a coarse proxy (unsegmented graph or zero detected semantic events).
- **`confusion`** — average `NarrativeGraph` segment-type confidence (both modes) + render mode's
  real `hookPrediction.linguisticFeatures.topicShiftScore`.
- **`incompleteThought`** — reuses `hasUnresolvedTension()`, newly extracted from
  `@speedora/virality-engine`'s `compute-virality-prediction.ts` into its own file and exported
  (mirrors `is-payoff-segment-type.ts`'s own precedent for the same reason) — a
  conflict/escalation segment with no `resolves` relation.
- **`abruptEnding`** — the clip's last narrative segment is a non-payoff type AND ends within 1.5s
  of the clip's own boundary.
- **`setupTooLong`** — leading hook/setup/context segment duration as a fraction of total clip
  duration, penalty scales past a 40% threshold.
- **`payoffMissing`** — reuses `isPayoffSegmentType` + a `resolves`-relation check.
- **`visualInstability`** (render mode only) — clusters the crop-MOVING `editingSuggestions`
  (`digital_push`/`focus_shift`/`speaker_focus_shift` — NOT `ocr_highlight`, a static overlay, or
  `reaction_hold`/`pause_hold`, purely temporal edits) within 1.5s of each other. This directly
  operationalizes the Gate B integration audit's own documented Focus-Shift+Digital-Push finding as
  a *score*, without building the arbitration rule that audit explicitly deferred to Gate C.
- **`overEditingRisk`** (render mode only) — `editingSuggestions` per minute, penalty scales past a
  6/min threshold. Deliberately distinct BY STATISTIC (density vs. clustering) from
  `visualInstability` even though both read the same array — a documented, deliberate reuse, not a
  hidden duplicate.
- **`redundancy`** (shortlist mode only — a cross-candidate comparison a single-candidate function
  can't see) — computed by `select-shortlist.ts` AFTER `selectDiverseShortlist()` has picked the
  final survivors, via `detectRedundancy()`/`mergeNegativeSignal()`. In practice this rarely fires
  for a genuine survivor (the greedy selection algorithm itself already avoids picking a redundant
  candidate); it mainly documents *why* a backfilled survivor (picked only because strict
  redundancy filtering would have left the shortlist under target) may still read as somewhat
  redundant.

## 5. Migration

`Clip.editorialDecision Json?` — nullable, additive, no backfill, no default. Mirrors the exact
`Clip.editingSuggestions`/`Clip.conversationDynamics` precedent
(`20260815130000_add_clip_editorial_decision`).

## 6. Explicit non-goals for this phase (deferred, not forgotten)

- **Edit Plan Director, Edit Budget, Effect Conflict Resolver** — Phase B.
- **Pre/post-render Quality Gate, auto-reject, safe fallback/re-render** — Phase C.
- **Real-video benchmark, blind human evaluation** — Phase D.
- **Grounded post-render boundary re-cut** — resolved: pre-render-only for this phase (§2.1).
- **Real embeddings for diversity** — resolved: heuristic for this phase (§2.2).
- **Speaker-role inference** (questioner/answerer) and **shortlist-mode `speakerClarity`** —
  diarization data isn't in `ShortlistCandidateInput` today (`shortlistDetectionSegmentSchema`
  deliberately carries no `speaker` field). Extending it to make shortlist-mode speaker signals
  possible is a separate, small follow-up, not bundled into this phase to keep scope bounded.
- **Fixing/removing `clip-ranking`'s own inert, double-counted `compositeRank`** — documented,
  known, left alone this phase (§3's last paragraph). Phase A adds a *better* signal beside it
  rather than risking that one's already-shipped call sites.

## 7. A real, unrelated bug found and fixed while wiring this phase

`packages/virality-engine`'s `deriveNarrativeGraphScore()`/`deriveSemanticEventsScore()`
(`derive-narrative-graph-score.ts`/`derive-semantic-events-score.ts`) used a **strict** `=== null`
check on their `NarrativeGraph | null`/`SemanticEvent[] | null` inputs. A real render-graph test
fixture (`render-clip.worker.spec.ts`) hands back `undefined` for an unpopulated node, not `null` —
crashing `deriveNarrativeGraphScore` the first time Editorial Director's render-mode call site
actually exercised it. This is the exact same bug class Phase 9 (Virality Engine Realignment)
already found and fixed once before, in the same package, via the identical `!= null`
loose-equality fix (see `docs/ai/intelligence-v4.md`'s Phase 9 note) — reintroduced later in a
sibling file that didn't get the same fix. Both functions now use `== null`/`!= null` consistently;
existing tests for both (which only ever exercised real `null`, never `undefined`) still pass
unchanged, confirming this is purely a widened defensive check, not a behavior change for any
currently-passing input.

## 8. Gate A1 validation (real data, not just passing tests)

Per the user's own explicit instruction ("implementation belum dianggap selesai jika hanya tests
pass"), Phase A's own decision logic was validated against real, already-imported videos in this
environment's live Postgres/MinIO (not mocked) before moving to Phase B — a scoped-down version of
the mission's own Gate A1 ("decision validation").

**Method** (`apps/worker/src/scripts/gate-a1-editorial-director-validation.ts`, reusable, not a
one-off): reads a real video's real `TranscriptSegment[]` from Postgres (read-only), calls
`scoreClipCandidates()` ONCE (one real OpenAI call, so both flag states compare against IDENTICAL
candidates rather than being confounded by LLM non-determinism across two separate generations),
then runs `selectShortlist()` twice against that same pool —
`EDITORIAL_DIRECTOR_ENABLED` unset vs `'true'` — with `targetSize` computed dynamically as half the
real pool size (so the pool-must-exceed-target activation condition, a deliberate Phase A cost-scope
decision, is actually satisfied instead of silently no-op-ing).

**Real finding**: `packages/clip-scoring`'s existing "whole-video fallback" (unrelated to this
phase, unmodified by it — see that module's own `score-clip-candidates.ts` comment, "in practice
this only fires for very short sources") fired in 3 of 5 real runs across 3 different real videos
(7-18 minutes long, not short) against the current OpenAI model — meaning most attempts returned
only 1 usable candidate, too few for a meaningful shortlist comparison. This is a real, observed
characteristic of an unrelated module against today's model behavior, not a Phase A bug — logged
here as a discovered backlog item (candidate-generation reliability), explicitly out of scope for
this phase to fix.

**What DID validate on real data** (the McDonald's Marketing Mix video, 18min/395 segments, after
2 retries produced a workable 3-candidate pool with `targetSize=2`): Editorial Director's
negative-signal detection fired correctly and meaningfully on genuine LLM output — both survivors
picked up a real `setupTooLong` penalty ("Setup occupies 88% of the clip, beyond the 40% guideline"
— a correct read on two 20-40s excerpts pulled mid-video with almost no room for a distinct payoff)
plus a small `confusion` penalty, and `editorialScore` diverged meaningfully from the unchanged
`preRankScore` (81.6 → 68.1 on the top candidate) without flipping the final ranking order for this
specific pool. A rank-flip/redundancy-elimination/boundary-nudge example was not obtained from these
3 specific real videos within this pass's budget (user-confirmed decision to stop rather than keep
spending real API cost chasing one) — the boundary-nudge and diversity/redundancy MECHANISMS
themselves remain proven at the unit level (§8 below, realistic fixtures exercising exactly these
scenarios), just not yet demonstrated end-to-end against one of these 3 particular real videos.
Gate A2 (rendered-output comparison) and Gate A3 (human evaluation) were not run this pass — both
need a case where the flag actually changes the output, which this pass didn't surface; deferred
until either a richer pool turns up (more real videos, or revisiting the fallback-frequency finding
above) or the next relevant session picks this back up.

## 9. Test coverage

- `packages/editorial-director` — 70 unit tests across 8 spec files (one per detector/composer:
  context-dependency, negative-signal detectors, similarity/diversity selection, boundary nudging,
  category composition + score composition + confidence, speaker clarity, the two top-level
  orchestrators).
- `packages/candidate-shortlist/src/select-shortlist.spec.ts` — extended with an "Editorial
  Director Phase A wiring" block: flag-off regression (editorialDecision/boundaryNudge always
  null, identical shortlist to before this phase), a diversity-selection case (a topically distinct
  lower-scored candidate survives over a redundant higher-scored one at a different timestamp), and
  a boundary-nudge case.
- `apps/worker/src/workers/render-clip.worker.spec.ts` — extended with an "Editorial Director Phase
  A (render mode)" block: `editorialDecision` is always computed regardless of the flag (ADR D8),
  `Prisma.JsonNull` when `scores` is unavailable, and additive-only (every pre-existing persisted
  field unaffected) — plus 5 existing full-object-equality tests elsewhere in the same file updated
  for the new field (a mechanical, non-behavioral update, not new coverage).
- Full `apps/worker`/`packages/candidate-shortlist`/`packages/virality-engine`/`packages/
  editorial-director` suites pass; `pnpm verify` run before considering this phase done.
