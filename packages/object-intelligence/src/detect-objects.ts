import {
  detectObjectsInputSchema,
  detectObjectsOutputSchema,
  type DetectObjectsInput,
  type ObjectSample,
} from '@speedora/contracts';

// Re-exported for convenience - same convention as
// @speedora/gesture-intelligence's `export type { GestureSample }`.
export type { ObjectSample };

// 1 sample/sec, same rationale/value as every other per-clip subprocess
// signal in this pipeline (face detection, facial emotion, gestures,
// camera motion).
export const OBJECT_SAMPLE_INTERVAL_SECONDS = 1;

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DetectObjectsDeps {
  execFile: ExecFileFn;
  pythonPath: string;
  scriptPath: string;
  // MediaPipe Object Detector's own .tflite model file (EfficientDet-Lite0)
  // - a SEPARATE model from every other detector in this pipeline (a
  // different MediaPipe Task entirely), same "own model, own path"
  // reasoning as @speedora/gesture-intelligence's modelPath.
  modelPath: string;
}

// PENDING REAL-MACHINE VERIFICATION: same sandbox limitation as every other
// MediaPipe-based detector in this pipeline - built without a real Python/
// MediaPipe/video environment available, so only fixture-tested here, not
// run against a real model/video. See docs/ai/vision.md's "Known
// verification gap" section.
//
// Shells out to deps.scriptPath exactly like every other MediaPipe-based
// detector here - MediaPipe's Node story is WASM/browser-oriented, not
// server-side. input.sourcePath must be a local file (same constraint as
// every other subprocess module here). Raw detection only - no tracking
// (that's trackObjects()'s job, entirely in TypeScript over these already-
// collected samples, same "detection vs. tracking" split as
// @speedora/ocr-intelligence's detectOcrText()/trackOcrText()).
export async function detectObjects(
  input: DetectObjectsInput,
  deps: DetectObjectsDeps,
): Promise<ObjectSample[]> {
  const { sourcePath, startTime, endTime } = detectObjectsInputSchema.parse(input);

  const { stdout } = await deps.execFile(deps.pythonPath, [
    deps.scriptPath,
    sourcePath,
    startTime.toString(),
    endTime.toString(),
    OBJECT_SAMPLE_INTERVAL_SECONDS.toString(),
    deps.modelPath,
  ]);

  return detectObjectsOutputSchema.parse(JSON.parse(stdout));
}
