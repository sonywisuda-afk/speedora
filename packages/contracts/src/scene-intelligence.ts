import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

export const detectSceneCutsInputSchema = z.object({
  videoPath: z.string(),
  // Absolute source-video seconds - same convention as detectFaces'
  // startTime/endTime (packages/reframe).
  startTime: z.number(),
  endTime: z.number(),
  // ffmpeg's own "scene" score is 0-1 (higher = more different from the
  // previous frame) - optional, defaults to a conventional 0.4 inside the
  // module itself (see detect-scene-cuts.ts).
  threshold: z.number().min(0).max(1).optional(),
});

export const detectSceneCutsOutputSchema = z.object({
  // Clip-relative seconds (0 = clip start), same convention as
  // FaceSample.t (packages/reframe) - NOT absolute source-video time.
  cuts: z.array(z.number()),
});

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - the
// dense features the Fusion Engine actually consumes, computed from the raw
// `cuts` array above by @speedora/scene-intelligence's deriveSceneFeatures().
export const sceneFeaturesSchema = z.object({
  cutCount: z.number().int().nonnegative(),
  // Cuts per 60 seconds of clip duration - normalizes cut frequency across
  // clips of different lengths so it's directly comparable. Null when the
  // clip's duration is 0 (division undefined).
  cutsPerMinute: z.number().nonnegative().nullable(),
  // Mean length of the segments cuts divide the clip into (including the
  // segments before the first cut and after the last) - null when the
  // clip's duration is 0.
  averageSegmentSeconds: z.number().nonnegative().nullable(),
  // Batch SC-1 (Scene Intelligence taxonomy expansion) - breakdown of
  // cutCount by type (see SCENE_CUT_TYPES below). hardCutCount + fadeCount +
  // dissolveCount always equals cutCount. dissolveCount is always 0 for now
  // (dissolve isn't detected yet, see sceneCutEventSchema's comment) - kept
  // as its own field rather than folded into hardCutCount so this schema
  // doesn't need another migration once dissolve detection ships.
  hardCutCount: z.number().int().nonnegative(),
  fadeCount: z.number().int().nonnegative(),
  dissolveCount: z.number().int().nonnegative(),
});

export const sceneSignalSchema = intelligenceSignalSchema(z.number(), sceneFeaturesSchema);

export type DetectSceneCutsInput = z.infer<typeof detectSceneCutsInputSchema>;
export type DetectSceneCutsOutput = z.infer<typeof detectSceneCutsOutputSchema>;
export type SceneFeatures = z.infer<typeof sceneFeaturesSchema>;
export type SceneSignal = z.infer<typeof sceneSignalSchema>;

// Batch SC-1 (Scene Intelligence taxonomy expansion, requested on top of
// Fase 26's original hard-cut-only detector) - classifies each cut
// detectSceneCuts already found as a hard cut vs. a fade, via a second
// ffmpeg pass (see @speedora/scene-intelligence's classifySceneCutTypes).
// `dissolve` (a gradual cross-fade between two shots, NOT through black) is
// part of the taxonomy the user asked for but genuinely NOT detected by
// this batch - it would need a different signal (frame-blend detection)
// than the blackdetect-based fade classification implemented here.
// Reserved in the enum (not removed) so a later batch can start producing
// it without another schema change - same "declare the shape before the
// detector exists" precedent as @speedora/ocr-intelligence's category enum
// before OCR-2, or fusion-engine's weights.ts reserving `ocr`/`llm` keys
// before those modules existed.
//
// The rest of the taxonomy the user listed - Camera Pan/Tilt/Zoom/Shake,
// Motion Energy, Static/Dynamic Scene - is a SEPARATE signal (camera-motion
// classification, not cut classification: a clip can be one continuous
// shot yet still pan/zoom throughout) and isn't implemented or reserved
// here at all yet - see CLAUDE.md's Scene Intelligence Taxonomy Gap
// Analysis for the batch plan (SC-2/SC-3).
export const SCENE_CUT_TYPES = ['hard_cut', 'fade', 'dissolve'] as const;
export type SceneCutType = (typeof SCENE_CUT_TYPES)[number];

export const sceneCutEventSchema = z.object({
  // Clip-relative seconds - same convention as detectSceneCutsOutputSchema's
  // `cuts` above (this is expected to be one of those same timestamps).
  t: z.number(),
  type: z.enum(SCENE_CUT_TYPES),
});
export type SceneCutEvent = z.infer<typeof sceneCutEventSchema>;

export const classifySceneCutTypesInputSchema = z.object({
  videoPath: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  // The cuts detectSceneCuts already found for this same range - this
  // function classifies them, it doesn't re-detect cuts itself.
  cuts: z.array(z.number()),
});

export const classifySceneCutTypesOutputSchema = z.object({
  events: z.array(sceneCutEventSchema),
});

export type ClassifySceneCutTypesInput = z.infer<typeof classifySceneCutTypesInputSchema>;
export type ClassifySceneCutTypesOutput = z.infer<typeof classifySceneCutTypesOutputSchema>;

// Batch SC-2 (Scene Intelligence taxonomy expansion, continuing Batch SC-1) -
// a SEPARATE signal from cut classification above: a clip can be one
// continuous shot (zero cuts) yet still pan/zoom/shake throughout, so
// "how much is the picture moving" is measured independently of "where are
// the cuts". Covers Motion Energy and Static/Dynamic Scene from the user's
// taxonomy; Camera Pan/Tilt/Zoom/Shake (DIRECTIONAL motion) is still NOT
// covered here - see @speedora/scene-intelligence's analyzeMotionEnergy
// module comment and CLAUDE.md's Batch SC-3 plan.
export const motionEnergySampleSchema = z.object({
  // Clip-relative seconds, same convention as detectSceneCutsOutputSchema's
  // `cuts` - sampled at a fixed ~1-second cadence (not one entry per source
  // frame), same sampling philosophy as @speedora/reframe's FaceSample.
  t: z.number(),
  // Mean absolute luma difference (ffmpeg signalstats' YDIF) between this
  // sample and the previous one, 0-255 scale - a MAGNITUDE of motion, not a
  // direction (that's Batch SC-3). Not comparable across different source
  // footage (varies with resolution/content), only meaningful relative to
  // other samples within the same clip - same caveat as audio-intelligence's
  // rmsDb/peakDb.
  motionEnergy: z.number().nonnegative(),
});
export type MotionEnergySample = z.infer<typeof motionEnergySampleSchema>;

export const analyzeMotionEnergyInputSchema = z.object({
  videoPath: z.string(),
  startTime: z.number(),
  endTime: z.number(),
});

export const analyzeMotionEnergyOutputSchema = z.object({
  samples: z.array(motionEnergySampleSchema),
});

export type AnalyzeMotionEnergyInput = z.infer<typeof analyzeMotionEnergyInputSchema>;
export type AnalyzeMotionEnergyOutput = z.infer<typeof analyzeMotionEnergyOutputSchema>;

// Derived summary (see packages/contracts/src/intelligence-signal.ts) -
// computed from analyzeMotionEnergy's raw `samples` array by
// @speedora/scene-intelligence's deriveMotionEnergyFeatures(). All four
// fields null when `samples` is empty (analysis wasn't run/failed, or the
// clip had zero eligible samples) - not a fabricated 0.
export const motionEnergyFeaturesSchema = z.object({
  averageMotionEnergy: z.number().nonnegative().nullable(),
  peakMotionEnergy: z.number().nonnegative().nullable(),
  // Static/Dynamic Scene classification from the user's taxonomy - the
  // fraction of samples at/below vs. above a fixed motion-energy threshold
  // (see STATIC_DYNAMIC_THRESHOLD in derive-motion-energy-features.ts,
  // unvalidated against real footage). Always sum to 1 when non-null.
  staticRatio: z.number().min(0).max(1).nullable(),
  dynamicRatio: z.number().min(0).max(1).nullable(),
  // Batch SC-5 (Scene Intelligence taxonomy expansion, continuing SC-1..
  // SC-4) - Motion Peak Detection. A "peak" is a local-maximum sample that
  // clears the clip's own mean-plus-stddev threshold (see
  // PEAK_STDDEV_MULTIPLIER in derive-motion-energy-features.ts,
  // unvalidated against real footage, same caveat as staticRatio's own
  // threshold). `peakTimestamps` is clip-relative seconds, same convention
  // as detectSceneCutsOutputSchema's `cuts`.
  peakCount: z.number().int().nonnegative().nullable(),
  peakTimestamps: z.array(z.number()).nullable(),
  // Peaks per 60 seconds of clip duration - same normalization reasoning as
  // sceneFeaturesSchema's cutsPerMinute. Null when the clip's duration is 0
  // (division undefined), same convention as cutsPerMinute.
  peakRatePerMinute: z.number().nonnegative().nullable(),
  // Batch SC-6 (Scene Intelligence taxonomy expansion, continuing SC-1..
  // SC-5) - Motion Complexity, the motion-energy half. Coefficient of
  // variation (stddev / mean) of the clip's motionEnergy samples - "how
  // erratically motion magnitude swings over the clip", independent of its
  // average level (a clip that's uniformly high-motion has LOW
  // motionVariability; a clip alternating between static and bursty has
  // HIGH motionVariability even at the same average). Per this codebase's
  // "feature-level fusion" principle, this is reported as its own named
  // feature rather than pre-blended with cameraMotionFeatures'
  // motionTypeDiversity into one module-owned "complexity score" - see
  // deriveMotionEnergyFeatures' own comment. Null when `samples` is empty
  // or the mean is 0 (division undefined - a perfectly flat/silent clip has
  // no meaningful variability ratio, not a fabricated 0).
  motionVariability: z.number().nonnegative().nullable(),
});
export type MotionEnergyFeatures = z.infer<typeof motionEnergyFeaturesSchema>;

// Batch SC-3 (Scene Intelligence taxonomy expansion, continuing SC-1/SC-2) -
// DIRECTIONAL camera motion (Pan/Tilt/Zoom/Shake from the user's taxonomy),
// a SEPARATE signal from motionEnergy above (magnitude only, no direction).
// ffmpeg's core filters have no built-in way to estimate a frame-to-frame
// translation/scale/rotation transform, so this needs a genuinely different
// technique - after weighing ffmpeg's `vidstabdetect` (an OPTIONAL
// libvidstab component with unverified availability in this project's
// ffmpeg build, plus a file-based .trf output that would break every other
// scene-intelligence detector's "parse stderr" pattern) against Python +
// OpenCV, the user explicitly chose OpenCV's ECC (Enhanced Correlation
// Coefficient) image alignment (`cv2.findTransformECC`, `MOTION_AFFINE`) -
// no new Python dependency (cv2/numpy already installed since Batch 1 Face
// Landmarker), same subprocess pattern as detectFaces/detectFacialEmotion/
// detectGestures/detectFaceLandmarks.
//
// Per explicit user design direction: the Python script computes ONLY the
// raw per-sample transform (dx/dy/scale/rotation/ecc) - classifying that
// into pan/tilt/zoom/shake scores is @speedora/scene-intelligence's
// deriveCameraMotionFeatures()'s job (pure TypeScript), same "raw vs.
// features" split as every other module in this pipeline.
export const detectCameraMotionInputSchema = z.object({
  sourcePath: z.string().min(1),
  startTime: z.number(),
  endTime: z.number(),
});

// One entry per sampled frame (~1/sec, same cadence as every other per-clip
// subprocess signal in this pipeline). dx/dy/scale/rotation/ecc are all
// null for the FIRST sample (no previous frame to align against) and for
// any sample where ECC alignment failed to converge - "null means no
// signal, not zero", same convention as facialEmotionSampleSchema.
export const cameraMotionSampleSchema = z.object({
  t: z.number(),
  // Horizontal/vertical translation between this sample and the previous
  // one, as a FRACTION of frame width/height (not raw pixels) - normalized
  // so it's comparable across source resolutions, same reasoning as
  // FaceLandmarkFeatures' scale-invariant ratios.
  dx: z.number().nullable(),
  dy: z.number().nullable(),
  // Multiplicative scale change vs. the previous sample (1 = no zoom,
  // >1 = zoomed in since then, <1 = zoomed out).
  scale: z.number().nullable(),
  // Rotation in degrees between this sample and the previous one.
  rotation: z.number().nullable(),
  // ECC alignment's own correlation coefficient (roughly -1 to 1, higher =
  // more confident alignment) - NOT a claim about which motion type
  // occurred, just how much to trust this sample's dx/dy/scale/rotation.
  ecc: z.number().nullable(),
});

export const detectCameraMotionOutputSchema = z.array(cameraMotionSampleSchema);

export type DetectCameraMotionInput = z.infer<typeof detectCameraMotionInputSchema>;
export type CameraMotionSample = z.infer<typeof cameraMotionSampleSchema>;

export const CAMERA_MOTION_TYPES = ['pan', 'tilt', 'zoom', 'shake', 'static'] as const;
export type CameraMotionType = (typeof CAMERA_MOTION_TYPES)[number];

// Batch SC-4 (Scene Intelligence taxonomy expansion, continuing SC-1/SC-2/
// SC-3) - Motion Direction. NOT a new signal or a new subprocess: it's a
// finer-grained read of the SAME dx/dy/scale transform detectCameraMotion
// already produces (dominantMotionType above answers "is this a pan?",
// dominantDirection answers "which way?"). Reserved as its own enum (not
// folded into CAMERA_MOTION_TYPES) because "static" is shared with the axis
// enum above but the two are semantically different: CameraMotionType is an
// AXIS (pan/tilt/zoom/shake/static), CameraMotionDirectionType is a SIGNED
// SUB-DIRECTION along whichever axis won (pan -> left/right, tilt -> up/
// down, zoom -> in/out) - "shake" has no coherent single direction so it's
// deliberately absent from this enum (see deriveCameraMotionFeatures'
// classifyDirection comment for what happens to a shake-dominant clip's
// dominantDirection value).
export const CAMERA_MOTION_DIRECTION_TYPES = [
  'left',
  'right',
  'up',
  'down',
  'in',
  'out',
  'static',
] as const;
export type CameraMotionDirectionType = (typeof CAMERA_MOTION_DIRECTION_TYPES)[number];

// Derived summary (see packages/contracts/src/intelligence-signal.ts) -
// computed from detectCameraMotion's raw samples above by
// @speedora/scene-intelligence's deriveCameraMotionFeatures(). All fields
// null when there were zero classifiable samples (analysis wasn't run/
// failed, or every sample failed to align) - not a fabricated 0.
export const cameraMotionFeaturesSchema = z.object({
  // Fraction of classifiable samples whose dominant motion was pan/tilt/
  // zoom respectively (see deriveCameraMotionFeatures' own thresholds,
  // unvalidated against real footage).
  panScore: z.number().min(0).max(1).nullable(),
  tiltScore: z.number().min(0).max(1).nullable(),
  zoomScore: z.number().min(0).max(1).nullable(),
  // Fraction of consecutive classifiable-sample pairs whose dx/dy reversed
  // sign - a proxy for erratic back-and-forth motion, distinct from
  // sustained panning/tilting. Coarse at this pipeline's ~1 sample/second
  // cadence (real handheld shake typically oscillates faster than 1Hz) -
  // documented honestly, same "kejujuran skala" as every other proxy metric
  // in this codebase.
  shakeScore: z.number().min(0).max(1).nullable(),
  dominantMotionType: z.enum(CAMERA_MOTION_TYPES).nullable(),
  // Batch SC-4 - majority-vote sub-direction across classifiable samples,
  // same counting approach as dominantMotionType above. Deliberately NOT
  // fed into the Fusion Engine (see extractCameraMotionFeatures' own
  // comment) - direction has no obvious "more of this = more engaging"
  // ordinal reading the way zoom/pan/tilt-over-static does, so this stays a
  // descriptive/explainability field only, same treatment as Batch 4.5's
  // trackingQualityMetrics.
  dominantDirection: z.enum(CAMERA_MOTION_DIRECTION_TYPES).nullable(),
  // Batch SC-6 (Scene Intelligence taxonomy expansion, continuing SC-1..
  // SC-5) - Motion Complexity, the camera-motion half. Normalized Shannon
  // entropy (0-1, divided by log2(4)) over the per-sample pan/tilt/zoom/
  // static classification counts deriveCameraMotionFeatures already
  // computes for dominantMotionType/shakeScore - "how varied the camera's
  // movement pattern is" (0 = every sample classified the same way, 1 =
  // evenly spread across all four categories), independent of WHICH type
  // dominates. Companion to motionEnergyFeatures' motionVariability - see
  // that field's own contract comment for why these stay two separate
  // features instead of one blended "complexity" score. Null when there
  // are zero classifiable samples, same convention as every other field
  // here.
  motionTypeDiversity: z.number().min(0).max(1).nullable(),
  // Batch SC-7 (Scene Intelligence taxonomy expansion, continuing SC-1..
  // SC-6) - Motion Smoothness (Camera Jitter). A MAGNITUDE-based
  // complement to shakeScore above (which only counts sign reversals, so a
  // slow, smooth pan that happens to reverse direction once still reads as
  // "some shake") - averages |dx delta| + |dy delta| between consecutive
  // classifiable samples and maps it to 0-1 (1 = perfectly smooth, 0 =
  // maximally jittery), see JITTER_CAP in derive-camera-motion-features.ts,
  // unvalidated against real footage. Same "no calibrated view on whether
  // this reads as good or bad" honesty as shakeScore's own comment - a
  // deliberate handheld aesthetic and an unstable tripod both produce a low
  // smoothnessScore. Null when fewer than two classifiable samples (no
  // consecutive pair to compare).
  smoothnessScore: z.number().min(0).max(1).nullable(),
});
export type CameraMotionFeatures = z.infer<typeof cameraMotionFeaturesSchema>;
