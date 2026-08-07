# AI Intelligence v4

> **v2 (`packages/fusion-engine`) is untouched by this initiative.** `highlightScore` still measures
> "interestingness" exactly as it always has. v4 is a separate, additive family of predictions that
> *consume* v2's signals and Fusion Engine v3's (`packages/fusion-ml`) abstractions as inputs, but
> never replace `highlightScore` (see ADR D1 below). Every new v4 module is wired at flag-off/
> weight-0 until real engagement data exists to calibrate it — the same "collect first, calibrate
> later" posture this codebase already uses for every Fusion Engine signal still at weight 0.

## Status

- **Phase 0 (Foundation)**: shipped — `packages/llm-client`, this document.
- **Phase 1 (Hook Prediction Engine)**: shipped, flag-off (`HOOK_PREDICTION_ENABLED=false`).
- **Phase 2 (Semantic Event Detection)**: shipped, flag-off
  (`SEMANTIC_EVENT_DETECTION_ENABLED=false`). Also pulled forward Multimodal Reasoning (spec Part 6)
  as its own standalone package, `packages/multimodal-reasoning`.
- **Phase 3 (Narrative Graph)**: shipped, flag-off (`NARRATIVE_GRAPH_ENABLED=false`).
- **Phase 4 (Contextual Momentum)**: shipped, flag-off (`CONTEXTUAL_MOMENTUM_ENABLED=false`). First
  v4 module with no LLM call at all — a pure composition over already-computed signals.
- **Phase 5 (Emotional Arc)**: shipped, flag-off (`EMOTIONAL_ARC_ENABLED=false`). Same no-LLM
  shape as Phase 4 — a pure composition over already-persisted `TranscriptSegment.emotion` labels
  plus Phase 2's `SemanticEvent[]` as optional context. Also satisfies the roadmap's "vocal-emotion
  rescue" prerequisite (see Track B below) without relocating `apps/worker/src/vocalEmotion.ts`.
- **Phase 6 (Multi-speaker Reasoning)**: shipped, flag-off
  (`MULTI_SPEAKER_REASONING_ENABLED=false`). Same no-LLM shape as Phase 4/5 — a pure, post-hoc
  attribution of Phase 4's `MomentumCurve` and Phase 5's `EmotionalArc` to individual speakers via
  Speaker Intelligence's `SpeakerTimelineEntry[]`. Returns `null` for the majority single-speaker
  case, by design.
- **Phases 7-14**: documented roadmap only, not built. See "Roadmap" below.

## Why this exists

Speedora's existing AI signals (Audio/Scene/Facial/Gesture/OCR/Editing Rhythm/Speaker/Composition/
Object Intelligence, all feeding Fusion Engine v2) answer "is this clip interesting." The brief asks
a different, product-facing question: "will this clip actually perform as short-form content" — hook
strength, predicted virality, predicted retention, narrative structure, niche personalization. Three
audits (Fusion/scoring/contracts, all AI signal packages + the render pipeline, LLM/schema/
conventions) found this codebase already has most of the raw material v4 needs; it just isn't
assembled into predictive, explainable, niche-aware scores yet. The mandate, consistent with every
prior AI-signal initiative here: **extend, don't rebuild**.

## ADR — Key Architecture Decisions

**D1. v4 is additive, not a v2 replacement or v3 successor.** Fusion Engine v3 (`packages/
fusion-ml`, feature-flagged, dormant, still blocked on 0 production engagement samples) is a
*retraining* of v2's existing weights via ML. v4 is a **new family of independent predictions**
(Hook Probability, Virality sub-probabilities, Retention curve, Narrative structure,
Personalization) that live beside `highlightScore`, not instead of it.

**D2. Every new v4 capability is its own JSON-contract stateless module**, following
`ARCHITECTURE.md`'s checklist exactly: `packages/contracts/src/<module>.ts` → `packages/<module>`
(single `(input, deps?) => Promise<Output>` entry point, fixture-tested, zero DB access) → an
adapter in `apps/worker` (a render-graph node, in most cases) that narrows DB data in and persists
output out. No exceptions for LLM-reasoning modules — the LLM client is injected via `deps`.

**D3. `packages/llm-client` extracts the shared LLM structured-output pattern**, already
independently reimplemented 4 times (`clip-scoring`, `subtitle-translate`, `seo-copy`,
`clip-query-parser`) before this pass — past this codebase's own "extract at the 3rd duplication"
threshold. `callStructured<T>(input, deps)` wraps `deps.openai.chat.completions.create`'s
`json_schema`/`strict: true` mode. Deliberately thin — no retry/backoff, no cost tracking (neither
existed at any of the 4 original call sites either). **The 4 existing call sites are not migrated**
— zero behavior change to them. Only new v4 modules use this.

**D4. New predictive scores are documented as heuristic/LLM-derived, never implied as trained
predictions** ("scale honesty," `docs/coding-standards.md`). Every new numeric field's doc comment
states this explicitly. Production has 0 usable engagement samples (same blocker Fusion Engine v3
has) — nothing in v4 is calibrated against real outcomes yet.

**D5. Reuse existing signals aggressively before adding detectors.** For Hook Prediction Engine
specifically:

| Requested input | Source | New work |
|---|---|---|
| Transcript | `TranscriptSegment` | none |
| Speech speed | `AudioFeatures.averageSpeakingRateWordsPerSecond` | none |
| Energy | `AudioFeatures.averageRmsDb`/`peakDb` | none |
| Pause | `@speedora/cutlist`'s `computeSilenceCuts()` | reused algorithm, new hook-specific scoring |
| Speaker confidence | `SpeakerFusionFeatures.dominantSpeakerConfidence` | none |
| Sentiment, emotion, surprise, controversy, keyword rarity, topic shift, question density, numeric facts, named entities | *(none)* | new LLM reasoning step (`packages/hook-prediction/src/extract-linguistic-features.ts`) |

**D6. New v4 detectors that run inside the render pipeline become render-graph nodes**, not new
BullMQ queues — `ARCHITECTURE.md`'s own precedent for "a consumer with many interdependent/optional
steps." Hook Prediction ships as two nodes: `hookPauseFeatures` (pure, depends on nothing beyond
`ctx.transcript`) and `hookPrediction` (the LLM call, depends on `hookPauseFeatures` +
`audioFeatures` + `speakerFusionFeatures`).

**D7. New `Clip` columns follow the existing raw+derived `Json?` convention.** Phase 1 adds
`Clip.hookPrediction Json?`, read/written as one unit. This triggers the TS2742 Prisma pitfall
(every new `Json?` column breaks `apps/api`'s `nest build` unless narrowed) — fixed via
`toSharedHookPrediction()` in `apps/api/src/videos/transcript-segment.util.ts`, the established
pattern.

**D8. Feature flags follow the existing bespoke-function convention**, not a new registry (none
exists). `isHookPredictionEnabled()` mirrors `isFusionV3Enabled()`'s exact shape — lazy env read,
strict `'true'` comparison. **The flag gates API exposure, not computation** — the render-graph node
still runs and persists `Clip.hookPrediction` regardless, matching how weight-0 Fusion signals are
already "collected but inert." Flipping the flag on later needs no backfill.

**D9. v4 surfaces through a new, separate endpoint** — `GET /clips/:id/intelligence` — rather than
overloading `/explainability`'s `results[{engine: 'v2'|'v3'}]` array, whose design intent is
alternate *highlightScore* engines (one commensurable number). v4 is a growing family of unrelated
scores that don't collapse into one number. Phase 1 ships `{ clipId, hookPrediction }`; later phases
add fields to the same DTO.

**D10. Personalization (Part 11) needs a small schema addition later** (a workspace niche/weight
profile) — **not added yet**, per this codebase's "don't ship schema before a real consumer" rule.
Revisit at Track A Phase 11.

**D11. Online Learning readiness (Part 12) reuses `packages/fusion-ml`'s existing abstractions**
(`FeatureVector`, `TrainingSample`, `Predictor`, `DatasetBuilder`, `ModelEvaluator`) rather than
inventing v4-specific ones.

## Dependency graph (Phase 1-6, as shipped)

```
TranscriptSegment (words, rmsDb, peakDb, speakingRateWordsPerSecond, emotion)
        │
        ├──▶ AudioFeatures (existing, @speedora/audio-intelligence)
        └──▶ derivePauseFeatures() (@speedora/hook-prediction, reuses @speedora/cutlist's
              computeSilenceCuts() gap-detection math)

SpeakerFusionFeatures.dominantSpeakerConfidence (existing) ─┐
AudioFeatures ────────────────────────────────────────────┼──▶ predictHook()
HookPauseFeatures (above) ──────────────────────────────────┤   (@speedora/hook-prediction)
extractLinguisticFeatures() [NEW LLM call, via @speedora/llm-client] ┘
                                                                    │
                                                                    ▼
                                                      HookPredictionOutput
                                            { hookProbability, reason, confidence,
                                              linguisticFeatures, predictionFeatures }
                                                                    │
                                                                    ▼
                                             Clip.hookPrediction (new Json? column)
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure)

TranscriptSegment (text) ──▶ extractRawEvents() [NEW LLM call, via @speedora/llm-client]
                                                                    │
                                                                    ▼
                                                        RawSemanticEvent[]
                                                  { type, t, confidence, importance, reason }
                                                                    │
ocrTracks (existing) ───────────────────────────────────────────┐  │
objectTracks (existing) ─────────────────────────────────────────┼──▶ groundEvents()
                                                                    │   (@speedora/multimodal-
                                                                    │    reasoning's
                                                                    │    findConcurrentEvidence)
                                                                    ▼
                                                          SemanticEvent[]
                                              { ...RawSemanticEvent, evidence: GroundedFact[] }
                                                                    │
                                                                    ▼
                                            Clip.semanticEvents (new Json? column)
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)

TranscriptSegment (text) ──▶ extractRawGraph() [NEW LLM call, via @speedora/llm-client]
                                                                    ▲
semanticEvents (existing, Phase 2 - optional context, degrades ────┘
  gracefully to null when its own flag is off or detection failed)
                                                                    │
                                                                    ▼
                                                          RawNarrativeGraph
                                            { segments, relations, unsegmented }
                                                                    │
                                                                    ▼
                                                           validateGraph()
                                              (pure - structural sanity check, collapses
                                               to `unsegmented: true` on ANY failure)
                                                                    │
                                                                    ▼
                                                          NarrativeGraph
                                            { segments: NarrativeSegment[],
                                              relations: NarrativeRelation[], unsegmented }
                                                                    │
                                                                    ▼
                                           Clip.narrativeGraph (new Json? column)
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)

motionEnergy (existing) ────────────────────────────────────────┐
cameraMotion (existing, optional) ───────────────────────────────┤
EditingRhythmFeatures.accelerationScore (existing, optional) ────┼──▶ computeMomentumCurve()
narrativeGraph (existing, Phase 3 - optional context, degrades ──┘   (@speedora/contextual-
  gracefully to no modifier when null or unsegmented: true)          momentum, PURE - no LLM
                                                                       call, no `deps` param)
                                                                    │
                                                                    ▼
                                                          MomentumCurve
                                                    MomentumSample[] { t, momentumScore }
                                                                    │
                                                                    ▼
                                        Clip.contextualMomentum (new Json? column - null means
                                                        "predates this migration," not "failed")
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)

TranscriptSegment.emotion (existing, persisted at transcribe time by ─┐
  apps/worker/src/vocalEmotion.ts's detectVocalEmotions - see the      │
  "vocal-emotion rescue" note under Track B below)                     │
                                                                        ├──▶ computeEmotionalArc()
semanticEvents (existing, Phase 2 - optional context, degrades ───────┘   (@speedora/emotional-
  gracefully to no boost when null/empty)                                 arc, PURE - no LLM
                                                                            call, no `deps` param)
                                                                    │
                                                                    ▼
                                                            EmotionalArc
                                        EmotionalArcSample[] { t, emotion, intensity }
                                                                    │
                                                                    ▼
                                             Clip.emotionalArc (new Json? column - null means
                                                        "predates this migration," not "failed")
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)

speakerTimeline (existing, Speaker Intelligence's SpeakerTimelineEntry[] - ┐
  already-existing node id, unmodified by this phase)                     │
contextualMomentum (existing, Phase 4 - MomentumCurve, unmodified) ────────┼──▶ computeMultiSpeaker
emotionalArc (existing, Phase 5 - EmotionalArc, unmodified) ───────────────┘   Breakdown()
                                                                                (@speedora/multi-
                                                                                 speaker-reasoning,
                                                                                 PURE - no LLM
                                                                                 call, no `deps`
                                                                                 param)
                                                                    │
                                                                    ▼
                                                     MultiSpeakerBreakdown | null
                                          SpeakerAttribution[] { speaker, talkTimeRatio,
                                       hookWindowTalkTimeRatio, averageMomentumScore,
                                       peakMomentumScore, dominantEmotion,
                                       averageEmotionalIntensity } - null for the majority
                                       single-speaker case (< 2 distinct speakers), BY DESIGN
                                                                    │
                                                                    ▼
                                    Clip.multiSpeakerBreakdown (new Json? column - null means
                                     "predates this migration" OR "< 2 distinct speakers," not
                                                        distinguished at the column level)
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)
```

## Roadmap (Parts 2-14 — documented, not built)

Two tracks. **Track A** (scoring/intelligence chain) is the user's own recommended sequence, each
phase mergeable as its own PR. **Track B** (editorial/rendering) consumes Track A's outputs
opportunistically but doesn't block or get blocked by it. No phase changes default production output
until its own later calibration sub-phase.

### Track A — Scoring & Intelligence Chain

| Phase | Name (spec Part) | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| 2 | Semantic Event Detection (2) — **shipped** | Phase 0/1; pulled forward Multimodal Reasoning (6) as `packages/multimodal-reasoning` | L | 22-value taxonomy governance (satisfied via `describeEventType()`'s exhaustive switch); +1 LLM call/clip |
| 3 | Narrative Graph (3) — **shipped** | Phase 2 | L | Hardest LLM-reasoning task; needs an "unsegmented" fallback (satisfied via `validateGraph()`'s structural collapse) |
| 4 | Contextual Momentum (new, part of 5) — **shipped** | Phase 3 + `EditingRhythmFeatures.accelerationScore` | M | No ground truth for curve *shape* yet (still true post-ship — heuristic weights, undocumented as calibrated) |
| 5 | Emotional Arc (new, part of 5) — **shipped** | vocal-emotion rescue (see below) + Phase 2 | M | Vocal-emotion classifier trained on acted, not natural, speech (still true post-ship — a documented heuristic caveat, not a solved problem) |
| 6 | Multi-speaker Reasoning (extends 6) — **shipped** | Phases 1, 4, 5 | M | Must not affect single-speaker clips (the majority case) - addressed by design: `computeMultiSpeakerBreakdown()` returns `null` for any clip with fewer than 2 distinct speakers |
| 7 | Cross-module Fusion (4, Virality Engine) | Phases 1, 3, 4, 5 | M | Labeling discipline (8 heuristic probabilities reading as "trained") |
| 8 | Confidence Calibration (cross-cutting) | Phases 1-7 | S-M | Hygiene pass, low risk |
| 9 | Explainability (13) | Phases 1-7 | M | UI copy is where "scale honesty" holds or breaks |
| 10 | Candidate Expansion (10, generation half) | Phase 1 | L | Biggest infra change — new pre-render adapter stage |
| 11 | Ranking Refinement (10 + 11, Personalization) | Phase 10 + 1-7 | L | Introduces `WorkspaceContentProfile` schema (D10) |
| 12 | Learning Pipeline (12) | Phases 1-11 | S | Interfaces only, no training, by design |
| 13 | Evaluation Suite (new) | Phases 10-12 | M | Gated on real engagement samples, same as Fusion v3 |
| 14 | Production Hardening (final) | all | M | Real go/no-go gate on cost + rollout |

**Adjacent opportunity flagged, not built in Phase 6**: `packages/contracts/src/
conversation-intelligence.ts` (Conversation Type Classification — monologue/interview/discussion/
debate/presentation/podcast) is fully spec'd (`CONVERSATION_TYPES`,
`classifyConversationTypeInputSchema`, `conversationTypeResultSchema`) with zero implementation.
Investigated during Phase 6 planning: its own input shape
(`speakerCount`/`turnCount`/`switchCount`/`averageTurnDurationSeconds`) comes from
`DiarizationFeatures`, not from Phases 1/4/5 — it doesn't match Phase 6's stated dependency chain,
so it was left as a well-scoped candidate for a future phase rather than folded in here.

### Track B — Editorial Intelligence (parallel, non-blocking)

**Prerequisite — satisfied by Phase 5, not as separate work**: rescue Vocal Emotion Detection
(`apps/worker/src/vocalEmotion.ts`) — was fully implemented but stranded outside
`@speedora/audio-intelligence`, no derive function, no Fusion signal, invisible to the
render-graph. Investigated directly: `vocalEmotion.ts` shells out to a Python subprocess using
`apps/worker`-local infra (scratch-file helpers, subprocess limiter) — the exact same shape as
`apps/worker/src/diarization.ts` (Speaker Intelligence's own subprocess caller), which was
deliberately never relocated into `packages/speaker-diarization` either; only pure derive
functions belong in `packages/*` (JSON-contract pattern's "zero DB/subprocess access" rule).
Literally relocating `vocalEmotion.ts` would break that convention. Phase 5's own
`packages/emotional-arc` (a pure derive function over already-persisted
`TranscriptSegment.emotion` labels) **is** the missing derive function, and its render-graph node
**is** what makes vocal emotion visible in the render-graph for the first time — closing the gap
without a literal file move. `vocalEmotion.ts` itself is untouched.

| Phase | Name (spec Part) | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| A | Subtitle Intelligence + Dynamic Caption (7, 8) | vocal-emotion rescue | M | Must never rewrite transcript *facts*, only phrasing |
| B | Visual Emphasis Engine (9) | none — signals already exist | M | Unify `reframe`'s own face detector with `primary-subject`'s choice, don't layer a second opinion |

## Phase 1 architecture (as shipped)

```
packages/contracts/src/hook-prediction.ts   hookPredictionSegmentSchema, hookPauseFeaturesSchema,
                                             hookPredictionInputSchema, hookLinguisticFeaturesSchema,
                                             hookPredictionOutputSchema

packages/llm-client/src/
  call-structured.ts                        callStructured<T>(input, deps) - Phase 0

packages/hook-prediction/src/
  derive-pause-features.ts                  derivePauseFeatures() - reuses @speedora/cutlist
  extract-linguistic-features.ts            extractLinguisticFeatures() - the one new LLM call
  compute-hook-prediction.ts                computeHookPrediction() - pure weighted scoring +
                                             buildReason(), mirrors fusion-engine's own shape
  predict-hook.ts                           predictHook() - the module's single entry point
  feature-flags.ts                          isHookPredictionEnabled()

apps/worker/src/render-graph/nodes/hook-prediction.ts
                                             hookPauseFeaturesNode (optional: false, pure/cheap),
                                             hookPredictionNode (optional: true, fallback: null -
                                             the LLM-backed half, never fails the render job)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['hookPrediction'] entry - deliberately
                                             NOT added to FUSION_INPUT_MAP (D1), guarded by a
                                             regression test in sinks.spec.ts

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedHookPrediction() - the TS2742 fix (D7)

apps/api/src/clips/{clips.controller.ts,clips.service.ts}
                                             GET /clips/:id/intelligence

packages/shared/src/types/
  video.ts                                  HookLinguisticFeatures/HookPredictionOutput mirrored
                                             (not imported) from packages/contracts, same
                                             duplication precedent as every other AI-signal type in
                                             this file (packages/shared and packages/contracts are
                                             deliberately separate layers); Clip.hookPrediction field
  intelligence-v4.ts                        ClipIntelligenceDto (D9)
```

## Phase 2 architecture (as shipped)

```
packages/contracts/src/
  multimodal-reasoning.ts                   groundedFactSchema (GroundedFact)
  semantic-events.ts                        SEMANTIC_EVENT_TYPES (22 values),
                                             semanticEventDetectionSegmentSchema,
                                             semanticEventSchema

packages/multimodal-reasoning/src/
  find-concurrent-evidence.ts               findConcurrentEvidence(t, windowSeconds, ocrTracks,
                                             objectTracks) - pure, synchronous, no LLM/DB access.
                                             Extracted standalone (not buried inside
                                             semantic-events) since this roadmap already names two
                                             more future consumers (Emotional Arc/Retention Curve,
                                             Virality Engine) - same precedent as
                                             packages/primary-subject.

packages/semantic-events/src/
  extract-raw-events.ts                     extractRawEvents() - the one new LLM call, over
                                             transcript text ALONE (no OCR/object context in the
                                             prompt)
  ground-events.ts                          groundEvents() - pure post-processing: attaches
                                             on-screen evidence via findConcurrentEvidence, falls
                                             back to describeEventType() when the LLM's own reason
                                             is empty
  describe-event-type.ts                    describeEventType() - exhaustive switch/assertNever
                                             over all 22 SEMANTIC_EVENT_TYPES (Contract Governance
                                             rule 1), the concrete "enum governance from day 1"
                                             this roadmap flagged as Phase 2's risk
  detect-semantic-events.ts                 detectSemanticEvents() - the module's single entry
                                             point, orchestrates extractRawEvents + groundEvents
  feature-flags.ts                          isSemanticEventDetectionEnabled()

apps/worker/src/render-graph/nodes/semantic-events.ts
                                             semanticEventsNode (optional: true, fallback: null -
                                             deps: ocrTracks/objectTracks, already-existing node
                                             ids, purely for grounding)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['semanticEvents'] entry - deliberately
                                             NOT added to FUSION_INPUT_MAP (D1), guarded by the
                                             same extended regression test as hookPrediction

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedSemanticEvents() - the TS2742 fix (D7)

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `semanticEvents`, gated by its OWN independent flag
                                             (D9 - later phases add fields to the same DTO)

packages/shared/src/types/
  video.ts                                  GroundedFact/SemanticEvent/SemanticEventType mirrored
                                             (not imported), same duplication precedent as
                                             HookPredictionOutput; Clip.semanticEvents field
  intelligence-v4.ts                        ClipIntelligenceDto.semanticEvents
```

## Phase 3 architecture (as shipped)

```
packages/contracts/src/narrative-graph.ts   NARRATIVE_SEGMENT_TYPES (10 values), NARRATIVE_
                                             RELATION_TYPES (leads_to, resolves),
                                             narrativeSegmentSchema, narrativeRelationSchema,
                                             narrativeGraphSchema, narrativeGraphDetection
                                             SegmentSchema

packages/narrative-graph/src/
  extract-raw-graph.ts                      extractRawGraph() - the one new LLM call, over
                                             transcript text, with Phase 2's SemanticEvent[] as
                                             OPTIONAL context (degrades gracefully to null)
  validate-graph.ts                         validateGraph() - pure structural validation
                                             (>=2 segments, in-bounds timing, valid relation
                                             references), collapses to `unsegmented: true` on
                                             ANY failure rather than a partial repair - this
                                             phase's required risk mitigation
  describe-segment-type.ts                  describeSegmentType() - exhaustive switch/
                                             assertNever over all 10 NARRATIVE_SEGMENT_TYPES
                                             (Contract Governance rule 1)
  build-narrative-graph.ts                  buildNarrativeGraph() - the module's single entry
                                             point, orchestrates extractRawGraph + validateGraph
  feature-flags.ts                          isNarrativeGraphEnabled()

apps/worker/src/render-graph/nodes/narrative-graph.ts
                                             narrativeGraphNode (optional: true, fallback: null -
                                             deps: semanticEvents, already-existing node id,
                                             purely for optional grounding context)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['narrativeGraph'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1); a
                                             present value (including `unsegmented: true`) is
                                             written through directly, never coerced to JsonNull

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedNarrativeGraph() - the TS2742 fix (D7)

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `narrativeGraph`, gated by its OWN independent flag
                                             (D9 - the 3rd field on the same DTO)

packages/shared/src/types/
  video.ts                                  NarrativeSegmentType/NarrativeSegment/
                                             NarrativeRelationType/NarrativeRelation/
                                             NarrativeGraph mirrored (not imported), same
                                             duplication precedent as SemanticEvent/
                                             HookPredictionOutput; Clip.narrativeGraph field
  intelligence-v4.ts                        ClipIntelligenceDto.narrativeGraph
```

## Phase 4 architecture (as shipped)

```
packages/contracts/src/contextual-momentum.ts
                                             momentumSampleSchema, momentumCurveSchema,
                                             computeMomentumCurveInputSchema

packages/contextual-momentum/src/
  segment-type-multiplier.ts                momentumMultiplierForSegmentType() - exhaustive
                                             switch/assertNever over all 10 NARRATIVE_SEGMENT_
                                             TYPES (Contract Governance rule 1), reusing Phase 3's
                                             taxonomy rather than introducing a new one
  compute-momentum-curve.ts                 computeMomentumCurve() - the module's single entry
                                             point, PURE and synchronous (no `deps` param) - first
                                             v4 module with zero LLM dependency, matching
                                             @speedora/editing-rhythm's own precedent for
                                             composite/derived signals. Per-sample formula: base
                                             motion-energy (min-max normalized within the clip's
                                             own samples) + a smaller-weighted camera-motion
                                             boost (nearest sample, optional) + a linear
                                             acceleration-bias ramp (optional) x a narrative
                                             segment-type multiplier (optional, degrades to
                                             neutral when narrativeGraph is null or
                                             unsegmented: true)
  feature-flags.ts                          isContextualMomentumEnabled()

apps/worker/src/render-graph/nodes/contextual-momentum.ts
                                             contextualMomentumNode (optional: false, no
                                             fallback - unlike every Phase 1-3 node, this one
                                             reads only already-resolved upstream data and can't
                                             hit real I/O failure; deps: motionEnergy,
                                             cameraMotion, editingRhythmFeatures, narrativeGraph,
                                             all already-existing node ids)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['contextualMomentum'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1),
                                             despite structurally resembling
                                             editingRhythmFeatures (which DOES feed Fusion Engine
                                             v2) closely enough to be worth calling out in code
                                             comments; cast through as InputJsonValue like
                                             motionEnergy (a closed array type), never
                                             Prisma.JsonNull even when empty - guarded by the
                                             same extended regression test as prior phases

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedContextualMomentum() - the TS2742 fix (D7).
                                             Unlike Phases 1-3, null here can ONLY mean "this Clip
                                             row predates this phase's migration," not "the node
                                             failed" (the node itself can't fail)

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `contextualMomentum`, gated by its OWN independent
                                             flag (D9 - the 4th field on the same DTO)

packages/database/prisma/schema.prisma      Clip.contextualMomentum Json? (new column, real-
                                             Postgres round trip manually verified)

packages/shared/src/types/
  video.ts                                  MomentumSample/MomentumCurve mirrored (not
                                             imported), same duplication precedent as
                                             NarrativeGraph/SemanticEvent/HookPredictionOutput;
                                             Clip.contextualMomentum field
  intelligence-v4.ts                        ClipIntelligenceDto.contextualMomentum
```

## Phase 5 architecture (as shipped)

```
packages/contracts/src/emotional-arc.ts
                                             emotionalArcSampleSchema, emotionalArcSchema,
                                             emotionalArcSegmentSchema,
                                             computeEmotionalArcInputSchema (imports
                                             semanticEventSchema from ./semantic-events and
                                             VOCAL_EMOTIONS from ./vocal-emotion - same
                                             cross-contract-file-import precedent
                                             contextual-momentum.ts already set)

packages/emotional-arc/src/
  emotional-event-boost.ts                  emotionalBoostForSemanticEventType() - exhaustive
                                             switch/assertNever over all 22 SEMANTIC_EVENT_TYPES
                                             (Contract Governance rule 1), reusing Phase 2's
                                             taxonomy rather than introducing a new one - same
                                             "govern an existing enum being consumed for the
                                             first time" pattern Phase 4's
                                             momentumMultiplierForSegmentType() established
  compute-emotional-arc.ts                  computeEmotionalArc() - the module's single entry
                                             point, PURE and synchronous (no `deps` param) - same
                                             zero-LLM shape as Phase 4, since the classifier
                                             itself already ran at transcribe time. Per-segment
                                             formula: a fixed base-intensity weight over the
                                             model's own 4-class taxonomy + the largest (not
                                             summed) semantic-event boost among any Phase 2
                                             SemanticEvent landing inside the segment's own
                                             window, tiered by event type
  feature-flags.ts                          isEmotionalArcEnabled()

apps/worker/src/render-graph/nodes/emotional-arc.ts
                                             emotionalArcNode (optional: false, no fallback -
                                             same reasoning as Phase 4's contextualMomentumNode:
                                             reads only already-resolved upstream data
                                             (ctx.transcript's own emotion labels + the
                                             semanticEvents node's output) and can't hit real
                                             I/O failure; deps: semanticEvents, an
                                             already-existing node id read purely as optional
                                             context, same degrade-gracefully pattern
                                             narrativeGraphNode already uses for it)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['emotionalArc'] entry - deliberately
                                             NOT added to FUSION_INPUT_MAP (D1); cast through as
                                             InputJsonValue like contextualMomentum/motionEnergy
                                             (a closed array type), never Prisma.JsonNull even
                                             when empty - guarded by the same extended
                                             regression test as prior phases

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedEmotionalArc() - the TS2742 fix (D7). Same
                                             null-semantics as toSharedContextualMomentum: null
                                             here can ONLY mean "this Clip row predates this
                                             phase's migration," not "the node failed"

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `emotionalArc`, gated by its OWN independent flag
                                             (D9 - the 5th field on the same DTO)

packages/database/prisma/schema.prisma      Clip.emotionalArc Json? (new column, real-Postgres
                                             round trip manually verified)

packages/shared/src/types/
  video.ts                                  VocalEmotion/EmotionalArcSample/EmotionalArc
                                             mirrored (not imported), same duplication
                                             precedent as MomentumSample/NarrativeGraph/
                                             SemanticEvent/HookPredictionOutput;
                                             Clip.emotionalArc field
  intelligence-v4.ts                        ClipIntelligenceDto.emotionalArc
```

`apps/worker/src/vocalEmotion.ts` (the classifier itself) is untouched by this phase - Phase 5
only adds a new consumer of its already-persisted `TranscriptSegment.emotion` output. See the
"vocal-emotion rescue" note under Track B above for why this satisfies that prerequisite without
relocating the file.

## Phase 6 architecture (as shipped)

```
packages/contracts/src/multi-speaker-reasoning.ts
                                             speakerAttributionSchema (imports
                                             VOCAL_EMOTIONS from ./vocal-emotion),
                                             multiSpeakerBreakdownSchema,
                                             computeMultiSpeakerBreakdownInputSchema (imports
                                             speakerTimelineEntrySchema from ./speaker-timeline
                                             and momentumSampleSchema from
                                             ./contextual-momentum - same cross-contract-file-
                                             import precedent contextual-momentum.ts already set)

packages/multi-speaker-reasoning/src/
  compute-multi-speaker-breakdown.ts        computeMultiSpeakerBreakdown() - the module's single
                                             entry point, PURE and synchronous (no `deps` param) -
                                             same zero-LLM shape as Phase 4/5, since this is a
                                             post-hoc ATTRIBUTION pass over already-computed data,
                                             not a fresh detection step. Returns null whenever the
                                             clip has fewer than 2 distinct speakers in its
                                             speakerTimeline (checked via a cheap Set-size check) -
                                             the majority single-speaker case, addressed by
                                             design, not an afterthought. For each distinct
                                             speaker: talkTimeRatio (share of total speaking
                                             time), hookWindowTalkTimeRatio (share of the opening
                                             5-second window's speaking time, reusing hook-
                                             prediction's own HOOK_WINDOW_SECONDS value, Phase 1
                                             tie-in), average/peak MomentumCurve samples within
                                             their turns (Phase 4 tie-in), dominant emotion +
                                             average intensity from EmotionalArc samples within
                                             their turns (Phase 5 tie-in)
  feature-flags.ts                          isMultiSpeakerReasoningEnabled()

apps/worker/src/render-graph/nodes/multi-speaker-reasoning.ts
                                             multiSpeakerReasoningNode, id: 'multiSpeakerBreakdown'
                                             (optional: false, no fallback - same reasoning as
                                             Phase 4/5's own pure-derive nodes; deps:
                                             speakerTimeline (Speaker Intelligence's own
                                             already-existing node id), contextualMomentum,
                                             emotionalArc - all already-existing node ids, none
                                             touched or modified by this phase)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['multiSpeakerBreakdown'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1).
                                             BREAKS FROM Phase 4/5's sink-casting precedent: since
                                             a real, successful computation can genuinely produce
                                             null (the majority single-speaker case), this uses
                                             the Phase 1-3 `?? Prisma.JsonNull` pattern, not the
                                             plain-cast-never-JsonNull pattern Phase 4/5 used for
                                             their always-array outputs - the first optional:
                                             false, no-LLM node whose result needs Prisma.JsonNull
                                             casting

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedMultiSpeakerBreakdown() - the TS2742 fix (D7).
                                             Null-semantics are a THIRD pattern, different from
                                             both established ones: null means EITHER "this row
                                             predates the migration" (Phase 4/5's meaning) OR
                                             "this clip doesn't have 2+ distinct speakers" (this
                                             module's own genuine, by-design result) - not
                                             distinguished at the column level

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `multiSpeakerBreakdown`, gated by its OWN independent
                                             flag (D9 - the 6th field on the same DTO)

packages/database/prisma/schema.prisma      Clip.multiSpeakerBreakdown Json? (new column,
                                             real-Postgres round trip manually verified)

packages/shared/src/types/
  video.ts                                  SpeakerAttribution/MultiSpeakerBreakdown mirrored
                                             (not imported), same duplication precedent as
                                             EmotionalArcSample/MomentumSample/NarrativeGraph/
                                             SemanticEvent/HookPredictionOutput;
                                             Clip.multiSpeakerBreakdown field
  intelligence-v4.ts                        ClipIntelligenceDto.multiSpeakerBreakdown
```

`packages/multimodal-reasoning` (Phase 2's Part 6 package) is untouched by this phase -
investigated directly and confirmed `findConcurrentEvidence()`'s schema is OCR/object-track-
specific with no speaker field anywhere, and its own doc comment never names Multi-speaker
Reasoning as an anticipated consumer. Phase 6 extends spec Part 6's *spirit* (cross-modal
reasoning) along a speaker-identity axis via a new sibling package, not by modifying Part 6's own
code - same precedent Phase 4/5 already set for spec Part 5.

`Clip.highlightScore` and every existing Fusion Engine v2 output are unchanged by all six phases —
verified by regression tests in `sinks.spec.ts` (extended to cover `multiSpeakerBreakdown`
alongside `hookPrediction`/`semanticEvents`/`narrativeGraph`/`contextualMomentum`/`emotionalArc`)
plus a full, green run of every existing test suite after each phase's changes. Phase 3 was the
first to run the full `pnpm verify` (added between Phase 2 and Phase 3) locally before pushing;
Phase 4, 5, and 6 continued that practice. Phase 6: `apps/worker`: 575/575, `apps/api`: 1268/1268,
`apps/web`: 313/313, plus 14 new unit tests in `packages/multi-speaker-reasoning` covering the
core "must not affect single-speaker clips" guarantee as a dedicated regression test, along with
talk-time-ratio/hook-window/momentum/emotion attribution scoping. One
`ffmpeg.brand-segment-concat.integration.spec.ts` case hit a system-load-induced timeout during
the combined `pnpm verify` run (unrelated to anything this phase changed) and was re-verified
passing cleanly in isolation (4/4) before being treated as green. Real-Postgres round trip
verified manually for the new column.
