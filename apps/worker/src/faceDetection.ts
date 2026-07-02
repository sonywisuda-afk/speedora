import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PYTHON_PATH = process.env.PYTHON_PATH ?? 'python3';
const SCRIPT_PATH = path.join(__dirname, '../scripts/detect_faces.py');
// Downloaded at Docker build time (apps/worker/Dockerfile) from MediaPipe's
// own model zoo - the Tasks API (mediapipe.tasks.python.vision.FaceDetector)
// needs this file locally, it isn't bundled in the pip package. Local dev
// needs the same file at the same path (see README.md's prerequisites).
const MODEL_PATH =
  process.env.FACE_DETECTOR_MODEL_PATH ??
  path.join(__dirname, '../models/blaze_face_short_range.tflite');

// 1 sample/sec keeps a 60s clip (detect-clips' own upper bound) to at most
// 60 MediaPipe calls - plenty for normal head movement, and cheap next to
// the transcribe/render steps already in the pipeline. See CLAUDE.md's
// Fase 2 sampling decision.
export const FACE_SAMPLE_INTERVAL_SECONDS = 1;

export interface FaceBox {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
}

export interface FaceSample {
  // Seconds relative to the clip's own start (0 = clip start), not the
  // source video's timeline.
  t: number;
  // null when no face was detected in this sampled frame - not an error,
  // see reframe.ts's buildCropPath() fallback-to-center-crop handling.
  box: FaceBox | null;
}

// Shells out to scripts/detect_faces.py exactly like ffmpeg.ts shells out
// to the ffmpeg binary - MediaPipe's own Node.js story is WASM/browser
// oriented, not first-class server-side, while the real `mediapipe` PyPI
// package is mature and well-supported. sourcePath must be a local file
// (same constraint as ffmpeg - no seeking directly against object storage).
export async function detectFaces(
  sourcePath: string,
  startTime: number,
  endTime: number,
): Promise<FaceSample[]> {
  const { stdout } = await execFileAsync(PYTHON_PATH, [
    SCRIPT_PATH,
    sourcePath,
    startTime.toString(),
    endTime.toString(),
    FACE_SAMPLE_INTERVAL_SECONDS.toString(),
    MODEL_PATH,
  ]);
  return JSON.parse(stdout) as FaceSample[];
}
