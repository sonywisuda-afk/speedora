import {
  MULTIMODAL_RELATION_TYPES,
  type ModalitySource,
  type MultimodalConnection,
  type MultimodalEvidence,
} from '@speedora/contracts';
import { describeRelationType } from './describe-relation-type';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isKnownRelation(value: string): value is MultimodalConnection['relation'] {
  return (MULTIMODAL_RELATION_TYPES as readonly string[]).includes(value);
}

// Pure, deterministic, no LLM/DB access - the module's hallucination guard (Part 6, Section 10).
// Collapses to DROPPING a connection on any structural problem, rather than attempting a partial
// repair - same "a half-fixed result is exactly the kind of silently-wrong output this exists to
// avoid" posture as @speedora/narrative-graph's validateGraph. A connection survives only when:
//   - its `relation` is a real MULTIMODAL_RELATION_TYPES value (defense-in-depth beyond
//     callStructured's own `strict: true` schema enforcement - this function must be safe to call
//     with untrusted input directly, not just via extractRawConnections);
//   - every one of its evidenceRefs resolves to a real id in `evidence` (the concrete mechanism
//     that catches a fabricated/hallucinated citation);
//   - the resolved evidence spans >= 2 DISTINCT modalities.
// `modalities`/`startTime`/`endTime` on the surviving connection are RECOMPUTED from the resolved
// evidence, never trusted as reported by the LLM itself - the same "recompute what you can verify,
// don't trust the model's own bookkeeping" discipline the evidenceRefs check already applies.
export function validateConnections(
  rawConnections: MultimodalConnection[],
  evidence: MultimodalEvidence[],
): MultimodalConnection[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  const result: MultimodalConnection[] = [];
  for (const raw of rawConnections) {
    if (!isKnownRelation(raw.relation)) continue;

    const uniqueRefs = [...new Set(raw.evidenceRefs)];
    if (uniqueRefs.length < 2) continue;

    const resolved: MultimodalEvidence[] = [];
    let allResolved = true;
    for (const ref of uniqueRefs) {
      const found = evidenceById.get(ref);
      if (!found) {
        allResolved = false;
        break;
      }
      resolved.push(found);
    }
    if (!allResolved) continue;

    const modalities = [...new Set(resolved.map((item) => item.modality))] as ModalitySource[];
    if (modalities.length < 2) continue;

    const reason = raw.reason.trim();

    result.push({
      relation: raw.relation,
      evidenceRefs: uniqueRefs,
      modalities,
      startTime: Math.min(...resolved.map((item) => item.startTime)),
      endTime: Math.max(...resolved.map((item) => item.endTime)),
      confidence: clamp01(raw.confidence),
      reason: reason.length > 0 ? reason : describeRelationType(raw.relation),
    });
  }
  return result;
}
