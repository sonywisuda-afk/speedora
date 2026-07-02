import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import * as path from 'node:path';

// Reuses the UPLOAD_DIR env var apps/api uses for source uploads, so there's
// one setting to point at a shared volume in production. Resolved against
// this process's own cwd (like apps/api's StorageService does), so with the
// relative local-dev default they land in different physical folders - that's
// fine, since apps/worker is the sole writer and stores the resulting
// absolute path in Clip.outputUrl for anyone else to read later.
const outputDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads', 'renders');

export async function reserveClipOutputPath(clipId: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  return path.join(outputDir, `${clipId}-${randomUUID()}.mp4`);
}

export async function reserveSrtPath(clipId: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  return path.join(outputDir, `${clipId}-${randomUUID()}.srt`);
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
