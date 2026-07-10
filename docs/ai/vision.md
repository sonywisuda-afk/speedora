# Vision Intelligence

Covers everything derived from video frames: face detection/reframe, the Face Intelligence
initiative (23 sub-features across 5 batches), Gesture Intelligence, and Scene Intelligence (cut/
motion/camera-motion detection). All follow the JSON-contract module pattern (`coding-standards.md`)
and the "module throws, adapter catches" convention for Python-subprocess-backed detectors.

## Face detection & Smart Reframe (`packages/reframe`)

The foundational module — MediaPipe Face Detector (Tasks API, `.tflite` model) via a Python
subprocess (`apps/worker/scripts/detect_faces.py`), ~1 sample/sec, "most prominent face" heuristic
(largest bounding box, a proxy for "who's speaking" — not real active-speaker detection).
Produces a crop path: **position** (x/y) from face tracking, **size** (w/h) from an independent
"Auto Zoom" envelope — a punch-in triggered by emphasis words (numbers/percentages/ALL-CAPS/quoted
phrases, same pattern as caption bold-highlight) with an attack/hold/release envelope (0.15s/0.4s/
0.5s), capped at 30% zoom-in. Either signal alone produces a path (a talking-head clip with no
emphasis words still pans; a clip with no tracked face but emphasis words still zooms, centered).
Falls back to a static center-crop only when *both* are absent, or the subprocess fails for any
reason. Interpolated crop path → FFmpeg `sendcmd` script (one line per point, 0.2s step),
`crop@reframe` filter tag driven at runtime.

## Face Intelligence (`packages/facial-intelligence`)

23 sub-features from the user's original spec, delivered across 5 batches (Batch 1 = one new
MediaPipe model covering 7 features at once; Batches 2–5 mostly extend the same script/derive
functions rather than adding new subprocesses).

- **Batch 1 — FaceLandmarker** (new model, `.task` not `.tflite`): blink (`eyeBlinkLeft/Right`
  blendshapes), smile (`mouthSmileLeft/Right`), mouth-open (`jawOpen`), face rotation (Euler angles
  from the facial transformation matrix), and framing (`positionScore`/`sizeScore`/
  `visibilityScore` from landmark bounding geometry). Also collects iris points + eye-corner
  landmarks used by later batches without a second MediaPipe call.
- **Batch 2 — Eye contact / looking direction**: pure derivation from Batch 1's already-collected
  iris/rotation data (no new subprocess). Two-tier heuristic: head rotation checked first (>20°
  yaw/pitch → looking away), iris offset only consulted as a fallback when the head is roughly
  forward. `eyeContactRate` requires *both* head and eyes centered, not iris alone.
- **Batch 3 — Blur/sharpness/lighting/occlusion**: extends the Batch 1 script with OpenCV
  measurements on the same already-read frame (no second decode). Laplacian variance
  (`sharpness`) serves both "blur detection" and "sharpness score" from the original spec — one
  number, two readings. `mouthContrastRatio` (mouth-region Laplacian variance ÷ full-face
  variance) is a rough occlusion proxy — explicitly the least-confident heuristic in this module
  (a naturally still/closed mouth can also read as "occluded"; it can't distinguish the two).
- **Batch 4 — Re-identification / tracking / speaker selection**: after the user chose geometric
  descriptors over a trained face-embedding model (avoiding a heavy new ML dependency) and then
  asked for temporal tracking strength on top, this batch adds a single-object `FaceTracker`
  (Kalman filter constant-velocity model + Hungarian assignment, cost = IoU + geometric-descriptor
  distance + pose distance). `face_descriptor()` is 9 scale-invariant inter-landmark distance
  ratios — explicitly *not* a trained embedding, so re-identification accuracy is honestly lower
  than a real face-recognition model, an accepted tradeoff. `trackId` lets TypeScript derive
  `speakerChangeCount`, `dominantSpeakerConsistency` (longest unbroken run of one track ÷ total,
  not total occurrence count), and `speakerAudioSyncRate` (jaw-open activity correlated against
  `TranscriptSegment.rmsDb` — a real mouth-movement-vs-audio check, replacing Batch 1's
  largest-bounding-box heuristic).
- **Batch 4.5 — Quality/telemetry**: explicitly *not* a new scoring signal — separate schema
  (`packages/contracts/src/face-tracking-quality.ts`) and derive function
  (`deriveTrackingQualityMetrics()`), stored in its own `Clip.trackingQualityMetrics` column, never
  touched by the Fusion Engine. Answers "can this tracking be trusted" (fragmentation rate, ID
  switch count, lost-track duration, re-identification success rate, per-track breakdown) for
  debugging/auditability, not for scoring.
- **Batch 5A — Lip activity**: pure derivation from Batch 1's `jawOpen` sequence —
  `averageLipVelocity`, `speakingIntensity` (average jaw-open *among currently-speaking* samples,
  unlike `averageMouthOpen` which is dragged down by silence), `pauseCount`, `articulationRate`
  (direction-reversal count ÷ duration — a crude, non-phoneme-aware variability proxy).
- **Batch 5B — Smile & laugh**: extends the script with cheek-squint/eye-squint blendshapes
  (orbicularis-oculi markers) to distinguish a Duchenne (genuine) smile from a posed one —
  `genuineSmileRate` requires cheek-raise + eye-squint co-occurring with an active smile, an
  uncalibrated heuristic threshold, not a trained classifier.
- **Batch 5C — Blink & eye behavior**: pure derivation. `blinkFrequencyPerMinute` (event count,
  distinct from Batch 1's `blinkRate` which is a fraction-of-samples reading) and
  `prolongedClosureCount` — at this pipeline's ~1 sample/sec rate, a real ~100–400ms blink almost
  never spans 2+ consecutive samples, so a multi-sample closure run reads as a deliberate
  eyes-closed period, not a blink. `gazeStabilityScore` is the one genuinely-measured (not proxy)
  metric in this batch.
- **Batch 5D — Emotion heuristic**: combines smile + jaw/speaking + eyebrow activity (new
  blendshapes) + head-movement-rate (from Batch 1's rotation data) into `dominantAffect` via a
  deterministic decision tree. **Explicit safety constraint from the user**: output vocabulary is
  restricted to `positive_affect`/`high_energy`/`low_energy`/`expressive`/`neutral` — never a
  discrete emotion name like "happy"/"sad"/"angry" — enforced as a TypeScript union type
  (`AFFECT_LABELS`), not just a comment.

## Gesture Intelligence (`packages/gesture-intelligence`)

Mirrors Face Intelligence's structure almost exactly: a separate MediaPipe Gesture Recognizer
model/subprocess, 7-gesture taxonomy + `none` (hand detected, no matching gesture — distinct from
`null`, no hand detected at all), same raw/features split, same derive-function shape as
`deriveFacialEmotionFeatures`.

## Scene Intelligence (`packages/scene-intelligence`)

Everything ffmpeg-native (no ML model) plus one OpenCV subprocess for directional motion.

- **Cut detection** — `select='gt(scene,threshold)'`/`showinfo`, per-clip (not whole-video).
- **Cut type classification (Batch SC-1)** — a second `blackdetect` pass over the same clip range;
  a cut is `fade` if it's within 0.5s of a detected black interval, else `hard_cut`. `dissolve` is
  reserved in the enum but not yet produced — needs a frame-blend signal this pass doesn't have.
- **Motion energy (Batch SC-2)** — `fps=1,signalstats,metadata=print` (YDIF, luma difference vs.
  the previous downsampled frame — magnitude only, no direction). Drives `staticRatio`/
  `dynamicRatio` (Static/Dynamic Scene classification from the original taxonomy).
- **Directional camera motion — pan/tilt/zoom/shake (Batch SC-3)** — after weighing ffmpeg
  `vidstabdetect` (unverified availability in this project's ffmpeg build, file-based output) vs.
  Python/OpenCV, the user chose OpenCV: `apps/worker/scripts/detect_camera_motion.py` runs
  `cv2.findTransformECC` (image alignment) between consecutive ~1/sec samples, decomposes the
  affine warp into dx/dy/scale/rotation/ecc (per the user's explicit design direction, the Python
  script reports only this raw transform — classification into pan/tilt/zoom/shake is pure
  TypeScript, `deriveCameraMotionFeatures()`). Zoom is checked before pan/tilt in the
  classification priority order (a scale change is unlikely to coincidentally match a translation
  magnitude). `shakeScore` requires a sign-reversal *and* both samples in the pair clearing the
  pan/tilt threshold first, to avoid sub-threshold noise dominating the shake reading for an
  actually-static clip.
- **Motion Direction (Batch SC-4)** — not a new detector: a finer-grained read of the same dx/dy/
  scale transform Batch SC-3 already collects. `deriveCameraMotionFeatures()` resolves each
  classifiable sample's dominant axis down to a signed sub-direction (`left`/`right`/`up`/`down`/
  `in`/`out`/`static`) and majority-votes across the clip into `dominantDirection`, same counting
  approach as `dominantMotionType`. Deliberately **not** fed into the Fusion Engine — unlike
  zoom/pan/tilt-over-static, a direction alone has no obvious more-engaging-than reading, so it
  stays a descriptive/explainability field on the persisted `Clip` row (same treatment as Batch
  4.5's `trackingQualityMetrics`), not a scored feature.
- **Motion Peak Detection (Batch SC-5)** — a pure derivation over `analyzeMotionEnergy`'s existing
  samples, no new subprocess. `deriveMotionEnergyFeatures()` flags a sample as a peak when it's a
  strict local maximum among its immediate neighbors *and* clears the clip's own
  mean-plus-1.5×-stddev threshold (self-relative, since raw `motionEnergy` isn't comparable across
  different source footage). Produces `peakCount`/`peakTimestamps`/`peakRatePerMinute`;
  `peakRatePerMinute` feeds the Fusion Engine under the existing `sceneMotion` signal (still weight
  0, pending calibration like every other recent addition).
- **Motion Complexity (Batch SC-6)** — another pure derivation, split into two independently-
  optional features rather than one module-owned "complexity" score, per this pipeline's
  feature-level fusion principle (extract named features, let the Fusion Engine combine them, don't
  pre-blend). `motionEnergyFeatures.motionVariability` is the coefficient of variation (stddev /
  mean) of a clip's `motionEnergy` samples — how erratically motion magnitude swings, independent
  of its average level. `cameraMotionFeatures.motionTypeDiversity` is normalized Shannon entropy
  (0–1) over the pan/tilt/zoom/static per-sample classification counts
  `deriveCameraMotionFeatures()` already computes for `dominantMotionType` — how varied the
  camera's movement pattern is, independent of which type dominates. Both feed the Fusion Engine
  under their existing `sceneMotion`/`cameraMotion` signals (still weight 0).
- **Motion Smoothness / Camera Jitter (Batch SC-7)** — a magnitude-based complement to `shakeScore`
  (which only counts sign reversals, so a slow pan that reverses once still reads as "some shake").
  `deriveCameraMotionFeatures()` averages `|Δdx| + |Δdy|` between consecutive classifiable samples
  and maps it to `smoothnessScore` (0–1, 1 = perfectly smooth), via the same unvalidated-cap
  pattern as every other threshold in this module. Same "no calibrated view on whether this reads
  as good or bad" honesty as `shakeScore` itself — a deliberate handheld aesthetic and an unstable
  tripod both produce a low score. Feeds the Fusion Engine under the existing `cameraMotion` signal
  (still weight 0).

## Deferred / future taxonomy

- **Visual Composition** (Rule of Thirds, close-up/medium/wide shot, headroom, leading room) — no
  implementation yet; likely reuses `FaceLandmarkSample.boundingBox` for framing-related items,
  but Rule of Thirds needs a more general composition analysis not tied to face presence.
- **Editing Rhythm** is documented in `ai/fusion.md` (it's a Fusion Engine signal, not a raw
  detector — see that doc).

## Known verification gap

Every Python-subprocess-backed module here (`detectFaces`, `detectFacialEmotion`,
`detectGestures`, `detectFaceLandmarks`, `detectCameraMotion`) and every ffmpeg-stderr-parsing
module (`detectSceneCuts`, `classifySceneCutTypes`, `analyzeMotionEnergy`) has been tested only
against hand-written fixtures — the sandbox this codebase has been developed in has never had a
real `ffmpeg`/Python/model/video available. Each must be run once against real binaries/footage
before being trusted in production. See `testing.md`.
