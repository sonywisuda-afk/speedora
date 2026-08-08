import type {
  FacialEmotionSample,
  GestureSample,
  MultimodalEvidence,
  ObjectTrack,
  OcrTextTrack,
  SceneCutEvent,
  SpeakerTimelineEntry,
} from '@speedora/contracts';

// A deliberately narrow view of TranscriptSegment (ARCHITECTURE.md's "adapter narrows ctx data"
// convention) - clip-relative already (the render-graph adapter re-anchors ctx.transcript onto
// this clip's own clock BEFORE calling in, same "segment.start - startTime" convention as
// nodes/semantic-events.ts's toSemanticEventSegments/nodes/hook-prediction.ts's
// toHookPredictionSegments).
export interface NormalizeEvidenceTranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  rmsDb?: number | null;
  peakDb?: number | null;
  speakingRateWordsPerSecond?: number | null;
}

export interface NormalizeEvidenceInput {
  transcript: NormalizeEvidenceTranscriptSegment[];
  sceneCutEvents: SceneCutEvent[];
  ocrTracks: OcrTextTrack[];
  objectTracks: ObjectTrack[];
  facialEmotions: FacialEmotionSample[];
  gestures: GestureSample[];
  // The canonical "who is speaking when" stream for this module - already fuses
  // speaker-diarization's turns with Active Speaker Detection/Speaker-Face Association (see
  // speakerTimelineEntrySchema's own doc comment), so raw ActiveSpeakerSample[] is deliberately
  // NOT a separate input here - it would be redundant evidence about the same underlying signal
  // (which face/track is active), not a second independent modality.
  speakerTimeline: SpeakerTimelineEntry[];
}

function transcriptEvidence(
  segment: NormalizeEvidenceTranscriptSegment,
  index: number,
): MultimodalEvidence {
  return {
    id: `transcript:${index}`,
    modality: 'transcript',
    startTime: segment.start,
    endTime: segment.end,
    speakerId: segment.speaker ?? null,
    value: segment.text,
    // Whisper's own output carries no per-segment transcription-confidence figure in this
    // codebase's contract - null here is honest absence, not a fabricated 1.0.
    confidence: null,
    provenance: 'transcript',
  };
}

// Audio evidence is deliberately read off the SAME TranscriptSegment, not a separate raw stream -
// @speedora/audio-intelligence's own AudioFeatures is a clip-wide aggregate with no timestamp of
// its own (see this package's module comment / docs/ai/intelligence-v4.md's Phase 11 audit); the
// only place a per-instant audio reading exists is TranscriptSegment.rmsDb/peakDb/
// speakingRateWordsPerSecond, timed by that same segment's start/end. Returns null when the
// segment has no audio reading at all (analysis never ran/failed) - not fabricated.
function audioEvidence(
  segment: NormalizeEvidenceTranscriptSegment,
  index: number,
): MultimodalEvidence | null {
  const parts: string[] = [];
  if (segment.rmsDb != null) parts.push(`rms ${segment.rmsDb.toFixed(1)}dB`);
  if (segment.peakDb != null) parts.push(`peak ${segment.peakDb.toFixed(1)}dB`);
  if (segment.speakingRateWordsPerSecond != null) {
    parts.push(`${segment.speakingRateWordsPerSecond.toFixed(1)} words/s`);
  }
  if (parts.length === 0) return null;

  return {
    id: `audio:${index}`,
    modality: 'audio',
    startTime: segment.start,
    endTime: segment.end,
    speakerId: segment.speaker ?? null,
    value: parts.join(', '),
    confidence: null,
    provenance: 'transcript',
  };
}

function sceneEvidence(event: SceneCutEvent, index: number): MultimodalEvidence {
  return {
    id: `scene:${index}`,
    modality: 'scene',
    startTime: event.t,
    endTime: event.t,
    speakerId: null,
    value: event.type,
    confidence: null,
    provenance: 'sceneCutEvents',
  };
}

function ocrEvidence(track: OcrTextTrack, index: number): MultimodalEvidence {
  return {
    id: `ocr:${index}`,
    modality: 'ocr',
    startTime: track.startTime,
    endTime: track.endTime,
    speakerId: null,
    value: track.text,
    confidence: track.confidence,
    provenance: 'ocrTracks',
  };
}

// Object Intelligence is a documented EXTENSION beyond Part 6's own 7 normative modalities (see
// packages/contracts/src/multimodal-reasoning.ts's MODALITY_SOURCES comment) - included because
// it's mature/shipped and findConcurrentEvidence already treats it as on-screen evidence
// alongside OCR.
function objectEvidence(track: ObjectTrack, index: number): MultimodalEvidence {
  return {
    id: `object:${index}`,
    modality: 'object',
    startTime: track.startTime,
    endTime: track.endTime,
    speakerId: null,
    value: track.category,
    confidence: track.confidence,
    provenance: 'objectTracks',
  };
}

// Skips samples with no classified emotion (no face found in that sampled frame) - not fabricated
// "neutral" evidence, same null-vs-value distinction the source contract itself documents.
function faceEvidence(sample: FacialEmotionSample, index: number): MultimodalEvidence | null {
  if (sample.emotion === null) return null;
  return {
    id: `face:${index}`,
    modality: 'face',
    startTime: sample.t,
    endTime: sample.t,
    speakerId: null,
    value: sample.emotion,
    confidence: sample.score,
    provenance: 'facialEmotions',
  };
}

// Skips samples with no hand detected (`gesture: null`) AND samples where a hand was detected but
// matched no recognized gesture (`gesture: 'none'`) - neither carries meaningful cross-modal
// signal for reasoning, same "not every raw sample is evidence" posture as faceEvidence above.
function gestureEvidence(sample: GestureSample, index: number): MultimodalEvidence | null {
  if (sample.gesture === null || sample.gesture === 'none') return null;
  return {
    id: `gesture:${index}`,
    modality: 'gesture',
    startTime: sample.t,
    endTime: sample.t,
    speakerId: null,
    value: sample.gesture,
    confidence: sample.confidence,
    provenance: 'gestures',
  };
}

function speakerEvidence(entry: SpeakerTimelineEntry, index: number): MultimodalEvidence {
  return {
    id: `speaker:${index}`,
    modality: 'speaker',
    startTime: entry.start,
    endTime: entry.end,
    speakerId: entry.speaker,
    value: `${entry.speaker} speaking`,
    // isActiveOnScreen is a boolean, not a confidence figure - no code-computed confidence exists
    // for a speaker-timeline interval itself (the confidence figures live on the raw
    // ActiveSpeakerSample/SpeakerFaceAssociation this timeline was built from, not on the fused
    // interval).
    confidence: null,
    provenance: 'speakerTimeline',
  };
}

// The module's evidence-normalization step (see this package's reasonMultimodal() for the full
// pipeline) - maps every already-computed, already-clip-relative raw signal into one common
// MultimodalEvidence shape, via an exhaustive per-modality mapper (Contract Governance rule 1's
// exhaustiveness spirit - adding a 9th MODALITY_SOURCES member without a mapper here is a design
// smell to catch in review, same as every other small taxonomy in this codebase). Pure/synchronous,
// no LLM/DB access.
export function normalizeEvidence(input: NormalizeEvidenceInput): MultimodalEvidence[] {
  const evidence: MultimodalEvidence[] = [];

  input.transcript.forEach((segment, index) => evidence.push(transcriptEvidence(segment, index)));
  input.transcript.forEach((segment, index) => {
    const item = audioEvidence(segment, index);
    if (item) evidence.push(item);
  });
  input.sceneCutEvents.forEach((event, index) => evidence.push(sceneEvidence(event, index)));
  input.ocrTracks.forEach((track, index) => evidence.push(ocrEvidence(track, index)));
  input.objectTracks.forEach((track, index) => evidence.push(objectEvidence(track, index)));
  input.facialEmotions.forEach((sample, index) => {
    const item = faceEvidence(sample, index);
    if (item) evidence.push(item);
  });
  input.gestures.forEach((sample, index) => {
    const item = gestureEvidence(sample, index);
    if (item) evidence.push(item);
  });
  input.speakerTimeline.forEach((entry, index) => evidence.push(speakerEvidence(entry, index)));

  return evidence;
}
