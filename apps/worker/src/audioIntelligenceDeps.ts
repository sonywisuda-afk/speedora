import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AnalyzeAudioLoudnessDeps } from '@speedora/audio-intelligence';

const execFileAsync = promisify(execFile);

// Deployment-specific plumbing for @speedora/audio-intelligence's
// analyzeAudioLoudness(): which ffmpeg binary to invoke - same FFMPEG_PATH
// env var convention as apps/worker/src/ffmpeg.ts, kept here (not inside
// the stateless module itself) for the same reason
// apps/worker/src/faceDetectionDeps.ts exists - the module should never
// read process.env directly.
export const audioIntelligenceDeps: AnalyzeAudioLoudnessDeps = {
  execFile: execFileAsync,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
};
