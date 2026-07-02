import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Pure scratch space for render-clip - ffmpeg needs a real local file to
// seek within, and there's no way around downloading the source and
// writing the output locally first. This is not persisted storage; every
// file written here is deleted once the job finishes (success or not).
// The actual persisted files live in object storage (@viral-clip-app/storage).
const scratchDir = path.join(os.tmpdir(), 'viral-clip-app');

export async function reserveScratchPath(prefix: string, ext: string): Promise<string> {
  await mkdir(scratchDir, { recursive: true });
  return path.join(scratchDir, `${prefix}-${randomUUID()}${ext}`);
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
