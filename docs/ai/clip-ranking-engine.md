# Clip Ranking Engine (spec Part 10, AI Intelligence v4 Track A Phase 13-14)

> **Status: audit + ADR + roadmap complete; Phase 13.1, 13.2, 14.1, and 14.2 shipped.** This document is
> the required audit-first deliverable (repo audit, reuse map, tech debt, ADR, dependency graph,
> phased roadmap, complexity/risk) for what `docs/ai/intelligence-v4.md`'s roadmap table already
> named **Phase 13 (Candidate Expansion, spec Part 10 generation half)** and **Phase 14 (Ranking
> Refinement + Personalization, spec Part 10 rank half + Part 11)**. Nothing here is a new
> initiative — it is the next unstarted phase of a roadmap already in flight, pulled forward ahead
> of Phase 12 (Explainability) at the user's explicit direction (2026-08-10). Phase 12 remains
> unstarted and unaffected; it can consume both the pre-existing v4 signals and this engine's
> ranking output whenever it's picked up.

## 1. Audit: what already exists

The mission asked for a ranking engine over 12 dimensions (Fusion, Virality, Narrative, Hook,
Retention, Semantic Importance, Novelty, Emotion, Practical Value, Educational Value, Curiosity,
Trust) selecting a top 10 from >= 30 candidates. Reading the actual code (not recalling from memory)
found **zero new detectors are needed** — every dimension already has a shipped source:

| Dimension | Existing source | Pre-render feasible? |
|---|---|---|
| Novelty, Emotion, Practical Value, Educational Value, Curiosity, Trust | `ClipScores` (`packages/clip-scoring/src/score-clip-candidates.ts`) — `novelty`/`emotion`/`practicalValue`/`educationalValue`/`curiosity`/`trustAuthority` | **Yes — already computed for free**, in the same LLM call that finds candidates. Also already folded into Fusion's `llm` signal at 5% weight (`packages/fusion-engine/src/feature-pipeline.ts:422-479`), so these 6 dimensions are simultaneously a Stage-A-free signal *and* a (diluted) contributor to the existing Fusion score. |
| Semantic Importance | `packages/semantic-events` (Phase 2, shipped) | **Yes for base detection** — one LLM call over transcript text, no video decode. The evidence-grounding half (`packages/multimodal-reasoning`) does need OCR/vision output and is NOT required for a ranking signal. |
| Narrative | `packages/narrative-graph` (Phase 3, shipped) | **Yes** — confirmed by reading `build-narrative-graph.ts`: input is `{ segments, semanticEvents, clipDurationSeconds }`, zero render-graph dependency in the module itself. It's only ever *called* from inside the render-graph today; nothing about the module requires that. |
| Hook | `packages/hook-prediction` (Phase 1, shipped) | **No** — `hookPredictionNode` (`apps/worker/src/render-graph/nodes/hook-prediction.ts:62`) depends on `audioFeatures` (real audio decode of the source clip) and `speakerFusionFeatures`. Only its pause-feature half (`hookPauseFeaturesNode`) is transcript-only/cheap. |
| Retention | `packages/retention-curve-insights` (Phase 10, shipped) | **No** — built on `MomentumCurve` (needs Scene Intelligence motion detection, vision-dependent) + `EmotionalArc`. |
| Virality | `packages/virality-engine` (Phase 9, shipped) | **No** — composes Hook + Narrative + Momentum + EmotionalArc, inherits the vision/audio dependency transitively through Hook and Momentum. |
| Fusion | `packages/fusion-engine` | **No** — the most expensive; needs nearly the full render-graph (scene, facial, gesture, OCR, object, composition, audio, speaker). |

This splits cleanly into cost tiers, which is the load-bearing fact for the ADR below:

- **Tier 1 (free today)**: the 6 `ClipScores` dimensions — already returned by the candidate-picking
  LLM call, zero marginal cost regardless of how many candidates are requested.
- **Tier 2 (cheap, transcript-only LLM calls, no video decode)**: Semantic Importance, Narrative.
- **Tier 3 (needs audio decode, no vision)**: Hook's LLM half.
- **Tier 4 (needs the full vision + audio render-graph)**: Retention, Virality, Fusion.

## 2. Technical debt found (blocks candidate expansion regardless of ranking design)

`packages/clip-scoring/src/score-clip-candidates.ts:270` — the system prompt sent to the LLM has
**"Pick 1-3 non-overlapping clips" hardcoded as a literal string**, independent of the
`maxCandidates` parameter. `maxCandidates` is already threaded through end-to-end (Pre-Processing
Settings roadmap added it, `detect-clips.worker.ts`'s `UNLIMITED_CLIP_COUNT_CAP = 50` already
anticipates a high value) but only used for a post-hoc `.slice(0, maxCandidates)` — the model itself
is never told the real ceiling. Today, passing `maxCandidates: 30` returns the same 1-3 candidates
it always did. This was already flagged in `intelligence-v4.md`'s roadmap table (Phase 13 risk
column) but not fixed. **Phase 13.1 below fixes this first**, since every later stage depends on
actually getting 30 real candidates out of the LLM call.

## 3. ADR

**D16 (carried from the Parts 4-15 re-audit, resolved here).** *Pre-render vs. post-render
tension*: running Tier 4 signals (Fusion/Virality/Retention) for 30 candidates instead of the
current 1-3 would be a ~10x worker-cost multiplier per video, mostly spent on candidates that won't
make the top 10, because `render-clip.worker.ts`'s render-graph does full ML inference (frame
extraction, MediaPipe face/gesture/object, OCR, scene-cut/motion, audio decode) **and** produces the
final encoded clip in the same job — there is no cheaper "analysis only" mode today.

**Resolution (user-confirmed 2026-08-10): a 3-stage funnel**, matching signal cost to selection
confidence instead of running every signal on every candidate:

- **Stage A (Tier 1, free)** — one LLM call generates the full candidate pool (>= 30), each already
  carrying `ClipScores`.
- **Stage B (Tier 2, cheap)** — Semantic Importance + Narrative computed per candidate over
  transcript text only (no video decode) → a pre-rank composite over 8 of 12 dimensions → cuts the
  pool to a shortlist (target ~12-15).
- **Stage C (Tier 3+4, expensive, mechanism unchanged)** — only the shortlist goes through the
  existing render-graph exactly as it does today per persisted `Clip` row → Hook, Retention,
  Virality, Fusion.
- **Stage D** — final 12-dimension composite over the shortlist's render outputs → top 10.

This bounds the worst-case render-graph cost increase to ~4-5x (shortlist size) instead of 10x
(full pool), without touching the render-graph's internals at all. Explicitly rejected: running the
full render-graph on all 30 (simplest, but full 10x cost with no mitigation) and decoupling
render-graph analysis from final ffmpeg encoding (would let all 30 get cheap-enough analysis, but is
a materially bigger prerequisite refactor of `render-clip.worker.ts` — deferred, not ruled out, see
§6).

**D17 (new). Candidate-generation strategy**: single LLM call with an expanded prompt/output budget
(not chunked/windowed multi-call generation), confirmed by the user as the starting strategy.
Accepted risk: one call reasoning over 30 slots at once on a long transcript may show quality
dilution versus today's 1-3; **the mitigation is measurement, not a different architecture** —
Phase 13.1 explicitly needs a before/after quality check (candidate diversity, overlap rate,
duration-bound compliance) before Phase 13.2 builds on top of it. If dilution turns out to be real,
the fallback is the already-designed alternative (windowed generation reusing Generate More Clips'
`excludeRanges` pattern) — not a redesign, just switching D17's chosen branch.

**D18 (new). Non-destructive output**: Stage D's ranking must never delete or hide the ~2-5
shortlisted-but-not-top-10 rendered clips. Every clip that survives Stage C gets fully rendered and
stays queryable; ranking only orders/labels the top 10 as recommended. This follows the project's
own standing "no big refactors, backward compat" rule and avoids adding a destructive path to the
video state machine for what is fundamentally a display/ordering concern. (Concrete mechanism is
Phase 14.2's job — flagged there as still needing its own design pass, not decided yet.)

## 4. Dependency graph

```
                    Video (TRANSCRIBED)
                            │
                            ▼
              scoreClipCandidates() [FIXED Phase 13.1]
              one LLM call, maxCandidates >= 30, real
              prompt ceiling (not hardcoded "1-3")
                            │
                            ▼
              RawCandidate[] (>= 30), each already
              carrying ClipScores (Tier 1, free)
                            │
                            ▼
   ┌────────────────────────────────────────────────┐
   │  Stage B — Phase 13.2 (NEW pre-render adapter)  │
   │  per candidate, transcript-only:                │
   │    detectSemanticEvents()  (Phase 2, existing)  │
   │    buildNarrativeGraph()   (Phase 3, existing)  │
   │  → cheap composite score → shortlist ~12-15     │
   └────────────────────────────────────────────────┘
                            │
                            ▼
         createCandidateClips() + enqueueRendersForCandidates()
         (clip-persistence.ts, UNCHANGED mechanism) — only for
         the shortlist, not the full pool
                            │
                            ▼
              render-clip.worker.ts / renderClipGraph
              (UNCHANGED — Hook, Momentum, EmotionalArc,
               Virality, RetentionCurveInsights, Fusion
               all run exactly as they do today, per clip)
                            │
                            ▼
   ┌────────────────────────────────────────────────┐
   │  Stage D — Phase 14.1/14.2 (NEW join + compose) │
   │  once every shortlisted clip finishes render:   │
   │    composite rank over all 12 dimensions        │
   │    → mark/order top 10, never delete the rest   │
   └────────────────────────────────────────────────┘
```

Every box marked UNCHANGED is a reused existing package/mechanism — this confirms the "compose,
don't rebuild" pattern every prior v4 phase has followed also holds here. The two NEW pieces are
Stage B (a pre-render adapter that doesn't exist yet) and Stage D's join point (no such barrier
exists in the current per-clip-independent render pipeline).

## 5. Phased roadmap

| Phase | Name | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| 13.1 | Fix hardcoded candidate-count prompt + raise ceiling — **shipped, flag-off** | none | S-M | Quality dilution at 30-in-one-call (D17) — needs a before/after measurement, not just a prompt edit |
| 13.2 | Cheap pre-rank shortlist stage (Stage B) — **shipped** | 13.1 | **L** (biggest single piece, matches original Phase 13 estimate) | New pre-render adapter stage; LLM cost — up to 2 extra calls x 30 candidates per video, bounded via a fixed concurrency batch (5); double-paying for Semantic Events/Narrative Graph on shortlisted survivors (Stage C's render-graph recomputes both, WITH real grounding) is a deliberate, documented scope decision for this phase, not solved — see "Phase 13.2 architecture" below |
| 14.1 | Composite ranking function (Stage D scoring) — **shipped** | 13.2 (shape only, can build against fixtures) | M | Weighting 12 heterogeneous, mostly-uncalibrated signals into one order — resolved by equal-weighting every non-null dimension (same "average of non-null" pattern `ViralityPrediction.overallViralScore` already established) rather than an arbitrary hand-picked weighting; mirrors `fusion-engine/rank-clips.ts`'s shape but multi-signal |
| 14.2 | Pipeline wiring — the join point — **shipped** | 13.2, 14.1 | **S** (re-scoped down from L once audited — no new barrier needed, an equivalent one already existed) | Original risk ("needs a new barrier that doesn't exist") was based on an incomplete audit — `render-clip.worker.ts` already has one (the atomic per-clip-completion transaction that flips `Video.status → RENDERED`); this phase composes with it instead of inventing a new mechanism — see "Phase 14.2 architecture" below |
| 14.3 | Personalization (`WorkspaceContentProfile`, D10) | 14.1 | M | **Out of scope for this delivery** — the mission asked for a Ranking Engine, not personalization; left as a documented future follow-up reusing `platform-fit`'s weighted-sum pattern, per the project's own scope-boundary convention |

## 6. Explicitly deferred / out of scope

The mission prompt also named three unrelated gaps versus reference platforms — logged here as
backlog, not built as part of this engine, per the project's standing rule to spin off unrelated
findings rather than scope-creep the current feature:

- **AI B-roll Recommendation** (auto-insert logos/illustrations/stock footage on named-entity
  mentions) — extends the existing 3-provider B-roll adapter; not started.
- **Silence Compression / rhythm reflow** ("I think ... Apple ... will lose" → "I think Apple will
  lose") — a materially bigger risk than the existing Smart Trim/silence-gap removal
  (`packages/cutlist`), since it implies word-level splice + audio re-timing for naturalness, not
  just gap deletion. Not started.
- **Attention Curve Optimization (predictive cut)** — Retention Curve Insights (Phase 10, shipped)
  already predicts drop points; nothing currently *acts* on that prediction by cutting. Closest
  existing lever is Visual Emphasis Engine's Pause Hold/Reaction Hold machinery. Not started.

Also deferred: `render-clip.worker.ts`'s analysis/encode decoupling (would let Stage C run on all 30
candidates instead of just the shortlist) — a legitimate future cost optimization, not ruled out,
just bigger than this delivery needs.

## Phase 13.1 architecture (as shipped)

`packages/clip-scoring/src/score-clip-candidates.ts` — the system prompt's hardcoded
`"Pick 1-3 non-overlapping clips"` is now `` `Pick between 1 and ${maxCandidates} non-overlapping
clips` ``, plus explicit "don't pad with filler, don't stop early" guidance. `maxCandidates` still
defaults to 3 (`MAX_CANDIDATES`) for any caller that omits it, so the rendered prompt text for every
existing caller is byte-for-byte `"Pick between 1 and 3 non-overlapping clips"` — a wording change
from the literal old string, but not a behavior change (no test asserted the old exact string, only
`.toContain` checks on unrelated substrings).

`packages/clip-scoring/src/feature-flags.ts` (new) — `isCandidateExpansionEnabled()` (env var
`CANDIDATE_EXPANSION_ENABLED`, same lazy-read/ADR-D8 shape as every prior v4 flag) and
`CANDIDATE_EXPANSION_POOL_SIZE = 30` (the Stage A pool size target). Unlike most v4 flags (which
gate DTO exposure while computation always runs), this one gates real computation — how many
candidates `detect-clips.worker.ts` asks the paid LLM call for by default — because raising it is a
real cost change, not a free/idempotent analysis step.

`apps/worker/src/workers/detect-clips.worker.ts`'s `toScoringInput()` — an explicit
`Video.processingOptions.clipGeneration.clipCount` (a number or `'unlimited'`) still wins
unconditionally, exactly as before this phase. Only the omitted-clipCount case (the common case)
now checks the flag: on, it requests `CANDIDATE_EXPANSION_POOL_SIZE` instead of silently falling
through to the module's own small default. Flag off (the default) reproduces every pre-Phase-13
render exactly.

**Not yet done**: the D17-mandated before/after quality measurement (candidate diversity, overlap
rate, duration-bound compliance at 30-in-one-call vs. today's 1-3) — needed before flipping
`CANDIDATE_EXPANSION_ENABLED` on anywhere, and before Phase 13.2 builds the shortlist stage on top
of this pool. Also not yet done: any change to `response_format`'s JSON schema or an explicit
`max_tokens` budget — at ~30 verbose candidate objects (9 numeric scores + several string fields
each), a rough estimate lands comfortably under gpt-4o-mini's default output ceiling, but this is
worth re-checking once real output is measured, not assumed safe indefinitely.

**Verification**: `packages/clip-scoring` 30/30 (2 new prompt-scaling tests + a new
`feature-flags.spec.ts`), `apps/worker`'s `detect-clips.worker.spec.ts` 22/22 (3 new flag-behavior
tests) and `generate-more-clips.worker.spec.ts` 8/8 (confirms its own, differently-shaped
`@speedora/clip-scoring` mock is unaffected), both packages' `typecheck`/`build`/`lint` green,
`prettier --check` green on every touched file.

## Phase 13.2 architecture (as shipped)

New package `packages/candidate-shortlist` (`@speedora/candidate-shortlist`):

- `derive-shortlist-score.ts` — the pure composite scoring function, `deriveShortlistScore()`.
  Combines three sub-scores, each independently bounded to `[0, 100]`, as a weighted sum (weights
  0.5/0.25/0.25, HEURISTIC/ADR D4, unvalidated): **llmScore** (Tier 1, free — averages `viralityScore`
  with the mean of ALL `ClipScores` fields, deliberately not a cherry-picked subset, so it stays
  correct if `ClipScores` grows a field later), **semanticImportanceScore** (Tier 2 — mean
  `SemanticEvent.importance` across detected events; `null` — an LLM failure — scores neutral (50),
  a real empty detection scores below neutral (20), since "the model tried and found nothing" is
  real information a failure isn't), **narrativeScore** (Tier 2 — `null` scores neutral;
  `unsegmented: true`, `@speedora/narrative-graph`'s own real-but-structureless result, scores below
  neutral (40); a real segmented graph scores on mean segment-type confidence plus a bonus for
  reaching a payoff segment type, reusing `isPayoffSegmentType()` from `@speedora/virality-engine`
  rather than reimplementing it).
- `select-shortlist.ts` — the orchestration entry point, `selectShortlist()`. A no-op passthrough
  (every candidate survives, in original order, zero LLM calls) when the input pool is already at or
  under `targetSize` (default `DEFAULT_SHORTLIST_TARGET_SIZE = 15`, the doc's own "~12-15" range,
  picked at the upper end since the composite is unvalidated) — this is what makes Phase 13.1's flag
  off (or any small explicit `clipCount`) cost nothing extra, unchanged from every pre-Phase-13
  render. When the pool exceeds the target, it fans out `detectSemanticEvents()` +
  `buildNarrativeGraph()` per candidate in fixed batches of 5 (`LLM_CONCURRENCY`) — a real, if
  modest, guard against a single BullMQ job firing up to 60 concurrent OpenAI requests, a risk this
  codebase hadn't needed to handle before (every prior v4 LLM call happens once per already-
  independent render-clip job). Both calls are un-grounded (`ocrTracks: []`, `objectTracks: []` —
  neither exists yet at this pre-render stage) and best-effort: either failing degrades that one
  candidate's score toward neutral rather than failing the whole shortlist pass or the detect-clips
  job.

`apps/worker/src/workers/detect-clips.worker.ts`'s new `shortlistRawCandidates()` calls
`selectShortlist()` between `scoreClipCandidates()` and `createCandidateClips()` — a candidate the
shortlist cuts never gets a `Clip` row or a render job at all, so ADR D18 (non-destructive output)
isn't in tension here: nothing was ever created for it to delete. `generate-more-clips.worker.ts` is
untouched — Phase 13.2 only wires into the original video-upload detect-clips flow, per the funnel
design; extending the same shortlist stage to that endpoint's own `requestedCount` is a documented
future follow-up, not silently out of scope.

**Deliberate scope decision, not solved**: Stage C's render-graph (`semanticEventsNode`,
`narrativeGraphNode`) is completely unchanged — it recomputes Semantic Events/Narrative Graph from
scratch for whichever candidates survive the shortlist, WITH real OCR/object grounding evidence this
pre-render pass can never have. This means a shortlisted survivor is paid for twice (once ungrounded
at Stage B across the full pool, once grounded at Stage C across just the survivors) rather than
Stage B's result being threaded through and reused. Considered and explicitly deferred: Stage C's
version is strictly more informed (real grounding) and is also consumed by several other downstream
signals (Retention Curve Insights, Virality Prediction, Multimodal Reasoning) that need that
grounding regardless of whether Stage B ran — reusing Stage B's ungrounded result there would
actually be a regression for those consumers, not a pure win. Revisit only if real cost data shows
this double-payment matters in practice.

**Verification**: `packages/candidate-shortlist` new suite 13/13 (`derive-shortlist-score.spec.ts`
covers every branch — neutral midpoint, both [0,100] extremes, empty-vs-failed detection, unsegmented
vs. segmented-with-payoff; `select-shortlist.spec.ts` covers the passthrough no-op, the default
target size, the cut-and-sort behavior, clip-relative segment re-anchoring, LLM-failure degradation,
and semantic-events-as-narrative-context threading), `packages/contracts` 183/183 (unchanged count -
the new contract file needed no dedicated spec, same precedent as `narrative-graph.ts`/
`semantic-events.ts`), `apps/worker`'s `detect-clips.worker.spec.ts` 25/25 (22 pre-existing pass
unchanged via the real passthrough path + 3 new tests exercising the real cut-and-sort integration,
mocked only at the true `@speedora/semantic-events`/`@speedora/narrative-graph` LLM boundary, not at
`@speedora/candidate-shortlist` itself), `generate-more-clips.worker.spec.ts` 8/8 confirmed
unaffected, `typecheck`/`build`/`lint`/`format` all green across every touched/new package.

## Phase 14.1 architecture (as shipped)

New package `packages/clip-ranking` (`@speedora/clip-ranking`):

- `derive-sub-scores.ts` — `deriveSubScores()` maps each of the 12 named dimensions from
  already-computed post-render signals onto a `[0, 100]` (or `null`) sub-score: **Fusion** =
  `Clip.highlightScore` directly; **Virality** = `viralityPrediction.overallViralScore` scaled from
  `0-1` to `0-100`; **Narrative**/**Semantic Importance** = delegate to
  `@speedora/candidate-shortlist`'s own `deriveNarrativeGraphScore()`/`deriveSemanticEventsScore()`
  (exported publicly this phase, previously module-private) — the formula is agnostic to whether the
  underlying detection was grounded, so Stage D's real grounded post-render `NarrativeGraph`/
  `SemanticEvent[]` reuses the exact same scoring shape Stage B already validated, rather than a
  second hand-written heuristic drifting apart from the first; **Hook** = `hookPrediction.
  hookProbability` directly; **Retention** = a new two-component score over `RetentionCurveInsights`'
  4 point arrays (a penalty from `dropPoints`' own already-computed severity, a bonus from
  `replayZones`/`emotionalPeaks`/`curiosityPeaks`, both around a neutral 60 baseline so a genuinely
  flat momentum curve is neither penalized nor rewarded) — this is the one genuinely NEW scoring
  formula this phase adds, since nothing before it collapses `RetentionCurveInsights`' 4 arrays into
  one scalar; **Novelty/Emotion/Practical Value/Educational Value/Curiosity/Trust** = the 6
  `ClipScores` fields mapped straight through, unaltered. `Narrative`/`Hook`/`Semantic Importance`/
  `Fusion` are `null` (excluded, not defaulted) when their source is unavailable; `Retention` and the
  6 `ClipScores` dimensions are never null.
- `rank-clips.ts` — `rankClipCandidates()` takes a batch, computes each clip's `compositeScore` as
  the average of every non-null sub-score (equal weighting across all 12 — deliberately not a
  hand-picked weighting scheme, for the same "avoid defending an arbitrary priority order" reasoning
  Stage B's own `averageClipScores()` already used) and `confidence` as `count(non-null)/12`, then
  sorts desc (nulls last, stable by input order) and assigns `rank`, mirroring
  `@speedora/fusion-engine`'s own `rankClips()` shape.

**Scope, exactly as planned**: this phase is scoring only. `rankClipCandidates()` takes an
already-assembled `ComputeClipRankInput[]` and has no opinion on where that array comes from or when
it's safe to call it — assembling it from real `Clip` rows, and deciding when enough of a shortlist
has finished rendering to call this function, is Phase 14.2's own job, not started here. No new
migration, render-graph node, or worker wiring in this phase — `packages/clip-ranking` currently has
no consumer in `apps/worker`/`apps/api`, same "framework proven on fixtures before any caller exists"
precedent Fusion Engine v3's M2A milestone already set.

**Verification**: `packages/clip-ranking` suite 13/13 (every sub-score's null-vs-delegate behavior,
retention's penalty/bonus/neutral-baseline behavior and its `[0, 100]` bound, rank ordering,
confidence coverage at both full and reduced availability, an empty-batch edge case),
`packages/candidate-shortlist` 13/13 (unchanged behavior), `packages/virality-engine` 56/56 (43
pre-existing + 13 new, see the CI-fix note below), `packages/contracts` 183/183 (unchanged count, no
dedicated spec needed for the new contract file), `typecheck`/`build`/`lint`/`format` all green.

**A real CI-only bug, caught and fixed after this phase's first PR push** (not caught by any local
verification before pushing — worth internalizing, not just documenting): this monorepo's
`injectWorkspacePackages: true` setting causes pnpm to resolve a `packages/*` → `packages/*` sibling
dependency as an isolated, self-contained copy (`file:packages/X(<peer-dep-suffix>)`) rather than a
live symlink (`link:../X`) whenever the target package transitively touches a dependency with
peer-dependency-affected resolution AND the consumer has no matching anchor of its own. Concretely:
`clip-ranking` originally depended on `candidate-shortlist` to reuse its `deriveNarrativeGraphScore`/
`deriveSemanticEventsScore` functions — `candidate-shortlist` transitively depends on `openai` (via
`@speedora/llm-client`), and `openai`'s own package.json declares peer dependencies
(`@aws-sdk/credential-provider-node`/`@smithy/signature-v4`/`ws`/`zod`). `apps/worker` (which also
depends on `candidate-shortlist`) resolves it as a plain `link:` because `worker` itself directly
depends on `openai`, giving pnpm a consistent anchor; `clip-ranking` has no such anchor, so pnpm
isolated it instead. The injected copy's `dist/` is a snapshot taken at `pnpm install` time and does
NOT get refreshed by a later `pnpm --filter "./packages/**" build` step building the SOURCE package —
so `candidate-shortlist` building successfully right before `clip-ranking` in CI's own log didn't
help; `clip-ranking`'s `tsc` still failed with `TS2307: Cannot find module '@speedora/
candidate-shortlist'`. A `node_modules` wipe "fixed" it locally only because local dev already had
stale-but-present `dist/` output on disk from earlier builds in the same working tree — it never
reproduced CI's genuinely fresh-checkout state, which is why the bug shipped past local verification.
**Real fix**: relocated both functions into `@speedora/virality-engine` (already the shared home for
`isPayoffSegmentType`), which has zero `openai`/`llm-client` anywhere in its own dependency tree —
`candidate-shortlist` now imports them FROM `virality-engine` (a dependency it already had) instead
of defining them, and `clip-ranking` depends on `virality-engine` directly instead of
`candidate-shortlist`. Confirmed via the same reproduction methodology that first caught the bug: a
full `node_modules` + every package's `dist/` wipe, a `pnpm install` to check the lockfile's
resolution (`virality-engine` now resolves `link:` from `clip-ranking`, confirmed), then
`pnpm --filter "./packages/**" build` from that genuinely clean state. **Lesson for future phases**:
when verifying a new `packages/*` → `packages/*` sibling dependency, a `node_modules`-only wipe is
NOT sufficient to catch this class of bug — wipe every package's `dist/` too, or the local repro will
silently pass while CI still fails.

## Phase 14.2 architecture (as shipped)

**The audit correction that re-scoped this phase down from L to S**: this document's own §5 roadmap
table originally flagged Phase 14.2 as needing "a new 'all shortlisted renders complete' barrier that
doesn't exist in today's per-clip-independent pipeline." That was wrong — written before actually
reading `render-clip.worker.ts`'s own completion logic. It already has exactly this barrier: every
clip render's own success transaction queries all sibling `Clip` rows, counts how many have
`outputUrl !== null`, and the execution that observes every sibling done atomically flips
`Video.status → RENDERED` — a race-free "last one out turns off the lights" pattern, no BullMQ
job-dependency/flow feature needed. Right beside it (same file, same `try`/`catch`-wrapped,
never-fails-the-job posture) is an existing ranking pass ("Ranking (Fase 31)") that recomputes
`Clip.highlightRank` via `@speedora/fusion-engine`'s own `rankClips()`. Phase 14.2 is a second,
additive pass beside that one, not a new mechanism.

**A real naming trap, caught before merge**: Fase 31's own ranking pass sits INSIDE the
`if (allRendered) { ... }` block — despite its comment reading "only meaningful once every clip...
has a highlightScore," it doesn't just prefer that condition, it's structurally gated by it, so it
only ever executes ONCE, on the single job execution that happens to be the last sibling to finish.
This session's own design discussion (recorded in the AskUserQuestion above) proposed "progressive,
every completion" as "mirroring the existing Fase 31 pattern" — that framing was incorrect. The
implementation was first written nested inside the same `if (allRendered)` block (silently making it
"wait for all" despite the user's explicit choice), caught by re-reading the code's own brace
structure before testing, and moved to sit AFTER that block closes instead — a sibling statement in
the same function scope, unconditional, so it genuinely runs after every clip's own render completes,
not just the last one.

**`packages/database`**: a real migration (`20260810073022_clip_ranking_composite_score`) adds 4
nullable `Clip` columns — `compositeRankScore Float?`, `compositeRank Int?`,
`compositeRankConfidence Float?`, `compositeRankSubScores Json?` — placed after `multimodalReasoning`
(the last Track A v4 signal field), deliberately NOT touching `highlightScore`/`highlightRank` or the
thumbnail cover-clip-selection logic that reads them (both stay completely untouched, same "strictly
additive" posture every prior v4 phase has followed).

**`apps/worker/src/workers/render-clip.worker.ts`**: a new block, its own `try`/`catch` (a failure
here can never affect Fase 31's `highlightRank`/cover-clip logic, or vice versa), placed right after
the `if (allRendered)` block closes:
1. Queries every RENDERED sibling (`outputUrl: { not: null }` — the real filter, unlike Fase 31's own
   unfiltered `where: { videoId }`, since Fase 31 only ever runs when every sibling is already
   rendered by construction) — covering both original `detect-clips` candidates and later "Generate
   More Clips" top-ups, same scope as Fase 31's own sibling query.
2. Filters out any clip missing `scores`/`viralityPrediction`/`retentionCurveInsights` (should only
   happen for rows predating this initiative's migrations — every render-graph node backing these is
   `optional: false`) — skipped, not defaulted, same "don't fabricate data" posture as everywhere else.
3. Maps the survivors into `ComputeClipRankInput[]` (a single documented cast per field, matching this
   codebase's established "trusted shape, one cast at a boundary" convention) and calls
   `rankClipCandidates()`.
4. Writes `compositeRankScore`/`compositeRank`/`compositeRankConfidence`/`compositeRankSubScores` back
   onto each ranked clip.

An unrendered sibling is never included with a placeholder score — `ComputeClipRankInput` requires
several fields (e.g. `viralityPrediction`) as real, non-null objects that genuinely don't exist until
that clip's own render-graph has run, so it's simply absent from the ranked batch until its own render
completes and re-triggers this same block with one more clip now eligible.

**Deliberately out of scope, same as Phase 14.1**: no API/DTO exposure. The columns are computed and
persisted on every qualifying render, but nothing reads them yet — no UI consumer exists to expose
them to (this initiative's roadmap only reaches Explainability at Phase 12, not yet started). This
mirrors Fusion Engine v3's own "framework proven, no caller yet" precedent, not an oversight.

**Verification**: `packages/database` migration applied cleanly against a real local Postgres,
`packages/database` rebuilt (dist wrapper). `apps/worker`'s `render-clip.worker.spec.ts` — the single
largest spec file in this codebase — full suite 124/124 (120 pre-existing unchanged + 4 new: computes
and persists all 4 new fields for a fully-rendered pair with correct rank ordering; excludes an
unrendered sibling from the ranked batch entirely rather than scoring it; never fails the job when the
new block itself throws; never runs at all on the P2025 concurrent-claim early-return path).
`typecheck`/`build`/`lint`/`format` all green. **A real test-authoring bug caught and fixed before
this was considered done**: two of the new tests' `clipFindManyMock.mockResolvedValueOnce()` chains
initially assumed Fase 31 always consumes a queue slot — when a test's fixture has `allRendered:
false`, Fase 31's own query never runs at all (see the naming-trap note above), so that assumed slot
goes unconsumed, shifting every subsequent queued value by one position and leaking an unconsumed
(in one case, REJECTED) mock value forward into unrelated, later tests in the same file. Caught by
running the FULL spec file (not just the new tests in isolation) and seeing unrelated pre-existing
tests fail with a nonsensical diff; fixed by removing the phantom queue entry, not by changing the
implementation.

## Speaker Intelligence Phase D architecture (as shipped)

Not part of this doc's own Phase 13/14 roadmap - a later, separate initiative (Speaker Intelligence
& Diarization Engine, see `docs/ai/speaker-intelligence.md`) extended this already-shipped Stage D
composite with a 13th dimension, `conversationEngagement`, once its own Phase C (Conversation
Dynamics) gave it something real to consume. Documented here rather than in a new file since it's a
small, additive extension of the exact structure Phase 14.1/14.2 already established, not a new
subsystem.

**Principles held throughout** (explicit user direction before starting): reuse Phase C's own output
as input (no new detector); no Fusion Engine v2 `weights.ts` changes (a completely separate module,
never touched); no new LLM call (`deriveConversationDynamics`/`classifyConversationType` are both
already zero-LLM); confidence stays explicit (the existing `count(non-null)/Object.keys(subScores).
length` denominator is dynamic, not hardcoded, so it updated to /13 automatically); flag-gated only
insofar as the thing being extended already is - Stage D's ranking pass has never had its own feature
flag (unlike the AI Intelligence v4 phases' API-exposure flags), so no new flag was invented just for
this one dimension, keeping it consistent with the pattern being extended rather than inventing a new
one; deterministic logic covered by fixture-based tests at both the unit level
(`@speedora/clip-ranking`) and a dedicated worker-level integration test proving the Prisma-column ->
`ComputeClipRankInput` -> `compositeRankSubScores` field-name wiring is genuinely correct end to end
(not just type-checking); no expansion into visual/reframe scope - this stays a pure numeric
composite, no crop-path/caption/rendering change anywhere.

**`packages/contracts/src/clip-ranking.ts`**: `clipRankSubScoresSchema` gains `conversationEngagement:
z.number().min(0).max(100).nullable()`. `computeClipRankInputSchema` gains `conversationDynamics:
conversationDynamicsSchema.nullable()` and `conversationType: conversationTypeResultSchema.
nullable()` - both null together whenever a Clip row predates Phase C's migration (the render-graph
node producing them is `optional: false`, so a post-migration clip always has both or neither).

**`packages/clip-ranking/src/derive-sub-scores.ts`**: a new `conversationEngagementScore()` helper -
gated by `ConversationTypeResult.type`, not just presence/absence. Null (excluded from the composite
average, not scored as a low number) for two cases: `type === null` (no diarization data at all) and
`type === 'monologue'` (a solo speaker) - the second case is the more consequential design decision.
`interactionIntensity` is mechanically near-zero for any single-speaker clip (no alternation, no
overlap by definition), so scoring it directly would systematically penalize every solo-creator clip
purely for being solo. This mirrors `classifyConversationType()`'s own explicit non-penalization rule
one level up ("single speaker is always monologue... never penalized for having many (self-)turns") -
conversational interactivity simply isn't a meaningful axis for monologue content, so it's excluded
from the average entirely rather than dragging it down. Every other type (interview/discussion/
debate/podcast) scores real `interactionIntensity * 100` - a genuinely low-interaction discussion
still scores low, that's real signal, not a penalty for content type.

**`apps/worker/src/workers/render-clip.worker.ts`**: the existing Phase 14.2 `renderedSiblings` select
gains `conversationDynamics`/`conversationType`; the `rankable.map()` call gains the two corresponding
fields (same single-cast-at-a-boundary convention as every sibling field). Deliberately NOT added to
the `rankable` filter (unlike `scores`/`viralityPrediction`/`retentionCurveInsights`, which exclude a
clip from ranking entirely when missing) - a clip predating Phase C's migration still ranks on the
other 12 dimensions with reduced confidence, rather than being excluded from ranking altogether. This
is a deliberate departure from the `retention` precedent (also a pure, zero-LLM, always-runs signal,
but declared non-nullable in the contract because the `rankable` filter already guarantees its
presence) - `conversationEngagement` stays nullable in the contract specifically so this looser,
non-excluding wiring choice is honestly reflected in the type.

**Verification**: `packages/contracts` 23/23 (183/183), `packages/clip-ranking` 2/2 (21/21, +6 new -
null-when-predates-migration, null-when-no-data, null-for-monologue, `it.each` across interview/
discussion/debate/podcast, real-low-score-not-a-penalty), `packages/shared` 11/11 (84/84, mirrored
`ClipRankSubScores` type), `apps/worker` 57/57 (753/753, +1 new dedicated integration test proving
the field-name wiring), `apps/api` 84/84 (1290/1290, unaffected - `compositeRankSubScores` flows
through its existing opaque-cast mapper unchanged). `typecheck`/`lint`/`format` all green across every
touched package.

## 7. Verification convention

Same as every prior v4 phase: after each sub-phase, run the affected package's own test suite, then
`pnpm verify` before considering the sub-phase done, and update this document's own status banner
(not a separate changelog) to reflect what actually shipped vs. what's still planned.
