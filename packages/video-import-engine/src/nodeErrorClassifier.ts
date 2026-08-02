import type { ImportFailureCategory } from '@speedora/contracts';

// Disk-full/permission failures on this module's own filesystem calls (e.g.
// scratch.ts's mkdir) never go through yt-dlp's stderr at all - they throw a
// raw Node errno error. This maps the handful of codes worth a dedicated
// category; anything else returns null so the caller can rethrow the
// original error unclassified, same as today.
export function classifyNodeError(error: unknown): ImportFailureCategory | null {
  if (!(error instanceof Error)) return null;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOSPC') return 'disk';
  if (code === 'EACCES' || code === 'EPERM') return 'permission';
  return null;
}
