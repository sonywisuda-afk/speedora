import { z } from 'zod';

// Formalizes apps/worker/src/diarization.ts's own `SpeakerTurn` interface
// (pyannote/speaker-diarization-community-1, see docs/ai/audio.md) as a real
// Zod contract - it existed only as a plain TS interface with an unchecked
// `JSON.parse(stdout) as SpeakerTurn[]` cast, unlike every other Python-
// subprocess-backed detector in this codebase (e.g.
// detectFaceLandmarksOutputSchema.parse(...) in
// @speedora/facial-intelligence) - a gap this file exists to close. `start`/
// `end` are absolute seconds against the full video/audio track (diarization
// runs once per video, not per-clip - see docs/ai/audio.md), NOT clip-
// relative like most other raw samples in this pipeline. `speaker` is the
// friendly "Speaker A"/"Speaker B" label assigned by `diarizeSpeakers`'s
// caller, first-appearance order - never pyannote's raw `SPEAKER_00` id.
export const speakerTurnSchema = z.object({
  start: z.number(),
  end: z.number(),
  speaker: z.string(),
});

export const diarizeSpeakersOutputSchema = z.array(speakerTurnSchema);

// Speaker Intelligence Phase 0 (Production Diarization Foundation) - the
// categories apps/worker/scripts/diarize_speakers.py's structured stderr
// error object (`{"error": true, "category": ..., "message": ...}`) can
// report, parsed by apps/worker/src/diarization.ts into a DiarizationError.
// "dependency_missing" is the exact bug this phase fixes in the Docker
// image (torch/pyannote.audio/soundfile weren't installed) - it should
// never occur in production again once that's fixed, which is what makes
// it a useful, low-noise alert-engine signal (see
// alert-engine.worker.ts's diarizationDependencyMissingRule) rather than
// something that needs a calibrated threshold. The others are pre-existing
// failure modes this phase gives a name to for the first time, not new
// behavior.
export const DIARIZATION_FAILURE_CATEGORIES = [
  'dependency_missing',
  'missing_token',
  'model_access_denied',
  'network',
  'timeout',
  'internal',
] as const;
export const diarizationFailureCategorySchema = z.enum(DIARIZATION_FAILURE_CATEGORIES);
export type DiarizationFailureCategory = (typeof DIARIZATION_FAILURE_CATEGORIES)[number];

// Everything below is a NEW aggregation over the turn list above - none of
// it is computed anywhere in this codebase yet (assignSpeakerLabels only
// maps turns onto Whisper segments, it doesn't aggregate). A future
// deriveDiarizationFeatures() would compute these from diarizeSpeakers' own
// raw output.
export const speakerSegmentSchema = z.object({
  speaker: z.string(),
  start: z.number(),
  end: z.number(),
  durationSeconds: z.number().min(0),
});

// 2+ turns whose [start, end) ranges overlap - pyannote's own turn output
// CAN represent overlapping speech (its diarization pipeline is not
// single-speaker-per-instant by construction), but assignSpeakerLabels
// currently discards that nuance by picking one largest-overlap speaker per
// Whisper segment - detecting this for real needs the turns themselves, not
// the segment-mapped labels currently persisted. Reserved until a caller
// consumes diarizeSpeakers' raw turn list directly instead of only the
// per-segment labels.
export const overlappingSpeechIntervalSchema = z.object({
  start: z.number(),
  end: z.number(),
  speakers: z.array(z.string()).min(2),
});

export const silenceIntervalSchema = z.object({
  start: z.number(),
  end: z.number(),
});

export const diarizationFeaturesSchema = z.object({
  speakerCount: z.number().int().min(0),
  segments: z.array(speakerSegmentSchema),
  // Speaker label -> total seconds spoken, across the whole video.
  speakerDurationsSeconds: z.record(z.string(), z.number().min(0)),
  turnCount: z.number().int().min(0),
  // Turns where the speaker differs from the immediately preceding turn -
  // "Speaker Switch Detection" from the roadmap; NOT the same as turnCount
  // (two consecutive turns CAN share a speaker after a false-positive turn
  // split).
  switchCount: z.number().int().min(0),
  overlappingSpeech: z.array(overlappingSpeechIntervalSchema),
  // Gaps between turns with no speaker at all - distinct from
  // voice-activity.ts's `silence` category (that's an acoustic VAD reading;
  // this is "no diarization turn covers this interval", which can also
  // happen when diarization simply didn't run this far, not only during
  // acoustic silence).
  silences: z.array(silenceIntervalSchema),
});

// Speaker Metadata - gender/language are RESERVED fields: no detector for
// either exists in this codebase (would need a dedicated voice/face
// classifier neither pyannote-diarization nor any current module provides) -
// always null until one is built, same "reserved key, not fabricated data"
// convention as voice-activity.ts's noise/music/crowd categories.
export const SPEAKER_GENDERS = ['male', 'female'] as const;
export type SpeakerGender = (typeof SPEAKER_GENDERS)[number];

export const speakerMetadataSchema = z.object({
  speakerId: z.string(),
  faceTrackId: z.number().int().nullable(),
  gender: z.enum(SPEAKER_GENDERS).nullable(),
  language: z.string().nullable(),
  durationSeconds: z.number().min(0),
  confidence: z.number().min(0).max(1).nullable(),
});

export type SpeakerTurn = z.infer<typeof speakerTurnSchema>;
export type SpeakerSegment = z.infer<typeof speakerSegmentSchema>;
export type OverlappingSpeechInterval = z.infer<typeof overlappingSpeechIntervalSchema>;
export type SilenceInterval = z.infer<typeof silenceIntervalSchema>;
export type DiarizationFeatures = z.infer<typeof diarizationFeaturesSchema>;
export type SpeakerMetadata = z.infer<typeof speakerMetadataSchema>;
