# Object Intelligence

Everything about *individual entities in the frame* — people, vehicles, products, animals, everyday
objects — as opposed to `scene-intelligence` (global scene/camera characteristics: motion energy,
camera motion, cuts) or `facial-intelligence`/`gesture-intelligence` (face- and hand-specific
signals). A deliberately **separate package** (`packages/object-intelligence`) rather than an
extension of `scene-intelligence`, per explicit user architectural direction: `scene-intelligence`
stays about the whole frame/camera; `object-intelligence` owns detection, tracking, and per-object
behavioral features for individual entities.

User's original taxonomy for this initiative: `objectCount`, `dominantObject`, `objectMotionSpeed`,
`objectMotionDirection`, `objectInteraction`, `objectPersistence`, `objectEntryExit`,
`objectOcclusion`, `objectTrackingConfidence`, `objectAttentionScore` — split across batches by how
much new detector work each needs (see the roadmap table below).

## Detector choice — why MediaPipe over YOLOv8

**YOLOv8/Ultralytics was ruled out**, not on technical merit but licensing: its code and models are
AGPL-3.0, which for a commercial SaaS product means either open-sourcing the entire codebase or
buying an Ultralytics Enterprise license. MediaPipe's Object Detector (EfficientDet-Lite0, pretrained
on the 80-class COCO taxonomy) is Apache 2.0 and already the exact ecosystem this codebase uses for
every other vision detector (Face Detector, Face Landmarker, Gesture Recognizer) — same subprocess/
`.tflite` pattern, zero new Python dependency. User confirmed: use all 80 COCO categories as-is, no
filtering or fine-tuning for now.

## Batch OI-1 — Foundation (detector + multi-object tracker)

- **Detection** (`apps/worker/scripts/detect_objects.py`, `packages/object-intelligence/src/
  detect-objects.ts`) — one MediaPipe subprocess call per clip, 1 sample/sec (same cadence as every
  other per-clip signal), returns `{ t, objects: [{ category, boundingBox, confidence }] }[]`. A
  frame can have multiple simultaneous objects, same reasoning as OCR's multiple text blocks per
  frame — an ARRAY per sample, unlike Face/Gesture (at most one measurement per sample). Bounding
  boxes are converted from MediaPipe's native absolute-pixel coordinates to this pipeline's
  normalized `[0, 1]` xCenter/yCenter/width/height convention inside the script itself.
- **Tracking** (`track-objects.ts`) — pure TypeScript, entirely post-hoc over the already-collected
  samples (no changes to the Python script). **Generalizes `ocr-intelligence`'s `trackOcrText()`**,
  not Face Intelligence's Kalman-filter tracker — Face's tracker only ever follows a single most-
  prominent face (a literal 1×1 Hungarian assignment each frame), while OCR's greedy lowest-cost-
  first assignment already solves the real N-active-tracks-vs-M-detections-per-frame problem this
  needs. The one difference from OCR's cost function: **category is a hard gate**, not a weighted
  cost term (a "car" detection must never merge into a "person" track) — IoU alone decides the match
  cost among same-category candidates. `MAX_MISS_SAMPLES` (2, vs. OCR's 1) tolerates a slightly
  longer occlusion gap, since a moving/occluded object is more likely to have a brief real detection
  gap than static on-screen text.
- **Features** (`derive-object-features.ts`) — aggregates tracks into `objectCount` (distinct
  tracks), `dominantObject` (most frequent category, weighted by `appearsFrames`, same convention as
  OCR's `dominantTextCategory`), `averageObjectsPerFrame` (density), `averageTrackingConfidence`,
  `averagePersistence`. `objectPersistence` and `objectEntryExit` from the original taxonomy don't
  need a separate features-layer field at all — they're `ObjectTrack.persistenceScore` and
  `.startTime`/`.endTime`, already present on every track for free.
- **Storage**: `Clip.objects`/`.objectTracks`/`.objectFeatures` (three nullable `Json` columns),
  same three-layer "raw/tracks/features" pattern as `ocrText`/`ocrTracks`/`ocrFeatures`. Both
  `objectTracks`/`objectFeatures` are null exactly when `objects` is null (total analysis failure).
- **Fusion Engine**: wired in at weight 0 (`object` in `FUSION_SIGNALS`/`DEFAULT_FUSION_WEIGHTS`),
  same "collect first, calibrate later" treatment as `sceneMotion`/`cameraMotion`/`gesture`/
  `faceGeometry`. `averageObjectsPerFrame`/`averageTrackingConfidence`/`averagePersistence` are
  extracted; `dominantObject` and `objectCount` are deliberately **not** — COCO's 80 categories have
  no defensible ordinal "more engaging" ranking the way OCR's 6-category `OCR_CATEGORY_WEIGHT` table
  does, and a raw count isn't duration-comparable across clips (`averageObjectsPerFrame` already
  covers that).

## Batch OI-2 — Motion (objectMotionSpeed / objectMotionDirection)

No new detector or subprocess — a pure extension of `track-objects.ts`/`derive-object-features.ts`
over data OI-1 already collects, same "extend, don't rebuild" pattern the Motion Intelligence
batches (SC-4 through SC-7) proved works. No new DB migration either (both fields live inside the
existing `objectTracks`/`objectFeatures` `Json` columns).

- **`ObjectTrack.motionSpeed`** — average frame-to-frame bounding-box-center movement across a
  track's own appearances, normalized to `[0, 1]` via a new `OBJECT_MOTION_CAP` constant. Same
  shape and same normalize-at-derive-time convention as `ocr-intelligence`'s `track-ocr-text.ts`
  `motionScore`. Null when the track only appeared in a single frame.
- **`ObjectTrack.motionDirection`** — net movement direction from the track's first to last
  appearance, classified with the same zoom-then-pan/tilt priority logic as
  `scene-intelligence`'s `deriveCameraMotionFeatures()`. **Reuses `CameraMotionDirectionType`
  directly** rather than defining a near-duplicate enum — the taxonomy is genuinely the same
  concept (screen-space movement plus toward/away-from-camera, where a shrinking/growing bounding
  box is an object's analog of camera zoom in/out). A NET first-to-last comparison, not a
  per-appearance-pair majority vote like camera motion's `dominantDirection` — a single tracked
  object's overall displacement is the more natural read here.
- **`ObjectFeatures.averageMotionSpeed`** — mean `motionSpeed` across tracks that have a
  computable value (single-appearance tracks are excluded, not treated as 0). Wired into the
  Fusion Engine under the existing `object` signal (still weight 0) — "more movement among tracked
  objects = more dynamic footage" is a defensible ordinal reading, same reasoning `sceneMotion`'s
  `averageMotionEnergy`/`peakRatePerMinute` already carry.
- **`motionDirection` is deliberately NOT scored** — same reasoning as `dominantObject`
  (OI-1) and camera motion's `dominantDirection`: no defensible "which direction is more engaging"
  ordinal ranking. Stays descriptive/explainability-only.

## Batch OI-3 — Occlusion (objectOcclusion)

Same "extend, don't rebuild" story again: no new detector/subprocess, no new DB migration
(`occlusionScore` lives inside the existing `objectTracks` `Json` column, `averageOcclusionScore`
inside `objectFeatures`). The one real difference from OI-1/OI-2: this is the first Object
Intelligence feature that needs to look ACROSS simultaneous objects within the same frame, not just
along a single track's own appearances over time.

- **`ObjectTrack.occlusionScore`** — for every appearance of a track, the highest IoU between that
  track's detection and any OTHER detection present in the SAME sampled frame (any category — a
  person can occlude another person just as easily as a car can occlude a person, unlike
  `trackObjects()`'s own category hard-gate for continuing a track match). The per-track value is
  the average of this across all of the track's own appearances. An honest PROXY for occlusion, not
  a real depth/z-order signal — same "coarse proxy, not ground truth" caveat as
  `facial-intelligence`'s `mouthContrastRatio`: two overlapping bounding boxes doesn't prove one is
  actually behind the other, only that they're close together in the frame. **Never null** — every
  track has at least one appearance, and a frame with no other objects simply scores `0` for that
  appearance (a real "not occluded", not "unknown").
- **`ObjectFeatures.averageOcclusionScore`** — mean `occlusionScore` across all tracks (never
  excluded, unlike `averageMotionSpeed` — `occlusionScore` itself is never null per-track). Wired
  into the Fusion Engine under the existing `object` signal (still weight 0) with an explicit
  "polarity unproven" honesty note — same treatment as camera motion's `shakeScore`/
  `smoothnessScore`: high occlusion could mean cluttered/busy footage (a negative) or a naturally
  crowded, socially engaging scene (a positive), so it's collected and scored anyway but not
  claimed to point either direction pending real engagement data.

## Batch OI-4 — Interaction (objectInteraction, exposed as `interactionConfidence`)

The one batch flagged from the start as needing a real design pass, not a mechanical extension —
"interaction" has no single obvious computable proxy the way occlusion (IoU) or motion (centroid
delta) did. Resolved via explicit user direction (given mid-implementation, after an initial
proximity-only draft) into a **named, honestly-scoped composite**: no new detector/subprocess, no
new DB migration (same as every prior batch), but a deliberately different exposure than
`occlusionScore`/`motionSpeed` — the field is `interactionConfidence`, not `interactionScore`, to
avoid implying this pipeline can determine that two entities are ACTUALLY interacting. It has no
depth estimation, pose estimation, or action recognition; this number is a confidence/likelihood
that interaction is *plausible*, built entirely from geometry and timing already available.

- **`ObjectTrack.interactionConfidence`** — an unweighted mean of three independent `[0, 1]`
  components, each computed in `track-objects.ts`:
  1. **Proximity** — closeness (`1 − normalized center distance`, via `INTERACTION_DISTANCE_CAP`)
     to the nearest other simultaneous detection, averaged per appearance. Deliberately a
     *different* geometric measure from `occlusionScore`'s IoU — two people standing close and
     talking score meaningfully above 0 here while scoring exactly 0 on occlusion (no box overlap).
  2. **Temporal co-presence** — what fraction of this track's own screen time overlaps with the
     track it shares the *most* screen time with. Two objects that coexist on screen for a long
     stretch read as more plausibly interacting than two that each flash by separately, independent
     of how physically close they were.
  3. **Distance trend ("convergence")** — whether this track's own nearest-neighbor distance is
     shrinking or growing across its appearances (first-half vs. second-half average). Reuses the
     exact same per-appearance nearest-distance series proximity is computed from — no extra
     detection work. Deliberately does NOT require the nearest neighbor to be the *same* other track
     every appearance (no per-appearance neighbor-identity bookkeeping exists) — a coarser signal
     than true pairwise convergence, documented as such. `0.5` (neutral) when fewer than 2
     appearances have another object present at all, not `null` — keeps every component a plain
     number for the average.
  - Computed in a **separate pass after every track is otherwise fully built** (unlike
    `occlusionScore`, computed inline during the main tracking loop) — temporal co-presence needs
    every *other* track's finished start/end time, which isn't available mid-loop.
- **`ObjectFeatures.averageInteractionConfidence`** — mean across all tracks (never excluded, same
  as `averageOcclusionScore`). Wired into the Fusion Engine under the existing `object` signal
  (still weight 0), same "uncalibrated heuristic, polarity unproven" honesty as `occlusionScore`,
  made even more explicit given this one has no depth/pose/action-recognition grounding at all.

## Batch OI-5 — Attention (`objectAttentionScore`, exposed with a separate `objectAttentionConfidence`)

No new detector or subprocess — a pure derivation extending `track-objects.ts`/
`derive-object-features.ts` over data OI-1 through OI-4 already collect. Redesigned mid-implementation
by explicit user direction, the same "corrected after an initial draft" pattern OI-4 went through: an
initial flat, unweighted five-way average (size, centrality, persistence, motion, visibility) was
discarded before it shipped, in favor of an internal **"fusion within Object Intelligence"** — the same
weighted, layered shape the top-level Fusion Engine itself uses, applied one level down:

```
Detection → Tracking → Motion → Occlusion → Interaction
  → [Visibility, Activity, Social] → Object Attention
```

Three intermediate, independently-explainable **domains**, each an unweighted mean of already-computed
(or newly, cheaply derived) `[0, 1]` ingredients, computed in `track-objects.ts`:

- **Visibility** — `average(confidence, persistenceScore, 1 − occlusionScore)`. "How much and how
  clearly was this object actually on screen." Always computable.
- **Activity** — `average(motionSpeed, motionPersistence, directionConsistency)` over whichever of the
  three are available; `0.5` (neutral, not `null`) for a single-appearance track with none of them —
  same "insufficient history → neutral" convention `convergenceScore` (OI-4) already established, so
  the three-domain average downstream always has a real number to work with.
  - **`motionPersistence`** (new) — fraction of this track's own consecutive-appearance steps that
    counted as "moving" (centroid delta at/above the same `OBJECT_PAN_TILT_THRESHOLD` gate
    `motionDirection` uses). A genuinely different read from `motionSpeed`'s average magnitude: a track
    that darts-stops-darts-stops has a similar average speed to one that drifts continuously, but much
    lower persistence.
  - **`directionConsistency`** (new) — average cosine similarity between consecutive nonzero
    displacement vectors, rescaled from `[−1, 1]` to `[0, 1]`. A track moving right-then-left-then-right
    nets out near-static by `motionDirection`'s first-to-last read, but scores low here. `null` (not
    fabricated) with fewer than two nonzero displacement steps.
- **Social** — `average(interactionConfidence, partnerScore, coPresenceScore)`. Always computable —
  `interactionConfidence` is never null, `partnerScore`/`coPresenceScore` are real numbers (`0` when
  nothing else was ever nearby, a real "alone in frame").
  - **`partnerScore`** (new) — count of *distinct* other tracks this track ever shared a sampled frame
    with at close range (center distance under `INTERACTION_DISTANCE_CAP`), normalized via
    `PARTNER_COUNT_CAP` (3). The one Social ingredient that needs raw per-appearance data (timestamp +
    box) rather than a track's summarized start/end time — "was near" is a per-moment question.
  - **`coPresenceScore`** — the *same* `temporalOverlapScore` value OI-4's `interactionConfidence`
    already computes, reused (not recomputed) as its own explicit Social-domain ingredient.

`objectAttentionScore = average(visibilityScore, activityScore, socialScore)` — a "domain of domains"
composite, deliberately not a flat average over five-plus raw signals. Each domain answers one clear
question, so the final score reads as "how did this object do across three questions", not an opaque
blend of unrelated numbers — the explicit reason the user requested the redesign ("jauh lebih mudah
dijelaskan" — much easier to explain).

- **`ObjectTrack.attentionScore`** — the composite above, never `null` (every domain is always
  computable for any track).
- **`ObjectTrack.attentionConfidence`** — a **separate** reliability signal, not a sixth ingredient
  folded into the score. Mirrors the distinction Speaker Intelligence's `speakerConfidenceScoreSchema`
  already draws between "what is the score" and "how much do we trust it": a track backed by a single
  frame can still score high on `attentionScore` purely from geometry (large, centered, briefly alone),
  but that reading rests on almost no observation. `clamp01(appearsFrames / CONFIDENCE_FRAME_CAP)` —
  deliberately frame-count-based, not `persistenceScore`-based, since a 3-frame track represents the
  same ~3 seconds of real observation whether the clip has 5 total samples or 500, while
  `persistenceScore` would swing wildly between those two clips for identical evidence.
- **`ObjectFeatures.averageAttentionScore` / `averageAttentionConfidence`** — mean across all tracks
  (never excluded, same as `averageOcclusionScore`/`averageInteractionConfidence`). Wired into the
  Fusion Engine under the existing `object` signal (still weight 0). `averageAttentionConfidence` is
  extracted under the **shared `peakConfidence` feature name** (not a new one) — the same name
  facial/gesture's own classifier-certainty features use — so it participates in
  `computeHighlightScore()`'s overall confidence/quality calculation the same way, once `object`'s
  weight ever moves off 0, rather than only ever being a normal weighted feature.

## Explicitly out of scope

- **Upgrading Face Detection/Face Intelligence to genuine multi-face tracking.** Object
  Intelligence's tracker is multi-object from day one (see above), but Face Detection's own
  single-most-prominent-face limitation is untouched — it has real ripple effects (Smart Reframe's
  crop logic picks one face; 23 already-shipped Face Intelligence sub-features assume one face per
  sample), so it's a separate, larger initiative if ever wanted, not bundled into this one.
- **Custom/fine-tuned object categories beyond COCO-80** — explicit user choice to use the model
  as-is for now.
- **Real ffmpeg/MediaPipe/model-binary verification** — same known sandbox gap as every other vision
  module in this pipeline (see `ai/vision.md`'s "Known verification gap"); `detect_objects.py` is
  fixture-tested only, never run against a real model/video.
