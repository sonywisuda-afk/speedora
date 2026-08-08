import type { ModalitySource, MultimodalEvidence } from '@speedora/contracts';

// How far outside a transcript segment's own [start, end) span other evidence may fall and still
// count as belonging to that segment's group - a small, documented tolerance (ADR D4 - not derived
// from any real data), not a second arbitrary sliding window: the GROUP is still anchored on a real
// structural unit (the transcript segment), this only forgives a gesture/emotion/cut firing a beat
// before/after the exact word timing. Deliberately smaller than semantic-events'
// GROUNDING_WINDOW_SECONDS=2 (that window has no anchor segment to lean on at all).
const SEGMENT_EVIDENCE_PADDING_SECONDS = 0.5;

// Caps how much same-modality evidence one group carries, same reasoning/precedent as
// find-concurrent-evidence.ts's MAX_EVIDENCE_PER_EVENT - a clip busy with on-screen text/objects
// shouldn't balloon one group's prompt payload; the closest items to the segment's own midpoint are
// kept.
const MAX_EVIDENCE_PER_MODALITY_PER_GROUP = 3;

// A candidate multimodal evidence group (Part 6, Section 8) - one per transcript segment, since a
// transcript segment is a REAL structural unit (Whisper's own boundary), not an arbitrary window.
// `evidence` always includes the segment's own transcript entry (and its audio entry, when
// present) plus whichever other modalities' evidence overlaps its [start, end] span.
export interface EvidenceGroup {
  segmentIndex: number;
  startTime: number;
  endTime: number;
  evidence: MultimodalEvidence[];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function distinctModalities(evidence: MultimodalEvidence[]): Set<ModalitySource> {
  return new Set(evidence.map((item) => item.modality));
}

function segmentMidpoint(start: number, end: number): number {
  return (start + end) / 2;
}

// Keeps at most MAX_EVIDENCE_PER_MODALITY_PER_GROUP items per modality, closest to the group's own
// midpoint first - same cap-and-sort-by-proximity shape as find-concurrent-evidence.ts.
function capPerModality(
  evidence: MultimodalEvidence[],
  groupMidpoint: number,
): MultimodalEvidence[] {
  const byModality = new Map<ModalitySource, MultimodalEvidence[]>();
  for (const item of evidence) {
    const bucket = byModality.get(item.modality) ?? [];
    bucket.push(item);
    byModality.set(item.modality, bucket);
  }

  const result: MultimodalEvidence[] = [];
  for (const bucket of byModality.values()) {
    const sorted = [...bucket].sort(
      (a, b) =>
        Math.abs(segmentMidpoint(a.startTime, a.endTime) - groupMidpoint) -
        Math.abs(segmentMidpoint(b.startTime, b.endTime) - groupMidpoint),
    );
    result.push(...sorted.slice(0, MAX_EVIDENCE_PER_MODALITY_PER_GROUP));
  }
  return result;
}

// Anchors one evidence group per transcript segment (Part 6, Section 8's temporal alignment) -
// pure/synchronous, no LLM/DB access. Every non-transcript evidence item whose span overlaps the
// segment's own [start, end] (padded by SEGMENT_EVIDENCE_PADDING_SECONDS) joins that segment's
// group; the transcript (and, when present, audio) evidence for that same segment is always
// included. Two evidence items with non-overlapping timestamps (e.g. one at 10s, one at 90s) never
// land in the same group - the concrete mechanism behind Part 6's "don't assume two evidence are
// related just because both exist in the video" rule.
export function groupEvidenceByTranscriptSegment(evidence: MultimodalEvidence[]): EvidenceGroup[] {
  const transcriptItems = evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.modality === 'transcript')
    .sort((a, b) => a.item.startTime - b.item.startTime);

  return transcriptItems.map(({ item: transcriptItem, index: transcriptIndex }, segmentIndex) => {
    const windowStart = transcriptItem.startTime - SEGMENT_EVIDENCE_PADDING_SECONDS;
    const windowEnd = transcriptItem.endTime + SEGMENT_EVIDENCE_PADDING_SECONDS;
    const midpoint = segmentMidpoint(transcriptItem.startTime, transcriptItem.endTime);

    const overlapping = evidence.filter((candidate, candidateIndex) => {
      if (candidate.modality === 'transcript') return candidateIndex === transcriptIndex;
      return overlaps(candidate.startTime, candidate.endTime, windowStart, windowEnd);
    });

    return {
      segmentIndex,
      startTime: transcriptItem.startTime,
      endTime: transcriptItem.endTime,
      evidence: capPerModality(overlapping, midpoint),
    };
  });
}

// Groups spanning fewer than 2 distinct modalities have nothing cross-modal to reason about by
// construction (Part 6's own definition of a connection needs >= 2 modalities) - filtering them out
// here, before any LLM call, is the module's main cost-control lever (Section 17): a clip whose
// evidence is mostly single-modality never pays for a prompt over it.
export function selectReasoningGroups(groups: EvidenceGroup[]): EvidenceGroup[] {
  return groups.filter((group) => distinctModalities(group.evidence).size >= 2);
}
