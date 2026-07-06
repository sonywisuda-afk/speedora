import {
  clipScoringOutputSchema,
  type ClipIntent,
  type ClipScores,
  type ClipScoringCandidate,
  type ClipScoringInput,
  type ClipScoringOutput,
  type ClipScoringSegment,
  type TranscriptWordInput,
  CLIP_INTENTS,
} from '@speedora/contracts';
import { sanitizeHashtags } from '@speedora/shared';
import type OpenAI from 'openai';

// Stateless module (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern):
// pure input -> output, no Prisma/BullMQ/Sentry access. The only external
// call is the LLM itself, which is why it's injected as `deps.openai` rather
// than constructed from process.env in here - the caller (apps/worker's
// detect-clips adapter) owns that singleton and its env var, and tests can
// pass a fake client without touching any module/env mocking at all.
export interface ScoreClipCandidatesDeps {
  openai: OpenAI;
}

const MAX_CANDIDATES = 3;

// Clip length bounds. The minimum is enforced (not just asked of the model)
// so it can't return a 2-second fragment that doesn't make sense on its own -
// a viral short needs enough runtime to land a complete moment (setup +
// payoff). For a source shorter than MIN_CLIP_SECONDS the whole thing is the
// only possible clip, so the effective minimum is clamped to the video's own
// duration rather than rejecting every candidate.
//
// MAX_CLIP_SECONDS is prompt guidance only, not code-enforced (see the
// in-range filter below, which never checks an upper bound) - raised from 90
// to 600 after real feedback that a short ceiling forced the model to
// truncate longer stories/topics mid-arc just to comply with the length
// instruction, producing clips that felt incomplete. 600s gives the model
// generous room for a genuinely long-form story arc; the prompt itself is
// also written to prefer picking a different, fully self-contained shorter
// moment over cutting off part of a longer one - see the system prompt
// below.
const MIN_CLIP_SECONDS = 20;
const MAX_CLIP_SECONDS = 600;

interface RawCandidate {
  startTime: number;
  endTime: number;
  viralityScore: number;
  hookText: string;
  hashtags: string[];
  scores: ClipScores;
  reason: string;
  topics: string[];
  keywords: string[];
  intent: ClipIntent;
  ctaText: string;
}

const SCORE_PROPERTIES = {
  hookStrength: { type: 'number' },
  educationalValue: { type: 'number' },
  practicalValue: { type: 'number' },
  curiosity: { type: 'number' },
  emotion: { type: 'number' },
  storytelling: { type: 'number' },
  novelty: { type: 'number' },
  trustAuthority: { type: 'number' },
  ctaStrength: { type: 'number' },
} as const;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'clip_candidates',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startTime: { type: 'number' },
              endTime: { type: 'number' },
              viralityScore: { type: 'number' },
              hookText: { type: 'string' },
              hashtags: { type: 'array', items: { type: 'string' } },
              scores: {
                type: 'object',
                properties: SCORE_PROPERTIES,
                required: Object.keys(SCORE_PROPERTIES),
                additionalProperties: false,
              },
              reason: { type: 'string' },
              topics: { type: 'array', items: { type: 'string' } },
              keywords: { type: 'array', items: { type: 'string' } },
              intent: { type: 'string', enum: CLIP_INTENTS },
              ctaText: { type: 'string' },
            },
            required: [
              'startTime',
              'endTime',
              'viralityScore',
              'hookText',
              'hashtags',
              'scores',
              'reason',
              'topics',
              'keywords',
              'intent',
              'ctaText',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['candidates'],
      additionalProperties: false,
    },
  },
} as const;

// Clamps every metric in a raw scores object to 0-100, same reasoning as
// viralityScore's own clamp below - the model is asked to stay in range but
// isn't trusted to always comply.
function clampScores(scores: ClipScores): ClipScores {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return {
    hookStrength: clamp(scores.hookStrength),
    educationalValue: clamp(scores.educationalValue),
    practicalValue: clamp(scores.practicalValue),
    curiosity: clamp(scores.curiosity),
    emotion: clamp(scores.emotion),
    storytelling: clamp(scores.storytelling),
    novelty: clamp(scores.novelty),
    trustAuthority: clamp(scores.trustAuthority),
    ctaStrength: clamp(scores.ctaStrength),
  };
}

// Trim + drop blanks, same normalization sanitizeHashtags does for
// hashtags - topics/keywords have no leading '#' to strip, so this is the
// plain version of that same idea.
function sanitizeStrings(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

// A fixed, neutral fallback for the whole-video fallback candidate below -
// never fabricated per-clip content, just a value that reads honestly as
// "not analyzed" rather than a guessed score.
const NEUTRAL_SCORES: ClipScores = {
  hookStrength: 50,
  educationalValue: 50,
  practicalValue: 50,
  curiosity: 50,
  emotion: 50,
  storytelling: 50,
  novelty: 50,
  trustAuthority: 50,
  ctaStrength: 50,
};

function flattenWords(segments: ClipScoringSegment[]): TranscriptWordInput[] {
  return segments.flatMap((segment) => segment.words ?? []).sort((a, b) => a.start - b.start);
}

// Snaps a candidate's boundaries to the nearest actual word instead of
// trusting the LLM's raw seconds verbatim (see the caller's comment).
// Returns the original times unchanged when there's no word-level data at
// all (older videos transcribed before Fase 3 - see CLAUDE.md) or the
// snapped result would be degenerate.
function snapToWordBoundaries(
  startTime: number,
  endTime: number,
  words: TranscriptWordInput[],
): { startTime: number; endTime: number } {
  if (words.length === 0) {
    return { startTime, endTime };
  }

  // startTime fell inside a word - pull the boundary back to that word's
  // own start so the clip doesn't open mid-word. Otherwise it fell in a gap
  // (silence) - snap forward to the next word's start, trimming that lead-in
  // silence for free.
  const startWord =
    words.find((word) => startTime >= word.start && startTime < word.end) ??
    words.find((word) => word.start >= startTime);
  const snappedStart = startWord ? startWord.start : startTime;

  // Symmetric for endTime: a word containing it extends the boundary to that
  // word's own end; otherwise snap back to the last word ending at or before
  // it, trimming trailing silence.
  const endWord =
    [...words].reverse().find((word) => endTime > word.start && endTime <= word.end) ??
    [...words].reverse().find((word) => word.end <= endTime);
  const snappedEnd = endWord ? endWord.end : endTime;

  // Guards against a pathological snap (shouldn't happen in practice - a
  // clip is always many word-durations long) rather than ever returning an
  // inverted or zero-length range.
  if (snappedStart >= snappedEnd) {
    return { startTime, endTime };
  }
  return { startTime: snappedStart, endTime: snappedEnd };
}

// The module's single entry point: JSON in, JSON out, validated against
// @speedora/contracts's Zod schema before returning (defense in depth on top
// of the manual sanitization below - the LLM's response_format is already
// strict, but this is the module's own contract boundary, not OpenAI's).
export async function scoreClipCandidates(
  input: ClipScoringInput,
  deps: ScoreClipCandidatesDeps,
): Promise<ClipScoringOutput> {
  const { segments } = input;
  if (segments.length === 0) {
    return { candidates: [] };
  }

  const videoStart = Math.min(...segments.map((segment) => segment.start));
  const videoEnd = Math.max(...segments.map((segment) => segment.end));
  const span = videoEnd - videoStart;
  const transcriptText = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join('\n');

  // Clamp the minimum to the video's own length so a genuinely short source
  // (e.g. a 15s talk) can still produce its single whole-video candidate,
  // while a normal-length video can't yield a too-short fragment. The prompt
  // is told this same adapted minimum so it isn't asked for a length the
  // source physically can't provide.
  const effectiveMinSeconds = Math.min(MIN_CLIP_SECONDS, span);
  const promptMinSeconds = Math.max(1, Math.round(effectiveMinSeconds));

  const completion = await deps.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You select the most engaging, shareable moments from a video transcript for ' +
          'short-form vertical clips (TikTok/Reels/Shorts). Pick 1-3 non-overlapping clips, ' +
          'using only timestamps within ' +
          `${videoStart.toFixed(1)}-${videoEnd.toFixed(1)} seconds. Prioritize completeness ` +
          'over hitting an exact duration: each clip must capture a COMPLETE, self-contained ' +
          'moment - the full build-up AND its payoff/conclusion, long enough to make sense on ' +
          'its own to someone who has not seen the rest of the video. Do NOT return short ' +
          'fragments, a single sentence cut off mid-thought, or a moment truncated before its ' +
          'natural conclusion just to fit a shorter duration. Each clip must still be between ' +
          `${promptMinSeconds} and ${MAX_CLIP_SECONDS} seconds long - if the best moment's ` +
          `natural, complete arc would need more than ${MAX_CLIP_SECONDS} seconds, choose a ` +
          'different moment whose complete arc actually fits within that limit, rather than ' +
          'cutting off part of a longer one. Start at a natural opening and end at a natural ' +
          'conclusion. Score each clip 0-100 for how ' +
          'likely it is to go viral (viralityScore). For each clip, also write hookText: a ' +
          'short opening line (spoken in the first ~3 seconds) rewritten to hook a scrolling ' +
          'viewer - it does not have to be an exact transcript quote. Also give hashtags: 3-8 ' +
          'relevant social hashtags as plain lowercase words, no leading "#" and no spaces ' +
          'within a word.\n\n' +
          'Additionally, analyze each clip on these dimensions:\n' +
          '- scores: rate 0-100 on each of hookStrength (how strong the first few seconds ' +
          'grab attention), educationalValue (how much the viewer learns), practicalValue ' +
          "(how much a viewer could immediately APPLY this clip's information with minimal " +
          'additional knowledge - score higher when there are clear steps, followable ' +
          'instructions, a concrete example, a checklist/procedure, or a directly-applicable ' +
          'solution, and especially when the clip answers a "how do I" question; score lower ' +
          'when the clip is only opinion, only motivation/inspiration with no concrete ' +
          'takeaway, purely theoretical, a story with no actionable step, or too abstract to ' +
          'act on), curiosity (how much it makes someone want to keep watching), emotion ' +
          '(emotional intensity), storytelling (how well-formed the narrative arc is), ' +
          'novelty (how surprising/unexpected the content is), trustAuthority (how credible/' +
          'authoritative the speaker comes across), ctaStrength (how persuasive/compelling ' +
          'the call-to-action is - 0 if the clip has no call-to-action at all).\n' +
          '- reason: 1-2 sentences explaining IN PLAIN LANGUAGE why this specific clip was ' +
          'chosen over the rest of the video - this is shown directly to the end user as the ' +
          'explanation for the pick, so write it for a human, not a log message.\n' +
          '- topics: 1-3 short topic tags for what this clip is about.\n' +
          '- keywords: 3-8 important keywords/phrases actually said in this clip.\n' +
          '- intent: classify the clip as exactly one of educate, entertain, persuade, ' +
          'inspire, story, or other.\n' +
          '- ctaText: if the speaker gives a call-to-action in this clip (e.g. "follow for ' +
          'part 2", "comment below", "link in bio"), quote/paraphrase it here; otherwise an ' +
          'empty string.\n\n' +
          'Write hookText, hashtags, reason, topics, and keywords all in the same language as ' +
          'the transcript.',
      },
      {
        role: 'user',
        content: `Transcript:\n${transcriptText}`,
      },
    ],
    response_format: RESPONSE_FORMAT,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { candidates: [] };
  }

  const parsed = JSON.parse(raw) as { candidates: RawCandidate[] };

  const inRange = parsed.candidates
    .filter(
      (candidate) =>
        candidate.endTime > candidate.startTime &&
        candidate.startTime >= videoStart &&
        candidate.endTime <= videoEnd,
    )
    .map((candidate) => ({
      ...candidate,
      viralityScore: Math.max(0, Math.min(100, candidate.viralityScore)),
      hookText: candidate.hookText.trim(),
      // Belt-and-suspenders, not trusting the schema/prompt alone: strip a
      // leading '#' and blank entries in case the model ignores the "no #"
      // instruction anyway.
      hashtags: sanitizeHashtags(candidate.hashtags),
      scores: clampScores(candidate.scores),
      reason: candidate.reason.trim(),
      topics: sanitizeStrings(candidate.topics),
      keywords: sanitizeStrings(candidate.keywords),
      ctaText: candidate.ctaText.trim(),
    }))
    .sort((a, b) => b.viralityScore - a.viralityScore);

  const longEnough = inRange
    .filter((candidate) => candidate.endTime - candidate.startTime >= effectiveMinSeconds)
    .slice(0, MAX_CANDIDATES);

  const finalCandidates: RawCandidate[] =
    longEnough.length > 0
      ? longEnough
      : // The model returned only too-short (or no usable) clips. Rather than
        // leave the video with zero clips, fall back to a single clip
        // spanning the whole transcript, reusing the best in-range
        // candidate's hook/hashtags/score when there is one. In practice
        // this only fires for very short sources; a normal-length video
        // yields plenty of clips above the minimum.
        [
          {
            startTime: videoStart,
            endTime: videoEnd,
            viralityScore: inRange[0]?.viralityScore ?? 50,
            hookText: inRange[0]?.hookText ?? '',
            hashtags: inRange[0]?.hashtags ?? [],
            scores: inRange[0]?.scores ?? NEUTRAL_SCORES,
            reason: inRange[0]?.reason ?? 'Video pendek - seluruh durasi dijadikan satu klip.',
            topics: inRange[0]?.topics ?? [],
            keywords: inRange[0]?.keywords ?? [],
            intent: inRange[0]?.intent ?? 'other',
            ctaText: inRange[0]?.ctaText ?? '',
          },
        ];

  // Fase 8 follow-up (Smart Start/End) - the LLM works from segment text
  // annotated with rounded (0.1s) timestamps in the prompt, not the audio
  // itself, so its chosen boundaries can land a fraction of a second into
  // or before a word. Snapping to the actual nearest word boundary avoids a
  // clip that visibly opens or closes mid-word/mid-syllable.
  const allWords = flattenWords(segments);
  const candidates: ClipScoringCandidate[] = finalCandidates.map((candidate) => ({
    ...candidate,
    ...snapToWordBoundaries(candidate.startTime, candidate.endTime, allWords),
  }));

  return clipScoringOutputSchema.parse({ candidates });
}
