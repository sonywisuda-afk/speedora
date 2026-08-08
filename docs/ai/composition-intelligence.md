# Composition Intelligence Roadmap

Answers *how the subject is placed within the frame* — rule of thirds, headroom, lead room,
centering, and whether that placement stays consistent over a clip's duration. Deliberately named
**Composition**, not **Camera**: the underlying computation (bounding-box position relative to
frame bounds) is agnostic to *why* the frame looks the way it does — a live camera pan, Smart
Reframe's AI crop, or a static thumbnail all produce the same shape of input, so the domain is
broader than "camera behavior" alone.

## Design Principles

- Reuse existing signals — never re-detect what Face/Object Intelligence already produced.
- Never recompute tracker outputs — a bounding box, a track ID, a presence flag is read once from
  whichever package computed it, never independently re-derived a second way.
- No new detector unless a derived solution is genuinely impossible — every RB-1 feature is pure
  geometry over already-computed positions; the moment a feature needs pixels this package doesn't
  already receive, it belongs to a different subsystem (see Non-Goals below), not a bolt-on
  detector here.

```
Face Intelligence
        │
Object Intelligence
        │
        ▼
Primary Subject Selection
        │
        ▼
Composition Intelligence
        │
        ▼
Composition Fusion Features
        │
        ▼
Fusion Engine
```

### Non-Goals

Composition Intelligence does not, and will not:

- detect camera movement (Scene/Motion Intelligence's job)
- detect blur, exposure, or focus (Video Quality Intelligence's job — separate roadmap)
- detect rolling shutter (Video Quality Intelligence's job)
- classify scenes (Scene Intelligence's job)
- detect action or interaction (Object Intelligence's `interactionConfidence`, Batch OI-4)
- estimate object importance (Object Intelligence's `objectAttentionScore`, Batch OI-5)

Composition Intelligence only derives spatial-composition metrics from an already-selected,
already-tracked subject.

## Origin — reclassifying a 15-batch "Camera Intelligence" proposal

This roadmap replaces an earlier proposal (`CI-1` through `CI-15`, "Camera Intelligence") that was
run through an architecture review against this codebase's actual state, per the established
principle for every initiative in this doc set: **reuse first, derive second, extend third, add a
new detector only when genuinely necessary.** The review found:

- **9 of the 15 proposed items already exist**, under Scene Intelligence, Motion Intelligence, or
  Object/Facial Intelligence, just re-described in camera vocabulary (see the mapping table below).
- **3 items are a different subsystem entirely** — technical recording quality (focus, exposure,
  noise, white balance, sharpness, compression) has nothing architecturally in common with subject
  placement and was split out into a separate, not-yet-written **Video Quality Intelligence**
  roadmap (see "Explicitly out of scope" below).
- **What survived as genuinely new work reduced to one real batch** (`RB-1` below) plus its
  mechanical Fusion Engine wiring (`RB-2`).

## Relationship to other subsystems

- **Scene Intelligence** (`packages/scene-intelligence`) — what happens in the scene, including
  camera motion type/stability/zoom/cuts (Batches SC-1 through SC-7). Already fully covers "how
  does the camera move" — Composition Intelligence does not duplicate any of it.
- **Object Intelligence** / **Facial Intelligence** — own detection, tracking, and per-entity
  bounding boxes (position, confidence, presence-per-frame). Composition Intelligence is a pure
  consumer of this data (face/object track bounding boxes as typed input), never a second detector
  for the same entities.
- **Video Quality Intelligence** (separate, not-yet-written roadmap) — technical recording
  quality: focus/sharpness, exposure, noise, white balance, compression artifacts. A completely
  different question ("how good is the footage, technically") from composition's ("where is the
  subject placed"), with no shared code or detector.
- **Fusion Engine** (`packages/fusion-engine`) — consumes Composition Intelligence's output the
  same way it consumes every other signal: a new `composition` key in `FUSION_SIGNALS`, wired at
  weight 0 (see `RB-2`).

## Primary Subject Selection

Every RB-1 feature depends on a single question answered before Composition Intelligence ever
runs: **which entity is "the subject" this frame?** This selection happens **entirely outside**
this package — Composition Intelligence consumes an already-selected subject and never performs
detection, tracking, or selection itself, same "reuse, never recompute" boundary as everything
else in this doc. Left undocumented, two engineers wiring the worker orchestrator could reasonably
build two different answers.

**Implemented as its own standalone package, `packages/primary-subject`** (`selectPrimarySubject()`)
— deliberately *not* folded into `packages/composition-intelligence` or hidden as a private detail
of `render-clip.worker.ts`, per explicit user direction: this is a reusable building block, not a
composition-only concern (a future Thumbnail Intelligence, Reframe upgrade, or Multi-Subject
initiative needs the identical "which entity is the subject" answer). Its output contract
(`primarySubjectSampleSchema`, `packages/contracts/src/primary-subject.ts`) is intentionally
generic — `box`/`trackId`/`facingYaw`/`t`/`source` — not named after composition at all.

Implemented order, first candidate with data at a given sampled instant wins:

1. **Active speaker** — Speaker Intelligence's Active Speaker Detection. **Correcting this doc's
   earlier claim**: CLAUDE.md's "contracts only" status for Speaker Intelligence is stale —
   `packages/active-speaker-intelligence`'s `detectActiveSpeaker()` is fully implemented and
   already runs in `render-clip.worker.ts` (`activeSpeakerSamples`). In this pipeline's current
   single-most-prominent-face tracker, this step mostly confirms "yes, the one tracked face is
   confidently talking" rather than choosing among several faces — the distinction becomes
   meaningful once multi-face tracking exists (see `docs/ai/object-intelligence.md`'s "Explicitly
   out of scope").
2. **Largest visible face** — Facial Intelligence's `faceLandmarks` (per-instant `boundingBox`).
   Trivially "the" face, not a comparison, for the same single-face-tracker reason as above.
3. **Largest tracked person** — Object Intelligence, `category === 'person'`.
4. **Highest `objectAttentionScore`** — Object Intelligence, Batch OI-5.
5. **Largest tracked object** — Object Intelligence, any category.

Steps 3–5 use `ObjectTrack`'s own clip-level **average** bounding box for the entity's entire
active window (`[startTime, endTime]`), not a true per-instant position — `ObjectTrack`'s contract
has no per-appearance box/timestamp list, only summary stats, and re-deriving one would mean
re-implementing `@speedora/object-intelligence`'s own tracker outside that package. Coarser than
the face-sourced steps, but an honest, documented limitation rather than a fabricated precision.

This order is encoded both as a comment on `compositionSampleSchema`/`primarySubjectSampleSchema`
and in `select-primary-subject.ts` itself, not just here, so the implementation and this doc can't
silently drift apart.

**Update**: Visual Emphasis Engine Phase C2 (`docs/ai/visual-emphasis-engine.md`, ADR DC3) gave
this same selection a second consumer — `render-clip.worker.ts`'s `buildReframePlan()` now derives
Smart Reframe's own crop-path subject from `selectPrimarySubject()`'s output too, retiring a
previously separate, disconnected `detectFaces()` call that could disagree with this chain's own
choice on the same clip. See `docs/worker.md`'s "Smart Reframe / Auto Zoom" section.

## Batch RB-1 — Composition Features

No new detector or subprocess. Every feature below is a pure derive function over bounding-box
data for the already-selected primary subject (see above) — never a second detection pass.
Contract shape lives in `packages/contracts/src/composition-intelligence.ts`
(`compositionSampleSchema`/`compositionInputSchema`/`compositionFeaturesSchema`). Follows the same
"pure function, `@speedora/contracts`-only dependency, no cross-package code imports" shape as
`packages/editing-rhythm` — the closest existing precedent for a derived-composite package that
consumes other packages' already-computed output without importing their code.

- **`ruleOfThirdsScore`** — closeness of the primary subject's bounding-box center to the nearest
  rule-of-thirds intersection point. Pure geometry over an already-available center point.
- **`headroomScore`** / **`leadRoomScore`** — distance from the subject's bounding-box edge to the
  frame edge in the relevant direction (top for headroom; subject **heading** — `facingYaw`, not
  motion direction — for lead room, using the same reasoning as `compositionSampleSchema.
  facingYaw`: yaw is the best already-available proxy since this pipeline has no eye-gaze,
  body-pose, or walking-direction signal to draw on instead), scored against a target range rather
  than a single ideal value.
- **`centeringScore`** — distance of the subject's bounding-box center from true frame-center,
  normalized `[0, 1]`. The simplest of the four, and the one most redundant with
  `ruleOfThirdsScore` if the subject is meant to be off-center by design — both are computed and
  exposed separately rather than blended, so a caller can tell "centered" apart from "well-composed
  but intentionally off-center."
- **`subjectLossRatio`** — fraction of a clip's sampled frames where the primary subject has no
  detection at all (visible → absent → visible). Reuses the *same* per-frame presence data
  Facial/Object Intelligence's trackers already produce as a byproduct of tracking — **not** a new
  visibility detector. Framed here as a composition/framing-failure question ("did the camera fail
  to keep the subject in frame"), distinct in intent from Object Intelligence's
  `averageTrackingConfidence` (a tracker-robustness question), even though both ultimately read
  from the same track continuity data.
- **`compositionStability`** — computed from **frame-to-frame changes** in composition, not
  absolute composition values (same shape as Scene Intelligence's `smoothnessScore`, also a
  `|Δdx| + |Δdy|` delta rather than an absolute reading). This is the whole reason it's a delta:
  clip A scoring `ruleOfThirdsScore` = `[0.8, 0.8, 0.8]` and clip B scoring
  `[0.6, 1.0, 0.6, 1.0]` average to the identical `0.8`, yet B is visibly worse framing —
  oscillating rather than held. Only the delta tells them apart.
- **`framingConsistency`** — rate of shot-type transitions (close-up ↔ medium ↔ wide) per unit
  time. Requires one small new piece of derive logic not yet defined anywhere: a coarse `shotType`
  bucket (close-up/medium/wide) from `subjectBoundingBoxArea ÷ frameArea`, thresholded the same way
  Scene Intelligence already buckets continuous camera-transform values into
  `dominantMotionType`. Still no detector — only a new bucketing function plus a transition-rate
  count over the bucketed sequence, the same shape as Motion Intelligence's peak/transition-rate
  features (SC-5). **A shot-type change is not automatically bad** — wide → medium → close-up is
  often deliberate editing. This field measures oscillation frequency / apparently-unnecessary
  reframing, never shot-type diversity itself, so intentional multi-shot-type editing isn't
  penalized just for using more than one shot type.

## Batch RB-2 — Fusion Wiring

Add `composition` as a new key in `FUSION_SIGNALS`/`DEFAULT_FUSION_WEIGHTS`
(`packages/fusion-engine/src/weights.ts`), wired at weight 0 — the same "collect first, calibrate
later" treatment every recently-added signal in that table already has (`sceneMotion`,
`cameraMotion`, `gesture`, `faceGeometry`, `object`, `speaker`). **Must be a new key, not a reuse of
the existing `cameraMotion` key** — `cameraMotion` is already populated by Scene Intelligence's
Batch SC-3 (directional pan/tilt/zoom/shake), and stands for a different question (how the camera
moved) from `composition` (where the subject sat in the frame). Conflating the two keys would
silently overwrite Scene Intelligence's existing contribution.

Calibration follows the identical path `editingRhythm` already went through:
`apps/worker/src/scripts/check-calibration-coverage.ts` gates any move off weight 0 on having real
production samples (clips with both `compositionFeatures` and a linked `PublishRecord` with
`viewCount`) — re-run it once production data accumulates, same checkpoint every other pending
signal in `weights.ts` is waiting on.

## Explicitly reclassified — not Composition Intelligence

| Original item | Actual home | Why |
|---|---|---|
| CI-1 Camera Motion Type | Scene Intelligence (Batch SC-3) | `dominantMotionType`, already shipped |
| CI-2 Camera Stability | Motion Intelligence (Batches SC-3/SC-7) | `shakeScore` + `smoothnessScore`, already shipped |
| CI-6 Camera Tracking Quality (as literally named) | Object/Facial Intelligence | `averageTrackingConfidence`, `face-tracking-quality.ts` — already shipped under this name; the videography-sense reading ("did the camera keep the subject visible") is `subjectLossRatio` above, not a rebuild of this |
| CI-7 Camera Reframing | `packages/reframe` | Already a shipped product feature (`buildCropPath()`), not a pending signal |
| CI-8 Zoom Analysis | Motion Intelligence (Batch SC-3) | `zoomScore`/`scale`, already shipped |
| CI-9 Camera Transition | Scene Intelligence (Batch SC-1) | `classifySceneCutTypes`, already shipped |
| CI-13 Camera Attention | Object Intelligence (Batch OI-5) | `objectAttentionScore` already is a "domain of domains" attention composite — consume it directly, don't rebuild |
| CI-10 Focus / CI-11 Exposure / CI-12 Horizon Stability | Video Quality Intelligence (separate roadmap) | Technical recording quality, not subject placement |
| CI-14 Camera Cinematic Score | Deferred | A composite over Video Quality + Composition outputs once both exist and have real calibration data — same "don't calibrate before there are samples" lesson `editingRhythm` already carries. Not scoped here. |

## Explicitly out of scope (this doc)

- **Video Quality Intelligence** (Focus/Sharpness, Exposure, White Balance, Noise, Compression,
  Rolling Shutter, and an eventual `qualityScore` composite) — a separate initiative with its own
  cost profile (several items extend the existing per-frame vision subprocess; Noise and
  Compression need real new algorithms; Rolling Shutter has no existing signal to lean on at all
  and is of doubtful value against arbitrary user-uploaded footage). Deserves its own roadmap doc
  when scoped, not bundled here.
- **A standalone "Camera Cinematic Score" or "Camera Attention" package** — both redundant with, or
  premature ahead of, signals covered elsewhere (see the reclassification table above).
- **Real ffmpeg/model-binary verification** — same known sandbox gap as every other vision-adjacent
  module in this pipeline (`ai/vision.md`'s "Known verification gap"); RB-1 has no new subprocess to
  verify in the first place, but its inputs (face/object detection) inherit that existing gap.

## Future Extensions

Possible future additions on top of RB-1, listed here only so they aren't forgotten, not scoped as
committed work. All are still **pure derived** — none need a new detector, all can be built from
data Facial/Object Intelligence (or RB-1 itself) already produces:

- **Eye-line balance** — once eye/gaze data is available (Face Landmarks Batch 2's eye-contact
  work), a composition read of which side of the frame the subject's gaze leaves open.
- **Negative-space score** — how much of the frame is *not* occupied by the subject or other
  tracked entities, derived from the same bounding boxes RB-1 already consumes.
- **Visual symmetry** — for frames with more than one simultaneous subject, balance of their
  combined bounding-box positions around the frame's center axis.
- **Multi-subject composition** — the reason `subjectTrackId` was added to `compositionSampleSchema`
  ahead of need: composing a frame around more than one tracked subject at once, once there's a
  concrete product reason to.

## What's next (not done in this pass)

**Done:** the Zod contract — `packages/contracts/src/composition-intelligence.ts`
(`compositionSampleSchema`/`compositionInputSchema`/`compositionFeaturesSchema`, exported from
`packages/contracts/src/index.ts`). Its shape resolves the four decisions that needed to be locked
before a `deriveCompositionFeatures()` implementation could start without risking a later
schema-breaking change:

1. **Per-sample timestamp** — `compositionSampleSchema.t` (seconds, clip-relative), matching this
   codebase's existing `t` convention on every other sample schema (no need for a
   `timestampMs`-style field of its own).
2. **Subject identity** — `compositionSampleSchema.subjectTrackId` (nullable), reserved for the
   multi-subject extension above without a future schema break.
3. **Frame dimensions** — `compositionInputSchema.frameSize` (clip-level, nullable). `subjectBox`
   itself stays resolution-independent (already normalized `[0, 1]`); `frameSize`'s actual purpose
   is aspect-ratio-aware thresholds (portrait vs. landscape), documented explicitly as such on the
   field itself.
4. **Selection boundary** — documented on `compositionSampleSchema` and in "Primary Subject
   Selection" above: this package consumes an already-selected subject and never selects one
   itself.

**Also done:** the `packages/composition-intelligence` package itself — pure derive functions only,
depending on `@speedora/contracts` alone (no code import of `facial-intelligence`/
`object-intelligence`), 36 fixture tests passing, `pnpm typecheck`/`pnpm lint` clean:

- `calculateRuleOfThirdsScore` / `calculateCenteringScore` — geometric distance-to-target scores,
  each independently exported/testable (`calculate-rule-of-thirds.ts`, `calculate-centering.ts`).
- `calculateHeadroomScore` (`calculate-headroom.ts`) — the one function that actually reads
  `frameSize`, applying a wider portrait-orientation target range when available and degrading to
  a landscape/neutral range when it's null, exactly the "aspect-ratio-aware thresholds" use case
  the field was added for.
- `calculateLeadRoomScore` (`calculate-lead-room.ts`) — uses `facingYaw` (heading) when available;
  falls back to the subject's own recent horizontal displacement trend across nearby samples when
  it isn't, per `compositionSampleSchema.facingYaw`'s documented fallback.
- `calculateSubjectLossRatio` (`calculate-subject-loss-ratio.ts`) — the simplest of the seven, a
  plain fraction over all samples.
- `calculateCompositionStability` (`calculate-composition-stability.ts`) — computes a per-frame
  placement reading (average of thirds-closeness and centering-closeness, the two scores always
  computable whenever a `subjectBox` exists) and takes the mean absolute delta between
  ADJACENT array entries that both have one — deliberately not inverted into a `[0, 1]`
  "stability" reading, a raw magnitude where higher means more oscillation.
- `calculateFramingConsistency` (`calculate-framing-consistency.ts`) — buckets `subjectBox` area
  into a coarse close-up/medium/wide `shotType` and counts bucket flips per minute of the sample
  set's own time span; deliberately does not expose `shotType` itself as a contract field, kept as
  an internal implementation detail.
- `deriveCompositionFeatures` (`derive-composition-features.ts`) — the orchestrator, same
  `deriveXFeatures` naming convention every other signal module in this pipeline uses.

**Also done:** the rest of `ARCHITECTURE.md`'s module checklist — Composition Intelligence is now
fully wired, end to end, into production render-time code:

- **`packages/primary-subject`** — `selectPrimarySubject()`, the 5-step order above, 7 fixture
  tests passing. Own package (see "Primary Subject Selection" above for why).
- **RB-2, Fusion Engine wiring** — `composition` added to `FUSION_SIGNALS`/`fusionInputSchema`
  (`packages/contracts/src/fusion.ts`) and `DEFAULT_FUSION_WEIGHTS` at weight 0
  (`packages/fusion-engine/src/weights.ts`), plus `extractCompositionFeatures()` and per-field
  `NORMALIZERS` entries in `feature-pipeline.ts` (`subjectLossRatio` inverted, same precedent as
  `occlusionRate`; `compositionStability`/`framingConsistency` left uninverted, same precedent as
  `shakeScore`/`SPEAKER_CHANGE_CAP`). 6 new fusion-engine tests, 89/89 passing overall.
- **Adapter wiring** — `render-clip.worker.ts` calls `selectPrimarySubject()` over
  `faceLandmarks`/`activeSpeakerSamples`/`objectTracks` (all already in scope by that point in the
  handler), then `deriveCompositionFeatures()`, then persists to a new `Clip.compositionFeatures`
  `Json?` column (migration `20260710221439_add_clip_composition_intelligence`) and feeds
  `computeHighlightScore()`'s `composition` input. Always computed, never wrapped in try/catch —
  same "pure/synchronous, degrades to all-null on missing data" convention as
  `editingRhythmFeatures`, since `selectPrimarySubject`/`deriveCompositionFeatures` never throw.
  The sample-timestamp grid is a **union** of `faceLandmarks`' and `objects`' own `t` values, not
  an either-or fallback — an empty-but-present array (detection ran, found nothing) is truthy, so
  a `??` fallback would have silently discarded valid object-track data whenever face detection
  succeeded-but-found-nothing (an easy trap; the initial implementation had exactly this bug before
  a dedicated test caught it). 2 new worker tests covering both the face-sourced and
  object-track-sourced paths, 43/43 passing overall.

**Not done:**

1. Calibration via `check-calibration-coverage.ts` once production data accumulates (same gate
   every other weight-0 signal is behind).
2. Real-binary verification is not applicable here — Composition Intelligence has no subprocess of
   its own anywhere in the chain, only pure TypeScript over already-computed input.
