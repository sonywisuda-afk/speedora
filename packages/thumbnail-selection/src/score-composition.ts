import type { PrimarySubjectSample } from '@speedora/contracts';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Same rule-of-thirds distance formula @speedora/composition-intelligence's
// calculate-rule-of-thirds.ts already implements, duplicated (not imported)
// - no cross-signal-package dependency, same convention as
// editing-rhythm/composition-intelligence themselves. Reused here rather
// than centering distance since rule-of-thirds is the more common
// "well-composed thumbnail" heuristic.
const THIRDS_POINTS: Array<{ x: number; y: number }> = [
  { x: 1 / 3, y: 1 / 3 },
  { x: 2 / 3, y: 1 / 3 },
  { x: 1 / 3, y: 2 / 3 },
  { x: 2 / 3, y: 2 / 3 },
];
// The farthest any point in a [0, 1] x [0, 1] frame can be from its nearest
// thirds intersection is a corner - sqrt(2)/3, a geometric fact about the
// unit square, not a tuned threshold.
const MAX_DISTANCE_TO_THIRDS_POINT = Math.sqrt(2) / 3;

function distanceToNearestThirdsPoint(xCenter: number, yCenter: number): number {
  let nearest = Infinity;
  for (const point of THIRDS_POINTS) {
    const distance = Math.hypot(xCenter - point.x, yCenter - point.y);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

// Samples with no subject box are excluded, not scored 0 - "no subject
// visible" is a true "no reading" at this instant, not a framing penalty,
// same convention as calculateRuleOfThirdsScore itself.
export function scoreComposition(samples: PrimarySubjectSample[] | null): Map<number, number> {
  const scores = new Map<number, number>();
  for (const sample of samples ?? []) {
    if (!sample.box) continue;
    const distance = distanceToNearestThirdsPoint(sample.box.xCenter, sample.box.yCenter);
    scores.set(sample.t, 1 - clamp01(distance / MAX_DISTANCE_TO_THIRDS_POINT));
  }
  return scores;
}
