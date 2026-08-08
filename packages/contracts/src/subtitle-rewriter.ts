import { z } from 'zod';
import { subtitleSegmentSchema } from './subtitles';
import { transcriptWordSchema } from './transcript-word';
import { momentumSampleSchema } from './contextual-momentum';
import { emotionalArcSampleSchema } from './emotional-arc';
import { semanticEventSchema } from './semantic-events';

// AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter, spec Part 7 -
// see docs/ai/subtitle-intelligence.md). STRUCTURAL re-chunking only (ADR
// DB1, resolved via AskUserQuestion before implementation started): every
// ASR word, word order, and word-level timestamp from the input `segments`
// passes through this module completely UNCHANGED - only which words group
// into which caption line, and which already-spoken words get flagged for
// bold/uppercase-style emphasis, may change. A future lexical-paraphrase
// capability is explicitly OUT OF SCOPE for this contract - see
// docs/ai/subtitle-intelligence.md's "Explicitly deferred" section.
//
// Zero LLM call, same shape as Phase 4/5/6/7/10 (DB2) - a pure composition
// over already-computed upstream signals (MomentumCurve/EmotionalArc/
// SemanticEvent[]/speaking rate), all independently OPTIONAL context that
// degrades gracefully when absent, same "optional context, never a hard
// dependency" pattern every phase since Phase 3 already uses.
//
// Every numeric threshold inside @speedora/subtitle-rewriter is a
// documented HEURISTIC (ADR D4, docs/coding-standards.md's "scale
// honesty") - no engagement/readability data exists to calibrate line-
// length/pause/momentum thresholds against. Never present this as a
// trained "optimal caption length" model downstream without this caveat.

// A single re-chunked caption line - `words` is the exact, UNMODIFIED
// sub-sequence of the source segment's own words that make up this line
// (same shape/values as the input, just grouped differently); `text` is
// simply those words joined by spaces, never independently generated.
// `emphasisWordIndices` are indices into `words` (not word text) so a
// consumer can restyle without re-deriving which words are "special" -
// selected via the SAME KEYWORD_PATTERN heuristic @speedora/subtitles'
// existing live BOLD_HIGHLIGHT renderer already uses (numbers/percentages,
// ALL-CAPS-as-transcribed words, quoted phrases), just precomputed here
// instead of at render time. Empty `words` (with a non-empty `text`) means
// this segment had no word-level timestamps at all - the same "can't do
// word-level anything" fallback @speedora/subtitles' karaoke/BOLD_HIGHLIGHT
// already falls back to (Tech Debt #8, docs/ai/subtitle-intelligence.md).
export const subtitleLineSchema = z.object({
  // Clip-relative seconds.
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(transcriptWordSchema),
  speaker: z.string().optional(),
  emphasisWordIndices: z.array(z.number().int().nonnegative()),
});
export type SubtitleLine = z.infer<typeof subtitleLineSchema>;

export const subtitleTimelineSchema = z.array(subtitleLineSchema);
export type SubtitleTimeline = z.infer<typeof subtitleTimelineSchema>;

// A "punch-worthy" moment (spec Part 8's Dynamic Caption Engine consumes
// this directly, without recomputing emotion/momentum/semantic-event
// signals itself - see docs/ai/subtitle-intelligence.md's dependency
// graph). `score` is RELATIVE within this clip's own moments only, same
// "not comparable across clips" caveat every other v4 0-1 score already
// carries. An empty HighlightTimeline is a real, honest "nothing punch-
// worthy found" result, same convention Phase 10's empty RetentionPoint
// arrays already use - not every clip has a shock/high-emotion beat.
export const highlightMomentSchema = z.object({
  start: z.number(),
  end: z.number(),
  score: z.number().min(0).max(1),
});
export type HighlightMoment = z.infer<typeof highlightMomentSchema>;

export const highlightTimelineSchema = z.array(highlightMomentSchema);
export type HighlightTimeline = z.infer<typeof highlightTimelineSchema>;

// A single per-clip object (like ViralityPrediction/RetentionCurveInsights),
// not itself a per-instant timeline - `timeline`/`highlights` are each
// their own array.
export const subtitleIntelligenceSchema = z.object({
  clipId: z.string(),
  timeline: subtitleTimelineSchema,
  highlights: highlightTimelineSchema,
});
export type SubtitleIntelligence = z.infer<typeof subtitleIntelligenceSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every context field
// is already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own. `segments` reuses @speedora/subtitles' own
// subtitleSegmentSchema directly (not a near-duplicate copy) - this
// module's input shape and @speedora/subtitles' rendering input shape are
// genuinely the same thing (start/end/text/words?/speaker?), just consumed
// one stage earlier in the pipeline.
export const computeSubtitleTimelineInputSchema = z.object({
  clipId: z.string(),
  segments: z.array(subtitleSegmentSchema),
  momentumCurve: z.array(momentumSampleSchema),
  emotionalArc: z.array(emotionalArcSampleSchema),
  semanticEvents: z.array(semanticEventSchema).nullable(),
  // AudioFeatures.averageSpeakingRateWordsPerSecond - already nullable at
  // its own source (a clip with zero transcribable words has none to
  // measure). null here degrades the word-per-line budget to its
  // unmodulated default rather than skipping rewriting altogether.
  averageSpeakingRateWordsPerSecond: z.number().nullable(),
});
export type ComputeSubtitleTimelineInput = z.infer<typeof computeSubtitleTimelineInputSchema>;
