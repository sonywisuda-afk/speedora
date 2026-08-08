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
