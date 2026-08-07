import type { GroundedFact, ObjectTrack, OcrTextTrack } from '@speedora/contracts';

// Caps how much evidence one event carries - a clip busy with on-screen
// text/objects shouldn't balloon a single event's payload; the closest,
// most relevant facts to `t` are kept, not just the first N found. Not
// derived from any real data, same "reasonable, documented default" as
// every other cap in this pipeline (e.g. hook-prediction's
// NUMERIC_FACT_SATURATION_COUNT).
const MAX_EVIDENCE_PER_EVENT = 3;

interface Candidate {
  fact: GroundedFact;
  distance: number;
}

function overlaps(
  trackStart: number,
  trackEnd: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  return trackStart < windowEnd && windowStart < trackEnd;
}

function trackMidpoint(start: number, end: number): number {
  return (start + end) / 2;
}

// Looks up which already-computed OcrTextTrack/ObjectTrack entries were on
// screen concurrently with `t` (within `windowSeconds` on either side) -
// pure, synchronous, no LLM/DB access. `t` and every track's start/end are
// expected in the SAME clip-relative clock (0 = clip start). Deduplicates
// by (source, text) - the same on-screen element sampled into multiple
// nearby tracks shouldn't count as separate evidence - and caps at
// MAX_EVIDENCE_PER_EVENT, keeping the facts closest to `t` first.
export function findConcurrentEvidence(
  t: number,
  windowSeconds: number,
  ocrTracks: OcrTextTrack[],
  objectTracks: ObjectTrack[],
): GroundedFact[] {
  const windowStart = t - windowSeconds;
  const windowEnd = t + windowSeconds;

  const candidates: Candidate[] = [];

  for (const track of ocrTracks) {
    if (!overlaps(track.startTime, track.endTime, windowStart, windowEnd)) continue;
    const midpoint = trackMidpoint(track.startTime, track.endTime);
    candidates.push({
      fact: { source: 'ocr', text: track.text, t: midpoint },
      distance: Math.abs(midpoint - t),
    });
  }

  for (const track of objectTracks) {
    if (!overlaps(track.startTime, track.endTime, windowStart, windowEnd)) continue;
    const midpoint = trackMidpoint(track.startTime, track.endTime);
    candidates.push({
      fact: { source: 'object', text: track.category, t: midpoint },
      distance: Math.abs(midpoint - t),
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);

  const seen = new Set<string>();
  const results: GroundedFact[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.fact.source}:${candidate.fact.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate.fact);
    if (results.length >= MAX_EVIDENCE_PER_EVENT) break;
  }

  return results;
}
