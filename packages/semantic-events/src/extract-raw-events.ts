import {
  SEMANTIC_EVENT_TYPES,
  type SemanticEvent,
  type SemanticEventDetectionSegment,
} from '@speedora/contracts';
import { callStructured, type StructuredCallDeps } from '@speedora/llm-client';

export type RawSemanticEvent = Omit<SemanticEvent, 'evidence'>;

const EVENT_PROPERTIES = {
  type: { type: 'string', enum: SEMANTIC_EVENT_TYPES },
  t: { type: 'number' },
  confidence: { type: 'number' },
  importance: { type: 'number' },
  reason: { type: 'string' },
} as const;

const RESPONSE_FORMAT = {
  name: 'semantic_events',
  schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: EVENT_PROPERTIES,
          required: Object.keys(EVENT_PROPERTIES),
          additionalProperties: false,
        },
      },
    },
    required: ['events'],
    additionalProperties: false,
  },
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// The one LLM call this module makes - detects narrative events from
// TRANSCRIPT TEXT ALONE (no OCR/object context in the prompt; grounding
// with on-screen evidence is ground-events.ts's separate, deterministic
// job - see this package's own module comment). Reuses
// @speedora/llm-client's callStructured (ADR D3), same convention as
// hook-prediction's extract-linguistic-features.ts.
export async function extractRawEvents(
  segments: SemanticEventDetectionSegment[],
  deps: StructuredCallDeps,
): Promise<RawSemanticEvent[]> {
  if (segments.length === 0) {
    return [];
  }

  const videoStart = Math.min(...segments.map((s) => s.start));
  const videoEnd = Math.max(...segments.map((s) => s.end));
  const transcriptText = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join('\n');

  const raw = await callStructured<{ events: RawSemanticEvent[] }>(
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You identify narrative EVENTS in a video clip transcript - specific moments that ' +
            'match one of a fixed set of event types. For each moment you find, report:\n' +
            `- type: exactly one of ${SEMANTIC_EVENT_TYPES.join(', ')}.\n` +
            '- t: the approximate timestamp (seconds) where this moment occurs, within ' +
            `${videoStart.toFixed(1)}-${videoEnd.toFixed(1)}.\n` +
            '- confidence (0-1): how confident you are that this moment genuinely matches the ' +
            'chosen type.\n' +
            '- importance (0-1): how significant this moment is to the overall narrative of the ' +
            'clip, independent of your confidence in the type label.\n' +
            '- reason: 1 sentence, in plain language, explaining why this moment matches the ' +
            'type - written for a human reader, not a log message.\n\n' +
            'Only report moments that clearly match a type - do not force weak/generic content ' +
            'into a category. A short clip may have zero events; a dense clip may have several. ' +
            'Never report the same moment twice under different types.',
        },
        { role: 'user', content: `Transcript:\n${transcriptText}` },
      ],
      responseFormat: RESPONSE_FORMAT,
    },
    deps,
  );

  return raw.events.map((event) => ({
    type: event.type,
    t: Math.max(videoStart, Math.min(videoEnd, event.t)),
    confidence: clamp01(event.confidence),
    importance: clamp01(event.importance),
    reason: event.reason.trim(),
  }));
}
