import { existsSync } from 'node:fs';
import * as path from 'node:path';

// Shared by all three yt-dlp-*.ts scripts below. Not part of
// @speedora/video-import-engine (that package never reads process.env or
// touches the filesystem for its own binary path - see its config.ts) -
// this is deploy-tooling, run manually, never by the running worker process.
const BIN_DIR = path.resolve(__dirname, '../../bin');
export const YTDLP_BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
export const YTDLP_LOCAL_PATH = path.join(BIN_DIR, YTDLP_BIN_NAME);

// Same precedence VideoImportEngineConfig.binaryPath would resolve to at
// runtime (YTDLP_PATH env override first), but additionally prefers a
// locally-managed binary at apps/worker/bin/ over a bare "yt-dlp" PATH
// lookup - the whole point of yt-dlp:update is to have somewhere to put the
// binary it fetches.
export function resolveYtDlpBinaryPath(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (existsSync(YTDLP_LOCAL_PATH)) return YTDLP_LOCAL_PATH;
  return 'yt-dlp';
}
