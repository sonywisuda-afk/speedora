import type { MultimodalReasoningResult } from '@speedora/contracts';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { extractRawConnections } from './extract-raw-connections';
import { groupEvidenceByTranscriptSegment, selectReasoningGroups } from './group-evidence';
import { normalizeEvidence, type NormalizeEvidenceInput } from './normalize-evidence';
import { validateConnections } from './validate-connections';

export type ReasonMultimodalInput = NormalizeEvidenceInput & { clipId: string };

function computeModalityCoverage(
  evidence: MultimodalReasoningResult['evidence'],
): Record<string, number> {
  const coverage: Record<string, number> = {};
  for (const item of evidence) {
    coverage[item.modality] = (coverage[item.modality] ?? 0) + 1;
  }
  return coverage;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module checklist) -
// orchestrates evidence normalization + temporal grouping (both pure) with the one LLM reasoning
// call + deterministic validation, into a full MultimodalReasoningResult. Same "adapter narrows
// ctx data, module owns the multi-step orchestration" shape as
// @speedora/semantic-events' detectSemanticEvents/@speedora/narrative-graph's
// buildNarrativeGraph. Exactly ONE LLM call per clip regardless of how many evidence groups exist
// (Section 17 - never one call per group/signal); groups with fewer than 2 distinct modalities are
// filtered out before the prompt is even built, so a clip with little cross-modal evidence pays
// less, not more.
export async function reasonMultimodal(
  input: ReasonMultimodalInput,
  deps: StructuredCallDeps,
): Promise<MultimodalReasoningResult> {
  const evidence = normalizeEvidence(input);
  const groups = groupEvidenceByTranscriptSegment(evidence);
  const reasoningGroups = selectReasoningGroups(groups);

  const rawConnections = await extractRawConnections(reasoningGroups, deps);
  const connections = validateConnections(rawConnections, evidence);

  return {
    clipId: input.clipId,
    evidence,
    connections,
    modalityCoverage: computeModalityCoverage(evidence),
  };
}
