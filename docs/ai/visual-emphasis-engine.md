# Visual Emphasis Engine (spec Part 9, AI Intelligence v4 Track B Phase C)

> **Status: Phases C1-C5 and C7 shipped. Phase C6 (Reaction Hold) has a complete redesign
> (renamed C6R - "Reaction Hold Temporal Extension" - once its own architecture became clear) but
> zero code yet - deliberately done OUT OF ORDER, C7 before C6, a real decision recorded in the
> "C7 rollout"/"C6R design" sections below.** This doc is the audit + ADR + dependency graph +
> phased roadmap requested before any implementation starts, same discipline as
> [`ai/subtitle-intelligence.md`](./subtitle-intelligence.md) (Track B Phase A/B, now complete) —
> see that doc for the precedent this one follows. See "Phase C1 architecture (as shipped)" through
> "Phase C5 architecture (as shipped)" and "Phase C7 architecture (as shipped)" below for what
> actually exists; "C6R design" is a full audit/ADR/sub-roadmap for the one phase in this initiative
> not yet built, resolved via `AskUserQuestion` before any code - its own C6R.1-C6R.3 sub-phases
> each still need their own explicit go-ahead.

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
| C3 | Focus Shift — deliberate transition when the primary subject id changes, instead of continuous drift — **shipped, flag-gated** (`VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED`, off by default, no per-clip toggle) | C2 | S-M | Defining "deliberate" (a faster pan? a hard cut? a brief hold?) without real footage to validate against |
| C4 | Digital Push — extend Auto Zoom's triggers beyond `EMPHASIS_PATTERN` words to include v4's own "this moment matters" signals — **shipped, flag-gated** (`VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED`, off by default, no per-clip toggle) | C1 | S | Two trigger sources (regex words, v4 signals) firing on overlapping spans needs a real merge rule, not double-triggering |
| C5 | OCR Highlight — new overlay rendering — **shipped, flag-gated** (`VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED`, off by default, no per-clip toggle; ASS `\p1` mechanism, real ffmpeg+libass verified) | C1, OCR Intelligence (existing) | L | Genuinely new rendering mechanism (Tech Debt #5) — needs the same "verify against real ffmpeg" discipline Track B Phase B2 established, and a real design pass for DC5's open question |
| C6 | Reaction Hold — freeze-frame + brief silence at a detected reaction, as a THIRD pass after cuts — **design complete (renamed C6R), zero code yet** - split into C6R.1 (temporal-remapping primitive, S)/C6R.2 (freeze+silence ffmpeg mechanism, real ffmpeg verified, M)/C6R.3 (wiring, flag-gated, S-M), see "C6R design" below | C1, C7 (runs strictly after its cuts pass) | S+M+S-M across 3 sub-phases (down from the original single-phase M estimate, once "third pass after cuts" made captions/crop-path/B-roll remapping unnecessary) | Ordering (must run after C7's cuts, on their output) and genuinely new ffmpeg filter-complex territory (mid-stream `concat`) — both scoped into their own sub-phase (C6R.3, C6R.2 respectively) rather than one big undertaking |
| C7 | Pause Hold — protect specific pauses from Smart Trim — **shipped, flag-gated** (`VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED`, off by default, no per-clip toggle) - **implemented before C6**, a deliberate reordering (see "C7 rollout" note) | C1 | S-M | A wrong "protect this pause" call silently reintroduces dead air Smart Trim was built to remove — needs a conservative default (protect rarely, not liberally) |

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

## Phase C3 architecture (as shipped)

**"C3 rollout" decision** (resolved via `AskUserQuestion` before implementation, unlike C2): unlike
C2's pure bug fix, Focus Shift introduces a genuinely NEW visual effect (a snap transition where
none existed) with no real footage available in this sandbox to validate its aesthetics against -
the user chose **flag-gated, off by default, no per-clip toggle** (a single global kill switch,
`VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED`) over shipping it unconditionally like C2/Auto Zoom/Auto
Crop. This resolves the "Whether any of C3-C7 need their own per-clip opt-in toggle... or should
just be unconditional" question this doc's "Explicitly deferred" section originally left open -
for C3 specifically; C4-C7 each surface this same question fresh when designed, per that section's
own instruction not to assume an answer for phases not yet built.

```
packages/reframe/src/crop-path.ts

  applyFocusShifts() NEW      Inserts synthetic HOLD/snap waypoints into interpolateAt()'s own
                              `known` array around each detected shift window - HOLD at the
                              pre-shift position until `start`, ramp (interpolateAt()'s existing
                              linear math, UNCHANGED) from `start` to `end`, HOLD at the post-shift
                              position after. No new interpolation algorithm - reuses the exact
                              same linear-ramp function every other pan already goes through, just
                              reshapes its input. A shift window with no bracketing known sample
                              (a clip-start/-end edge case) is skipped for that one shift - falls
                              back to the default drift rather than fabricating a position with
                              nothing to anchor it to.

  buildCropPath() CHANGED     Gained an 8th parameter, `focusShifts: Array<{start, end}> = []`
                              (default empty - every pre-C3 caller/test keeps the function's exact
                              prior drift behavior with no changes needed). Deliberately a plain
                              {start, end} shape, not @speedora/visual-emphasis's own
                              EditingSuggestion type - @speedora/reframe stays decoupled from that
                              package's vocabulary; the filter/map from EditingSuggestion happens
                              at the orchestration seam in render-clip.worker.ts instead (same
                              "adapter translates between modules' own vocabularies" pattern
                              FUSION_INPUT_MAP already established in render-graph/sinks.ts).

packages/visual-emphasis/src/feature-flags.ts

  isFocusShiftEnabled() NEW   VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED - a SEPARATE flag from
                              isVisualEmphasisEnabled() (ADR D8's API-exposure-only gate,
                              unaffected by this phase): this one gates an actual render-pipeline
                              behavior change, following the SAME "one flag per phase" convention
                              as SUBTITLE_REWRITE_ENABLED/DYNAMIC_CAPTION_ENABLED rather than
                              reusing VISUAL_EMPHASIS_ENABLED for two unrelated concerns (API
                              exposure vs. rendering behavior) or letting one flag silently gate
                              multiple future C4-C7 techniques together.

apps/worker/src/workers/render-clip.worker.ts

  buildReframePlan() CHANGED  Gained an 8th parameter, focusShifts: EditingSuggestionTimeline = []
                              (Phase C1's own type, always available on graphResult regardless of
                              VISUAL_EMPHASIS_ENABLED - that flag gates API exposure only,
                              computation always runs). Filters to technique === 'focus_shift' and
                              maps to buildCropPath()'s plain {start, end} shape right here, before
                              forwarding.

  Call site (the           isFocusShiftEnabled() ? graphResult.editingSuggestions : [] - the ONE
  buildReframePlan() call)   place this phase's flag is actually checked. Off (default) reproduces
                              buildReframePlan()'s exact pre-C3 behavior byte-for-byte (empty
                              array in, empty array through to buildCropPath(), which then behaves
                              exactly as it did before this phase existed).
```

**What did NOT change**: `interpolateAt()`'s own linear-ramp math, the zoom envelope, `buildSendCmdScript()`, the `sendcmd` filtergraph mechanism, and Phase C2's own subject-selection wiring are all byte-for-byte untouched - this phase only reshapes WHICH waypoints `interpolateAt()` ramps between, and only when the window comes from a real Phase C1 `focus_shift` suggestion.

**Verification performed**: `packages/reframe/src/crop-path.spec.ts` gained 3 new tests - (1) the core snap behavior (a sample pair that would have produced a mid-drift value at t=0.2 without this phase now holds flat at the pre-shift position, snapping only within the shift's own [0.4, 0.6] window), (2) the clip-start edge case (a shift window before the first known sample falls back to the exact pre-C3 path, proven via `toEqual` against the no-shift baseline), (3) an explicit default-empty-array regression lock. `render-clip.worker.spec.ts` gained a new "Visual Emphasis Engine Phase C3 - Focus Shift render wiring" describe block (2 tests: flag on with a real detected subject change passes the exact `[{start: 1.85, end: 2.15}]` window through to `buildCropPath()`; flag off passes `[]` even with the same real subject change present) and had its 3 existing Phase C2 "smart reframe" assertions extended with the new trailing `[]` argument. `@speedora/reframe`: 27/27 pass (up from 24). Full worker suite: 594/594 pass (up from 592, net +2 new Phase C3 tests). `apps/worker`/`@speedora/reframe`/`@speedora/visual-emphasis` typecheck, lint, and production build all clean; `apps/api` typecheck unaffected (no API surface touched - `focusShifts` is a purely internal render-time parameter derived from Phase C1's already-exposed `editingSuggestions`, no new DTO field); `pnpm format:check` clean. No new migration, no new Prisma column, no new DTO field - the entire phase lives inside `packages/reframe` + `packages/visual-emphasis` + `apps/worker`.

**What was explicitly NOT done** (the same honestly-flagged gap C2 already carries, restated for this phase's own new visual effect): no real footage was available in this sandbox to judge whether the 0.3s snap window (reusing Phase C1's own `FOCUS_SHIFT_WINDOW_SECONDS` heuristic, not a new constant) actually reads as "deliberate" versus "jarring" to a real viewer - exactly the risk this doc's own roadmap table flagged for C3 before implementation, and the reason the user chose a flag-gated rollout over an unconditional one for this phase specifically.

## Phase C4 architecture (as shipped)

**"C4 rollout" decision** (resolved via `AskUserQuestion` before implementation, same discipline as
C3): the user's own framing distinguished this phase's risk shape from C3's - C4 doesn't introduce
a new visual effect (the zoom/push mechanism already exists, unconditionally, since Fase 11), it
changes the *distribution* of an existing one by adding a second trigger source:

```
Before C4                         After C4
emphasis-word regex               emphasis-word regex ──┐
        │                                                ├── Auto Zoom (unchanged mechanism)
        ▼                         digital_push ──────────┘
   Auto Zoom
```

A clip that never zoomed before (no emphasis words) can now zoom because a `digital_push`
suggestion fired. The risk is over-emphasis (too many punch-ins, zooming on highlights that didn't
need one, an overly aggressive visual rhythm) - not a correctness bug, but still unvalidated
against real footage, and this doc's own roadmap table already flagged the "two trigger sources
firing on overlapping spans" risk before implementation. The user chose the **same rollout shape as
C3** for this reason, with one explicit refinement carried forward from their own review of C3:
**never a shared master flag** - `VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED` and
`VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED` are independent, so production calibration can turn one on
and the other off without a single combined switch forcing them together (e.g. Focus Shift
confirmed good and left on while Digital Push turns out too aggressive and gets turned back off).

**Explicit implementation requirement carried forward from the user's review** (verbatim intent,
not paraphrased away): C4 must ADD a trigger, never replace or duplicate the existing mechanism -

```
existing emphasis-word trigger
          +
Phase C1's digital_push suggestions
          ↓
existing Auto Zoom mechanism (zoomEnvelopeAt(), UNCHANGED)
```

not a second, parallel zoom implementation. The code below satisfies this literally: `zoomEnvelopeAt()`
itself is untouched; only the trigger-start ARRAY feeding into its existing max-reduce grew a
second source.

```
packages/reframe/src/crop-path.ts

  buildCropPath() CHANGED     Gained a 9th parameter, `digitalPushStarts: number[] = []` (default
                              empty - every pre-C4 caller/test keeps the function's exact prior
                              zoom behavior with no changes needed). The `emphasisStarts` local
                              was replaced with `zoomTriggerStarts = [...emphasisWords.map(w =>
                              w.start), ...digitalPushStarts]` - ONE combined array feeding the
                              SAME `.reduce((max, start) => Math.max(max, zoomEnvelopeAt(t, start)),
                              0)` every emphasis-word-only case already used. This IS the "real
                              merge rule" the roadmap flagged as C4's primary risk - it falls out
                              of the existing max-reduce for free (two triggers overlapping in
                              time still only ever produce one envelope's peak, 1.0, never summed/
                              stacked), no new merge logic needed. The `hasFaceData &&
                              emphasisWords.length === 0` early-return guard was also extended to
                              `&& digitalPushStarts.length === 0`, so a faceless clip with only a
                              digital-push moment (no face, no emphasis word) still produces a real
                              zoom-only path instead of incorrectly returning null.

packages/visual-emphasis/src/feature-flags.ts

  isDigitalPushEnabled() NEW  VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED - a SEPARATE flag from
                              isFocusShiftEnabled() (per the "never a shared master flag" decision
                              above), same lazy-env-var-read shape as every other v4 flag.

apps/worker/src/workers/render-clip.worker.ts

  buildReframePlan() CHANGED  Refactored from C3's original shape: the parameter (renamed from
                              `focusShifts` to `editingSuggestions`) now carries Phase C1's
                              UNFILTERED EditingSuggestionTimeline, and BOTH isFocusShiftEnabled()
                              and isDigitalPushEnabled() are checked INSIDE this function, each
                              filtering to its own technique before mapping to buildCropPath()'s
                              own plain shapes. This refactor was necessary the moment two
                              independently-toggleable techniques both needed to read from the
                              same array - C3's original design (gate the WHOLE array at the call
                              site) couldn't scale to a second independent flag.

  Call site               Simplified to pass graphResult.editingSuggestions through UNCONDITIONALLY
                              (always computed regardless of VISUAL_EMPHASIS_ENABLED) - both
                              per-technique flag checks now live inside buildReframePlan() itself,
                              in exactly one place each.
```

**What did NOT change**: `zoomEnvelopeAt()`'s own attack/hold/release envelope math, the pan/
`interpolateAt()` side of `buildCropPath()`, `buildSendCmdScript()`, and Phase C2/C3's own wiring
are all byte-for-byte untouched - Digital Push is purely a second array feeding an existing
computation, exactly the "extend the trigger set, not a new mechanism" requirement.

**Verification performed** (the 5 explicit regression scenarios requested before implementation,
each with its own test):
- **flag OFF + a real digital_push moment present → no new zoom**: `render-clip.worker.spec.ts`'s
  "passes an empty digitalPushStarts array when the flag is off (default), even with a real
  punch-worthy moment detected" - drives a REAL `digital_push` suggestion (a transcript segment
  with `emotion: 'ang'`, whose `BASE_INTENSITY` of 0.85 clears `computeHighlightTimeline()`'s own
  `PUNCH_THRESHOLD` of 0.6 via Phase A1's real, un-mocked `subtitleIntelligenceNode`) and confirms
  `buildCropPath()` still receives `[]`.
- **flag ON + digital_push → zoom occurs**: the sibling "passes the detected digital_push start
  through to buildCropPath when the flag is on" test, same fixture, flag set - confirms
  `buildCropPath()` receives `[0]`.
- **old emphasis-word trigger still works when the C4 flag is off**: "still applies the old
  emphasis-word trigger even when the C4 flag is off" - drives `findEmphasisWordsMock` directly
  (proving Fase 11's own mechanism is completely unaffected by C4's flag state).
- **no digital_push suggestions → identical old behavior**: "passes an empty digitalPushStarts
  array when the flag is on but there is no punch-worthy moment" - flag ON but plain `baseJobData`
  (no punch-worthy segment) still yields `[]`, proving the flag alone doesn't fabricate a trigger.
- **multiple suggestions → no duplicate/stacked zoom**: `packages/reframe/src/crop-path.spec.ts`'s
  "combines an emphasis word and an overlapping digital-push moment by taking the strongest zoom,
  never stacking them" - asserts the exact same single-trigger peak-shrink expression the
  pre-existing "combines overlapping emphasis words" test uses, proving two overlapping SOURCES
  still collapse to one envelope peak. A companion "fires two independent, non-overlapping zoom
  envelopes for two well-separated digital-push moments" test proves well-separated triggers still
  each get their own full envelope (not merged into one).

Plus 3 more `crop-path.spec.ts` tests (zoom-only path from a digital-push moment alone with no
face/emphasis data; exact pre-C4 behavior preserved with the new parameter passed empty; the
updated null-guard's own regression lock) and a 4th `render-clip.worker.spec.ts` fixture test.
`@speedora/reframe`: 32/32 pass (up from 27, +5 new). Full worker suite: 598/598 pass (up from 594,
+4 new). `apps/worker`/`@speedora/reframe`/`@speedora/visual-emphasis` typecheck, lint, and
production build all clean; `apps/api` typecheck unaffected (no API surface touched); `pnpm
format:check` clean. No new migration, no new Prisma column, no new DTO field.

**What was explicitly NOT done** (same category as C2/C3's own gap): no real footage was available
in this sandbox to judge whether the WIDER set of zoom triggers (now including highlight-driven
moments, not just emphasis words) reads as more impactful or as over-emphasis/aggressive rhythm to
a real viewer - the exact reason this phase ships flag-gated with its own independent flag rather
than unconditionally alongside the existing Auto Zoom mechanism it extends.

## Phase C5 architecture (as shipped)

**"C5 mechanism" and "C5 position tracking" decisions** (both resolved via `AskUserQuestion` before
implementation, DC5's own open question finally closed): ASS `\p1` vector-drawing rectangle burn-in
(reusing the existing `subtitles=` filter pipeline, the SAME mechanism Phase B2 already proved
against real ffmpeg+libass - explicitly preferred over a new `drawbox` ffmpeg filter to avoid
introducing a second, unverified drawing mechanism), positioned via a STATIC crop-window snapshot
taken at the highlight's own `startTime` (never the clip's start - the user's own explicit
constraint, since using clip-start crop state would only widen drift) and held fixed for the
highlight's whole visible duration, rather than continuously tracking the crop path's own pan/zoom
motion (explicitly out of scope - "OCR highlight renderer", not "dynamic geometry synchronization
between OCR tracks and an animated crop path", its own separate problem with its own sampling-rate/
interpolation-shape/crop-path-discontinuity questions that need real footage evidence to design
against, not a guess made here).

```
packages/contracts/src/reframe.ts

  ocrHighlightBoxSchema NEW  {start, end, x, y, width, height} - a positioned rectangle for ONE
                              highlight's visible window, in absolute OUTPUT-frame pixel
                              coordinates, already clamped to the frame. Lives alongside
                              cropWindowSchema (both are "a positioned rectangle for one instant/
                              window in output-pixel space") even though PRODUCED by
                              @speedora/reframe and CONSUMED by @speedora/subtitles - a genuine
                              cross-package boundary type, same convention every other
                              contracts/src/*.ts type follows.

packages/reframe/src/ocr-highlight.ts NEW

  computeOcrHighlightBoxes() Transforms each qualifying OCR track's SOURCE-frame-normalized
                              boundingBox into absolute OUTPUT-frame pixel coordinates: finds the
                              crop window nearest the track's own startTime (nearestCropWindow(),
                              a local linear-scan helper, same "local copy, not a shared micro-
                              package" convention every other nearestByTime()-shaped helper in
                              this codebase already follows), transforms through it (subtract
                              crop offset, scale by outputWidth/crop.width and
                              outputHeight/crop.height), then clamps to the output frame - a
                              track that falls entirely outside the crop window's own view (e.g.
                              visible in the wide source shot but cropped out of the 9:16 output)
                              or clamps down to a degenerate (zero-size) box is skipped entirely,
                              never producing an invalid/nonsensical rectangle. `cropPath` must be
                              non-empty - buildCropPath() returning null (a static center-crop)
                              still means a real, constant crop window exists; the caller supplies
                              a single-element synthetic path spanning the whole clip in that case,
                              never an empty array.

packages/visual-emphasis/src/from-ocr-tracks.ts CHANGED

  OCR_HIGHLIGHT_CATEGORIES/  Exported (were module-private) plus a new isOcrHighlightWorthy()
  MIN_CATEGORY_CONFIDENCE/   helper - Phase C5 reuses the EXACT SAME filter Phase C1's own
  isOcrHighlightWorthy() NEW fromOcrTracks() already uses to decide which OcrTextTrack entries
                              qualify, so "which tracks are highlight-worthy" has exactly one
                              definition, not two independently drifting copies (the suggestion-
                              timeline one and a hypothetical render-time one).

packages/visual-emphasis/src/feature-flags.ts CHANGED

  isOcrHighlightEnabled() NEW VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED - a SEPARATE, independent flag
                              from isFocusShiftEnabled()/isDigitalPushEnabled(), same "one flag
                              per technique, never a shared master flag" reasoning as C3/C4.

packages/subtitles/src/build-ass.ts CHANGED

  buildOcrHighlightEvent() NEW One Dialogue event per highlight box: \an7\pos(x,y) (top-left-
                              anchored, so the vector path's own `m 0 0` origin lands exactly at
                              the box's own (x,y)) plus \p1...\p0 vector drawing
                              (`m 0 0 l W 0 l W H l 0 H l 0 0`) for the rectangle itself. \1a&HFF&
                              (fully transparent PRIMARY/fill colour) makes the interior
                              invisible - only the \3c-coloured, \bord-thick OUTLINE renders (an
                              outline "annotation" box, not a filled rectangle obscuring the video
                              underneath). Reuses HIGHLIGHT_COLOR (the same yellow already used
                              for karaoke/bold-highlight emphasis) as the outline colour -
                              "yellow = emphasis" is already this module's own established visual
                              language. Emitted on Layer 1 (captions stay Layer 0, the Format's
                              default) so a highlight box that happens to visually overlap a
                              caption still shows on top of it.

  buildAss() CHANGED          Gained a new `ocrHighlights` input field (buildAssInputSchema,
                              packages/contracts/src/subtitles.ts) - defaults to `[]` so every
                              pre-C5 caller/test produces byte-identical output. CRITICAL
                              coordinate-frame distinction, documented directly on the schema
                              field (this codebase's own established caution after Phase A2's real
                              coordinate-frame bug): `ocrHighlights[].start/end` arrive ALREADY
                              clip-relative (computeOcrHighlightBoxes() output), UNLIKE `segments`
                              (which arrive in ABSOLUTE source-video time and get shifted by
                              `clipStart` internally) - buildAss() clamps ocrHighlights to
                              [0, duration] but must NEVER apply the same `- clipStart` shift a
                              second time. Highlight events are merged into the SAME `events` array
                              as captions (not a separate return path), so a clip with zero
                              overlapping captions but a real highlight-worthy OCR moment (e.g. a
                              music-only clip with an on-screen price tag) still gets a real .ass
                              file written instead of being skipped entirely.

apps/worker/src/workers/render-clip.worker.ts CHANGED

  buildReframePlan() CHANGED  Return type changed from `Promise<ReframeOptions>` to
                              `Promise<{reframe: ReframeOptions; ocrHighlights: OcrHighlightBox[]}>`
                              - OCR highlights are a genuinely separate concern from the crop/zoom
                              plan ffmpeg.ts's renderClip() actually consumes, so they're returned
                              alongside it rather than bundled INTO ReframeOptions (which would
                              give renderClip() a field it never uses). Gained a 9th parameter,
                              `ocrTracks: OcrTextTrack[] | null = null` (graphResult.ocrTracks
                              itself, always computed regardless of any flag) - filtered by
                              isOcrHighlightWorthy() and gated by isOcrHighlightEnabled() right
                              here, same "each technique checks its own flag inside this function"
                              shape C3/C4 already established. computeOcrHighlightBoxes() is
                              called in BOTH the null-cropPath branch (static center-crop - a
                              single-element synthetic crop window built from the static x/y/w/h)
                              and the real-cropPath branch, so OCR highlights work identically
                              whether or not the clip also has a moving pan/zoom.

  Call site                buildAss()'s call now passes `ocrHighlights` through (the destructured
                              second half of buildReframePlan()'s new return value) as a new field.
                              apps/worker's ffmpeg.ts (renderClip()) needed ZERO changes - the
                              entire mechanism piggybacks on the ALREADY-EXISTING subtitles=
                              filter, exactly the reuse-first design DC5 required.
```

**What did NOT change**: `buildCropPath()`/`interpolateAt()`/`zoomEnvelopeAt()` (Phase C2-C4's own
math), `ffmpeg.ts`'s `renderClip()` function signature, and every existing ASS Dialogue-line
construction (karaoke/bold-highlight/speaker-color/dynamic-caption treatment) are all byte-for-byte
untouched - this phase adds a wholly new, independent Dialogue-line KIND (a drawn rectangle, not
styled text) on its own Layer, composing alongside everything already there.

**Verification performed** (the acceptance gate the user made explicit for this phase, unlike
C3/C4 which had no equivalent real-render surface to exercise):
- `packages/reframe/src/ocr-highlight.spec.ts` (7 new tests): empty crop path -> no boxes; empty
  track list -> no boxes; a real source-to-output coordinate transform through a static crop
  window, checked against a hand-computed expected pixel value; the snapshot uses the crop window
  nearest the highlight's own `startTime` (proven by using a DIFFERENT crop window than clip-start
  would have produced); multiple tracks -> multiple boxes; a track fully outside the crop window
  -> skipped; a track partially overlapping the edge -> clamped, not out-of-bounds; a degenerate
  (zero-size) box -> skipped safely.
- `packages/subtitles/src/build-ass.spec.ts` (7 new tests, "OCR Highlight (Phase C5)" describe
  block): empty `ocrHighlights` (default) -> byte-identical to pre-C5 output; a real box produces
  the exact expected `\p1` rectangle path and `\1a&HFF&` transparent-fill tag; timestamps are used
  DIRECTLY (not clipStart-shifted, the coordinate-frame regression this test locks in); multiple
  boxes -> multiple Dialogue lines; a highlight-only clip (no captions) still produces real output;
  a highlight that clamps to zero/negative duration is dropped; captions and highlights compose in
  the same file.
- `render-clip.worker.spec.ts` (4 new tests, "Visual Emphasis Engine Phase C5 - OCR Highlight
  render wiring" describe block, using REAL - not mocked - `classifyOcrTrack()` classification via
  `detectOcrTextMock`, same "pure functions left real" convention as
  `detectFacialEmotion`/`detectFaceLandmarks` elsewhere in this spec file): flag off -> empty
  tracks array passed to `computeOcrHighlightBoxes()` even with a real qualifying (`price`) track
  detected; flag on + qualifying track -> the real classified track passed through; flag on +
  non-qualifying (`subtitle`) track -> empty array; `computeOcrHighlightBoxes()`'s own return
  value flows through to `buildAss()`'s `ocrHighlights` field unchanged.
- **Real ffmpeg+libass render** (this phase's explicit acceptance gate): a real `buildAss()` call
  (one caption line + one highlight box spanning a 5s test clip) run through real `ffmpeg` with a
  `crop=...,subtitles='...'` filtergraph matching `renderClip()`'s own real shape - zero libass
  parse errors/warnings, and frame extraction at 4 timestamps visually confirmed: (1) caption only
  before the highlight starts, (2) the highlight box - a yellow outline, transparent interior, at
  the expected position and size - with the caption still visible where their windows overlap,
  (3) the highlight box alone after the caption ends, (4) neither, after the highlight ends too.
  Confirms the `\p1`/`\an7\pos()`/`\1a`/`\3c`/`\bord` tag combination is genuinely valid ASS that
  libass renders correctly, not just a plausible-looking string.

`@speedora/reframe`: 47/47 pass (up from 40, +7). `@speedora/subtitles`: 34/34 pass (up from 27,
+7). Full worker suite: 606/606 pass (up from 602, +4). `apps/worker`/`@speedora/contracts`/
`@speedora/reframe`/`@speedora/visual-emphasis`/`@speedora/subtitles` typecheck, lint, and
production build all clean; `apps/api` typecheck unaffected (no API surface touched - no new DTO
field, no new endpoint); `pnpm format:check` clean. One new Prisma-adjacent-but-not-actually-Prisma
type (`ocrHighlightBoxSchema`, `packages/contracts`) - no migration, since this data is never
persisted, only computed fresh at render time and burned directly into the `.ass` file.

**What was explicitly NOT done**: continuous crop-path tracking (the "C5 position tracking"
decision's own explicit scope cut - see above) - a highlight box is anchored to the crop state at
its own start and CAN visibly drift out of alignment with the source video's own on-screen text if
the crop path pans/zooms substantially during a long highlight. This is a documented, by-design
limitation, not an oversight - no real footage was available in this sandbox to judge how often
that matters in practice, and a future phase (dynamic tracking, if real footage evidence ever
shows drift is a real problem) would need that evidence to design its own sampling/interpolation
approach against, not a guess made here.

## C6R design (Reaction Hold Temporal Extension) — redesign complete, not yet built

Before starting C6, its own risk note ("extending duration interacts with the existing cutlist/
render timeline math non-trivially") was reconsidered against C7's actual shape (see "C7 rollout"
below) and found to be a materially bigger, categorically different undertaking than every other
C-phase shipped so far - **C2-C5 and C7 all change spatial positioning, a visual effect's trigger
set, or an editing DECISION, but never the clip's own temporal coordinate system.** Literally
"extending a shot's on-screen duration" (freeze-frame or slow-motion) would shift every downstream
timestamp - the first phase in this initiative that would need to. Per explicit user direction -
"Jangan mengubah timeline duration tanpa terlebih dahulu memiliki explicit temporal-remapping
layer" - this section is that redesign pass, done before any C6R code. **Status: design complete,
resolved via `AskUserQuestion` + follow-up review, nothing implemented yet** - see the C6R.1-C6R.3
sub-roadmap at the end for what's next.

### The key architectural finding: a THIRD pass, after cuts, needs zero remapping of anything

Every open question in the original deferral note (caption propagation, crop-path remapping,
B-roll remapping, segment boundary handling) turns out to share one root cause - they all assumed
the extension has to happen somewhere INSIDE the existing render graph/first-pass composition,
where captions/crop-path/B-roll timing all still live as separate, not-yet-composed data. It
doesn't. `render-clip.worker.ts`'s existing pipeline already has a precedent for exactly this
shape: **Phase C7's own cuts pass runs on the ALREADY fully-composed (cropped + captioned + B-roll
overlaid) output**, which is why cuts need no separate remap logic for any of those three things -
by the time cuts run, they're not separate signals anymore, they're just pixels.

Reaction Hold gets the identical benefit by running as a **third pass, after cuts**, on that same
already-composed-and-trimmed output:

```
pass 1 (existing)   crop/zoom + B-roll + captions -> composed output
pass 2 (C7)         silence/filler cuts (pause_hold-protected) -> trimmed output
pass 3 (C6R, NEW)   freeze-frame + silence hold at each reaction_hold instant -> final output
```

Freezing a frame of the ALREADY-COMPOSED output automatically freezes whatever crop position/
caption/B-roll pixel was showing at that instant, correctly, for free - there is no "crop-path
remapping" or "caption timestamp propagation" left to design, because nothing downstream of pass 1
is still a separate timeline by the time pass 3 runs. This is a smaller redesign outcome than the
original deferral note anticipated, not a bigger one - most of the original open-question list
dissolves once the insertion point is chosen correctly.

**What's actually left to design** (the real remaining surface, confirmed via `AskUserQuestion`
before any code): (1) how a timestamp maps from the ORIGINAL clip-relative timeline (where
`reaction_hold` suggestions already live, computed by Phase C1) onto the POST-CUT timeline pass 3
actually operates on, and (2) the freeze-frame/audio mechanism itself.

### The reusable temporal-remapping primitive: generalize, don't invent

`@speedora/cutlist` already has a timestamp-remapping function - `computeCutJunctionTimestamps()`
(Fase 14, Smart Transitions), which maps each cut's own start onto its post-cut position. C6R's
"primitive" is generalizing this from "map a cut's own start" to "map ANY original timestamp":

```ts
// packages/cutlist/src/cutlist.ts (planned, C6R.1)
export function remapTimestamp(t: number, cuts: CutRange[]): number | null {
  let removedBefore = 0;
  for (const cut of cuts) {
    if (t >= cut.start && t < cut.end) return null; // t itself was cut away
    if (cut.end <= t) removedBefore += cut.end - cut.start;
  }
  return round3(t - removedBefore);
}
```

`null` covers the one real edge case this generalization must handle that
`computeCutJunctionTimestamps()` never had to: a `reaction_hold` instant whose ORIGINAL timestamp
falls INSIDE a range that got cut away entirely (e.g. a reaction expressed only through facial
expression during an otherwise-silent gap, with no speech to anchor the moment to). Resolution:
**skip that hold entirely** - same "protect rarely, don't guess" conservatism C7's own exact-match
design already established; there's no surviving frame at that instant to freeze on, and snapping
to the nearest surviving frame would be fabricating a position, not respecting a real one.
`computeCutJunctionTimestamps()` itself can be refactored to call `remapTimestamp()` internally
(`cuts.map((cut) => remapTimestamp(cut.start, cuts))`) once this exists, so there's exactly one
remapping algorithm in the codebase, not two - a real DRY opportunity, not just a coincidence.

### Resolved via `AskUserQuestion` (all three, before any code)

1. **Insertion point**: confirmed - third pass, after cuts (above).
2. **Hold mechanism: freeze-frame**, not slow-motion. Duplicates a single frame for an extra,
   fixed duration via ffmpeg's mid-stream freeze technique (`trim`+`tpad`+`concat`, splitting the
   video around the hold instant, padding the frozen slice, concatenating before/frozen/after back
   together) - the classic "freeze on the reaction" editing technique, unambiguous to verify.
   Slow-motion (variable-rate `setpts`/`atempo` stretching, needing pitch-correction) was
   explicitly rejected as unnecessary complexity for a first version.
3. **Audio: brief silence, not a held/repeated sample, not continued playback.** The user's own
   explicit reasoning, preserved verbatim since it's the actual design constraint: repeating the
   last audio sample literally risks "syllable patah/terulang, noise loop, consonant yang terdengar
   aneh" (a broken/repeated syllable, a noise loop, a strange-sounding consonant) - artifacts worse
   than silence. Letting audio continue underneath a frozen frame was also rejected: it creates a
   NEW contract (video and audio diverge during the hold, needing an explicit resync point after)
   that adds complexity not needed to prove C6R works. **The stated invariant**: video duration and
   audio duration both grow by exactly the same amount, at exactly the same point - "C6R must never
   leave the final output with an A/V timestamp offset." Implementation-wise, this means the SAME
   `-filter_complex` pass splits and re-concatenates BOTH streams around the identical remapped
   timestamp, with the video's frozen slice and the audio's inserted silence sized to the exact
   same duration:

```
reaction_hold instant (Phase C1, clip-relative)
        ↓
remapTimestamp() against C7's own cuts (may resolve to null -> skip)
        ↓
video: trim/tpad/concat - freeze one frame for N seconds
audio: atrim/anullsrc/concat - insert N seconds of silence at the SAME point
        ↓
both streams now exactly N seconds longer, still perfectly in sync
        ↓
resume original A/V
```

### Still open - resolved here as documented, reasoned defaults (lower-stakes than the three
### above; revisit if real footage says otherwise, same "scale honesty" posture as every other
### heuristic in this initiative)

- **Hold duration**: a fixed heuristic constant (tentatively ~0.5s extra, not the `reaction_hold`
  suggestion's own ~1.5s WINDOW size, which represents when the peak reads as significant, not how
  long to freeze on it) - deliberately NOT scaled by the suggestion's own `score`, since that score
  is documented elsewhere as "not comparable across clips," and turning it into a literal duration
  multiplier would be a second, uncalibrated heuristic stacked on the first. A single constant is
  simpler to reason about and verify for a first version, matching the user's own "MVP jauh lebih
  deterministic" preference.
- **Overlapping/multiple reaction windows**: process hold points in chronological order, splitting
  the already-cut timeline into `N+1` "pass-through" segments interleaved with `N` frozen+silence
  segments (one `concat` filter, not `N` separate ffmpeg invocations). Two reaction instants close
  enough together that their own extra-duration windows would overlap need a merge rule before
  splitting - reusing `mergeCutRanges()`'s own sort-and-merge shape (already proven, already
  tested) rather than inventing a second one.
- **Clip-start/clip-end edge cases**: a reaction instant near either boundary clamps the same way
  `fromEmotionalPeaks()`'s own `Math.max(0, peak.t - REACTION_HOLD_WINDOW_SECONDS / 2)` already
  does for the suggestion's own start - no new clamping logic, reuse what Phase C1 already
  established at the signal-detection layer.
- **Idempotency**: not a new mechanism to build - `render-clip.worker.ts` already re-renders a
  clip from the original SOURCE video on every real render (the existing `existingClip.outputUrl`
  check skips a genuinely-already-rendered clip entirely; it never re-processes a PREVIOUS render's
  own output), so C6R inherits the same "always fresh from source, never incremental" guarantee
  every other pass in this pipeline already has, with no additional idempotency logic needed.

### Sub-phase roadmap (each still needs its own explicit "Start Phase C6R.N" go-ahead)

| Sub-phase | Deliverable | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| C6R.1 | `remapTimestamp()` in `@speedora/cutlist`, fully unit-tested pure function (including the `null`-for-cut-away-instant case); `computeCutJunctionTimestamps()` refactored to reuse it | none - pure function over existing `CutRange[]` | S | Low - same shape as `protectPauseHolds()`'s own exact/pure-function design |
| C6R.2 | The freeze-frame + silence ffmpeg mechanism itself (`apps/worker/src/ffmpeg.ts`, new function) - `trim`/`tpad`/`atrim`/`anullsrc`/`concat` filter-complex, verified against a REAL ffmpeg render (this sandbox has one, same acceptance-gate discipline Phase C5 established) confirming exact A/V sync (both streams grow by the identical duration) and correct freeze position | C6R.1 (needs a remapped timestamp to freeze at) | M | Genuinely new ffmpeg filter-complex territory (mid-stream `concat`, unlike every existing filter in this pipeline which only ever runs once, start-to-end) - needs real verification, not just a plausible-looking filter string |
| C6R.3 | Wiring into `render-clip.worker.ts` - reads `reaction_hold` suggestions from `graphResult.editingSuggestions` (already computed, Phase C1), remaps + merges overlapping windows, applies C6R.2's mechanism as pass 3, flag-gated (`VISUAL_EMPHASIS_REACTION_HOLD_ENABLED`, off by default, no per-clip toggle, same convention as C3/C4/C5/C7) | C6R.1, C6R.2 | S-M | Ordering bugs (must run strictly after C7's own cuts pass, on ITS output, not the pre-cut one) |

## Phase C7 architecture (as shipped)

**"C7 rollout" decision**: unlike C6, Pause Hold changes an editing DECISION only - which of the
already-detected silence gaps `@speedora/cutlist`'s existing `computeSilenceCuts()` produces get
SKIPPED rather than trimmed. No duration mutation, no timestamp rebasing, no freeze-frame/slow-
motion, no caption shift, no B-roll rescheduling - the render-graph/render-timeline architecture
this pipeline already has is completely sufficient. This is exactly why C7 was implemented before
C6 despite the numbering - a deliberate reordering, not an oversight, once C6's own real risk
became clear during this comparison. Same rollout SHAPE as C3/C4/C5 regardless (flag-gated, off by
default, own independent flag, `VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED`) - lower risk than any prior
rendering-behavior phase, but a wrong "protect this pause" call still silently reintroduces dead air
Smart Trim exists specifically to remove, and (the same gap every prior phase carries) no real
footage was available in this sandbox to validate how often the exact-match protection below
actually fires on real content.

```
packages/cutlist/src/cutlist.ts

  protectPauseHolds() NEW    Removes any silence cut that EXACTLY matches a protected window
                              ({start, end} from a Phase C1 pause_hold EditingSuggestion - always
                              derived from THIS SAME computeSilenceCuts() call in
                              @speedora/visual-emphasis's fromPauses(), so an exact match - not a
                              loose overlap check - is the correct, conservative comparison:
                              "protect THIS pause", never "protect anything near it" (the
                              roadmap's own "protect rarely, not liberally" instruction). A 1e-6
                              floating-point tolerance accounts for ordinary binary rounding, same
                              reasoning round3() elsewhere in this file already exists for. Must
                              run BEFORE mergeCutRanges() combines silence cuts with filler-word
                              cuts - a protected silence gap sitting right next to an unrelated
                              filler cut must never accidentally protect the filler cut too
                              (filler words are always removed regardless of dramatic-pause
                              proximity; pause protection only ever applies to actual silence
                              gaps).

packages/visual-emphasis/src/feature-flags.ts

  isPauseHoldEnabled() NEW   VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED - a SEPARATE, independent flag
                              from isFocusShiftEnabled()/isDigitalPushEnabled()/
                              isOcrHighlightEnabled(), same "one flag per technique, never a
                              shared master flag" reasoning as every prior rendering-behavior
                              phase.

apps/worker/src/workers/render-clip.worker.ts

  computeClipCuts() CHANGED  Gained a 4th parameter, editingSuggestions: EditingSuggestionTimeline
                              = [] (Phase C1's own output, always computed regardless of any
                              flag) - filtered to technique === 'pause_hold' and gated by
                              isPauseHoldEnabled() INSIDE this function, same "each technique
                              checks its own flag inside the function that consumes it" shape
                              C3/C4/C5 already established. protectPauseHolds() runs on the raw
                              silence-cuts array, before merging with filler cuts, matching
                              protectPauseHolds()'s own documented ordering requirement.

  Call site                graphResult.editingSuggestions passed through unconditionally (same
                              "always pass the whole array, let the consumer check its own flag"
                              shape as C3/C4/C5's own call sites).
```

**What did NOT change**: `computeSilenceCuts()`/`computeFillerCuts()`/`mergeCutRanges()`/
`totalCutSeconds()`/`computeCutJunctionTimestamps()` (every existing `@speedora/cutlist` function),
the entire `renderClip()`/`trimCutRanges()` ffmpeg mechanism, and every downstream caption/crop-path
timestamp are all byte-for-byte untouched - this phase only changes WHICH already-computed silence
cuts make it into the final list that gets trimmed.

**Verification performed**: `packages/cutlist/src/cutlist.spec.ts` gained 6 new tests for
`protectPauseHolds()` - exact-match protection, partial-overlap NOT protected (proving the
conservative "exact match only" design), floating-point tolerance, empty-protected-windows
no-op, empty-silence-cuts no-op, multiple independent protected cuts. `render-clip.worker.spec.ts`
gained a new "Visual Emphasis Engine Phase C7 - Pause Hold render wiring" describe block driving a
REAL `pause_hold` suggestion through the full render graph (a genuine 9.2s silence gap - the exact
same fixture the pre-existing silence-cut test already uses - plus a real `curiosityPeak` via
`detectSemanticEventsMock`, left otherwise real/un-mocked for `computeRetentionCurveInsights`'s own
derivation, same "mock only the LLM seam" convention as every other LLM-backed node in this file):
flag on -> the trim pass is skipped entirely (`trimCutRangesMock` never called); flag off (default)
-> the exact same gap still gets cut normally. Caught and fixed a real test-isolation bug during
this work: `detectSemanticEventsMock.mockResolvedValue(...)` (unlike every other detector mock in
this file, which already has a safe default set in the top-level `beforeEach`) had no prior default,
so setting it in this describe block's own `beforeEach` silently leaked into every LATER test in
file execution order (`jest.clearAllMocks()` only clears call history, not a mock's own resolved-
value implementation) - fixed with an explicit `detectSemanticEventsMock.mockReset()` in this
block's `afterEach`, confirmed by re-running the full suite and seeing the previously-broken
Scene/Facial Intelligence tests pass again. `@speedora/cutlist`: 26/26 pass (up from 20, +6). Full
worker suite: 604/604 pass (up from 602, +2). `apps/worker`/`@speedora/cutlist`/
`@speedora/visual-emphasis` typecheck, lint, and production build all clean; `apps/api` typecheck
unaffected (no API surface touched); `pnpm format:check` clean. No new migration, no new contract
type, no new DTO field - the entire phase lives inside `packages/cutlist` + `apps/worker`.

## Explicitly deferred / open questions

- **Whether any of C6-C7 need their own per-clip opt-in toggle** (mirroring `smartSegmentation`/
  `dynamicCaptions`) or should just be unconditional once shipped, the way Auto Zoom/Auto Crop
  already are — a real product decision each phase should surface explicitly when it's actually
  designed, not assumed now (C3/C4/C5 all resolved this the same way - flag-gated, off by default,
  no per-clip toggle - but each phase re-decided it explicitly rather than assuming the precedent).
- **Continuous OCR highlight position tracking** (a possible future C5.x/C8, per the "C5 position
  tracking" decision above) — would need real production footage showing the static-snapshot
  limitation actually matters before designing a sampling/interpolation approach, not a guess made
  ahead of that evidence.
- **Video Quality Intelligence** (focus/exposure/noise/compression) — named in
  `docs/ai/composition-intelligence.md` as a separate, not-yet-scoped roadmap; genuinely unrelated
  to Visual Emphasis Engine despite both touching "camera," not folded in here.
