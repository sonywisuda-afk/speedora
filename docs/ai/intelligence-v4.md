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
- **Phases 3-14**: documented roadmap only, not built. See "Roadmap" below.

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

## Dependency graph (Phase 1-2, as shipped)

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
| 3 | Narrative Graph (3) | Phase 2 | L | Hardest LLM-reasoning task; needs an "unsegmented" fallback |
| 4 | Contextual Momentum (new, part of 5) | Phase 3 + `EditingRhythmFeatures.accelerationScore` | M | No ground truth for curve *shape* yet |
| 5 | Emotional Arc (new, part of 5) | vocal-emotion rescue (see below) + Phase 2 | M | Vocal-emotion classifier trained on acted, not natural, speech |
| 6 | Multi-speaker Reasoning (extends 6) | Phases 1, 4, 5 | M | Must not affect single-speaker clips (the majority case) |
| 7 | Cross-module Fusion (4, Virality Engine) | Phases 1, 3, 4, 5 | M | Labeling discipline (8 heuristic probabilities reading as "trained") |
| 8 | Confidence Calibration (cross-cutting) | Phases 1-7 | S-M | Hygiene pass, low risk |
| 9 | Explainability (13) | Phases 1-7 | M | UI copy is where "scale honesty" holds or breaks |
| 10 | Candidate Expansion (10, generation half) | Phase 1 | L | Biggest infra change — new pre-render adapter stage |
| 11 | Ranking Refinement (10 + 11, Personalization) | Phase 10 + 1-7 | L | Introduces `WorkspaceContentProfile` schema (D10) |
| 12 | Learning Pipeline (12) | Phases 1-11 | S | Interfaces only, no training, by design |
| 13 | Evaluation Suite (new) | Phases 10-12 | M | Gated on real engagement samples, same as Fusion v3 |
| 14 | Production Hardening (final) | all | M | Real go/no-go gate on cost + rollout |

### Track B — Editorial Intelligence (parallel, non-blocking)

**Prerequisite**: rescue Vocal Emotion Detection (`apps/worker/src/vocalEmotion.ts`) — fully
implemented but stranded outside `@speedora/audio-intelligence`, no derive function, no Fusion
signal, invisible to the render-graph. Small relocation, no new detection logic.

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

`Clip.highlightScore` and every existing Fusion Engine v2 output are unchanged by both phases —
verified by regression tests in `sinks.spec.ts` (extended to cover `semanticEvents` alongside
`hookPrediction`) plus a full, green run of every existing test suite after each phase's changes
(worker: 568/568, api: 1268/1268, web: 313/313 as of Phase 2).
