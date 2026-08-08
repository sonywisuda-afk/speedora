import { z } from 'zod';

// AI Intelligence v4, Phase 2 (see docs/ai/intelligence-v4.md) - Semantic
// Event Detection's own prerequisite: spec Part 6 (Multimodal Reasoning)
// pulled forward as a small, standalone correlation utility rather than a
// Semantic-Event-Detection-only private detail, since the roadmap already
// names two more future consumers (Emotional Arc/Retention Curve, Virality
// Engine's reasoning) - same "extract standalone ahead of a second real
// consumer" precedent as packages/primary-subject.
//
// A GroundedFact is deliberately NOT causal to event detection - the LLM
// reasons over transcript text alone (packages/semantic-events'
// extract-raw-events.ts); grounding is a separate, deterministic
// post-processing step (@speedora/multimodal-reasoning's
// findConcurrentEvidence) that cites whichever already-computed OcrTextTrack/
// ObjectTrack entries were on screen around a detected event's timestamp -
// keeps the LLM prompt simple and the grounding logic independently
// testable.
export const GROUNDED_FACT_SOURCES = ['ocr', 'object'] as const;
export type GroundedFactSource = (typeof GROUNDED_FACT_SOURCES)[number];

export const groundedFactSchema = z.object({
  source: z.enum(GROUNDED_FACT_SOURCES),
  // The OCR track's own text, or the object track's category label -
  // whichever concurrent signal this fact cites.
  text: z.string(),
  // Clip-relative seconds - the track's own representative timestamp
  // (midpoint of its [startTime, endTime] span), not the event's t.
  t: z.number(),
});
export type GroundedFact = z.infer<typeof groundedFactSchema>;

// AI Intelligence v4, Phase 11 (Multimodal Reasoning Engine - see docs/ai/
// intelligence-v4.md, spec Part 6). GroundedFact above stays exactly as it
// is - it's Phase 2's own frozen contract (SemanticEvent.evidence), not
// touched by this phase. Everything below is a SEPARATE, richer evidence
// model built for genuine cross-modal reasoning (not just "what was on
// screen near this LLM-detected event"), living in the same file because
// both are Part 6 material, not because they share a schema.
//
// The 7 modalities below (everything except 'object') are Part 6's own
// NORMATIVE list: Transcript, Scene, OCR, Face, Gesture, Audio, Speaker.
// 'object' (Object Intelligence's objectTracks) is a deliberate, DOCUMENTED
// EXTENSION, not a spec requirement - it's mature/shipped, and
// findConcurrentEvidence above already treats it as on-screen evidence
// alongside OCR, so excluding it here would discard real, available signal
// for no reason. Any code/docs describing this modality list must keep that
// distinction explicit rather than silently claiming Part 6 asks for 8
// sources. `timing` is deliberately NOT a modality of its own - Part 6
// treats it as a dimension every piece of evidence carries
// (startTime/endTime below), not a signal source in its own right.
export const MODALITY_SOURCES = [
  'transcript',
  'scene',
  'ocr',
  'face',
  'gesture',
  'audio',
  'speaker',
  'object',
] as const;
export type ModalitySource = (typeof MODALITY_SOURCES)[number];

// One normalized, evidence-agnostic observation - the common shape every
// modality's own raw sample/track/segment gets mapped into before temporal
// grouping/reasoning, so the reasoning step never has to special-case 8
// different upstream shapes. `id` is stable only within one clip's own
// MultimodalReasoningResult (e.g. "ocr:0"), referenced by
// MultimodalConnection.evidenceRefs below - the concrete mechanism that
// lets a connection be traced back to real, resolvable evidence instead of
// trusted at face value (see @speedora/multimodal-reasoning's
// validateConnections).
export const multimodalEvidenceSchema = z.object({
  id: z.string(),
  modality: z.enum(MODALITY_SOURCES),
  // Clip-relative seconds. Instant-sampled modalities (scene/face/gesture)
  // collapse to a zero-width interval (startTime === endTime) rather than a
  // separate optional `t` field - one shape every caller reasons about,
  // instead of two.
  startTime: z.number(),
  endTime: z.number(),
  // Null when this evidence has no known speaker attribution (e.g. a scene
  // cut, an on-screen OCR block) - not the same as "attribution failed".
  speakerId: z.string().nullable(),
  // A short, human-readable summary of what this evidence actually says -
  // the OCR track's text, the gesture's label, the facial emotion's label,
  // the transcript segment's own text, etc. Never fabricated; always a
  // direct read of the source signal's own value.
  value: z.string(),
  // This evidence's OWN detector confidence, when the source signal has
  // one (OCR/object/gesture/active-speaker do; scene cuts/transcript
  // segments don't) - a CODE-COMPUTED reading carried through unchanged,
  // distinct from MultimodalConnection.confidence below (which is the LLM's
  // own self-reported certainty about a RELATIONSHIP, not about this
  // evidence's existence). Full taxonomy: docs/ai/intelligence-v4.md's
  // "Phase 8 architecture (as shipped)" section.
  confidence: z.number().min(0).max(1).nullable(),
  // Which render-graph node id this evidence was normalized from (e.g.
  // "ocrTracks", "gestures") - traceability back to the source detector,
  // independent of `modality` (a debugging/audit aid, not consumed by
  // reasoning itself).
  provenance: z.string(),
});
export type MultimodalEvidence = z.infer<typeof multimodalEvidenceSchema>;

// Deliberately small and closed (same "keep relation taxonomy small"
// discipline as NARRATIVE_RELATION_TYPES's 2 values) - a bigger vocabulary
// multiplies prompt-engineering/labeling risk without a clear product need
// yet:
//   refers_to     - one evidence (typically transcript/speaker) verbally
//                   references what another evidence shows (Part 6's own
//                   example: "lihat angka ini" -> OCR "$500 Million").
//   co_occurs_with - evidence overlaps temporally across modalities without
//                   a verbal reference tying them together (e.g. a gesture
//                   and a scene change happening at the same moment, with
//                   no speech pointing at either).
//   emphasizes    - one evidence (typically gesture/face/audio) intensifies
//                   or underscores a moment another evidence establishes.
//                   Must be grounded in the evidence itself (e.g. a
//                   pointing gesture, a raised-intensity vocal moment, a
//                   surprised facial expression concurrent with the
//                   referenced moment) - never inferred merely from two
//                   evidence items sharing a timestamp (that's
//                   co_occurs_with).
export const MULTIMODAL_RELATION_TYPES = ['refers_to', 'co_occurs_with', 'emphasizes'] as const;
export type MultimodalRelationType = (typeof MULTIMODAL_RELATION_TYPES)[number];

// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no production engagement
// data exists yet to calibrate confidence against. Never present these as
// ML-model output downstream (UI copy, API docs) without this caveat.
export const multimodalConnectionSchema = z.object({
  relation: z.enum(MULTIMODAL_RELATION_TYPES),
  // References MultimodalReasoningResult.evidence[].id - at least 2, and
  // (once validated by @speedora/multimodal-reasoning's
  // validateConnections) always resolving to real evidence actually sent to
  // the LLM. This is the hallucination-guard mechanism: a connection whose
  // evidenceRefs don't all resolve is dropped, not repaired.
  evidenceRefs: z.array(z.string()).min(2),
  // The DISTINCT modalities spanned by evidenceRefs above, RECOMPUTED from
  // the resolved evidence by validateConnections - never trusted as
  // reported by the LLM itself. A real cross-modal connection has >= 2
  // distinct values here; validateConnections drops anything that doesn't.
  modalities: z.array(z.enum(MODALITY_SOURCES)),
  // Clip-relative seconds spanning the connection's own evidence.
  startTime: z.number(),
  endTime: z.number(),
  // LLM-SELF-REPORTED certainty about this RELATIONSHIP, not a
  // code-computed coverage fraction - same "kind of confidence" as
  // SemanticEvent.confidence/NarrativeSegment.confidence, unlike
  // HookPredictionOutput.confidence/ViralityPrediction.confidence. Full
  // taxonomy: docs/ai/intelligence-v4.md's "Phase 8 architecture (as
  // shipped)" section.
  confidence: z.number().min(0).max(1),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as SemanticEvent/NarrativeSegment's own `reason`
  // field.
  reason: z.string(),
});
export type MultimodalConnection = z.infer<typeof multimodalConnectionSchema>;

// The module's full output (see @speedora/multimodal-reasoning's
// reasonMultimodal()). `evidence` is the COMPLETE normalized evidence list
// actually considered for this clip - not just the evidence cited by
// `connections` - so a caller/debugger can see exactly what the reasoning
// step had available, independent of what it concluded. An empty
// `connections` array (evidence non-empty) is a REAL, SUCCESSFUL result -
// the LLM ran and genuinely found nothing groundable to connect, same
// "a degenerate-but-real result isn't an error" convention as Phase 2's
// empty SemanticEvent[]/Phase 3's `unsegmented: true`.
export const multimodalReasoningResultSchema = z.object({
  clipId: z.string(),
  evidence: z.array(multimodalEvidenceSchema),
  connections: z.array(multimodalConnectionSchema),
  // How many evidence items were normalized per modality - a CODE-COMPUTED
  // coverage signal (which modalities this clip actually had data for),
  // distinct from any connection's own LLM-self-reported confidence. Keys
  // are ModalitySource values, absent (not zero) for modalities with no
  // evidence at all - z.record(z.string(), ...) rather than
  // z.record(z.enum(MODALITY_SOURCES), ...) deliberately, since zod infers
  // an enum-keyed record's TS type as requiring every key present even
  // though it validates a genuinely partial object fine at runtime (a known
  // zod wart) - same "sparse numeric tally" shape as
  // speaker-diarization.ts's speakerDurationsSeconds.
  modalityCoverage: z.record(z.string(), z.number().int().nonnegative()),
});
export type MultimodalReasoningResult = z.infer<typeof multimodalReasoningResultSchema>;
