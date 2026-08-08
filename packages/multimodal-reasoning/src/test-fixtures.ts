// Shared builder helpers for this package's own spec files - NOT a spec file itself (doesn't match
// jest's `.spec.ts$` testRegex), just a fixture module several spec files import from to avoid
// re-declaring the same realistic per-modality shapes 5 times over.
import type {
  FacialEmotionSample,
  GestureSample,
  MultimodalEvidence,
  ObjectTrack,
  OcrTextTrack,
  SceneCutEvent,
  SpeakerTimelineEntry,
} from '@speedora/contracts';
import type { NormalizeEvidenceTranscriptSegment } from './normalize-evidence';

const BOUNDING_BOX = { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.1 };

export function transcriptSegment(
  overrides: Partial<NormalizeEvidenceTranscriptSegment> = {},
): NormalizeEvidenceTranscriptSegment {
  return {
    start: 0,
    end: 1,
    text: 'default text',
    ...overrides,
  };
}

export function ocrTrack(overrides: Partial<OcrTextTrack> = {}): OcrTextTrack {
  return {
    trackId: 1,
    text: 'default text',
    boundingBox: BOUNDING_BOX,
    confidence: 0.9,
    startTime: 0,
    endTime: 1,
    durationSeconds: 1,
    appearsFrames: 3,
    persistenceScore: 0.5,
    motionScore: null,
    nearFace: null,
    language: null,
    regexFlags: { isPriceLike: false, isNameLike: false },
    category: 'subtitle',
    categoryConfidence: 0.8,
    classificationMethod: 'HybridRuleEngine',
    ...overrides,
  };
}

export function objectTrack(overrides: Partial<ObjectTrack> = {}): ObjectTrack {
  return {
    trackId: 1,
    category: 'person',
    boundingBox: BOUNDING_BOX,
    confidence: 0.9,
    startTime: 0,
    endTime: 1,
    durationSeconds: 1,
    appearsFrames: 3,
    persistenceScore: 0.5,
    motionSpeed: null,
    motionDirection: null,
    occlusionScore: 0.1,
    interactionConfidence: 0.2,
    attentionScore: 0.5,
    attentionConfidence: 0.5,
    ...overrides,
  };
}

export function sceneCutEvent(overrides: Partial<SceneCutEvent> = {}): SceneCutEvent {
  return { t: 0, type: 'hard_cut', ...overrides };
}

export function facialEmotionSample(
  overrides: Partial<FacialEmotionSample> = {},
): FacialEmotionSample {
  return { t: 0, emotion: 'happy', score: 0.8, ...overrides };
}

export function gestureSample(overrides: Partial<GestureSample> = {}): GestureSample {
  return { t: 0, gesture: 'pointing_up', confidence: 0.8, ...overrides };
}

export function speakerTimelineEntry(
  overrides: Partial<SpeakerTimelineEntry> = {},
): SpeakerTimelineEntry {
  return {
    speaker: 'Speaker A',
    start: 0,
    end: 1,
    faceTrackId: null,
    isActiveOnScreen: null,
    ...overrides,
  };
}

export function evidence(overrides: Partial<MultimodalEvidence> = {}): MultimodalEvidence {
  return {
    id: 'transcript:0',
    modality: 'transcript',
    startTime: 0,
    endTime: 1,
    speakerId: null,
    value: 'default value',
    confidence: null,
    provenance: 'transcript',
    ...overrides,
  };
}
