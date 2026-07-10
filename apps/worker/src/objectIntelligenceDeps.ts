import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { DetectObjectsDeps } from '@speedora/object-intelligence';

const execFileAsync = promisify(execFile);

// Deployment-specific plumbing for @speedora/object-intelligence's
// detectObjects(): which python executable to invoke, and where the
// detection script + downloaded MediaPipe model file live in this app's
// own directory/Docker layout - same reasoning as faceDetectionDeps.ts/
// gestureIntelligenceDeps.ts. EfficientDet-Lite0 is its OWN model file, a
// different MediaPipe Task entirely from every other detector in this
// pipeline (see detect_objects.py's own module comment).
export const objectIntelligenceDeps: DetectObjectsDeps = {
  execFile: execFileAsync,
  pythonPath: process.env.PYTHON_PATH ?? 'python3',
  scriptPath: path.join(__dirname, '../scripts/detect_objects.py'),
  modelPath:
    process.env.OBJECT_DETECTOR_MODEL_PATH ??
    path.join(__dirname, '../models/efficientdet_lite0.tflite'),
};
