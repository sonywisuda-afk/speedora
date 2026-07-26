import * as path from 'node:path';
import type { ImportDeps } from './types';

// Filenames are always derived from deps.randomId(), never from the URL or
// any other user input - this is the module's only filesystem write, and
// this is what makes it path-traversal-safe.
export async function reserveScratchPath(deps: ImportDeps): Promise<string> {
  await deps.fs.mkdir(deps.config.scratchDir);
  return path.join(deps.config.scratchDir, `${deps.randomId()}.mp4`);
}
