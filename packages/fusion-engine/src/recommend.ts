import type { FusionPrediction, FusionRecommendation } from '@speedora/contracts';
import type { WeightedFeature } from './feature-pipeline';

// Step 8: Recommendation. Turns the prediction bucket into one concrete,
// actionable next step - for a low-performing clip, derived from the
// single WEAKEST weighted contribution (the "biggest lever" among the
// signals that actually counted toward the score), not just the bucket
// alone. Deterministic mapping, not a trained model - same honesty as the
// rest of this engine.
const ACTION_BY_FEATURE: Record<string, string> = {
  averageRmsDb: 'boost_audio_energy',
  speakingRateStdDev: 'vary_pacing',
  cutsPerMinute: 'add_visual_dynamism',
  dominantEmotionWeight: 'add_hook',
  dominantGestureWeight: 'add_hook',
  peakConfidence: 'review_manually',
  stability: 'review_manually',
  'engagement.hookStrength': 'add_hook',
  'engagement.curiosity': 'add_hook',
  'engagement.emotion': 'add_hook',
  'engagement.storytelling': 'tighten_story',
  'knowledge.educationalValue': 'clarify_takeaway',
  'knowledge.practicalValue': 'add_actionable_steps',
  'knowledge.novelty': 'clarify_takeaway',
  'knowledge.trustAuthority': 'clarify_takeaway',
  'conversion.ctaStrength': 'strengthen_cta',
};

const MESSAGE_BY_FEATURE: Record<string, string> = {
  averageRmsDb:
    'Vocal energy is low - consider a louder/more energetic take or normalizing audio levels.',
  speakingRateStdDev:
    'Delivery pace is flat - varying speaking rate can make the clip feel more dynamic.',
  cutsPerMinute: 'Visual dynamism is low - consider adding a cutaway/B-roll or a faster edit.',
  dominantEmotionWeight:
    'Facial expression is low-arousal - consider a clip moment with a stronger reaction.',
  dominantGestureWeight:
    'Hand gestures are minimal - not necessarily a problem, but a more expressive moment could help.',
  peakConfidence:
    'Classification confidence was low for this signal - consider a clearer shot of the speaker.',
  stability: 'This signal is inconsistent across the clip - consider a more focused moment.',
  'engagement.hookStrength':
    'The opening does not grab attention strongly - consider a punchier hook line.',
  'engagement.curiosity':
    'The clip does not build much curiosity - consider teasing the payoff earlier.',
  'engagement.emotion':
    'Emotional intensity is low - consider a moment with a stronger emotional beat.',
  'engagement.storytelling':
    'The narrative arc feels underdeveloped - consider a clip with a clearer setup/payoff.',
  'knowledge.educationalValue':
    'The clip teaches little - consider a moment that explains more of the "why".',
  'knowledge.practicalValue':
    'The clip is light on directly-applicable steps - consider a moment with a clear ' +
    'how-to, example, or checklist rather than opinion/theory alone.',
  'knowledge.novelty':
    'The content feels expected rather than surprising - consider a more novel angle.',
  'knowledge.trustAuthority':
    'The speaker comes across less credible here - consider a moment establishing expertise.',
  'conversion.ctaStrength':
    'The call-to-action is weak or missing - consider adding a clear, specific ask.',
};

const DEFAULT_ACTION = 'review_manually';
const DEFAULT_MESSAGE = 'Review this clip for ways to make it more engaging.';

export function buildRecommendation(
  prediction: FusionPrediction,
  weighted: WeightedFeature[],
): FusionRecommendation {
  if (prediction.bucket === 'likely_high_performer') {
    return {
      action: 'publish_as_is',
      message: 'This clip scores well across the available signals - ready to publish as-is.',
    };
  }

  if (prediction.bucket === 'uncertain') {
    return {
      action: 'review_manually',
      message: 'Signals are mixed or incomplete - review this clip manually before publishing.',
    };
  }

  // likely_low_performer - find the single weakest scored contribution to
  // suggest a specific, targeted fix rather than a generic message.
  const scored = weighted.filter((item) => item.weight > 0);
  if (scored.length === 0) {
    return {
      action: DEFAULT_ACTION,
      message: 'No weighted signals were available - review this clip manually.',
    };
  }

  const weakest = scored.reduce((min, item) =>
    item.normalizedValue < min.normalizedValue ? item : min,
  );

  return {
    action: ACTION_BY_FEATURE[weakest.feature] ?? DEFAULT_ACTION,
    message: MESSAGE_BY_FEATURE[weakest.feature] ?? DEFAULT_MESSAGE,
  };
}
