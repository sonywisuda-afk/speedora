import {
  NARRATIVE_RELATION_TYPES,
  NARRATIVE_SEGMENT_TYPES,
  narrativeGraphSchema,
  type NarrativeGraph,
  type NarrativeGraphDetectionSegment,
  type SemanticEvent,
} from '@speedora/contracts';
import { callStructured, type StructuredCallDeps } from '@speedora/llm-client';

const SEGMENT_PROPERTIES = {
  id: { type: 'number' },
  type: { type: 'string', enum: NARRATIVE_SEGMENT_TYPES },
  startTime: { type: 'number' },
  endTime: { type: 'number' },
  confidence: { type: 'number' },
  reason: { type: 'string' },
} as const;

const RELATION_PROPERTIES = {
  fromSegmentId: { type: 'number' },
  toSegmentId: { type: 'number' },
  type: { type: 'string', enum: NARRATIVE_RELATION_TYPES },
} as const;

const RESPONSE_FORMAT = {
  name: 'narrative_graph',
  schema: {
    type: 'object',
    properties: {
      unsegmented: { type: 'boolean' },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: SEGMENT_PROPERTIES,
          required: Object.keys(SEGMENT_PROPERTIES),
          additionalProperties: false,
        },
      },
      relations: {
        type: 'array',
        items: {
          type: 'object',
          properties: RELATION_PROPERTIES,
          required: Object.keys(RELATION_PROPERTIES),
          additionalProperties: false,
        },
      },
    },
    required: ['unsegmented', 'segments', 'relations'],
    additionalProperties: false,
  },
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Formats Phase 2's SemanticEvent[] (when available) as extra prompt
// context - helps ground segmentation without making it a hard dependency.
// null/empty both render as "no additional context" so the prompt doesn't
// need two different code paths for "Phase 2 disabled" vs "Phase 2 found
// nothing".
function formatSemanticEventsContext(semanticEvents: SemanticEvent[] | null): string {
  if (!semanticEvents || semanticEvents.length === 0) {
    return '';
  }
  const lines = semanticEvents
    .map((event) => `- [${event.t.toFixed(1)}s] ${event.type}: ${event.reason}`)
    .join('\n');
  return `\n\nDetected narrative events (for context, not exhaustive):\n${lines}`;
}

// The one LLM call this module makes - reasons over TRANSCRIPT TEXT, with
// Phase 2's semantic events as optional additional context (degrades
// gracefully to transcript-only when null/empty - Phase 2's flag being off
// or its own detection failing must never block this phase from running).
// Returns the RAW (not yet structurally validated) graph - validateGraph()
// is a separate, deterministic step. Reuses @speedora/llm-client's
// callStructured (ADR D3), same convention as every prior v4 LLM call.
export async function extractRawGraph(
  segments: NarrativeGraphDetectionSegment[],
  semanticEvents: SemanticEvent[] | null,
  deps: StructuredCallDeps,
): Promise<NarrativeGraph> {
  if (segments.length === 0) {
    return { segments: [], relations: [], unsegmented: true };
  }

  const videoStart = Math.min(...segments.map((s) => s.start));
  const videoEnd = Math.max(...segments.map((s) => s.end));
  const transcriptText = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join('\n');

  const raw = await callStructured<NarrativeGraph>(
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You analyze a video clip transcript for its narrative STRUCTURE - a real story ' +
            'graph, not just a linear sequence. If the clip genuinely does not decompose into a ' +
            'clear narrative structure (e.g. a plain list of facts, a single unbroken point with ' +
            'no arc), set unsegmented to true and return empty segments/relations arrays - do ' +
            'NOT force a structure onto content that does not have one.\n\n' +
            'Otherwise, set unsegmented to false and segment the clip into 2 or more of these ' +
            `types (a clip need not use every type): ${NARRATIVE_SEGMENT_TYPES.join(', ')}. Each ` +
            'segment needs: id (a small integer, unique within this response, starting at 0), ' +
            `type, startTime/endTime (seconds, within ${videoStart.toFixed(1)}-` +
            `${videoEnd.toFixed(1)}), confidence (0-1, how sure you are this span really is this ` +
            'type), and reason (1 sentence, plain language, why this span is this type).\n\n' +
            'Then identify relations between segments - this is what makes it a GRAPH, not just ' +
            `a list: ${NARRATIVE_RELATION_TYPES.join(', ')}. leads_to connects two segments in ` +
            'sequence. resolves connects a LATER segment back to an EARLIER one whose tension it ' +
            'resolves - these do not have to be adjacent (e.g. a takeaway resolving a problem ' +
            'stated much earlier). Only add a relation when it is genuinely clear from the ' +
            'transcript, not a forced guess.' +
            formatSemanticEventsContext(semanticEvents),
        },
        { role: 'user', content: `Transcript:\n${transcriptText}` },
      ],
      responseFormat: RESPONSE_FORMAT,
    },
    deps,
  );

  if (raw.unsegmented) {
    return { segments: [], relations: [], unsegmented: true };
  }

  return narrativeGraphSchema.parse({
    unsegmented: false,
    segments: raw.segments.map((segment) => ({
      ...segment,
      confidence: clamp01(segment.confidence),
      reason: segment.reason.trim(),
    })),
    relations: raw.relations,
  });
}
