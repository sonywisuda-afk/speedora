import * as path from 'node:path';
import { VideoImportError } from './errors';
import { classifyNodeError } from './nodeErrorClassifier';
import type { ImportDeps } from './types';

// Filenames are always derived from deps.randomId(), never from the URL or
// any other user input - this is the module's only filesystem write, and
// this is what makes it path-traversal-safe.
export async function reserveScratchPath(deps: ImportDeps): Promise<string> {
  try {
    await deps.fs.mkdir(deps.config.scratchDir);
  } catch (error) {
    // Reclassify a recognized errno (disk-full/permission) into a category
    // the metrics/alerting/retry-decisioning layers understand; anything
    // else is rethrown as-is (generic Error, unclassified - same as before
    // this check existed).
    const category = classifyNodeError(error);
    if (category) {
      throw new VideoImportError(
        `failed to prepare scratch directory: ${error instanceof Error ? error.message : String(error)}`,
        { category, engineName: 'yt-dlp', cause: error },
      );
    }
    throw error;
  }
  return path.join(deps.config.scratchDir, `${deps.randomId()}.mp4`);
}
