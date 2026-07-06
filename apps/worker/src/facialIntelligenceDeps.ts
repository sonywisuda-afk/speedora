import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { DetectFacialEmotionDeps } from '@speedora/facial-intelligence';

const execFileAsync = promisify(execFile);

// Deployment-specific plumbing for @speedora/facial-intelligence's
// detectFacialEmotion(): which python executable to invoke, and where the
// classification script + MediaPipe model file live in this app's own
// directory/Docker layout (see CLAUDE.md's Fase 27 section) - kept here, in
// apps/worker, rather than inside the stateless module itself, same
// reasoning as faceDetectionDeps.ts/audioIntelligenceDeps.ts. Deliberately
// reuses the SAME FACE_DETECTOR_MODEL_PATH env var and default path as
// faceDetectionDeps.ts - the script shells out to needs the exact same
// MediaPipe model file face detection already downloads, so there's no
// separate model/env var to configure for this feature.
export const facialIntelligenceDeps: DetectFacialEmotionDeps = {
  execFile: execFileAsync,
  pythonPath: process.env.PYTHON_PATH ?? 'python3',
  scriptPath: path.join(__dirname, '../scripts/detect_facial_emotion.py'),
  modelPath:
    process.env.FACE_DETECTOR_MODEL_PATH ??
    path.join(__dirname, '../models/blaze_face_short_range.tflite'),
};
