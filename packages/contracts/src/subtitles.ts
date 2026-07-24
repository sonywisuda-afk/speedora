import { z } from 'zod';
import { transcriptWordSchema } from './transcript-word';

// Mirrors CaptionStyle in packages/shared (which itself mirrors
// packages/database's Prisma enum) - duplicated here rather than imported,
// same reasoning as clip-scoring's CLIP_INTENTS: this contract package has
// no dependency on packages/shared or packages/database in either direction.
export const CAPTION_STYLES = ['DEFAULT', 'KARAOKE', 'BOLD_HIGHLIGHT'] as const;
export const captionStyleSchema = z.enum(CAPTION_STYLES);

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
});

export type CaptionStyleValue = z.infer<typeof captionStyleSchema>;
export type SubtitleSegment = z.infer<typeof subtitleSegmentSchema>;
export type BuildAssInput = z.infer<typeof buildAssInputSchema>;
