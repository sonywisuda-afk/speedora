import {
  HOOK_SENTIMENTS,
  hookLinguisticFeaturesSchema,
  type HookLinguisticFeatures,
  type HookPredictionSegment,
} from '@speedora/contracts';
import { callStructured, type StructuredCallDeps } from '@speedora/llm-client';

const RESPONSE_FORMAT = {
  name: 'hook_linguistic_features',
  schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: HOOK_SENTIMENTS },
      dominantEmotion: { type: 'string' },
      surpriseScore: { type: 'number' },
      controversyScore: { type: 'number' },
      keywordRarityScore: { type: 'number' },
      topicShiftScore: { type: 'number' },
      questionDensity: { type: 'number' },
      numericFactCount: { type: 'number' },
      namedEntities: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'sentiment',
      'dominantEmotion',
      'surpriseScore',
      'controversyScore',
      'keywordRarityScore',
      'topicShiftScore',
      'questionDensity',
      'numericFactCount',
      'namedEntities',
    ],
    additionalProperties: false,
  },
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// The one genuinely new signal Hook Prediction adds (ADR D5) - every other
// input it uses already exists elsewhere in this codebase. Reuses
// @speedora/llm-client's callStructured rather than calling
// deps.openai.chat.completions.create directly (ADR D3), the same "module's
// only external call goes through injected deps" convention as
// clip-scoring's scoreClipCandidates.
export async function extractLinguisticFeatures(
  segments: HookPredictionSegment[],
  deps: StructuredCallDeps,
): Promise<HookLinguisticFeatures> {
  const transcriptText = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join('\n');

  const raw = await callStructured<HookLinguisticFeatures>(
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You analyze a short-form video clip transcript for its HOOK potential - how ' +
            'likely the opening is to stop someone scrolling. Rate the transcript as a whole ' +
            'on these dimensions:\n' +
            '- sentiment: overall tone, exactly one of positive, negative, neutral, mixed.\n' +
            '- dominantEmotion: the single strongest emotion conveyed by the WORDS (not the ' +
            'voice), as a short lowercase label (e.g. "curiosity", "anger", "excitement").\n' +
            '- surpriseScore (0-1): how unexpected/surprising the content is.\n' +
            '- controversyScore (0-1): how likely this content is to provoke disagreement or ' +
            'strong reactions.\n' +
            '- keywordRarityScore (0-1): how unusual/specific (vs. generic/common) the ' +
            "clip's vocabulary is - higher for jargon, specific numbers/names, niche terms.\n" +
            '- topicShiftScore (0-1): how much the topic changes within the clip - 0 for a ' +
            'single sustained topic, 1 for an abrupt pivot.\n' +
            '- questionDensity (0-1): the fraction of the clip that poses a genuine question ' +
            'to the viewer or a rhetorical question.\n' +
            '- numericFactCount: count of distinct numeric facts/statistics actually stated ' +
            '(e.g. "$500 million", "30 percent", "10 years").\n' +
            '- namedEntities: distinct proper nouns mentioned (people, companies, places, ' +
            'products) - short array, no duplicates.',
        },
        { role: 'user', content: `Transcript:\n${transcriptText}` },
      ],
      responseFormat: RESPONSE_FORMAT,
    },
    deps,
  );

  return hookLinguisticFeaturesSchema.parse({
    ...raw,
    surpriseScore: clamp01(raw.surpriseScore),
    controversyScore: clamp01(raw.controversyScore),
    keywordRarityScore: clamp01(raw.keywordRarityScore),
    topicShiftScore: clamp01(raw.topicShiftScore),
    questionDensity: clamp01(raw.questionDensity),
    numericFactCount: Math.max(0, Math.round(raw.numericFactCount)),
  });
}
