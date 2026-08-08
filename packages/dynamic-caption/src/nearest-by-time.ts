// Temporal nearest-neighbor by |t - targetT|, ties broken by whichever
// comes first - same shape @speedora/retention-curve-insights' and
// @speedora/subtitle-rewriter's own local copies already use for an
// unrelated signal pair each; kept as its own small local file here rather
// than a shared package - still below this codebase's "extract at 3rd
// cross-PACKAGE duplication" threshold for a 3-line helper.
export function nearestByTime<T extends { t: number }>(samples: T[], targetT: number): T | null {
  if (samples.length === 0) return null;
  return samples.reduce((nearest, sample) =>
    Math.abs(sample.t - targetT) < Math.abs(nearest.t - targetT) ? sample : nearest,
  );
}
