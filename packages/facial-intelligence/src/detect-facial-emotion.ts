import {
  detectFacialEmotionInputSchema,
  detectFacialEmotionOutputSchema,
  type DetectFacialEmotionInput,
  type FacialEmotionSample,
} from '@speedora/contracts';

// Re-exported for convenience - callers importing detectFacialEmotion from
// this module can also get its result type from the same import, same
// convention as @speedora/reframe's `export type { FaceSample }`.
export type { FacialEmotionSample };

// 1 sample/sec, same rationale and same value as @speedora/reframe's
// FACE_SAMPLE_INTERVAL_SECONDS - detect-clips' own upper bound (60s) keeps
// this to at most 60 classifier calls per clip.
export const FACIAL_EMOTION_SAMPLE_INTERVAL_SECONDS = 1;

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DetectFacialEmotionDeps {
  execFile: ExecFileFn;
  // Same deployment-plumbing reasoning as @speedora/reframe's
  // DetectFacesDeps: which python executable to invoke and where the
  // classification script lives are apps/worker deployment concerns (Docker
  // image layout, PYTHON_PATH env var), not something this stateless module
  // should resolve itself via __dirname/process.env. The adapter
  // (apps/worker/src/facialIntelligenceDeps.ts) computes and injects these.
  //
  pythonPath: string;
  scriptPath: string;
  // The script reuses face detection's own MediaPipe model file (to crop
  // to the most prominent face before classifying it) - same field name/
  // shape as @speedora/reframe's DetectFacesDeps.modelPath. The
  // classification model itself is loaded by HuggingFace model id via
  // transformers' pipeline() (see the script's own module comment), so
  // there's no second model file path to inject here.
  modelPath: string;
}

// PENDING REAL-MACHINE VERIFICATION: this was built in a sandbox with
// neither Python nor a real video file available, so the subprocess call
// itself and its JSON stdout shape are only exercised against a
// hand-written fixture string in this module's own test, not a real script
// run. See CLAUDE.md's Fase 27 section and the script's own module comment
// for the specific model/library choices this parser assumes.
//
// Shells out to deps.scriptPath exactly like reframe's detectFaces() shells
// out to detect_faces.py - transformers' image-classification pipeline is
// Python-first, no maintained Node equivalent (same reasoning as vocal
// emotion detection, Fase 13). input.sourcePath must be a local file (same
// constraint as ffmpeg/MediaPipe - no seeking directly against object
// storage).
export async function detectFacialEmotion(
  input: DetectFacialEmotionInput,
  deps: DetectFacialEmotionDeps,
): Promise<FacialEmotionSample[]> {
  const { sourcePath, startTime, endTime } = detectFacialEmotionInputSchema.parse(input);

  const { stdout } = await deps.execFile(deps.pythonPath, [
    deps.scriptPath,
    sourcePath,
    startTime.toString(),
    endTime.toString(),
    FACIAL_EMOTION_SAMPLE_INTERVAL_SECONDS.toString(),
    deps.modelPath,
  ]);

  return detectFacialEmotionOutputSchema.parse(JSON.parse(stdout));
}
