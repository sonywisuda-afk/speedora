import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DetectSceneCutsDeps } from '@speedora/scene-intelligence';

const execFileAsync = promisify(execFile);

// Deployment-specific plumbing for @speedora/scene-intelligence's
// detectSceneCuts(): which ffmpeg binary to invoke - same FFMPEG_PATH env
// var convention as apps/worker/src/ffmpeg.ts and audioIntelligenceDeps.ts,
// kept here (not inside the stateless module itself) for the same reason
// apps/worker/src/faceDetectionDeps.ts exists.
export const sceneIntelligenceDeps: DetectSceneCutsDeps = {
  execFile: execFileAsync,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
};
