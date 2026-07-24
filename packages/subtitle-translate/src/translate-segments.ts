import type OpenAI from 'openai';

// Stateless module (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern):
// pure input -> output, no Prisma/BullMQ/Sentry access. The only external
// call is the LLM itself, injected as `deps.openai` (same reasoning as
// @speedora/clip-scoring's ScoreClipCandidatesDeps) rather than constructed
// here - the caller (apps/worker's translate-transcript adapter) owns the
// singleton/env var, and tests pass a fake client with no module mocking.
export interface TranslateSegmentsDeps {
  openai: OpenAI;
}

export interface TranslateSegmentsInput {
  // id + text only - this module never sees start/end/speaker/emotion/words,
  // same "narrower than the DB-hydrated TranscriptSegment" posture
  // @speedora/contracts' SubtitleSegment already takes for build-ass.ts.
  segments: { id: string; text: string }[];
  // Free-form language name/code, passed straight into the prompt - see
  // TranslateTranscriptDto's own comment for why this isn't a closed enum.
  languageCode: string;
}

export interface TranslateSegmentsOutput {
  translations: { id: string; text: string }[];
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'segment_translations',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        translations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['id', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['translations'],
      additionalProperties: false,
    },
  },
} as const;

// One call per video per requested language (not per segment) - every
// segment's {id, text} is sent in a single prompt and the model is asked to
// echo the same ids back, which is how the caller re-associates a
// translation with its row without relying on array order surviving the
// round trip.
export async function translateSegments(
  input: TranslateSegmentsInput,
  deps: TranslateSegmentsDeps,
): Promise<TranslateSegmentsOutput> {
  const { segments, languageCode } = input;
  if (segments.length === 0) {
    return { translations: [] };
  }

  const completion = await deps.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          `Translate each of the following video caption segments into ${languageCode}. ` +
          'Keep each translation natural and concise, suitable for a burned-in video caption ' +
          '(not a literal word-for-word translation) - short-form social video captions read ' +
          "at a glance. Return every segment's id unchanged alongside its translated text, in " +
          'any order.',
      },
      {
        role: 'user',
        content: JSON.stringify({ segments }),
      },
    ],
    response_format: RESPONSE_FORMAT,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { translations: [] };
  }

  const parsed = JSON.parse(raw) as TranslateSegmentsOutput;
  // Belt-and-suspenders, not trusting the schema/prompt alone (same posture
  // as clip-scoring's own sanitization) - drop any id the model invented
  // that doesn't correspond to a real input segment.
  const validIds = new Set(segments.map((s) => s.id));
  return {
    translations: parsed.translations.filter((t) => validIds.has(t.id)),
  };
}
