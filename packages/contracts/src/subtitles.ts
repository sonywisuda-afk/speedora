import { z } from 'zod';
import { transcriptWordSchema } from './transcript-word';

// Mirrors CaptionStyle in packages/shared (which itself mirrors
// packages/database's Prisma enum) - duplicated here rather than imported,
// same reasoning as clip-scoring's CLIP_INTENTS: this contract package has
// no dependency on packages/shared or packages/database in either direction.
export const CAPTION_STYLES = ['DEFAULT', 'KARAOKE', 'BOLD_HIGHLIGHT'] as const;
export const captionStyleSchema = z.enum(CAPTION_STYLES);

// Numbers/percentages, ALL-CAPS-as-transcribed words, and quoted phrases -
// patterns that tend to carry emphasis on their own. Hoisted here (was
// previously local to @speedora/subtitles' build-ass.ts, which still
// re-exports it for its existing consumers) so @speedora/subtitle-rewriter
// (AI Intelligence v4 Track B, Phase A1 - see docs/ai/
// subtitle-intelligence.md, ADR DB6) can precompute the exact same
// emphasis decision at rewrite time that @speedora/subtitles' own
// BOLD_HIGHLIGHT renderer already makes live at render time, instead of
// each maintaining its own drifting copy.
export const KEYWORD_PATTERN = /\d|^[A-Z]{2,}$|^["“'].+["”']$/;

// Brand Kit roadmap (P3a) - a curated, OFL-licensed set (not arbitrary
// font-file upload - see the plan's own decision record) that must be
// bundled into apps/worker's Docker image (apps/worker/Dockerfile) and kept
// in sync with this list by hand, same "no build-time link between a
// Dockerfile and a TypeScript const" caveat that Dockerfile's own comment
// documents. The ASS Fontname build-ass.ts writes must exactly match each
// font file's own name-table family name for fontconfig/libass to resolve
// it - "Open Sans" (with the space), not "OpenSans".
export const FONT_FAMILIES = [
  'Inter',
  'Poppins',
  'Montserrat',
  'Roboto',
  'Oswald',
  'Nunito',
  'Open Sans',
  'Lato',
] as const;
export const fontFamilySchema = z.enum(FONT_FAMILIES);
const DEFAULT_FONT_FAMILY: (typeof FONT_FAMILIES)[number] = 'Inter';

// AI Intelligence v4 Track B, Phase B1/B2 (Dynamic Caption Engine, spec
// Part 8 - see docs/ai/subtitle-intelligence.md). Hoisted here (was
// previously defined in packages/contracts/src/dynamic-caption.ts) for the
// same reason KEYWORD_PATTERN was hoisted in Phase A1: this renderer
// contract file is the most "upstream" one in the subtitles/subtitle-
// rewriter/dynamic-caption import chain
// (subtitles.ts <- subtitle-rewriter.ts <- dynamic-caption.ts), so
// defining CaptionSizeTier/CaptionAnimation/TreatmentMoment here - where
// subtitleSegmentSchema itself now also consumes them (Phase B2) - avoids
// a circular import that defining them in dynamic-caption.ts and importing
// back into subtitles.ts would create. @speedora/dynamic-caption's own
// module code is unaffected - it already imports these by name from
// '@speedora/contracts' (the package root), never from a specific file.
//
// "High emotion -> large text; whisper -> small text" (spec Part 8).
// 'normal' is the majority-case default - most caption lines get no size
// change at all.
export const CAPTION_SIZE_TIERS = ['small', 'normal', 'large'] as const;
export const captionSizeTierSchema = z.enum(CAPTION_SIZE_TIERS);
export type CaptionSizeTier = z.infer<typeof captionSizeTierSchema>;

// "Shock -> punch animation; question -> attention animation" (spec Part
// 8) - 'none' is the majority-case default. Mutually exclusive with each
// other (a line gets at most one animation), and rate-limited across the
// whole clip so animation stays a highlight, not a constant flicker
// ("Do NOT overuse animation" - spec Part 8's own explicit constraint,
// enforced by @speedora/dynamic-caption's cooldown, not by this contract).
export const CAPTION_ANIMATIONS = ['none', 'punch', 'attention'] as const;
export const captionAnimationSchema = z.enum(CAPTION_ANIMATIONS);
export type CaptionAnimation = z.infer<typeof captionAnimationSchema>;

// One treatment decision per SubtitleLine (start/end mirror that line's
// own timing exactly - clip-relative seconds, same coordinate frame as
// SubtitleTimeline).
export const treatmentMomentSchema = z.object({
  start: z.number(),
  end: z.number(),
  sizeTier: captionSizeTierSchema,
  animation: captionAnimationSchema,
});
export type TreatmentMoment = z.infer<typeof treatmentMomentSchema>;

// A dense, 1:1-with-`SubtitleTimeline` array (not a filtered/sparse one
// like HighlightTimeline) - every caption line gets a real treatment
// decision, even when it's the 'normal'/'none' default. Bare array, no
// clipId wrapper - same shape as MomentumCurve/EmotionalArc (a single
// per-instant timeline, not a compound multi-array object like
// SubtitleIntelligence/RetentionCurveInsights).
export const captionTreatmentTimelineSchema = z.array(treatmentMomentSchema);
export type CaptionTreatmentTimeline = z.infer<typeof captionTreatmentTimelineSchema>;

// The subtitles module's OWN transcript segment shape - deliberately
// narrower than packages/shared's DB-hydrated TranscriptSegment (which also
// carries speaker/emotion labels this module never reads), same pattern as
// clip-scoring's own segment contract.
export const subtitleSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(transcriptWordSchema).optional(),
  // Subtitle Studio roadmap (P2c) - only read when BuildAssInput.
  // speakerColorCaptions is true; otherwise ignored. "Speaker A"/"Speaker
  // B"/... labels (see @speedora/diarization's assignSpeakerLabels) - the
  // same friendly, order-of-first-appearance format the DB row itself
  // stores, not the raw pyannote "SPEAKER_00" label.
  speaker: z.string().optional(),
  // AI Intelligence v4 Track B, Phase B2 (Dynamic Caption Engine render
  // wiring) - undefined for every caller that doesn't opt in (the raw-
  // transcript path, or smart segmentation without dynamicCaptions), in
  // which case buildAss() emits exactly the same output as before this
  // phase existed. Populated by the adapter (render-clip.worker.ts) by
  // index-zipping Clip.subtitleIntelligence.timeline with
  // Clip.captionTreatment - both computed from the exact same source
  // array by @speedora/dynamic-caption, so they're guaranteed the same
  // length/order; no separate timestamp-matching needed here.
  sizeTier: captionSizeTierSchema.optional(),
  animation: captionAnimationSchema.optional(),
});

export const buildAssInputSchema = z.object({
  segments: z.array(subtitleSegmentSchema),
  clipStart: z.number(),
  clipEnd: z.number(),
  style: captionStyleSchema,
  videoWidth: z.number(),
  videoHeight: z.number(),
  // Subtitle Studio roadmap (P2c) - orthogonal to `style` (composes with
  // any of the 3 presets rather than a combinatorial enum), defaults false.
  speakerColorCaptions: z.boolean().default(false),
  // Brand Kit roadmap (P3a) - defaults to Inter (not hardcoded 'Arial',
  // which was never actually guaranteed to render correctly - see
  // build-ass.ts's own comment) for a clip whose Brand Kit has no font
  // choice set yet.
  fontFamily: fontFamilySchema.default(DEFAULT_FONT_FAMILY),
});

export type CaptionStyleValue = z.infer<typeof captionStyleSchema>;
export type FontFamily = z.infer<typeof fontFamilySchema>;
export type SubtitleSegment = z.infer<typeof subtitleSegmentSchema>;
export type BuildAssInput = z.infer<typeof buildAssInputSchema>;
