import { z } from 'zod';

// Speaker Intelligence roadmap, Level 3 - Conversation Type Classification.
// Derived purely from already-computed speaker-diarization.ts features
// (speakerCount, turnCount, switchCount, turn-length distribution) via a
// deterministic heuristic - NOT a trained model, same "heuristic, not
// calibrated against real data" honesty as every other classification in
// this pipeline (see coding-standards.md). Contracts-first, no classifying
// function implemented yet.
export const CONVERSATION_TYPES = [
  'monologue',
  'interview',
  'discussion',
  'debate',
  'presentation',
  'podcast',
] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const classifyConversationTypeInputSchema = z.object({
  speakerCount: z.number().int().min(0),
  turnCount: z.number().int().min(0),
  switchCount: z.number().int().min(0),
  averageTurnDurationSeconds: z.number().min(0).nullable(),
});

// null type means there wasn't enough diarization data to classify at all
// (e.g. speakerCount is 0 - diarization never ran or found no turns) - not
// a fabricated default like 'monologue'.
export const conversationTypeResultSchema = z.object({
  type: z.enum(CONVERSATION_TYPES).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export type ClassifyConversationTypeInput = z.infer<typeof classifyConversationTypeInputSchema>;
export type ConversationTypeResult = z.infer<typeof conversationTypeResultSchema>;

// Speaker Intelligence Phase C (Conversation Dynamics) - per-CLIP metrics
// (not video-wide, unlike the docs' own audit of DiarizationFeatures),
// derived entirely from the clip-scoped SpeakerTurn[] already reconstructed
// per render (render-clip.worker.ts's toSpeakerTurns()) by re-running the
// SAME @speedora/speaker-diarization deriveDiarizationFeatures() this
// codebase already uses for the video-wide aggregate - zero new detectors,
// zero new subprocess calls, pure arithmetic over an already-computed turn
// list. See docs/ai/speaker-intelligence.md's Phase C section.
//
// null vs 0 discipline (same "never fabricate, null means no data"
// convention as every other derive function in this codebase):
// - turnCount/switchCount/turnDensityPerMinute/overlapRatio are always a
//   real number (0 is itself a real, meaningful answer - "zero turns" and
//   "zero overlap" are both true facts, not missing data).
// - averageTurnDurationSeconds/medianTurnDurationSeconds are null when
//   there are no turns at all (nothing to average).
// - backAndForthScore/responseLatencySeconds are null when there's fewer
//   than 2 turns, or no speaker CHANGE ever happens - a ratio/average over
//   zero data points is undefined, not zero.
export const conversationDynamicsSchema = z.object({
  speakerCount: z.number().int().min(0),
  turnCount: z.number().int().min(0),
  switchCount: z.number().int().min(0),
  turnDensityPerMinute: z.number().min(0),
  averageTurnDurationSeconds: z.number().min(0).nullable(),
  medianTurnDurationSeconds: z.number().min(0).nullable(),
  // 0-1: switchCount / (turnCount - 1), i.e. how close this clip is to
  // alternating speaker on EVERY turn (1.0) vs. one speaker holding the
  // floor across long runs of consecutive turns (near 0).
  backAndForthScore: z.number().min(0).max(1).nullable(),
  // Average gap (seconds, clamped to >= 0 - a negative gap means the turns
  // overlapped, treated as an instant/zero-latency response) between one
  // speaker's turn ending and a DIFFERENT speaker's next turn starting.
  responseLatencySeconds: z.number().min(0).nullable(),
  // Fraction of the clip's own duration covered by simultaneous speech
  // from 2+ speakers (overlapping intervals merged first, so 3-way overlap
  // at the same instant isn't double-counted).
  overlapRatio: z.number().min(0).max(1),
  // 0-1 heuristic composite of the three signals above (turnDensity
  // normalized against an assumed rapid-exchange ceiling, backAndForthScore,
  // overlapRatio) - same "scale honesty" convention as every other
  // heuristic composite in this codebase (see coding-standards.md): NOT
  // calibrated against real engagement data, not a trained model output.
  interactionIntensity: z.number().min(0).max(1),
});
export type ConversationDynamics = z.infer<typeof conversationDynamicsSchema>;
