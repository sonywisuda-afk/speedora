import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { DetectFacesDeps } from '@speedora/reframe';
import { limitExecFile } from './subprocessLimiter';

const execFileAsync = limitExecFile(promisify(execFile));

// Deployment-specific plumbing for @speedora/reframe's detectFaces(): which
// python executable to invoke, and where the detection script + downloaded
// MediaPipe model file live in this app's own directory/Docker layout (see
// CLAUDE.md's Fase 2 section) - kept here, in apps/worker, rather than
// inside the stateless module itself, which should never need to know
// about apps/worker's specific file layout. Lives at this same directory
// depth apps/worker/src/faceDetection.ts used to (pre-migration) so
// __dirname still resolves scripts/models the same way.
//
// Visual Emphasis Engine Phase C2 (docs/ai/visual-emphasis-engine.md, ADR
// DC3/Tech Debt #1) retired this file's only call site -
// render-clip.worker.ts's buildReframePlan() now derives its crop-path
// subject from the render graph's own primarySubjectSamples (Composition
// Intelligence's selectPrimarySubject() chain) instead of running a
// second, disconnected MediaPipe Face Detector subprocess. Left in place
// deliberately rather than deleted: audioIntelligenceDeps.ts/
// cameraMotionDeps.ts/facialIntelligenceDeps.ts/gestureIntelligenceDeps.ts/
// objectIntelligenceDeps.ts/ocrIntelligenceDeps.ts/sceneIntelligenceDeps.ts
// all reference this file by name in their own comments as the pattern
// they followed, and @speedora/reframe's own detectFaces()/face-detection.ts
// remain a real, independently-tested library function - a future feature
// needing a standalone MediaPipe Face Detector call again would reuse this
// adapter rather than reinvent it.
export const faceDetectionDeps: DetectFacesDeps = {
  execFile: execFileAsync,
  pythonPath: process.env.PYTHON_PATH ?? 'python3',
  scriptPath: path.join(__dirname, '../scripts/detect_faces.py'),
  modelPath:
    process.env.FACE_DETECTOR_MODEL_PATH ??
    path.join(__dirname, '../models/blaze_face_short_range.tflite'),
};
