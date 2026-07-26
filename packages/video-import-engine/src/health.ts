import type { EngineHealthStatus } from './types';

// yt-dlp's version string is a plain date (YYYY.MM.DD[.revN]), which sorts
// correctly with a plain string comparison - no semver parsing needed. Only
// meaningful when both strings share that exact format (true for every real
// yt-dlp release).
export function compareVersions(current: string, minimum: string): number {
  if (current === minimum) return 0;
  return current > minimum ? 1 : -1;
}

// No live network call (no GitHub API request) in this phase - see
// ARCHITECTURE.md/docs/worker.md: yt-dlp updates happen via the manual
// yt-dlp:update script + Docker image rebuild, not an automatic runtime
// check. `minVersion` is an operator-configured "this is the oldest version
// we consider healthy" floor (YTDLP_MIN_VERSION), not a live "latest
// available" lookup.
export function evaluateHealthStatus(
  version: string | null,
  minVersion: string | null,
): EngineHealthStatus {
  if (version === null) return 'unreachable';
  if (minVersion === null) return 'healthy';
  return compareVersions(version, minVersion) >= 0 ? 'healthy' : 'stale';
}
