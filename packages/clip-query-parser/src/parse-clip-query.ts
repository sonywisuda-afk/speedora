import { SocialPlatform } from '@speedora/shared';
import type OpenAI from 'openai';

// Stateless module (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern):
// pure input -> output, no Prisma/BullMQ/Sentry access. The only external
// call is the LLM itself, injected as `deps.openai` (same reasoning as
// @speedora/clip-scoring's ScoreClipCandidatesDeps/@speedora/subtitle-
// translate's TranslateSegmentsDeps) rather than constructed here - the
// caller (apps/api's ClipQueryParserService) owns the singleton/env var,
// and tests pass a fake client with no module mocking. Unlike those two
// existing LLM packages (both called from apps/worker BullMQ jobs), this
// one is called SYNCHRONOUSLY from an HTTP request - the caller is
// responsible for its own timeout/rate-limit handling, this module just
// makes the one call and returns.
export interface ParseClipQueryDeps {
  openai: OpenAI;
}

export interface ParseClipQueryInput {
  query: string;
  // That workspace's real, currently-existing topic vocabulary (from
  // GET /clips/facets) - passed in so the model only ever picks a topic
  // that actually matches real clips, instead of inventing a plausible-
  // sounding topic string that would silently filter to zero results.
  availableTopics: string[];
}

// A partial ClipLibraryFilterParams (packages/shared) - only the axes a
// free-text query can plausibly express. workspaceId/projectId/folderId/
// cursor/limit stay app-context-controlled, never parsed from the query.
export interface ParseClipQueryOutput {
  minScore?: number;
  platform?: SocialPlatform;
  minDuration?: number;
  maxDuration?: number;
  topics?: string[];
  emotion?: string;
  keyword?: string;
  // Short plain-language restatement of what was understood, e.g. "Skor >=
  // 70 - Durasi < 30 detik - Kata kunci: marketing" - shown to the user so
  // the parse is transparent/correctable, never a silent black box.
  summary: string;
}

const EMOTION_VALUES = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'] as const;
const PLATFORM_VALUES = Object.values(SocialPlatform);

// Structured Outputs strict mode requires every property in `properties` to
// also appear in `required` - an "optional" field is instead modeled as a
// nullable type (`["number", "null"]`) with `null` meaning "the query
// didn't say anything about this axis." Converted back to plain `?:`-style
// undefined in this module's own output (see toOutput below), since that's
// what ClipLibraryFilterParams itself already uses - `null` is never a
// meaningful value for any of these fields on the Prisma/API side.
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'clip_query_filters',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        minScore: {
          type: ['number', 'null'],
          description: 'Minimum virality score 0-100. Use for vibe/quality words like "best", ' +
            '"top", "viral", "funniest", "highest scoring" - there is no dedicated "funny" or ' +
            '"viral" field, this is the closest real signal.',
        },
        platform: {
          type: ['string', 'null'],
          enum: [...PLATFORM_VALUES, null],
          description: 'Only set when the query names a specific platform (e.g. "for TikTok", ' +
            '"on YouTube").',
        },
        minDuration: {
          type: ['number', 'null'],
          description: 'Minimum clip duration in SECONDS (e.g. "at least 1 minute" -> 60).',
        },
        maxDuration: {
          type: ['number', 'null'],
          description: 'Maximum clip duration in SECONDS (e.g. "under 30 seconds" -> 30).',
        },
        topics: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Zero or more topics from the provided availableTopics list that match ' +
            'the query. NEVER invent a topic string that is not in availableTopics - if nothing ' +
            'in that list matches, leave this null and use keyword instead.',
        },
        emotion: {
          type: ['string', 'null'],
          enum: [...EMOTION_VALUES, null],
          description: 'One of the 7 FACIAL EXPRESSION classes shown in the on-camera speaker\'s ' +
            'face - ONLY set this when the query is genuinely about how someone looks on camera ' +
            '(e.g. "clips where I look happy", "surprised reaction"). Do NOT use this for mood/ ' +
            'quality words like "funny", "sad topic", "exciting" - those are not facial-' +
            'expression signals, use minScore/keyword instead.',
        },
        keyword: {
          type: ['string', 'null'],
          description: 'A single free-text keyword or short phrase to match against the clip\'s ' +
            'hook text, hashtags, topics, and keywords - the catch-all for any subject/topic ' +
            'language that is not one of the other structured axes.',
        },
        summary: {
          type: 'string',
          description: 'One short plain-language sentence restating what filters were applied, ' +
            'in the same language the query was written in.',
        },
      },
      required: [
        'minScore', 'platform', 'minDuration', 'maxDuration', 'topics', 'emotion', 'keyword',
        'summary',
      ],
      additionalProperties: false,
    },
  },
} as const;

interface RawParseResult {
  minScore: number | null;
  platform: string | null;
  minDuration: number | null;
  maxDuration: number | null;
  topics: string[] | null;
  emotion: string | null;
  keyword: string | null;
  summary: string;
}

function isValidPlatform(value: string): value is SocialPlatform {
  return (PLATFORM_VALUES as string[]).includes(value);
}

// Belt-and-suspenders, not trusting the schema/prompt alone (same posture
// as clip-scoring/translate-segments' own sanitization) - re-validates
// every field even though strict mode should already constrain them.
function toOutput(raw: RawParseResult, availableTopics: string[]): ParseClipQueryOutput {
  const availableTopicSet = new Set(availableTopics);
  const topics = raw.topics?.filter((topic) => availableTopicSet.has(topic)) ?? [];

  return {
    minScore: raw.minScore != null ? Math.min(100, Math.max(0, raw.minScore)) : undefined,
    platform: raw.platform != null && isValidPlatform(raw.platform) ? raw.platform : undefined,
    minDuration: raw.minDuration != null && raw.minDuration >= 0 ? raw.minDuration : undefined,
    maxDuration: raw.maxDuration != null && raw.maxDuration >= 0 ? raw.maxDuration : undefined,
    topics: topics.length > 0 ? topics : undefined,
    emotion:
      raw.emotion != null && (EMOTION_VALUES as readonly string[]).includes(raw.emotion)
        ? raw.emotion
        : undefined,
    keyword: raw.keyword?.trim() ? raw.keyword.trim() : undefined,
    summary: raw.summary,
  };
}

export async function parseClipQuery(
  input: ParseClipQueryInput,
  deps: ParseClipQueryDeps,
): Promise<ParseClipQueryOutput> {
  const { query, availableTopics } = input;

  const completion = await deps.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You translate a short-form video creator\'s free-text search query into structured ' +
          'filters for their clip library. Only set a field when the query genuinely implies it - ' +
          'leave everything else null. Never invent a topic that is not in the provided ' +
          'availableTopics list.',
      },
      {
        role: 'user',
        content: JSON.stringify({ query, availableTopics }),
      },
    ],
    response_format: RESPONSE_FORMAT,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { summary: '' };
  }

  const parsed = JSON.parse(raw) as RawParseResult;
  return toOutput(parsed, availableTopics);
}
