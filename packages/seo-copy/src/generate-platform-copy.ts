import { seoCopyOutputSchema, type SeoCopyInput, type SeoCopyOutput } from '@speedora/contracts';
import { sanitizeHashtags } from '@speedora/shared';
import type OpenAI from 'openai';
import { PLATFORM_GUIDANCE } from './platform-guidance';

// Stateless module (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern):
// pure input -> output, no Prisma/BullMQ/Sentry access. `openai` is injected
// rather than constructed from process.env in here, same reasoning as
// @speedora/clip-scoring's ScoreClipCandidatesDeps - the caller (apps/worker's
// generate-platform-copy adapter) owns that singleton and its env var, and
// tests can pass a fake client without touching any module/env mocking.
export interface GeneratePlatformCopyDeps {
  openai: OpenAI;
}

interface RawSeoCopy {
  caption: string;
  hashtags: string[];
  description: string | null;
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'seo_copy',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        caption: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
        description: { type: ['string', 'null'] },
      },
      required: ['caption', 'hashtags', 'description'],
      additionalProperties: false,
    },
  },
} as const;

// The module's single entry point: JSON in, JSON out, validated against
// @speedora/contracts's Zod schema before returning (defense in depth on top
// of the manual sanitization below - the LLM's response_format is already
// strict, but this is the module's own contract boundary, not OpenAI's),
// same convention as @speedora/clip-scoring's scoreClipCandidates(). Only
// consumes already-computed Clip fields - deliberately never re-sends the
// full transcript, keeping this call cheap and independent of detect-clips'
// own data needs.
export async function generatePlatformCopy(
  input: SeoCopyInput,
  deps: GeneratePlatformCopyDeps,
): Promise<SeoCopyOutput> {
  const guidance = PLATFORM_GUIDANCE[input.platform];

  const completion = await deps.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          `You write publish-ready social copy for ${input.platform} from an already-selected ` +
          "video clip's metadata (not the full transcript). Write a caption: " +
          `${guidance.captionGuidance}. Also give hashtags: ${guidance.hashtagCountGuidance} ` +
          'relevant hashtags as plain lowercase words, no leading "#" and no spaces within a ' +
          'word.\n' +
          (guidance.includesDescription
            ? `Also write description: ${guidance.descriptionGuidance}.\n`
            : 'This platform has no separate description field - always return description as ' +
              'null.\n') +
          'Write the caption, hashtags, and description (if any) in the same language as the ' +
          'clip metadata below.',
      },
      {
        role: 'user',
        content:
          `Hook: ${input.hookText}\n` +
          `Topics: ${input.topics.join(', ')}\n` +
          `Keywords: ${input.keywords.join(', ')}\n` +
          `Call-to-action: ${input.ctaText || '(none)'}\n` +
          `Why this clip was chosen: ${input.reason}`,
      },
    ],
    response_format: RESPONSE_FORMAT,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { caption: '', hashtags: [], description: null };
  }

  const parsed = JSON.parse(raw) as RawSeoCopy;

  return seoCopyOutputSchema.parse({
    caption: parsed.caption.trim(),
    // Belt-and-suspenders, not trusting the schema/prompt alone - same
    // reasoning as scoreClipCandidates' identical sanitizeHashtags call.
    hashtags: sanitizeHashtags(parsed.hashtags),
    description: parsed.description?.trim() || null,
  });
}
