# Visual Emphasis Engine (spec Part 9, AI Intelligence v4 Track B Phase C)

> **Status: Phases C1-C2 shipped. Phases C3-C7 remain design only.** This doc is the audit + ADR +
> dependency graph + phased roadmap requested before any implementation starts, same discipline as
> [`ai/subtitle-intelligence.md`](./subtitle-intelligence.md) (Track B Phase A/B, now complete) —
> see that doc for the precedent this one follows. See "Phase C1 architecture (as shipped)" and
> "Phase C2 architecture (as shipped)" below for what actually exists; every other phase (C3-C7,
> the 6 remaining technique-specific rendering phases) is still the planned design below, not
> built.

## Why this exists

The real spec Part 9 text (supplied 2026-08-08, after an earlier one-line roadmap description had
guessed at this phase's scope from its risk note alone — the same "don't reverse-engineer, ask for
the real text" lesson Track A's Phase 7→9 realignment already taught this codebase once):

```
PART 9 - VISUAL EMPHASIS ENGINE
Generate editing suggestions.
Auto Zoom / Auto Crop / Face Priority / Object Priority / OCR Highlight /
Focus Shift / Digital Push / Reaction Hold / Pause Hold
```

Three of these nine — **Auto Zoom, Auto Crop, Face Priority** — already exist as shipped Smart
Reframe behavior (`packages/reframe`, Fase 2/Fase 11). The real gap isn't "these don't exist," it's
that Smart Reframe makes its own subject-selection decision (raw face detection only,
unconditionally) that's **completely disconnected** from `packages/primary-subject`'s already-built,
richer selection chain (active speaker → face → person → object-attention → object) used elsewhere
for Composition Intelligence scoring — the exact duplication the original one-line roadmap risk
note flagged ("unify reframe's own face detector with primary-subject's choice, don't layer a
second opinion"). The other six items are either genuinely new (OCR Highlight, Reaction Hold,
Pause Hold) or partial extensions of existing mechanisms (Focus Shift, Digital Push, Object
Priority). "Generate editing suggestions" is the literal ask: a supervisory decision layer this
pipeline doesn't have yet, even though several underlying mechanisms (auto-crop, auto-zoom, face
panning) already run today with no real "is this the right moment" judgment beyond a keyword regex.

## Audit — the 9 items against what already exists

| Spec item | Current state | What's actually needed |
|---|---|---|
| **Auto Crop** | **Shipped** (Fase 2) — `computeCropDimensions()` picks a constant 9:16 output frame for the whole clip. | Nothing — already correct, unconditional, no "suggestion" concept needed (there's no alternative to suggest). |
| **Auto Zoom** | **Shipped** (Fase 11) — `buildCropPath()`'s attack/hold/release zoom envelope, triggered by `findEmphasisWords()` (the same `KEYWORD_PATTERN`-style regex `@speedora/subtitles`/`@speedora/subtitle-rewriter` already reuse for caption emphasis). Fires on *every* matching word, unconditionally. | Real "engine" judgment: reuse v4's own already-computed "this moment matters" signals (Hook Prediction, Virality Engine's sub-probabilities, Phase B1's own `HighlightTimeline`) to decide *which* emphasis moments deserve a push, not just which words match a regex. This is **Digital Push** below, not a separate feature. |
| **Face Priority** | **Shipped, but via a separate, narrower opinion** — `buildReframePlan()` calls `detectFaces()` directly (single-most-prominent-face tracker) and pans toward it. `packages/primary-subject`'s `selectPrimarySubject()` already encodes a richer "face priority" (active speaker first, then largest face) but is only consumed by Composition Intelligence's *scoring* today, never by the actual crop. | **Unify** — make `buildReframePlan()` consume `selectPrimarySubject()`'s own choice instead of re-deriving one. Zero new detector; this is a pure "stop computing the same answer twice" fix. |
| **Object Priority** | **Does not exist in rendering today** — `buildCropPath()` only ever receives `FaceSample[]`; a clip with no face at all just centers the crop with zero pan, even when a tracked object (Object Intelligence, already computed) could have driven one. `selectPrimarySubject()` already has this exact object-fallback chain (steps 3-5: largest tracked person → highest `objectAttentionScore` → largest tracked object) — again, only consumed by scoring, never rendering. | Same unification as Face Priority above — once `buildReframePlan()` consumes `selectPrimarySubject()`, object-fallback panning becomes real for free. |
| **OCR Highlight** | **Does not exist** — OCR Intelligence (`packages/ocr-intelligence`) detects/tracks/classifies on-screen text but nothing in the render pipeline ever draws anything from it. | Genuinely new: an ffmpeg overlay (`drawbox`/`drawtext`, or a burned-in box via the existing `.ass` subtitle-track mechanism — needs a real decision, see ADR) around important on-screen text at the moments OCR Intelligence already flags. |
| **Focus Shift** | **Partially exists as an accident of continuous interpolation** — `buildCropPath()`'s `interpolateAt()` already smoothly pans between every known face position, including when the tracked face changes. There's no *deliberate* "the primary subject switched, transition intentionally" concept — a 2-speaker conversation just drifts continuously as if tracking one wandering face. | New, small: once Face/Object Priority unification (above) makes `selectPrimarySubject()`'s per-instant subject id available to reframe, detect a subject-id change and use a distinct (faster/more deliberate) transition instead of the default continuous pan. |
| **Digital Push** | **Likely the same mechanism as Auto Zoom** (a push-in zoom for emphasis is exactly what Fase 11 already does) — real filmmaking terminology for the same effect, not a second one. | Extend Auto Zoom's *trigger* set (see Auto Zoom row) rather than building a second zoom system — the actual "digital push" motion already exists. |
| **Reaction Hold** | **Does not exist** — no mechanism anywhere in this pipeline extends a shot's on-screen duration for a reaction. Facial Intelligence's `dominantAffect`, Emotional Arc's intensity, and Gesture Intelligence are all real, already-computed candidate signals for "this is a reaction worth holding." | Genuinely new — and touches editing *pacing*, not framing, so it likely belongs closer to `@speedora/cutlist`/`@speedora/editing-rhythm` territory than `@speedora/reframe`. |
| **Pause Hold** | **Actively fought by an existing feature** — `@speedora/cutlist`'s `computeSilenceCuts()` (Smart Trim) already treats *every* sufficiently-long pause as dead air to remove, with no exception mechanism at all. A dramatic pause right before a reveal would be trimmed exactly like dead air. | Genuinely new — a "protect this pause from Smart Trim" signal. Real candidates already computed: Retention Curve Insights' `curiosityPeaks`/`dropPoints`, Hook Prediction's `pauseBeforeHookRatio`, Narrative Graph segment boundaries (a pause right before a `peak`/`resolution` segment reads as dramatic, not empty). |

**The headline finding**: of the 9 items, 3 are already fully shipped, 2 more (Object Priority,
Focus Shift) become real "for free" once Face Priority's own duplication is fixed, 1 (Digital
Push) is an extension of an existing mechanism's triggers rather than new motion, and only 3
(OCR Highlight, Reaction Hold, Pause Hold) need genuinely new mechanisms this pipeline doesn't
have any version of today.

## Tech debt found

1. **The core duplication** (already named by the original roadmap risk note, now confirmed by
   reading both code paths): `render-clip.worker.ts`'s `buildReframePlan()` calls
   `detectFaces()`/`buildCropPath()` directly — a self-contained, single-most-prominent-face
   decision. `render-graph/nodes/composition.ts`'s `primarySubjectSamplesNode` calls
   `selectPrimarySubject()` — a richer, already-built 5-step chain (active speaker → face → person
   → attention → object) — over the *exact same* underlying signals
   (`faceLandmarks`/`activeSpeakerSamples`/`objectTracks`), but only to feed Composition
   Intelligence's *scoring*. These two can disagree about who "the subject" is on the very same
   clip, and only one of them actually drives what gets rendered.
2. **`buildCropPath()` has no object-track input at all** — its signature only accepts
   `FaceSample[]`; a faceless clip (a product demo, a screen recording) gets zero pan today even
   when a real tracked object exists to pan toward.
3. **Auto Zoom's trigger is a plain regex over transcript words** (`EMPHASIS_PATTERN`, a literal
   duplicate of `@speedora/subtitles`' `KEYWORD_PATTERN`/`@speedora/subtitle-rewriter`'s reuse of
   it — a 3rd independent copy of the same pattern, past this codebase's own "extract at 3rd
   duplication" threshold) — no awareness of Hook Prediction, Virality Engine, or Phase B1's own
   `HighlightTimeline`, all of which already compute a real "is this moment worth emphasizing"
   judgment that Auto Zoom currently ignores entirely.
4. **`@speedora/cutlist` has no concept of a "protected" range** — `computeSilenceCuts()` cuts
   every sufficiently-long silence unconditionally; there's no parameter or exception list to say
   "not this one."
5. **No OCR-driven visual rendering exists anywhere** — OCR Intelligence's entire output
   (`ocrText`/`ocrTracks`/`ocrFeatures`) is consumed only by the Fusion Engine's scoring today,
   never drawn onto a rendered frame.
6. **No "editing suggestion" contract shape exists** — every prior AI Intelligence v4 phase either
   produces a score/prediction (Track A) or a caption-rendering decision (Track B Phase A/B); a
   generic "which technique, when, why" suggestion timeline is a new shape this pipeline hasn't
   needed before.

## ADR — key decisions

**DC1. Real spec text obtained before design started** (unlike Phase 7's original Virality Engine,
built by reverse-engineering a one-line description before the real Part 4 text existed, later
needing a breaking realignment in Phase 9) — this doc is written against the actual Part 9 text,
not a guess.

**DC2. Reuse-first applies especially hard here — 3 of 9 items need zero new work, 2 more become
free byproducts of fixing the core duplication.** No new detector is proposed anywhere in this
roadmap; every phase below is either a pure derive/composition over already-computed signals, or a
wiring fix connecting two already-built pieces that were never connected.

**DC3. Face Priority/Object Priority unification (fixing Tech Debt #1) is its own phase, ordered
before the newer suggestion-timeline work, not after** — unlike Track B Phase A/B's "data first,
render-wiring second" pattern, this particular fix has no meaningful "data-only" form: the bug
*is* that two code paths already independently produce data, and the fix is making one of them
authoritative. Low risk (`selectPrimarySubject()` and its render-graph node are already
production-tested via Composition Intelligence), real value on its own regardless of how much of
the rest of this roadmap ever ships.

**DC4. "Generate editing suggestions" is a genuine new module, separate from the unification fix**
— a pure, synchronous composition (same zero-LLM shape as most of Track B Phase A/B) over
already-computed v4/v2 signals, producing a dense or sparse timeline (to be decided per-technique,
same "some outputs are dense, some are sparse" precedent Phase A1/B1 already established for
`SubtitleTimeline` vs. `HighlightTimeline`) naming which of the 9 techniques applies, when, and
why. Mirrors Track B Phase A/B's own "data first" split: this phase computes *suggestions*, a
later phase decides how many of them actually get wired into rendering.

**DC5. OCR Highlight's rendering mechanism is an open question, not pre-decided here** — two real
candidates exist (an ffmpeg `drawbox`/`drawtext` filter, or reusing the existing `.ass` burn-in
pipeline the way captions already do) with different composability/positioning tradeoffs against
the existing crop/caption filter chain. Deferred to that phase's own design pass, not guessed at
now.

**DC6. Reaction Hold and Pause Hold are pacing decisions, not framing decisions** — despite being
named alongside 7 camera/text items, both actually extend `@speedora/cutlist`'s trim logic
(Pause Hold directly) or `@speedora/editing-rhythm`'s territory (Reaction Hold, shot duration),
not `@speedora/reframe`. Scoped as their own phases for exactly this reason, not folded into the
camera-focused phases.

## Dependency graph (planned)

```
faceLandmarks (existing) ──┐
activeSpeakerSamples (existing) ─┼──▶ selectPrimarySubject() [ALREADY BUILT,
objectTracks (existing) ──────┘        @speedora/primary-subject]
                                                    │
                                    ┌───────────────┴───────────────┐
                                    ▼ (existing consumer,             ▼ (NEW consumer,
                                       unchanged)                       Phase C2)
                          compositionFeaturesNode              buildReframePlan()'s
                          (Composition Intelligence                own pan-target
                           scoring, untouched)                  (replaces detectFaces()-
                                                                  only decision)
                                                                          │
                                                              objectTracks (NEW input to
                                                              buildCropPath(), Phase C2) ──┐
                                                                          │                 │
                                                              subject-id-change detection  │
                                                              (Phase C3, Focus Shift) ◀─────┘

hookPrediction (existing) ──────┐
viralityPrediction (existing) ──┼──▶ computeEditingSuggestions()  [NEW, Phase C1,
captionTreatment.highlights ────┤     @speedora/visual-emphasis - name TBD]
  (Phase B1's HighlightTimeline)┤
narrativeGraph (existing) ──────┤
retentionCurveInsights ─────────┤
  (dropPoints/curiosityPeaks)   │
facialFeatures/emotionalArc ────┘
                                                    │
                                                    ▼
                                       EditingSuggestionTimeline
                                (per-technique suggested moments -
                                 data only, Phase C1, no render change)
                                                    │
                        ┌───────────────┬───────────┼───────────┬───────────────┐
                        ▼               ▼           ▼           ▼               ▼
                 Digital Push      OCR Highlight  Focus Shift  Reaction Hold  Pause Hold
                 (Phase C4 -       (Phase C5 -    (Phase C3 -  (Phase C6 -    (Phase C7 -
                 extends Fase 11's  new overlay    extends      extends       extends
                 zoom triggers)     rendering)     Phase C2's   editing-      cutlist's
                                                    pan)         rhythm)       silence-cut)
```

## Phased roadmap

| Phase | Deliverable | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| C1 | Editing Suggestion timeline (data only) — names which of the 9 techniques applies, when, why | Hook Prediction, Virality Engine, Phase B1's `HighlightTimeline`, Narrative Graph, Retention Curve Insights, Emotional Arc — all existing | M | Defining one contract shape flexible enough for 9 fairly different techniques (some are instants, some are ranges, some are booleans-per-clip) without it becoming a junk-drawer type |
| C2 | Unify Face/Object Priority — `buildReframePlan()` consumes `selectPrimarySubject()` instead of its own `detectFaces()`-only decision — **shipped, no flag** (real behavior change, not opt-in) | `primarySubjectSamples` node (existing) | M | Real behavior change to the production crop path for every future render (unlike Track B's flag-gated phases, this fixes a duplication rather than adding an opt-in) — needs a real before/after render comparison, not just unit tests |
| C3 | Focus Shift — deliberate transition when the primary subject id changes, instead of continuous drift | C2 | S-M | Defining "deliberate" (a faster pan? a hard cut? a brief hold?) without real footage to validate against |
| C4 | Digital Push — extend Auto Zoom's triggers beyond `EMPHASIS_PATTERN` words to include v4's own "this moment matters" signals | C1 | S | Two trigger sources (regex words, v4 signals) firing on overlapping spans needs a real merge rule, not double-triggering |
| C5 | OCR Highlight — new overlay rendering | C1, OCR Intelligence (existing) | L | Genuinely new rendering mechanism (Tech Debt #5) — needs the same "verify against real ffmpeg" discipline Track B Phase B2 established, and a real design pass for DC5's open question |
| C6 | Reaction Hold — extend shot duration for a detected reaction | C1 | M | Extending duration interacts with the existing cutlist/render timeline math non-trivially — a naive implementation could desync captions/crop from the extended audio |
| C7 | Pause Hold — protect specific pauses from Smart Trim | C1 | S-M | A wrong "protect this pause" call silently reintroduces dead air Smart Trim was built to remove — needs a conservative default (protect rarely, not liberally) |

Each phase, per this codebase's established convention: implement → run the full test suite →
confirm no regression → update this doc + `intelligence-v4.md`/`CLAUDE.md` → confirm production
builds pass — before starting the next phase. No phase is auto-continued without its own explicit
go-ahead, same as every phase in the now-complete Subtitle & Dynamic Caption Intelligence
initiative.

## Phase C1 architecture (as shipped)

```
packages/contracts/src/visual-emphasis.ts    EDITING_TECHNIQUES (5 values - digital_push,
                                              ocr_highlight, focus_shift, reaction_hold,
                                              pause_hold; the other 4 spec items - Auto Crop,
                                              Auto Zoom, Face Priority, Object Priority - are
                                              either already shipped as unconditional Smart
                                              Reframe behavior or fold into C2's unification fix,
                                              not into this timeline), editingTechniqueSchema,
                                              editingSuggestionSchema (EditingSuggestion -
                                              {technique, start, end, score, reason} - reuses the
                                              0-1 "not comparable across clips" score convention
                                              every other v4 module already established),
                                              editingSuggestionTimelineSchema
                                              (EditingSuggestionTimeline - sparse/filtered, same
                                              shape as HighlightTimeline, not dense like
                                              CaptionTreatmentTimeline - DC4's "to be decided
                                              per-technique" question resolved as: every
                                              technique ends up sparse in practice, so one shared
                                              sparse shape covers all 5, no per-technique variant
                                              needed), computeEditingSuggestionsInputSchema -
                                              reuses subtitle-rewriter.ts's highlightTimelineSchema,
                                              ocr.ts's ocrTextTrackSchema, primary-subject.ts's
                                              primarySubjectSampleSchema, and
                                              retention-curve-insights.ts's
                                              retentionCurveInsightsSchema directly (not
                                              near-duplicate copies) - same cross-contract-file-
                                              import precedent Phase A1/10/11 already established

packages/visual-emphasis/src/
  from-highlights.ts                         fromHighlights() - 1:1 maps Phase A1/B1's own
                                              HighlightTimeline onto digital_push suggestions.
                                              DC4/Tech Debt #3's "Digital Push is Auto Zoom's
                                              existing motion, just needs a real trigger" finding
                                              resolved as: this IS that real trigger source, ready
                                              for C4 to wire into buildCropPath()'s existing zoom
                                              envelope - no new zoom mechanism, only a better
                                              "when."
  from-ocr-tracks.ts                         fromOcrTracks() - filters OcrTextTrack[] to the
                                              2 categories that read as "worth highlighting"
                                              (price, name - OCR_HIGHLIGHT_CATEGORIES, a
                                              documented HEURISTIC subset of OCR_TEXT_CATEGORIES'
                                              6 values, deliberately excluding subtitle/caption/
                                              logo/slide) above a MIN_CATEGORY_CONFIDENCE
                                              threshold, maps each to an ocr_highlight suggestion.
                                              Genuinely new (Tech Debt #5's first half) - which
                                              tracks deserve a highlight; C5 decides how one gets
                                              drawn.
  from-primary-subject-samples.ts            fromPrimarySubjectSamples() - walks
                                              PrimarySubjectSample[] for real (non-null-to-
                                              non-null) trackId changes held at least
                                              MIN_HOLD_SECONDS before switching, emits a
                                              focus_shift suggestion centered on the switch
                                              instant, scored by how long the prior subject was
                                              held (SCORE_NORMALIZATION_SECONDS, capped at 1.0).
                                              Deliberately ignores transitions into/out of null
                                              (no subject detected) - only a real subject-to-
                                              subject switch counts, not a detection gap. Reuses
                                              Composition Intelligence's already-computed
                                              primarySubjectSamples node directly (Tech Debt #1's
                                              still-open duplication is C2's job, not this one's -
                                              C1 only reads the richer selectPrimarySubject()
                                              output, doesn't yet make it authoritative for
                                              rendering).
  from-emotional-peaks.ts                    fromEmotionalPeaks() - maps Phase 10's own
                                              RetentionPoint[] (emotionalPeaks) directly onto
                                              reaction_hold suggestions, a fixed
                                              REACTION_HOLD_WINDOW_SECONDS centered on each peak
                                              (clamped at 0 for a peak near the clip start).
                                              Documents honestly (Tech Debt #6's framing) that
                                              this pipeline has no per-speaker face tracker to
                                              hold ON specifically - the suggestion names WHEN,
                                              not which face fills the frame; that's a C6 rendering
                                              concern, not this phase's.
  from-pauses.ts                             fromPauses() - reuses @speedora/cutlist's
                                              computeSilenceCuts() directly (Tech Debt #4's "no
                                              protected range" gap; same reuse
                                              @speedora/hook-prediction's derivePauseFeatures()
                                              already established) to find the exact same gaps
                                              Smart Trim would cut, then checks each against Phase
                                              10's curiosityPeaks/dropPoints within a
                                              PAUSE_PROXIMITY_SECONDS window, keeping the
                                              higher-scoring match when both are nearby. A gap
                                              with no nearby Retention Curve Insights point
                                              produces no suggestion - conservative by
                                              construction (C7's "protect rarely, not liberally"
                                              risk note), not a general "protect every pause"
                                              rule. Does NOT yet change Smart Trim's actual
                                              behavior - that wiring is C7's job.
  compute-editing-suggestions.ts             computeEditingSuggestions() - the module's single
                                              entry point (ARCHITECTURE.md's checklist), pure and
                                              synchronous like every other Track B module, no
                                              `deps` param, no runtime schema validation (same
                                              "trust the TS input type" convention Phase A1's own
                                              regression note established). Concatenates all 5
                                              technique functions' output and sorts chronologically
                                              by `start` - a single flat timeline, not 5 separate
                                              arrays, so a future consumer (C2-C7) doesn't need to
                                              know which function produced which entry to render
                                              them in order.
  feature-flags.ts                           isVisualEmphasisEnabled() - VISUAL_EMPHASIS_ENABLED,
                                              same ADR D8 "gates API exposure, not computation"
                                              shape as isDynamicCaptionEnabled()

apps/worker/src/render-graph/nodes/
  visual-emphasis.ts                         editingSuggestionsNode - id `editingSuggestions`,
                                              deps: [subtitleIntelligence, ocrTracks,
                                              primarySubjectSamples, retentionCurveInsights] (all
                                              already-registered node ids, no new detector),
                                              optional: false (same pure-composition shape as
                                              Phase 4/5/6/7/10/A1/B1 - no LLM/subprocess call that
                                              can fail). toClipRelativeWords() re-anchors this
                                              clip's own transcript words onto clip-relative time
                                              (0 = clip start) and flattens across segments -
                                              same convention as toHookPredictionSegments/
                                              toSubtitleRewriterSegments, but flattened straight
                                              to TranscriptWordInput[] since fromPauses() only
                                              needs the flat word list.

packages/database/prisma/schema.prisma       Clip.editingSuggestions Json? - same null-semantics
  (migration                                 as contextualMomentum/emotionalArc/captionTreatment:
   20260808222910_add_clip_                  null can ONLY mean this row predates the migration,
   editing_suggestions)                      never "the node failed" (it can't - optional: false,
                                              pure composition).

apps/worker/src/render-graph/sinks.ts        editingSuggestions deliberately NOT added to
                                              FUSION_INPUT_MAP (DB1/DB2's "v4 sits beside the
                                              Fusion Engine, never feeds it" posture, same as
                                              every prior v4 output). CLIP_UPDATE_MAP casts it
                                              through as an InputJsonValue, never Prisma.JsonNull,
                                              same "always a real array" convention as
                                              contextualMomentum/emotionalArc/captionTreatment.

apps/api/src/videos/                         toSharedEditingSuggestions() - the TS2742 narrowing
  transcript-segment.util.ts                 function every new nullable Json? column needs;
                                              wired into VideosService.mapVideoWithClips and
                                              ClipsService.toDto (the general Clip DTO, ungated -
                                              same as subtitleIntelligence/captionTreatment
                                              already are there) and ClipsService.getIntelligence
                                              (ClipIntelligenceDto, gated by
                                              isVisualEmphasisEnabled() - the same field is exposed
                                              twice today, once ungated on the general Clip object
                                              and once flag-gated on the dedicated intelligence
                                              endpoint, matching the exact precedent
                                              subtitleIntelligence/captionTreatment already set
                                              rather than a new pattern invented for this phase).

packages/shared/src/types/video.ts           EditingTechnique, EditingSuggestion,
  packages/shared/src/types/                 EditingSuggestionTimeline (mirrored, not imported -
  intelligence-v4.ts                         same duplication precedent as every other v4 type in
                                              video.ts), Clip.editingSuggestions,
                                              ClipIntelligenceDto.editingSuggestions
```

**What Phase C1 deliberately does NOT do**: touch `buildReframePlan()`, `buildCropPath()`,
`computeSilenceCuts()`, or any actual rendering/trimming decision. Every suggestion computed here
is inert data until a later phase (C2-C7) decides to act on it - identical in spirit to Phase
A1/B1's own "data first, wiring second" split. Tech Debt #1 (the Face/Object Priority duplication)
is unchanged by this phase; C2 remains the phase that fixes it.

**Verification performed**: `@speedora/visual-emphasis`'s own unit suite (26 tests across all 5
technique functions plus the orchestrator) exercises the exact heuristic math documented above
(hold-duration scoring, window clamping at clip boundaries, proximity-window matching, the
higher-score-wins tie-break between a nearby curiosityPeak and dropPoint). `render-graph/
sinks.spec.ts` was extended with the same 3-part regression shape every prior phase's sink entry
got: never leaks into `FusionInput`, casts through as an `InputJsonValue` (never
`Prisma.JsonNull`, even empty), and a present value writes through unchanged.
`render-clip.worker.spec.ts`'s 5 existing full-payload assertions were extended with
`editingSuggestions: expect.any(Array)`. Full typecheck/build/test pass for
`@speedora/contracts`/`@speedora/visual-emphasis`/`@speedora/worker`/`@speedora/api`/
`@speedora/web`/`@speedora/shared`, plus `pnpm format:check` - all clean, no regressions.

## Phase C2 architecture (as shipped)

Unlike every phase before it (Track B Phase A/B, Phase C1 above), this phase ships **no new
package, contract, migration, flag, or DTO field** - ADR DC3's own framing holds: "the bug *is*
that two code paths already independently produce data, and the fix is making one of them
authoritative." The entire change is a rewiring inside `apps/worker/src/workers/render-clip.worker.ts`
(plus one comment update in `render-graph/context.ts`), fixing Tech Debt #1 and #2 for real.

```
apps/worker/src/workers/render-clip.worker.ts

  computeReframeDimensions() NEW - the old buildReframePlan()'s dimensions-only half, split out
                              so it can run BEFORE the render graph (unchanged requirement -
                              compositionFeaturesNode needs ctx.reframe.outputWidth/outputHeight
                              early). Wraps getVideoDimensions() + computeCropDimensions() - both
                              already-existing calls, genuinely independent of face/subject
                              detection, just relocated.

  toFaceSamples() NEW        Converts PrimarySubjectSample[] -> FaceSample[] by dropping
                              trackId/facingYaw/source - both share the IDENTICAL
                              {xCenter, yCenter, width, height}|null box shape (ADR DC3's own
                              finding, confirmed by reading both contracts side by side before
                              writing this function), so this is a field-drop, not a real
                              conversion.

  buildReframePlan() CHANGED Now takes primarySubjectSamples (not sourcePath/startTime/endTime)
                              as its first argument, called AFTER the render graph instead of
                              before. No longer calls @speedora/reframe's detectFaces() at all -
                              the render path's only remaining face-shaped input is
                              graphResult.primarySubjectSamples, Composition Intelligence's own
                              selectPrimarySubject() output (already computed by the graph for
                              compositionFeaturesNode's benefit, now read a second time here - no
                              new detector, no duplicate computation). Dropped the try/catch that
                              used to swallow detectFaces() subprocess failures - there's no
                              external I/O left in this function to fail; a thrown error here
                              would be a real code bug, not the expected-and-handled "Python
                              subprocess had a problem" case the old code protected against
                              (primarySubjectSamplesNode is optional: false and already resolves
                              every upstream null gracefully, proven by Composition Intelligence's
                              own existing tests).

  Call site (inside the      Restructured into 3 steps instead of 1: (1) computeReframeDimensions()
  main try block)            before the graph, feeding ctx.reframe with just outputWidth/
                              outputHeight; (2) the render graph runs, producing
                              graphResult.primarySubjectSamples along with everything else; (3)
                              buildReframePlan() runs AFTER the graph, consuming that output to
                              build the real crop path / sendCmd script. Every downstream consumer
                              of the full `reframe` object (buildBRollOverlays, buildAss's
                              videoWidth/videoHeight, the final renderClip() call) is unchanged -
                              they already ran after where buildReframePlan() now executes.

apps/worker/src/faceDetectionDeps.ts

  Left in place, deliberately not deleted, with a new comment explaining why: 7 other *Deps.ts
  adapter files reference it by name in their own comments as the pattern they followed, and
  @speedora/reframe's detectFaces()/face-detection.ts remain real, independently-tested library
  code a future feature could still reuse. Its only call site (this phase's retired one) is gone;
  the file itself is not dead code by any codebase convention, just currently unreferenced.

apps/worker/src/render-graph/context.ts

  RenderGraphContext.reframe's own comment updated - previously said "Built by buildReframePlan()
  BEFORE the graph runs"; now correctly attributes this to computeReframeDimensions() and notes
  the crop-PATH construction moved to run AFTER the graph instead.
```

**What Phase C2 fixes, concretely**:
- **Tech Debt #1** (the core duplication) - closed. There is exactly one "who is the subject"
  answer computed per clip now; `buildReframePlan()`'s panning and `compositionFeaturesNode`'s
  scoring read the identical `primarySubjectSamples` array, sourced from the identical
  `selectPrimarySubject()` call.
- **Tech Debt #2** (`buildCropPath()` has no object-track input) - closed as a genuinely free
  byproduct, not separate work: `selectPrimarySubject()`'s Steps 3-5 (tracked person → highest
  `objectAttentionScore` → tracked object) already produce real `PrimarySubjectSample` entries for
  a faceless clip; `toFaceSamples()` passes those straight through with no special-casing needed.
  A product-demo/screen-recording clip with a tracked object but no face now pans toward it
  instead of rendering a static center-crop.

**What did NOT change**: `buildCropPath()`, `buildSendCmdScript()`, `computeCropDimensions()`,
`findEmphasisWords()`, the `sendcmd` filtergraph mechanism, and Auto Zoom's emphasis-word trigger
are all byte-for-byte untouched - this phase only changed WHICH `FaceSample[]` values feed into
already-existing, already-verified crop-path math. **Focus Shift** (C3) and **Digital Push** (C4)
remain unbuilt - this phase makes their inputs available (a real per-instant subject id, a real
"protect this moment" signal source) but adds no new transition/trigger logic itself.

**Verification performed**: the `smart reframe` describe block in `render-clip.worker.spec.ts` was
rewritten - the old `detectFacesMock`-based tests (which asserted a call to a now-retired function)
are replaced with 3 tests driving the REAL `selectPrimarySubject()` (left un-mocked in this spec
file, same "pure functions left real" convention as `trackObjects()`/`deriveFaceLandmarkFeatures()`
elsewhere in the same file) via this spec file's existing `detectFaceLandmarksMock`/
`detectObjectsMock`: (1) no face or object anywhere → static center-crop, with an explicit
assertion that `buildCropPath()` is still called with an empty array rather than skipped; (2) a
real face sample → asserts `buildCropPath()` receives the EXACT `{t, box}` shape
`toFaceSamples()` should produce, locking in the conversion; (3) a tracked non-person object with
no face at all → asserts `buildCropPath()` now receives that object's box, a genuinely new
regression test proving Tech Debt #2's fix (this exact scenario returned no pan target before this
phase) - a net-zero test-count swap (3 old tests replaced by these 3 new ones), full worker suite
still 592/592 pass. `@speedora/reframe`'s own 24 tests (unaffected - `detectFaces()`/
`buildCropPath()` themselves are untouched) still pass. `apps/worker` typecheck, lint, and
production build (`tsc -p tsconfig.build.json`) all clean; `pnpm format:check` clean. No new
migration, so no Prisma/API/shared-type change needed at all - the only doc updates are this
section, `docs/worker.md`'s "Smart Reframe / Auto Zoom" section, and a cross-reference note in
`docs/ai/composition-intelligence.md`'s "Primary Subject Selection" section.

**What was explicitly NOT done** (ADR DC3's own flagged risk, honestly left open): a real
visual/subjective before/after comparison of panning DECISIONS on real footage. This sandbox has
no MediaPipe/Python runtime available (the same "Known verification gap" `docs/ai/vision.md`
already documents for every Python-subprocess-backed detector) and this specific change's own
mechanism (which array of coordinates feeds an already-verified crop-path algorithm) doesn't
exercise any new ffmpeg/libass rendering surface the way Track B Phase B2's ASS-tag change did, so
there was no equivalent "real ffmpeg render" proof available to run here. The wiring is verified
correct (right values reach the right function); whether `selectPrimarySubject()`'s existing
priority order produces aesthetically better panning than the old face-only detector is a real
open question for production footage to answer, same category of gap
`video-import-reliability.md` already carries for its own unverified stderr-regex categories.

## Explicitly deferred / open questions

- **OCR Highlight's exact rendering mechanism** (DC5) — a real design decision for that phase's own
  pass, not pre-committed here.
- **Whether any of C3-C7 need their own per-clip opt-in toggle** (mirroring `smartSegmentation`/
  `dynamicCaptions`) or should just be unconditional once shipped, the way Auto Zoom/Auto Crop
  already are — a real product decision each phase should surface explicitly when it's actually
  designed, not assumed now.
- **Video Quality Intelligence** (focus/exposure/noise/compression) — named in
  `docs/ai/composition-intelligence.md` as a separate, not-yet-scoped roadmap; genuinely unrelated
  to Visual Emphasis Engine despite both touching "camera," not folded in here.
