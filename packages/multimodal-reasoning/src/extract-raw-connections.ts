import {
  MODALITY_SOURCES,
  MULTIMODAL_RELATION_TYPES,
  type MultimodalConnection,
} from '@speedora/contracts';
import { callStructured, type StructuredCallDeps } from '@speedora/llm-client';
import type { EvidenceGroup } from './group-evidence';

const CONNECTION_PROPERTIES = {
  relation: { type: 'string', enum: MULTIMODAL_RELATION_TYPES },
  evidenceRefs: { type: 'array', items: { type: 'string' } },
  modalities: { type: 'array', items: { type: 'string', enum: MODALITY_SOURCES } },
  startTime: { type: 'number' },
  endTime: { type: 'number' },
  confidence: { type: 'number' },
  reason: { type: 'string' },
} as const;

const RESPONSE_FORMAT = {
  name: 'multimodal_connections',
  schema: {
    type: 'object',
    properties: {
      connections: {
        type: 'array',
        items: {
          type: 'object',
          properties: CONNECTION_PROPERTIES,
          required: Object.keys(CONNECTION_PROPERTIES),
          additionalProperties: false,
        },
      },
    },
    required: ['connections'],
    additionalProperties: false,
  },
} as const;

function formatGroup(group: EvidenceGroup): string {
  const lines = group.evidence.map((item) => {
    const confidence = item.confidence != null ? `, confidence ${item.confidence.toFixed(2)}` : '';
    return `  - id=${item.id} modality=${item.modality} [${item.startTime.toFixed(1)}-${item.endTime.toFixed(1)}]: "${item.value}"${confidence}`;
  });
  return (
    `Group ${group.segmentIndex} [${group.startTime.toFixed(1)}-${group.endTime.toFixed(1)}]:\n` +
    lines.join('\n')
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// The one LLM call this module makes - genuine cross-modal reasoning over already-grouped
// evidence (see group-evidence.ts), NOT signal concatenation/summarization: the prompt asks the
// model to find RELATIONSHIPS between specific, id-referenced evidence items, never to describe
// each modality's own content in isolation. Reuses @speedora/llm-client's callStructured (ADR D3),
// same convention as every other v4 LLM-reasoning module. Returns the model's RAW claims -
// validate-connections.ts is the separate, deterministic step that checks every evidenceRefs entry
// actually resolves before this is trusted as a real connection.
export async function extractRawConnections(
  groups: EvidenceGroup[],
  deps: StructuredCallDeps,
): Promise<MultimodalConnection[]> {
  if (groups.length === 0) {
    return [];
  }

  const groupsText = groups.map(formatGroup).join('\n\n');

  const raw = await callStructured<{ connections: MultimodalConnection[] }>(
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You find CROSS-MODAL CONNECTIONS in a video clip - real relationships between ' +
            'evidence items drawn from different signal types (transcript, scene, on-screen text, ' +
            'detected objects, facial expression, hand gesture, audio level, speaker identity). ' +
            'Evidence is given to you already grouped by the moment it occurs in.\n\n' +
            'For each connection you report:\n' +
            `- relation: exactly one of ${MULTIMODAL_RELATION_TYPES.join(', ')}.\n` +
            '  refers_to = one evidence verbally references what another evidence shows (e.g. ' +
            'speech says "look at this number" and on-screen text shows a dollar amount).\n' +
            '  co_occurs_with = evidence overlaps in time across modalities with no verbal ' +
            'reference tying them together.\n' +
            '  emphasizes = a gesture/facial expression/audio-intensity moment genuinely ' +
            'intensifies or underscores another evidence item - never report this just because ' +
            'two items share a timestamp.\n' +
            '- evidenceRefs: the exact `id` values (from the evidence given to you) that support ' +
            'this connection - at least 2, from at least 2 DIFFERENT modalities. Never invent an ' +
            'id that was not given to you.\n' +
            '- modalities: the modalities of the evidence you cited.\n' +
            '- startTime/endTime: the time span covered by the evidence you cited.\n' +
            '- confidence (0-1): how confident you are that this is a REAL relationship, not a ' +
            'coincidence.\n' +
            '- reason: 1 sentence, in plain language, explaining the connection - written for a ' +
            'human reader.\n\n' +
            'Only report a connection when the cited evidence genuinely supports it. A group with ' +
            'nothing meaningfully connected should contribute zero connections - do not force a ' +
            'connection to satisfy the prompt. Never reference evidence from a different group ' +
            'unless its id was given to you in this same request.',
        },
        { role: 'user', content: groupsText },
      ],
      responseFormat: RESPONSE_FORMAT,
    },
    deps,
  );

  return raw.connections.map((connection) => ({
    ...connection,
    confidence: clamp01(connection.confidence),
    reason: connection.reason.trim(),
  }));
}
