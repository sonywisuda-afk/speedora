import type { ClassifyConversationTypeInput, ConversationTypeResult } from '@speedora/contracts';

// Speaker Intelligence Phase C - implements the classifier
// packages/contracts/src/conversation-intelligence.ts's own header comment
// already named as "contracts-first, no classifying function implemented
// yet." A deliberately simple, named-constant decision tree over
// speakerCount/turnCount/switchCount/averageTurnDurationSeconds - the ONLY
// signals this input carries. Explicitly NOT a trained model and NOT
// calibrated against real engagement data (see coding-standards.md's
// "scale honesty" convention) - confidence reflects how far a clip sits
// from a threshold boundary, not a statistical certainty.
//
// 'presentation' is a real member of CONVERSATION_TYPES this classifier can
// never currently produce - distinguishing "one person presenting slides"
// from "one person telling a story" needs a signal this input doesn't
// carry (visual/OCR context, not diarization stats). Left as an honest gap
// rather than a guessed heuristic that would silently misclassify.

const LONG_TURN_SECONDS = 20;
const SHORT_TURN_SECONDS = 8;
// How close switchCount is to the maximum possible (turnCount - 1, i.e.
// alternating every turn) before a multi-speaker clip reads as "debate"-like
// rapid exchange rather than a more measured "discussion".
const HIGH_ALTERNATION_RATIO = 0.6;

function alternationRatio(input: ClassifyConversationTypeInput): number | null {
  if (input.turnCount < 2) return null;
  return input.switchCount / (input.turnCount - 1);
}

export function classifyConversationType(
  input: ClassifyConversationTypeInput,
): ConversationTypeResult {
  const { speakerCount, averageTurnDurationSeconds } = input;

  if (speakerCount === 0) {
    // No diarization data at all (never ran, or found zero turns) - not
    // enough to classify, not a fabricated default.
    return { type: null, confidence: null };
  }

  if (speakerCount === 1) {
    // Solo talking-head - see the brief's own "multi-speaker vs solo
    // content" rule (section 13): a single speaker is always 'monologue'
    // here regardless of turn count, never penalized for having many
    // (self-)turns.
    return { type: 'monologue', confidence: 0.9 };
  }

  const alternation = alternationRatio(input);
  const longTurns =
    averageTurnDurationSeconds !== null && averageTurnDurationSeconds >= LONG_TURN_SECONDS;
  const shortTurns =
    averageTurnDurationSeconds !== null && averageTurnDurationSeconds <= SHORT_TURN_SECONDS;

  if (speakerCount === 2) {
    if (longTurns) {
      // Long, infrequently-switching turns between exactly two people -
      // the shape of a long-form two-host conversation.
      return { type: 'podcast', confidence: 0.6 };
    }
    if (shortTurns && alternation !== null && alternation >= HIGH_ALTERNATION_RATIO) {
      // Short, rapidly-alternating turns - question/answer rhythm.
      return { type: 'interview', confidence: 0.6 };
    }
    return { type: 'discussion', confidence: 0.4 };
  }

  // speakerCount >= 3
  if (alternation !== null && alternation >= HIGH_ALTERNATION_RATIO) {
    return { type: 'debate', confidence: 0.55 };
  }
  return { type: 'discussion', confidence: 0.4 };
}
