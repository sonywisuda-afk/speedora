import {
  detectGesturesInputSchema,
  detectGesturesOutputSchema,
  type DetectGesturesInput,
  type GestureSample,
} from '@speedora/contracts';

// Re-exported for convenience - same convention as
// @speedora/facial-intelligence's `export type { FacialEmotionSample }`.
export type { GestureSample };

// 1 sample/sec, same rationale/value as face detection and facial emotion
// (detect-clips' own 60s upper bound keeps this to at most 60 classifier
// calls per clip).
export const GESTURE_SAMPLE_INTERVAL_SECONDS = 1;

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DetectGesturesDeps {
  execFile: ExecFileFn;
  pythonPath: string;
  scriptPath: string;
  // MediaPipe Gesture Recognizer's own .task model file - a SEPARATE model
  // from face detection's blaze_face_short_range.tflite (a different
  // MediaPipe Task entirely), so unlike facial-intelligence this needs its
  // own model path, not a reused one.
  modelPath: string;
}

// PENDING REAL-MACHINE VERIFICATION: same sandbox limitation as
// facial-intelligence and scene-intelligence - built without a real Python/
// MediaPipe/video environment available, so only fixture-tested here, not
// run against a real model/video. See CLAUDE.md's Fase 30 section.
//
// Shells out to deps.scriptPath exactly like reframe's detectFaces()/
// facial-intelligence's detectFacialEmotion() shell out to their own
// scripts - MediaPipe's Node story is WASM/browser-oriented, not
// server-side. input.sourcePath must be a local file (same constraint as
// every other subprocess module here).
export async function detectGestures(
  input: DetectGesturesInput,
  deps: DetectGesturesDeps,
): Promise<GestureSample[]> {
  const { sourcePath, startTime, endTime } = detectGesturesInputSchema.parse(input);

  const { stdout } = await deps.execFile(deps.pythonPath, [
    deps.scriptPath,
    sourcePath,
    startTime.toString(),
    endTime.toString(),
    GESTURE_SAMPLE_INTERVAL_SECONDS.toString(),
    deps.modelPath,
  ]);

  return detectGesturesOutputSchema.parse(JSON.parse(stdout));
}
