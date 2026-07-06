import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { DetectGesturesDeps } from '@speedora/gesture-intelligence';

const execFileAsync = promisify(execFile);

// Deployment-specific plumbing for @speedora/gesture-intelligence's
// detectGestures(): which python executable to invoke, and where the
// classification script + MediaPipe Gesture Recognizer model file live in
// this app's own directory/Docker layout (see CLAUDE.md's Fase 30 section)
// - kept here, in apps/worker, rather than inside the stateless module
// itself, same reasoning as faceDetectionDeps.ts/facialIntelligenceDeps.ts.
// Unlike facialIntelligenceDeps.ts, this uses its OWN model file/env var -
// gesture_recognizer.task is a different MediaPipe Task than face
// detection's blaze_face_short_range.tflite, not something to reuse.
export const gestureIntelligenceDeps: DetectGesturesDeps = {
  execFile: execFileAsync,
  pythonPath: process.env.PYTHON_PATH ?? 'python3',
  scriptPath: path.join(__dirname, '../scripts/detect_gestures.py'),
  modelPath:
    process.env.GESTURE_RECOGNIZER_MODEL_PATH ??
    path.join(__dirname, '../models/gesture_recognizer.task'),
};
