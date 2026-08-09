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
- **Phase 7 (Cross-module Fusion, spec Part 4 - Virality Engine)**: shipped, flag-off
  (`VIRALITY_ENGINE_ENABLED=false`). Same no-LLM shape as Phase 4/5/6 - fuses Phase 1/3/4/5's own
  already-computed outputs into one composite estimate. Deliberately distinct from the pre-existing,
  unrelated `Clip.viralityScore` (Fase 8's MVP LLM clip-scoring) - see `ai/scoring.md`, now
  documenting 4 distinct scoring systems. **Shipped by reverse-engineering what "Virality Engine"
  wanted, since the real Part 4 spec text didn't exist in the repo at the time — Phase 9 below
  realigns this phase's output shape to the real spec once that text became available.**
- **Phase 8 (Confidence Calibration, cross-cutting)**: shipped. No new package, contract, migration,
  or API field — a deliberate departure from every prior phase's "new JSON-contract module" shape,
  since real numeric calibration is impossible (0 usable engagement samples, the same blocker every
  phase already documents). A labeling/consistency pass instead: filled `HookPredictionOutput.
  confidence`'s previously-missing doc comment, standardized the "scale honesty" module comment
  across the 6 contract files that lacked it, added "kind of confidence" pointers distinguishing
  LLM-self-reported (Phase 2, 3) from code-computed-coverage (Phase 1, 7) confidence fields, and
  disambiguated from M1.5's pre-existing, unrelated "Weight Calibration Report". See "Phase 8
  architecture (as shipped)" below.
- **Phase 9 (Virality Engine Realignment, spec Part 4)**: shipped, same `VIRALITY_ENGINE_ENABLED`
  flag as Phase 7 (no new flag needed). The user supplied the real Part 4 spec text for the first
  time (a "Parts 4-15 re-audit," ADR D12-D16, ran before this phase) and it named 7 different
  probabilities than Phase 7 had reverse-engineered. **Replaces** (not extends) Phase 7's 8
  structural sub-probabilities with the spec's own 7: `scrollStopProbability`, `watchProbability`,
  `completionProbability`, `shareProbability`, `commentProbability`, `saveProbability`,
  `followProbability`, plus a renamed top-level composite `overallViralScore` (was
  `viralityProbability`). The one deliberate exception to this initiative's strict additive-only
  convention (ADR D12) — justified because `VIRALITY_ENGINE_ENABLED` was `false` in production, so
  zero real consumers depended on the old shape. Needed no new migration (`Clip.viralityPrediction`
  is `Json?`, no DB-level schema), no new render-graph node, no new sink wiring, and no new
  `ClipIntelligenceDto` field — see "Phase 9 architecture (as shipped)" below.
- **Phase 10 (Retention Curve Insights, spec Part 5 extension)**: shipped, flag-off
  (`RETENTION_CURVE_INSIGHTS_ENABLED=false`). Unlike Phase 9, this stays strictly additive (ADR
  D13) — Phase 4's `MomentumCurve` and Phase 5's `EmotionalArc` are unchanged, only consumed. New
  `packages/retention-curve-insights` derives `dropPoints`/`replayZones`/`emotionalPeaks` (peak/
  trough detection over `MomentumCurve`/`EmotionalArc`, reusing `packages/scene-intelligence`'s own
  `findPeakIndices`/`meanAndStddev` — now exported — plus a new mirror-image `findTroughIndices`)
  and `curiosityPeaks` (`SemanticEvent[]` filtered to a curiosity-flavored type subset via a new
  `isCuriositySemanticEventType()` exhaustive switch). Timeline visualization is explicitly
  deferred to Phase 12 (Explainability) — see "Phase 10 architecture (as shipped)" below.
- **Phase 11 (Multimodal Reasoning Engine, spec Part 6)**: shipped, flag-off
  (`MULTIMODAL_REASONING_ENABLED=false`). Extends Phase 2's `packages/multimodal-reasoning` (its
  existing `findConcurrentEvidence` is untouched, still Phase 2's own grounding helper) with a
  genuine cross-modal reasoning layer: normalizes 8 evidence sources into one common
  `MultimodalEvidence` shape (Transcript/Scene/OCR/Face/Gesture/Audio/Speaker — Part 6's own 7
  normative modalities — plus Object Intelligence's `objectTracks` as a documented, non-normative
  extension), groups them by transcript segment (a real structural unit, not an arbitrary window),
  then makes exactly one LLM call per clip to find `refers_to`/`co_occurs_with`/`emphasizes`
  connections across evidence from >= 2 distinct modalities, validated by a deterministic post-LLM
  step that drops any connection whose cited evidence doesn't actually resolve (the hallucination
  guard). See "Phase 11 architecture (as shipped)" below.
- **Phases 12-17**: documented roadmap only, not built (renumbered from the original Phase 9-14 —
  see "Roadmap" below; Phases 0-8 above keep their original numbers/history unchanged).
- **Track B, Phase A1 (Subtitle Rewriter, spec Part 7)**: shipped, flag-off
  (`SUBTITLE_REWRITE_ENABLED=false`). A separate track from Phases 0-17 above (parallel,
  non-blocking) — see "Roadmap" below and [`ai/subtitle-intelligence.md`](./subtitle-intelligence.md)
  for its own full audit/ADR/dependency-graph/roadmap. STRUCTURAL re-chunking only (resolved via
  `AskUserQuestion` before implementation): `@speedora/subtitle-rewriter` groups a clip's own
  already-transcribed words into short, pause/rhythm/emotion/speaking-speed-aware caption lines with
  precomputed emphasis, plus a derived `HighlightTimeline` of punch-worthy moments — every ASR word/
  order/timestamp stays byte-for-byte unchanged, no LLM call.
- **Track B, Phase A2 (wire Subtitle Rewriter into rendering, spec Part 7)**: shipped, flag-off. A
  new per-clip `Clip.smartSegmentation` Boolean (same orthogonal-to-`captionStyle` shape as
  `speakerColorCaptions`, user-settable via `PATCH /clips/:id`) opts a clip's captions into Phase
  A1's rewritten timeline at render time - gated by 3 conditions together (the per-clip toggle, the
  global `SUBTITLE_REWRITE_ENABLED` flag, and no translation requested). `buildAss()` itself needed
  zero changes. A real coordinate-frame bug (clip-relative vs. absolute source time) was caught
  while writing this phase's own tests, before it ever ran - see `ai/subtitle-intelligence.md`'s
  "Phase A2 architecture (as shipped)" section. No frontend UI yet (API-settable only).
- **Track B, Phase B1 (Dynamic Caption Engine, data only, spec Part 8)**: shipped, flag-off
  (`DYNAMIC_CAPTION_ENABLED=false`). New `@speedora/dynamic-caption` - a pure composition (no LLM
  call, no new detector) over Phase A1's own `SubtitleTimeline`/`HighlightTimeline` and Phase 5's
  `EmotionalArc` - decides a size tier (small/normal/large, from emotional intensity) and animation
  (none/punch/attention, from highlight overlap and question-mark detection) for every caption
  line, rate-limited by a cooldown so animation stays a highlight, not a constant flicker ("Do NOT
  overuse animation," spec Part 8's own explicit constraint). `Clip.captionTreatment` persisted,
  exposed via `GET /clips/:id/intelligence`'s 10th field.
- **Track B, Phase B2 (wire Dynamic Caption treatment into rendering, spec Part 8)**: shipped,
  flag-off. A new per-clip `Clip.dynamicCaptions` Boolean (same shape as `smartSegmentation`) opts
  a clip's captions into Phase B1's size/animation decisions at render time - gated by 4
  conditions together (the per-clip toggle, the global `DYNAMIC_CAPTION_ENABLED` flag, and Phase
  A2's own smart-segmentation gate, since treatment data only aligns with the rewritten timeline).
  New `\fscx`/`\fscy`/`\t` ASS tags - genuinely new territory for this codebase, but **verified
  against a real `ffmpeg`+`libass` render** (not left as an "unverified sandbox" caveat the way
  Audio/Scene/Facial Intelligence's own subprocesses still are) - a real `.ass` file exercising
  every new tag was rendered through the exact same `subtitles=` filter production uses, and
  frames were visually inspected to confirm correct scaling. See `ai/subtitle-intelligence.md`'s
  "Phase B2 architecture (as shipped)" section. **This completes the full Subtitle & Dynamic
  Caption Intelligence roadmap (Track B Phase A1/A2/B1/B2)** - see that doc's own status banner.
- **Track B, Phase C (Visual Emphasis Engine, spec Part 9)**: Phases C1-C5 and C7 shipped (C7
  deliberately implemented BEFORE C6 - see below); C6 needs a dedicated redesign pass before
  implementation - see [`ai/visual-emphasis-engine.md`](./visual-emphasis-engine.md). Real spec
  text obtained before any design started (unlike Phase 7's original Virality Engine) - "Generate
  editing suggestions" across Auto Zoom/Auto Crop/Face Priority/Object Priority/OCR Highlight/Focus
  Shift/Digital Push/Reaction Hold/Pause Hold. Audit found 3 of the 9 already shipped (Auto
  Zoom/Crop/Face Priority, via `packages/reframe`), and confirmed the original roadmap's own
  flagged risk is real: `buildReframePlan()`'s own face-detection-only subject choice is completely
  disconnected from `packages/primary-subject`'s already-built, richer selection chain used
  elsewhere for Composition Intelligence scoring. Split into 7 sub-phases (C1 data-only suggestion
  timeline, C2 unifies the duplication - also making Object Priority real for the first time, C3
  Focus Shift, C4 Digital Push, C5 OCR Highlight, C6 Reaction Hold, C7 Pause Hold). **Phase C1**
  (`@speedora/visual-emphasis`) is a pure, zero-LLM composition over 5 already-computed signals
  (Phase A1/B1's `HighlightTimeline`, OCR Intelligence's price/name tracks, Composition
  Intelligence's `PrimarySubjectSample[]`, Phase 10's `emotionalPeaks`/`curiosityPeaks`/
  `dropPoints`, `@speedora/cutlist`'s silence-gap detection) into one chronological
  `EditingSuggestionTimeline` (`Clip.editingSuggestions`, `VISUAL_EMPHASIS_ENABLED`) naming which
  of 5 techniques applies, when, and why - no new detector, no rendering-path change. **Phase C2**
  is that rendering-path change, and unlike every other phase in this initiative ships with no
  flag at all (a real behavior fix, not an opt-in): `render-clip.worker.ts`'s `buildReframePlan()`
  no longer calls a second, disconnected `detectFaces()` subprocess - it now consumes the render
  graph's own `primarySubjectSamples` (Composition Intelligence's `selectPrimarySubject()`) for
  Smart Reframe's actual crop-path subject, closing Tech Debt #1 (the duplication) and #2
  (`buildCropPath()` gaining real object-track input as a free byproduct) in one rewiring, with no
  new package/contract/migration/DTO field needed. **Phase C3** (Focus Shift) inserts synthetic
  hold/snap waypoints into `@speedora/reframe`'s existing linear-ramp interpolation (no new
  interpolation math) around each Phase C1 `focus_shift` suggestion, turning a slow drift across a
  detected subject change into a short, deliberate snap - unlike C2, this is a genuinely new visual
  effect with no real footage available in this sandbox to validate its aesthetics, so (resolved
  via `AskUserQuestion`) it ships behind its own `VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED` flag, off by
  default, no per-clip toggle - the first Track B rendering phase to make that off-by-default
  choice explicitly rather than following C2's unconditional precedent. **Phase C4** (Digital
  Push) extends Auto Zoom's (Fase 11) existing emphasis-word trigger set with Phase C1's own
  `digital_push` suggestion instants - the SAME `zoomEnvelopeAt()` envelope, UNCHANGED, now fed by
  a combined trigger array (`[...emphasisWords, ...digitalPushStarts]`) through the same
  max-reduce every overlapping-emphasis-word case already used, which is also this phase's "real
  merge rule" for overlapping triggers (falls out for free, no new logic). Also resolved via
  `AskUserQuestion` (the user's own framing: this changes an existing effect's *frequency*, not
  correctness - the risk is over-emphasis, not a bug) - ships behind its own, independent
  `VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED` flag, off by default, no per-clip toggle, explicitly never
  sharing a flag with Focus Shift so each technique can be calibrated independently in production.
  **Phase C5** (OCR Highlight) is this initiative's first genuinely new RENDERING mechanism (DC5) -
  resolved via `AskUserQuestion` in favor of ASS `\p1` vector-drawing rectangles (reusing the
  already-proven `subtitles=` filter pipeline from Phase B2, not a new ffmpeg `drawbox` filter) at
  a STATIC crop-window snapshot taken at each highlight's own start (never continuous pan/zoom
  tracking - its own separate, harder problem, explicitly deferred). `@speedora/reframe`'s new
  `computeOcrHighlightBoxes()` transforms a qualifying OCR track's source-frame box into output-
  frame pixel coordinates; `@speedora/subtitles`' new `buildOcrHighlightEvent()` draws it. Ships
  behind its own `VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED` flag, off by default, no per-clip toggle -
  same rollout shape as C3/C4, each phase re-deciding it explicitly rather than assuming the
  precedent. Uniquely among C2-C5, this phase's own RENDERING MECHANISM (not just its aesthetics)
  was verified against a real ffmpeg+libass render with frame extraction, an explicit acceptance
  gate the user required before trusting it - the ASS tag combination is confirmed genuinely valid,
  not just a plausible-looking string. **Phase C6** (Reaction Hold) was reconsidered before starting
  and found categorically riskier than every phase shipped so far - literally "extending a shot's
  on-screen duration" would be the first change in this initiative to touch the clip's own temporal
  coordinate system (shifting every downstream caption/crop-path/B-roll timestamp), not just spatial
  positioning or an editing decision. Deferred pending its own dedicated redesign pass (tentatively
  **C6R**) building a reusable temporal-remapping primitive FIRST, per explicit user direction -
  "don't change timeline duration without an explicit temporal-remapping layer first" - rather than
  a Reaction-Hold-specific hack. **Phase C7** (Pause Hold) was implemented in its place - a
  deliberate reordering, not an oversight - since it only changes an editing DECISION (which
  already-detected `@speedora/cutlist` silence gaps get skipped rather than trimmed, via a new
  `protectPauseHolds()` requiring an EXACT match against a Phase C1 `pause_hold` suggestion window),
  never the timeline itself. Ships behind its own `VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED` flag, off by
  default, no per-clip toggle, same shape as every prior rendering-behavior phase despite being
  lower-risk than all of them. **The C6R redesign itself is now complete** (resolved via
  `AskUserQuestion`, zero code yet): the key finding is that a THIRD ffmpeg pass, running AFTER
  C7's own cuts on the already fully-composed-and-trimmed output, needs no caption/crop-path/B-roll
  remapping at all - those are already baked into pixels by that point, the same reason C7's cuts
  pass itself never needed to touch them. The one real "temporal-remapping primitive" needed is a
  generalization of the existing `computeCutJunctionTimestamps()` (Fase 14, Smart Transitions) into
  a `remapTimestamp()` function mapping any original clip-relative instant onto its post-cut
  position (`null` when that instant itself was cut away - resolved as "skip that hold", the same
  conservative posture C7 already established). The mechanism itself: **freeze-frame** (not
  slow-motion) plus a **brief inserted silence** (not a held/repeated audio sample, which risks
  broken-syllable/noise-loop artifacts, and not continued audio playback, which would create a new
  A/V-divergence contract) - both streams extended by the exact same duration at the exact same
  point, a stated invariant ("C6R must never leave the final output with an A/V timestamp offset").
  Split into C6R.1 (the remapping primitive) → C6R.2 (the freeze+silence ffmpeg mechanism, its own
  real-ffmpeg verification gate) → C6R.3 (wiring, flag-gated `VISUAL_EMPHASIS_REACTION_HOLD_ENABLED`)
  - each still needing its own explicit go-ahead before implementation starts. **C6R.1 is now
  shipped**: `@speedora/cutlist`'s new `remapTimestamp()` maps any original clip-relative instant
  onto its post-cut position, `null` when that instant was cut away entirely. Deliberately did NOT
  refactor `computeCutJunctionTimestamps()` to reuse it, despite the surface similarity planned in
  the original design - a real semantic mismatch surfaced while writing that refactor (a cut's own
  `start` always falls inside its own range by `remapTimestamp()`'s own definition, so it would
  return `null` for every cut, not the junction position `computeCutJunctionTimestamps()` actually
  needs) - caught before it shipped as a subtly wrong DRY cleanup, not after. No ffmpeg/worker/flag
  changes at all - `remapTimestamp()` has no caller anywhere yet, C6R.3's job. C6R.2/C6R.3 remain
  design only.

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

## Dependency graph (Phase 1-7, as shipped)

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

hookPrediction (existing, Phase 1 - HookPredictionOutput, optional) ───┐
narrativeGraph (existing, Phase 3 - NarrativeGraph, optional) ─────────┤
contextualMomentum (existing, Phase 4 - MomentumCurve, unmodified) ────┼──▶ computeVirality
emotionalArc (existing, Phase 5 - EmotionalArc, unmodified) ───────────┘   Prediction()
                                                                            (@speedora/virality-
                                                                             engine, PURE - no
                                                                             LLM call, no `deps`
                                                                             param)
                                                                    │
                                                                    ▼
                                                          ViralityPrediction
                                        { viralityProbability, confidence, reason,
                                          subProbabilities: { hookStrength, replayPotential,
                                          buildIntensity, peakMomentum, emotionalIntensity,
                                          emotionalRange, narrativeCompleteness, payoffPresence } }
                                        - each sub-probability null when its source phase's data
                                          is unavailable; composite averages only non-null values
                                                                    │
                                                                    ▼
                                     Clip.viralityPrediction (new Json? column - null means ONLY
                                                        "predates this migration," not "failed" -
                                                          this node always produces a real object)
                                                                    │
                                                                    ▼
                                       GET /clips/:id/intelligence (flag-gated exposure,
                                                                     own independent flag)
```

## Roadmap (Parts 2-15 — documented, not built unless marked shipped)

Two tracks. **Track A** (scoring/intelligence chain) is the user's own recommended sequence, each
phase mergeable as its own PR. **Track B** (editorial/rendering) consumes Track A's outputs
opportunistically but doesn't block or get blocked by it. No phase changes default production output
until its own later calibration sub-phase.

**Renumbering note (2026-08-08, Parts 4-15 re-audit)**: the user supplied the real Part 4-15 spec
text for the first time. It revealed Phases 7/4-5/2 didn't match what Parts 4/5/6 actually asked for
(built by reverse-engineering before the text existed). Phase 9 (below) realigns Phase 7. Two more
new phases (Retention Curve Insights, Multimodal Reasoning Engine) were inserted for Parts 5/6,
pushing the original Phase 9-14 (Explainability through Production Hardening) to Phase 12-17. Phases
0-8 keep their original numbers and shipped git history unchanged — only not-yet-started phases were
renumbered. Full ADR (D12-D16) and audit are in persistent memory
(`project_ai_intelligence_v4_parts4_15_reaudit.md`) and this session's own plan file.

### Track A — Scoring & Intelligence Chain

| Phase | Name (spec Part) | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| 2 | Semantic Event Detection (2) — **shipped** | Phase 0/1; pulled forward Multimodal Reasoning (6) as `packages/multimodal-reasoning` | L | 22-value taxonomy governance (satisfied via `describeEventType()`'s exhaustive switch); +1 LLM call/clip |
| 3 | Narrative Graph (3) — **shipped** | Phase 2 | L | Hardest LLM-reasoning task; needs an "unsegmented" fallback (satisfied via `validateGraph()`'s structural collapse) |
| 4 | Contextual Momentum (new, part of 5) — **shipped** | Phase 3 + `EditingRhythmFeatures.accelerationScore` | M | No ground truth for curve *shape* yet (still true post-ship — heuristic weights, undocumented as calibrated) |
| 5 | Emotional Arc (new, part of 5) — **shipped** | vocal-emotion rescue (see below) + Phase 2 | M | Vocal-emotion classifier trained on acted, not natural, speech (still true post-ship — a documented heuristic caveat, not a solved problem) |
| 6 | Multi-speaker Reasoning (extends 6) — **shipped** | Phases 1, 4, 5 | M | Must not affect single-speaker clips (the majority case) - addressed by design: `computeMultiSpeakerBreakdown()` returns `null` for any clip with fewer than 2 distinct speakers |
| 7 | Cross-module Fusion (4, Virality Engine) — **shipped, realigned by Phase 9** | Phases 1, 3, 4, 5 | M | Labeling discipline (8 heuristic probabilities reading as "trained") - addressed by design: each sub-probability documented as a HEURISTIC (ADR D4) with an explicit "not trained/calibrated" caveat, plus a new 4th disambiguation section in `ai/scoring.md` against the pre-existing `viralityScore`. **Superseded**: shipped by reverse-engineering Part 4 without its real spec text — see Phase 9 |
| 8 | Confidence Calibration (cross-cutting) — **shipped** | Phases 1-7 | S-M | Hygiene pass, low risk — addressed by design: no numeric recalibration was possible (0 usable engagement samples, same blocker every phase already documents), so this phase is labeling/consistency only — a missing field comment, 6 standardized module comments, and a confidence-field taxonomy, zero new runtime behavior |
| 9 | Virality Engine Realignment (4) — **shipped** | Phases 1, 3, 4, 5 (same deps Phase 7 already had) | M | Breaking change to `ViralitySubProbabilities` (ADR D12) - addressed by design: `VIRALITY_ENGINE_ENABLED` was `false` in production so zero real consumers existed; scoped tightly to the shape change only (no new migration/node/sink/DTO field needed since `Clip.viralityPrediction` is `Json?`) |
| 10 | Retention Curve Insights (5, extension) — **shipped** | Phases 2, 4, 5 | S-M | Peak/trough thresholds are HEURISTIC (no ground truth for curve *shape*, same caveat Phase 4 already carries) — addressed by design: every `RetentionPoint.score` field is documented as such; "Curiosity Peaks" had no free existing signal (needed `SemanticEvent` timestamp mapping, not pure array math) — resolved via a new `isCuriositySemanticEventType()` exhaustive switch (Contract Governance rule 1) |
| 11 | Multimodal Reasoning Engine (6) — **shipped** | Phase 0, Phase 2 (context) + raw Face/Gesture/Audio/Speaker/Scene/OCR/Object signals | L | First new LLM reasoning module since Phase 3 — prompt-engineering risk (genuine cross-modal "connection" reasoning, not just concatenated signal descriptions) - addressed by design: evidence is grouped by transcript segment (not sent as flat concatenated text) and every LLM-cited connection is deterministically re-validated against the real evidence sent, dropping any connection whose evidenceRefs don't resolve or whose resolved modalities are < 2 |
| 12 | Explainability (13) | Phases 1-11 | M | UI copy is where "scale honesty" holds or breaks — also must decide whether to backfill reason/confidence onto the 3 currently-silent fields (momentum/emotional-arc/multi-speaker) or document why they stay silent |
| 13 | Candidate Expansion (10, generation half) | Phase 1 | L | Biggest infra change — new pre-render adapter stage; must fix `clip-scoring`'s hardcoded "Pick 1-3" prompt text, not just raise `maxCandidates` |
| 14 | Ranking Refinement + Personalization (10 rank half + 11) | Phase 13 + Phases 1-9 | L | Pre-render vs. post-render tension (ADR D16, unresolved); introduces `WorkspaceContentProfile` schema (D10), reusing `platform-fit`'s weighted-sum pattern |
| 15 | Learning Pipeline (12) | Phases 1-14 | S | Interfaces only, no training, by design — needs a genuinely new v4-aware `FeatureExtractor`, since `fusion-ml`'s `FUSION_V3_SIGNALS` vocabulary has zero v4 coverage today (D11 alone doesn't cover this) |
| 16 | Evaluation Suite (new) | Phases 13-15 | M | Gated on real engagement samples, same as Fusion v3 — also gated on `dataset-feedback-loop`'s own known gap (CTR/Retention/Completion/Replay have no capture mechanism at all yet) |
| 17 | Production Hardening (final) | all | M | Real go/no-go gate on cost + rollout; also where spec Part 15's "performance benchmark" ask belongs |

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
| A1 | Subtitle Rewriter, data only (7) — **shipped, flag-off** (`SUBTITLE_REWRITE_ENABLED=false`), see [`ai/subtitle-intelligence.md`](./subtitle-intelligence.md) | vocal-emotion rescue | M | Re-chunking heuristic quality unvalidated; addressed by design: non-destructive, data-only (`Clip.subtitleIntelligence`), zero render-path risk |
| A2 | Wire Subtitle Rewriter into `buildAss()` (7) — **shipped, flag-off** (`Clip.smartSegmentation`) | A1 | M | First phase touching the production render path — karaoke word-sync must survive re-chunking |
| B1 | Dynamic Caption Engine, data only (8) — **shipped, flag-off** (`DYNAMIC_CAPTION_ENABLED=false`) | A1, Phase 5 | S-M | "Don't overuse animation" needs an explicit documented cooldown heuristic |
| B2 | Wire Dynamic Caption treatment into `build-ass.ts`'s ASS emission (8) — **shipped, flag-off** (`Clip.dynamicCaptions`) | B1, A2 | L | New `\fscx`/`\fscy`/`\t` ASS tag territory — verified against real ffmpeg+libass, including a visual frame-extraction check |
| C | Visual Emphasis Engine (9) — **C1 shipped, flag-off** (`Clip.editingSuggestions`), **C2 shipped, no flag** (real behavior change), **C3 shipped, flag-off** (`VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED`), **C4 shipped, flag-off** (`VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED`), **C5 shipped, flag-off** (`VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED`, real ffmpeg+libass verified), **C7 shipped, flag-off** (`VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED`, implemented before C6), **C6 design complete (renamed C6R) - C6R.1 shipped, C6R.2/C6R.3 not yet built**, see [`ai/visual-emphasis-engine.md`](./visual-emphasis-engine.md) | none — signals already exist | M (per original estimate; the real spec text splits into 7 sub-phases, S-L each) | Unify `reframe`'s own face detector with `primary-subject`'s choice, don't layer a second opinion (Phase C2, shipped) |

**Update (2026-08-08)**: resolved a real product-shape ambiguity in Part 7's "rewrite subtitle" via
`AskUserQuestion` before any code was written (same "ask, don't guess" precedent as v2.1's Practical
Score/Prediction, OI-4's interactionConfidence redesign) — the spec's own illustrative example
changes actual wording, which conflicts with karaoke word-sync and this table's own already-stated
risk ("must never rewrite transcript facts"). User resolved: **structural re-chunking only for this
phase** (every ASR word/order/timestamp stays verbatim; only line breaks/chunk boundaries/emphasis
selection change), with lexical paraphrase explicitly deferred to its own future, separately-gated
phase. Old single "Phase A" row above is now split into A1/A2 (Subtitle Rewriter) and B1/B2 (Dynamic
Caption Engine, renamed from the old "Phase B" which is now **Phase C**) per the full audit/ADR/
dependency-graph/roadmap in [`ai/subtitle-intelligence.md`](./subtitle-intelligence.md). **Update,
same day**: Phase A1 is now shipped (flag-off) — a pure, non-destructive re-chunker
(`@speedora/subtitle-rewriter`) producing `Clip.subtitleIntelligence` (`SubtitleTimeline` +
`HighlightTimeline`), wired as a new `optional: false` render-graph node, exposed via
`GET /clips/:id/intelligence`'s 9th field. Does not yet touch `buildAss()`/the actual burned-in
captions (Phase A2's job). A2/B1/B2 remain design-only pending their own go-ahead — see
`ai/subtitle-intelligence.md`'s "Phase A1 architecture (as shipped)" section for the full file list,
a real bug caught during verification, and what was actually tested/built.

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

## Phase 7 architecture (as shipped)

```
packages/contracts/src/virality-engine.ts
                                             viralitySubProbabilitiesSchema,
                                             viralityPredictionSchema,
                                             computeViralityPredictionInputSchema (imports
                                             hookPredictionOutputSchema from ./hook-prediction,
                                             narrativeGraphSchema from ./narrative-graph,
                                             momentumSampleSchema from ./contextual-momentum,
                                             emotionalArcSampleSchema from ./emotional-arc - same
                                             cross-contract-file-import precedent
                                             contextual-momentum.ts/multi-speaker-reasoning.ts
                                             already set)

packages/virality-engine/src/
  is-payoff-segment-type.ts                 isPayoffSegmentType() - exhaustive switch/assertNever
                                             over all 10 NARRATIVE_SEGMENT_TYPES (Contract
                                             Governance rule 1), marking resolution/takeaway/cta
                                             as payoff-bearing - same "govern an existing enum
                                             being consumed for the first time" pattern Phase 4/6
                                             already established
  compute-virality-prediction.ts            computeViralityPrediction() - the module's single
                                             entry point, PURE and synchronous (no `deps` param) -
                                             same zero-LLM shape as Phase 4/5/6, since "Cross-
                                             module Fusion" means fusing v4's own already-computed
                                             outputs, not detecting anything new. Exactly 8 sub-
                                             probabilities, 2 sourced from each of Phases 1/3/4/5
                                             (hookStrength/replayPotential from Hook Prediction,
                                             buildIntensity/peakMomentum from Contextual Momentum,
                                             emotionalIntensity/emotionalRange from Emotional Arc,
                                             narrativeCompleteness/payoffPresence from Narrative
                                             Graph) - each null (not 0) when its source phase's
                                             data is unavailable, same "null means unavailable"
                                             convention Phase 6 established. Composite
                                             viralityProbability averages only non-null values;
                                             confidence is coverage-only (count non-null / 8)
  feature-flags.ts                          isViralityEngineEnabled()

apps/worker/src/render-graph/nodes/virality-engine.ts
                                             viralityPredictionNode, id: 'viralityPrediction'
                                             (optional: false, no fallback - same reasoning as
                                             Phase 4/5/6's own pure-derive nodes; deps:
                                             hookPrediction, narrativeGraph, contextualMomentum,
                                             emotionalArc - exactly the roadmap's own stated
                                             dependency list, Phases 1/3/4/5, all already-existing
                                             node ids, none touched or modified by this phase)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['viralityPrediction'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1).
                                             Unlike Phase 6's multiSpeakerBreakdown, this node
                                             always produces a real object once it runs (no
                                             "doesn't apply to the majority case" analog) - so it
                                             reverts to the "always-computed non-nullable object"
                                             convention audioFeatures/editingRhythmFeatures/
                                             compositionFeatures already use: a plain passthrough,
                                             no Prisma.JsonNull, no InputJsonValue cast needed

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedViralityPrediction() - the TS2742 fix (D7).
                                             Same null-semantics as toSharedContextualMomentum/
                                             toSharedEmotionalArc (not
                                             toSharedMultiSpeakerBreakdown's third pattern): null
                                             here can ONLY mean this Clip row predates this
                                             phase's migration

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `viralityPrediction`, gated by its OWN independent
                                             flag (D9 - the 7th field on the same DTO)

packages/database/prisma/schema.prisma      Clip.viralityPrediction Json? (new column,
                                             real-Postgres round trip manually verified)

packages/shared/src/types/
  video.ts                                  ViralitySubProbabilities/ViralityPrediction
                                             mirrored (not imported), same duplication precedent
                                             as SpeakerAttribution/EmotionalArcSample/
                                             MomentumSample/NarrativeGraph/SemanticEvent/
                                             HookPredictionOutput; Clip.viralityPrediction field
  intelligence-v4.ts                        ClipIntelligenceDto.viralityPrediction
```

**Naming collision investigated and resolved**: `Clip.viralityScore` already existed (Fase 8's
original MVP LLM clip-scoring, pre-dates v4 entirely). Kept the "Virality" name for direct
traceability to the roadmap/ADR's own naming (spec Part 4 = "Virality Engine," same "package name
mirrors the roadmap's own phase noun" convention every prior phase used), but the new field is
`Clip.viralityPrediction` (not bare `virality`), and `docs/ai/scoring.md` now has a new 4th section
disambiguating the two explicitly - see there for the full comparison.

**A real bug found and fixed during verification**: an early version of `hasNarrativeGraph` used
`narrativeGraph !== null` (a strict check) rather than the established `!narrativeGraph ||
narrativeGraph.unsegmented` truthy-check pattern `@speedora/contextual-momentum`'s own `segmentAt()`
already uses - this threw when the render-graph's `get()` handed back `undefined` rather than
`null` in `render-clip.worker.spec.ts`'s own integration fixtures (81 of 85 tests failed). Fixed to
`narrativeGraph != null && !narrativeGraph.unsegmented` (loose inequality, catches both null and
undefined) and locked in with a dedicated regression test.

`Clip.highlightScore` and every existing Fusion Engine v2 output are unchanged by all seven
phases — verified by regression tests in `sinks.spec.ts` (extended to cover `viralityPrediction`
alongside `hookPrediction`/`semanticEvents`/`narrativeGraph`/`contextualMomentum`/`emotionalArc`/
`multiSpeakerBreakdown`) plus a full, green run of every existing test suite after each phase's
changes. Phase 3 was the first to run the full `pnpm verify` (added between Phase 2 and Phase 3)
locally before pushing; Phases 4-7 continued that practice. Phase 7: `apps/worker`: 576/576,
`apps/api`: 1268/1268, `apps/web`: 313/313, plus 37 new unit tests in `packages/virality-engine`
(including the dedicated undefined-vs-null regression test above) - a fully clean run, no
load-induced flakes this time. Real-Postgres round trip verified manually for the new column.

## Phase 8 architecture (as shipped)

Confidence Calibration turned out, once researched, to have no numeric work to do: real
calibration (adjusting a confidence number against observed accuracy) needs engagement data that
doesn't exist yet — the same "0 usable samples" blocker every phase from Phase 1 onward already
documents in its own comments, and the same blocker Fusion Engine v3 (M2C) and Milestone 1.5 are
both explicitly parked on. So "calibration" here means labeling/consistency calibration only —
comments and docs, zero runtime change. **No new package, contract, migration, or API field** — the
first phase since Phase 0 without a new `packages/<name>` module.

**Confidence-field taxonomy** (the audit this phase's comment changes are based on — every
confidence-shaped field across Phases 1-7):

| Phase | Field | Meaning | Kind |
|---|---|---|---|
| 1 Hook Prediction | `HookPredictionOutput.confidence` | Fraction of this module's configured signal weight backed by non-null input data | Code-computed coverage |
| 2 Semantic Events | `SemanticEvent.confidence` (per-event) | The LLM's own certainty that this moment matches its assigned `type` | LLM-self-reported |
| 3 Narrative Graph | `NarrativeSegment.confidence` (per-segment) | The LLM's own certainty about this segment's `type` classification | LLM-self-reported |
| 4 Contextual Momentum | — | No confidence field — a pure derive with no natural weighted-budget/coverage concept the way Phase 1/7 have | N/A |
| 5 Emotional Arc | — | No confidence field, same reasoning as Phase 4 | N/A |
| 6 Multi-speaker Reasoning | — | No confidence field — per-speaker `null` sub-fields (`averageMomentumScore`, `dominantEmotion`, ...) already communicate coverage without a redundant top-level number | N/A |
| 7 Virality Engine | `ViralityPrediction.confidence` | `count(non-null sub-probabilities) / 8`, flat (no weighting, unlike Phase 1) | Code-computed coverage |

Two genuinely different "kinds" of confidence exist across this codebase's v4 modules, and neither
is a measure of *accuracy* — both are forms of "how much of the intended input did this prediction
actually have," not "how often is this prediction right" (nothing here is validated against
outcomes yet):
- **Code-computed coverage** (Phase 1, 7) — a deterministic fraction of available signal, computed
  in plain arithmetic, not asked of the LLM.
- **LLM-self-reported** (Phase 2, 3) — the model's own stated certainty about a categorical
  judgment it just made, taken at face value with no independent check.

Every contract file's confidence-bearing field now carries a one-line pointer back to this table
(`packages/contracts/src/hook-prediction.ts`, `semantic-events.ts`, `narrative-graph.ts`,
`virality-engine.ts`), replacing Phase 7's previous one-directional, unconfirmable cross-reference
("same meaning as HookPredictionOutput's own confidence," pointing at a field that had no comment
of its own to confirm the claim).

**"Scale honesty" comment standardized** across the 6 contract files that previously lacked either
the phrase itself or the operational instruction that follows it (`semantic-events.ts`,
`narrative-graph.ts`, `contextual-momentum.ts`, `emotional-arc.ts`, `multi-speaker-reasoning.ts`,
`virality-engine.ts`): every module-level comment now states both the ADR D4 "scale honesty" label
*and* "never present these as ML-model output downstream (UI copy, API docs) without this caveat"
— previously only Phase 1's file said the second part. Each file's own extra phase-specific caveat
(e.g. Phase 5's IEMOCAP acted-speech note) was preserved verbatim, not replaced.

**Naming collision investigated and resolved (same shape as Phase 7's own `viralityScore` vs.
`viralityPrediction` disambiguation)**: `docs/ai/dataset-validation-calibration.md`'s Milestone 1.5
already ships a "Weight Calibration Report" — an entirely different object. It suggests
adjustments to **Fusion Engine v2's signal weights** (`packages/fusion-engine/src/weights.ts`,
e.g. facial/audio/scene contribution percentages) once ≥20 real engagement samples exist,
correlating each *signal* against outcomes at the Fusion Engine level. Phase 8's "Confidence
Calibration" is about individual v4 *prediction fields'* confidence-number semantics being
honestly labeled — no signal weights, no Fusion Engine v2 involvement, no correlation math. The
shared word "calibration" is the only overlap; this section is that disambiguation, so a future
reader doesn't conflate the two the way Phase 7 already flagged for `viralityScore`.

**Why no new numeric calibration**: restated here as the phase's own explicit closing note, not
just implied by the roadmap table — every phase from Phase 1 onward already documents "0 usable
engagement samples exist yet" in its own comments (`docs/ai/dataset-feedback-loop.md`). Genuinely
calibrating a confidence number against observed accuracy requires exactly that data. Until it
exists, this phase's only honest option was labeling/consistency, which is what shipped.

Verification: comments/docs-only change, zero new runtime logic, so verification is a full green
`pnpm verify` run (unchanged pass/fail status across every suite) plus a grep confirming no
existing test asserts on the exact comment text touched.

## Phase 9 architecture (as shipped)

Virality Engine Realignment exists because Phase 7 shipped without the real Part 4 spec text — it
reverse-engineered "Virality Engine" into 8 structural sub-probabilities
(`hookStrength`/`replayPotential`/`buildIntensity`/`peakMomentum`/`emotionalIntensity`/
`emotionalRange`/`narrativeCompleteness`/`payoffPresence`). Once the user supplied the real text (a
"Parts 4-15 re-audit" done before this phase, ADR D12-D16), it named 7 different probabilities:
**Scroll Stop, Watch, Completion, Share, Comment, Save, Follow Probability + Overall Viral Score**.

```
packages/contracts/src/virality-engine.ts
                                             viralitySubProbabilitiesSchema REPLACED (not extended)
                                             - 7 new fields, each documented with the existing
                                             Phase 1/3/4/5 field(s) it re-composes:
                                               scrollStopProbability  <- hookPrediction.
                                                 predictionFeatures.expectedScrollStopRate (direct)
                                               watchProbability       <- momentumCurve avg +
                                                 hookPrediction.expectedRetentionLift (normalized)
                                                 + narrativeGraph segment-type coverage
                                               completionProbability  <- narrativeGraph payoff
                                                 check (same isPayoffSegmentType/`resolves` logic
                                                 Phase 7's old payoffPresence used) + late-momentum
                                                 (final third of momentumCurve) not collapsing
                                               shareProbability       <- hookPrediction surprise/
                                                 controversy scores + emotionalArc peak intensity
                                               commentProbability     <- hookPrediction controversy/
                                                 question-density scores + an "unresolved tension"
                                                 check (conflict/escalation segment, no `resolves`)
                                               saveProbability        <- hookPrediction numeric-
                                                 fact-count/named-entity-count (normalized) +
                                                 narrativeGraph `takeaway`-segment bonus
                                               followProbability      <- hookPrediction dominant-
                                                 emotion positivity + emotionalArc 'hap' ratio -
                                                 documented as the WEAKEST-SUPPORTED of the 7 (no
                                                 speaker-trust signal is one of this phase's 4
                                                 dependencies)
                                             viralityPredictionSchema.viralityProbability RENAMED to
                                             overallViralScore (spec's own "Overall Viral Score"
                                             naming); confidence denominator /8 -> /7

packages/virality-engine/src/
  compute-virality-prediction.ts            computeViralityPrediction() rewritten - one small pure
                                             helper per probability (computeScrollStopProbability()
                                             through computeFollowProbability()), each averaging
                                             only the parts whose source data is present (same
                                             "null means unavailable" convention every prior phase
                                             uses); SUB_PROBABILITY_LABELS/buildReason() updated to
                                             the 7 new keys, same shape otherwise
  is-payoff-segment-type.ts                 UNCHANGED - still reused by completionProbability's
                                             payoff check and (via a sibling hasUnresolvedTension()
                                             helper) commentProbability's tension check

apps/worker/src/render-graph/nodes/virality-engine.ts
                                             UNCHANGED - same node id, same 4 deps (hookPrediction/
                                             narrativeGraph/contextualMomentum/emotionalArc), same
                                             optional: false; compiles against the new return type
                                             with no code change needed

apps/worker/src/render-graph/sinks.ts       UNCHANGED - still a plain passthrough
                                             (`viralityPrediction: (r) => ({ viralityPrediction:
                                             r.viralityPrediction })`), no field names referenced

packages/database/prisma/schema.prisma      UNCHANGED - Clip.viralityPrediction is Json? with no
                                             DB-level schema, so the shape change needed NO new
                                             migration (a genuine scope-reduction found during this
                                             phase's own planning, smaller footprint than a typical
                                             new-phase PR despite being a breaking change)

packages/shared/src/types/video.ts          ViralitySubProbabilities/ViralityPrediction interfaces
                                             updated to the new field names (still duplicated, not
                                             imported, same convention every phase's mirror follows)

apps/api/src/clips/clips.service.ts,
apps/api/src/videos/transcript-segment.util.ts
                                             UNCHANGED - toSharedViralityPrediction() narrows
                                             `unknown` to `ViralityPrediction | null` without
                                             referencing any field name; GET /clips/:id/intelligence
                                             still exposes viralityPrediction under the same
                                             VIRALITY_ENGINE_ENABLED flag, no new field
```

**No new feature flag, no new API/DTO field, no new render-graph wiring** — the render-graph node,
sink, flag, and `ClipIntelligenceDto.viralityPrediction` field all keep their Phase 7 identity; only
the internal shape of what flows through them changed. This is a real departure from every other
phase's footprint, and was flagged as such during this phase's own planning specifically because
D12 makes it a breaking change despite the small footprint.

**`docs/ai/scoring.md` updated**: §4's sub-probability list and the `viralityProbability` ->
`overallViralScore` rename are reflected there; the disambiguation-from-`viralityScore` reasoning
itself (system 1 vs. system 4) is unchanged, since the *relationship* between the two systems didn't
change, only system 4's internal field names.

**The `followProbability` weak-signal caveat is documented, not silently accepted**: with only
Phases 1/3/4/5 wired as inputs (no Speaker Scoring), nothing in this phase's dependency set carries
a real trust/authority/engagement signal for "will they follow this creator." The contract's own
field comment names this as the weakest-supported of the 7 and points at a future (unscoped)
strengthening via Speaker Scoring, rather than presenting a weak proxy as equally reliable to the
other 6.

Verification: `packages/virality-engine`'s own suite (37 tests, a rewrite of the existing coverage
for the new fields/values, including the preserved `narrativeGraph`-undefined regression test from
Phase 7's own verification) all green; `apps/worker`'s `render-clip.worker.spec.ts` (576 tests, all
5 `viralityPrediction` fixtures use `expect.any(Object)` so needed no changes) and `sinks.spec.ts`
(updated `noViralityPrediction` fixture) all green; a repo-wide grep confirmed no other file
referenced the old field names outside `packages/virality-engine` itself. Full local `pnpm verify`
green before push.

## Phase 10 architecture (as shipped)

Retention Curve Insights turns Phase 4's `MomentumCurve` and Phase 5's `EmotionalArc` — real,
useful raw signal, but not spec Part 5's actual ask — into the derived outputs Part 5 names:
Expected Drop Points, Replay Zones, Emotional Peaks, and Curiosity Peaks. Unlike Phase 9's
realignment, this is **strictly additive** (ADR D13) — `MomentumCurve`/`EmotionalArc` themselves
are untouched, only consumed by a new layer on top.

```
packages/scene-intelligence/src/derive-motion-energy-features.ts
                                             findPeakIndices()/meanAndStddev() EXPORTED (were
                                             module-private) - reused rather than duplicated. New
                                             findTroughIndices() added alongside them - the mirror
                                             image (strict local MINIMUM below mean -
                                             PEAK_STDDEV_MULTIPLIER*stddev), same threshold
                                             constant, same file (keeps both next to the one shared
                                             mean/stddev computation)

packages/contracts/src/retention-curve-insights.ts
                                             retentionPointSchema ({t, score} - the shared shape for
                                             all 4 arrays), retentionCurveInsightsSchema
                                             (dropPoints/replayZones/emotionalPeaks/curiosityPeaks,
                                             each an array, never null - a real "no such point
                                             found" result when empty), computeRetentionCurveInsights
                                             InputSchema (imports momentumSampleSchema from
                                             ./contextual-momentum, emotionalArcSampleSchema from
                                             ./emotional-arc, semanticEventSchema from
                                             ./semantic-events - same cross-contract-file-import
                                             precedent virality-engine.ts already uses)

packages/retention-curve-insights/src/
  compute-retention-curve-insights.ts       computeRetentionCurveInsights() - the module's single
                                             entry point, PURE and synchronous (no `deps` param),
                                             same zero-LLM shape as Phase 4/5/6/9. dropPoints =
                                             trough indices over MomentumCurve.momentumScore, score
                                             = 1 - momentumScore (drop severity). replayZones =
                                             peak indices over MomentumCurve.momentumScore, boosted
                                             by the temporally-nearest EmotionalArc sample's
                                             intensity when one exists (falls back to momentumScore
                                             alone otherwise). emotionalPeaks = peak indices over
                                             EmotionalArc.intensity. curiosityPeaks =
                                             SemanticEvent[] filtered to isCuriositySemanticEventType,
                                             t/score taken directly from the event's own
                                             t/importance
  is-curiosity-semantic-event-type.ts       isCuriositySemanticEventType() - exhaustive switch/
                                             assertNever over all 22 SEMANTIC_EVENT_TYPES (Contract
                                             Governance rule 1), same "govern an existing enum being
                                             consumed for the first time" pattern Phase 6/7 already
                                             established. secret/prediction/warning/breaking_news/
                                             controversy read as curiosity-evoking (creates an
                                             information gap - a withheld fact, an implied future,
                                             visible disagreement, novelty); every other type does
                                             not
  feature-flags.ts                          isRetentionCurveInsightsEnabled()

apps/worker/src/render-graph/nodes/retention-curve-insights.ts
                                             retentionCurveInsightsNode, id:
                                             'retentionCurveInsights' (optional: false, no fallback
                                             - same reasoning as Phase 4/5/6/9's own pure-derive
                                             nodes; deps: contextualMomentum, emotionalArc,
                                             semanticEvents - all already-existing node ids, no new
                                             upstream detector)

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['retentionCurveInsights'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1). Same
                                             "always-computed non-nullable object" convention as
                                             viralityPrediction: a plain passthrough, no
                                             Prisma.JsonNull, no InputJsonValue cast needed (an
                                             object whose own array fields can be empty, but the
                                             object itself is never null once computed)

packages/database/prisma/schema.prisma      Clip.retentionCurveInsights Json? (new column, real
                                             migration this time - unlike Phase 9, this is a
                                             genuinely new field, not a shape change to an existing
                                             one; real-Postgres round trip verified manually)

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedRetentionCurveInsights() - the TS2742 fix (D7).
                                             Same null-semantics as toSharedContextualMomentum/
                                             toSharedEmotionalArc/toSharedViralityPrediction (not
                                             toSharedMultiSpeakerBreakdown's third pattern): null
                                             here can ONLY mean this Clip row predates this phase's
                                             migration

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `retentionCurveInsights`, gated by its OWN independent
                                             flag (D9 - the 8th field on the same DTO)

packages/shared/src/types/
  video.ts                                  RetentionPoint/RetentionCurveInsights mirrored (not
                                             imported), same duplication precedent as
                                             ViralitySubProbabilities/SpeakerAttribution/
                                             EmotionalArcSample/MomentumSample/NarrativeGraph/
                                             SemanticEvent/HookPredictionOutput; Clip.
                                             retentionCurveInsights field
  intelligence-v4.ts                        ClipIntelligenceDto.retentionCurveInsights
```

**Timeline visualization explicitly deferred to Phase 12**: the Parts 4-6 audit found zero v4
fields render anywhere in `apps/web` today - every prior phase (1-9) has been backend/contract-only
with UI work deferred to Phase 12 (Explainability), the phase this roadmap explicitly positions as
where new v4 UI surfaces get built. This phase ships the data only.

**No confidence field, matching Phase 4/5/6's own precedent**: `RetentionCurveInsights` has no
top-level confidence/coverage number - a pure derive with no natural weighted-budget concept, same
reasoning already established for `MomentumCurve`/`EmotionalArc`/`MultiSpeakerBreakdown`. Coverage
is communicated by each of the 4 arrays being present-but-possibly-empty, not by a separate figure.

Verification: `packages/retention-curve-insights`'s own suite (peak/trough detection edge cases -
empty arrays, flat signals with stddev 0 - plus an `isCuriositySemanticEventType()` exhaustiveness
test over all 22 `SEMANTIC_EVENT_TYPES`, same `it.each` pattern `is-payoff-segment-type.spec.ts`
uses) green; `apps/worker`'s `render-clip.worker.spec.ts` (all 5 `viralityPrediction` fixture sites
extended with a new `retentionCurveInsights: expect.any(Object)` line, same pattern Phase 7 used
after `multiSpeakerBreakdown`) and `sinks.spec.ts` (new `noRetentionCurveInsights` fixture, the
FusionInput-leak regression guard extended to cover this field too) green; real-Postgres round trip
verified manually for the new column. Full local `pnpm verify` green before push.

## Phase 11 architecture (as shipped)

Multimodal Reasoning Engine is spec Part 6's own real ask: "gabungkan Transcript, Scene, OCR, Face,
Gesture, Audio, Speaker, Timing, dan LLM... semua reasoning dilakukan secara multimodal... model
harus mampu menghubungkan evidence lintas modalitas." An audit against that source text first
(see the persistent-memory plan file, `project_ai_intelligence_v4_phase11.md`) found Phase 2's
existing `packages/multimodal-reasoning`/`findConcurrentEvidence` is a correct, reusable building
block but nowhere near Part 6-complete on its own — it's a deterministic OCR/Object co-occurrence
lookup consumed by one caller (`semantic-events`' grounding step), not a reasoning engine. This
phase **extends that same package** (not a second, competing one) with the genuine reasoning layer
Part 6 actually asks for, while leaving `findConcurrentEvidence`/`groundedFactSchema` completely
untouched — Phase 2 keeps working exactly as it does today.

**Evidence timing turned out to already be uniform** (a real open question the audit had to
resolve, not an assumption): every render-graph node id this phase depends on
(`sceneCutEvents`/`ocrTracks`/`objectTracks`/`facialEmotions`/`gestures`/`speakerTimeline`) is
already clip-relative by the time it reaches a node's `run()`, same clock as `ctx.transcript` once
re-anchored by `startTime` (the same `segment.start - startTime` convention every prior LLM-backed
v4 node already uses). `SpeakerTimelineEntry`'s own doc comment describes the RAW diarization
output as absolute-video-time, which reads as a risk at first glance — but `render-clip.worker.ts`'s
`toSpeakerTurns()` already converts to clip-relative BEFORE the render graph ever sees it, so no
conversion bug was possible here.

**Object Intelligence is a documented, non-normative extension, not a Part 6 requirement.** Part
6's own list is Transcript/Scene/OCR/Face/Gesture/Audio/Speaker (7) + Timing + LLM.
`objectTracks` is included as an 8th evidence source because it's mature/shipped and
`findConcurrentEvidence` already treats it as on-screen evidence alongside OCR — but every place
that names the modality list (contracts, package description, this doc) says so explicitly, rather
than silently presenting 8 as if Part 6 asked for it. `timing` is deliberately not a modality of
its own in `MODALITY_SOURCES` — every evidence item already carries `startTime`/`endTime`, so
timing is a dimension of evidence, not a signal source, matching Part 6's own Section 4 framing.

```
packages/contracts/src/multimodal-reasoning.ts
                                             groundedFactSchema/GROUNDED_FACT_SOURCES UNTOUCHED
                                             (Phase 2's own frozen contract). NEW below it:
                                             MODALITY_SOURCES (8 values - transcript/scene/ocr/
                                             face/gesture/audio/speaker/object, with 'object'
                                             documented as a non-normative extension),
                                             multimodalEvidenceSchema (id/modality/startTime/
                                             endTime/speakerId/value/confidence/provenance),
                                             MULTIMODAL_RELATION_TYPES (refers_to/co_occurs_with/
                                             emphasizes - deliberately small/closed, same
                                             discipline as NARRATIVE_RELATION_TYPES's 2 values),
                                             multimodalConnectionSchema (relation/evidenceRefs/
                                             modalities/startTime/endTime/confidence/reason),
                                             multimodalReasoningResultSchema (clipId/evidence/
                                             connections/modalityCoverage - modalityCoverage uses
                                             z.record(z.string(), ...) rather than
                                             z.record(z.enum(MODALITY_SOURCES), ...) deliberately,
                                             since zod infers an enum-keyed record's TS type as
                                             requiring every key present even though it validates a
                                             genuinely partial object fine at runtime)

packages/multimodal-reasoning/src/
  find-concurrent-evidence.ts               UNTOUCHED (Phase 2's own module)
  normalize-evidence.ts                     normalizeEvidence() - exhaustive per-modality mapper
                                             (transcript/audio both read off the SAME
                                             TranscriptSegment - audio has no raw timestamped
                                             stream of its own, only AudioFeatures' clip-wide
                                             aggregate; scene/face/gesture collapse to zero-width
                                             instant evidence; speaker evidence comes from
                                             speakerTimeline ONLY - raw ActiveSpeakerSample[] is
                                             deliberately NOT a separate input, it would be
                                             redundant evidence about the same underlying signal
                                             speakerTimeline already fuses). Skips non-evidence
                                             samples (null face emotion, null/'none' gesture, a
                                             transcript segment with zero audio readings) rather
                                             than fabricating them
  group-evidence.ts                         groupEvidenceByTranscriptSegment() - one evidence
                                             group PER TRANSCRIPT SEGMENT (a real structural unit,
                                             not an arbitrary sliding window - Part 6, Section 8's
                                             own requirement), with a small
                                             SEGMENT_EVIDENCE_PADDING_SECONDS=0.5 overlap tolerance
                                             and a MAX_EVIDENCE_PER_MODALITY_PER_GROUP=3 cap (same
                                             cap-and-sort-by-proximity shape as
                                             find-concurrent-evidence.ts's own
                                             MAX_EVIDENCE_PER_EVENT). selectReasoningGroups() drops
                                             any group spanning < 2 distinct modalities BEFORE the
                                             LLM prompt is built - the module's main cost-control
                                             lever (Section 17): a clip with little cross-modal
                                             evidence pays less, not more
  extract-raw-connections.ts                extractRawConnections() - the one LLM call, over
                                             ALREADY-GROUPED evidence with explicit ids (never flat
                                             concatenated per-modality text - the concrete
                                             difference from "signal concatenation," Section 3),
                                             asking the model to cite >= 2 evidence ids from >= 2
                                             modalities per connection. Skips the LLM call entirely
                                             when there are zero reasoning-worthy groups (same
                                             `segments.length === 0` early-return convention as
                                             extractRawEvents/extractRawGraph)
  describe-relation-type.ts                 describeRelationType() - exhaustive switch/assertNever
                                             over all 3 MULTIMODAL_RELATION_TYPES (Contract
                                             Governance rule 1's exhaustiveness discipline), used as
                                             the fallback `reason` when the LLM's own reason comes
                                             back empty
  validate-connections.ts                   validateConnections() - the hallucination guard
                                             (Section 10), pure/deterministic, no LLM/DB access.
                                             DROPS (never partially repairs) a connection when its
                                             relation isn't a real MULTIMODAL_RELATION_TYPES value,
                                             when any evidenceRefs entry doesn't resolve to a real
                                             evidence id actually sent to the LLM, or when the
                                             resolved evidence spans < 2 distinct modalities.
                                             modalities/startTime/endTime on a surviving connection
                                             are RECOMPUTED from the resolved evidence, never
                                             trusted as reported by the LLM itself
  reason-multimodal.ts                      reasonMultimodal() - the module's single entry point,
                                             orchestrates normalizeEvidence -> groupEvidenceBy
                                             TranscriptSegment -> selectReasoningGroups ->
                                             extractRawConnections -> validateConnections. Exactly
                                             ONE LLM call per clip regardless of evidence group
                                             count (Section 17)
  feature-flags.ts                          isMultimodalReasoningEnabled()

apps/worker/src/render-graph/nodes/multimodal-reasoning.ts
                                             multimodalReasoningNode, id: 'multimodalReasoning'
                                             (optional: true, fallback: null - the LLM call can
                                             fail, never fails the render job, same convention as
                                             hookPrediction/semanticEvents/narrativeGraph); deps:
                                             sceneCutEvents/ocrTracks/objectTracks/facialEmotions/
                                             gestures/speakerTimeline (all already-existing node
                                             ids, no new upstream detector); re-anchors
                                             ctx.transcript onto clip-relative time the same way
                                             every prior LLM-backed v4 node does

apps/worker/src/render-graph/sinks.ts       CLIP_UPDATE_MAP['multimodalReasoning'] entry -
                                             deliberately NOT added to FUSION_INPUT_MAP (D1). Same
                                             "?? Prisma.JsonNull" null-semantics as hookPrediction/
                                             semanticEvents/narrativeGraph (LLM-backed, can
                                             genuinely fail/never run) - NOT the "always a real
                                             object" pattern contextualMomentum/emotionalArc/
                                             viralityPrediction/retentionCurveInsights use

packages/database/prisma/schema.prisma      Clip.multimodalReasoning Json? (new column, real
                                             migration - real-Postgres round trip verified)

apps/api/src/videos/transcript-segment.util.ts
                                             toSharedMultimodalReasoning() - the TS2742 fix (D7).
                                             Same LLM-backed null-semantics as toSharedHookPrediction/
                                             toSharedSemanticEvents/toSharedNarrativeGraph

apps/api/src/clips/clips.service.ts         GET /clips/:id/intelligence extended with
                                             `multimodalReasoning`, gated by its OWN independent
                                             flag (D9); VideosService.mapVideoWithClips also
                                             extended (the TS2742 fix's OTHER call site)

packages/shared/src/types/
  video.ts                                  ModalitySource/MultimodalEvidence/MultimodalConnection/
                                             MultimodalReasoningResult mirrored (not imported), same
                                             duplication precedent as every other v4 contract type;
                                             Clip.multimodalReasoning field
  intelligence-v4.ts                        ClipIntelligenceDto.multimodalReasoning
```

**Testing note - `reasonMultimodal` is mocked at the render-graph test level, same as its
siblings**: `render-clip.worker.spec.ts` mocks `@speedora/multimodal-reasoning`'s `reasonMultimodal`
as the one I/O-touching seam (leaving `normalizeEvidence`/`groupEvidenceByTranscriptSegment`/
`validateConnections`/`findConcurrentEvidence` real via `requireActual`), exactly the same "mock
only the seam" convention as `predictHook`/`detectSemanticEvents`/`buildNarrativeGraph`. Without
this mock, `reasonMultimodal`'s own "skip the LLM call when there are zero reasoning-worthy groups"
design (Section 17) would make it return a REAL, non-null result in most of this spec file's sparse
fixtures — unlike its siblings, which always attempt the LLM call and so always fail against this
file's `{}`-mocked `openai` client, this module's success path doesn't depend on an LLM call at all
when there's nothing cross-modal to reason about. Discovered by running the full
`render-clip.worker.spec.ts` suite after wiring the node (not just the new package's own tests) and
seeing 4 failures whose expected fixtures assumed `Prisma.JsonNull` - fixed by adding the same
single-seam mock every sibling v4 LLM module already has, not by changing the module's own
"skip empty-evidence clips" behavior (that behavior is correct and Section 17-mandated).

Verification: `packages/multimodal-reasoning`'s own suite (55 tests - per-modality normalization
including every skip case; temporal grouping with Part 6's own worked example, transcript+speaker+
gesture+OCR+scene all overlapping one moment, joining one group; a non-overlapping-timestamps
negative test; missing-modality combinations; the hallucination guard dropping a fabricated
evidence id end to end; malformed/out-of-range LLM output clamping; a transcript-only clip skipping
the LLM call entirely; an LLM failure propagating rather than being swallowed - "module throws,
adapter catches") green; `apps/worker`'s full suite (579 tests, including `render-clip.worker.spec.ts`
and `sinks.spec.ts` extended with `multimodalReasoning` fixtures/regression guards) green;
`apps/api`'s full `clips.service`/`videos.service`/`transcript-segment` suite (222 tests, 4 expected
literals extended with `multimodalReasoning: null`) green; real-Postgres round trip verified via
`prisma migrate dev`. `nest build` (not just `tsc --noEmit`) run for `apps/api` per `docs/prisma.md`'s
own TS2742 warning. Full local `pnpm verify` green before push.
