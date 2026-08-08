import { normalizeEvidence } from './normalize-evidence';
import {
  facialEmotionSample,
  gestureSample,
  objectTrack,
  ocrTrack,
  sceneCutEvent,
  speakerTimelineEntry,
  transcriptSegment,
} from './test-fixtures';

const EMPTY_INPUT = {
  transcript: [],
  sceneCutEvents: [],
  ocrTracks: [],
  objectTracks: [],
  facialEmotions: [],
  gestures: [],
  speakerTimeline: [],
};

describe('normalizeEvidence', () => {
  it('returns nothing for a completely empty input', () => {
    expect(normalizeEvidence(EMPTY_INPUT)).toEqual([]);
  });

  it('maps a transcript segment to transcript evidence, with speaker attribution', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      transcript: [
        transcriptSegment({ start: 10, end: 11.5, text: 'lihat angka ini', speaker: 'Speaker A' }),
      ],
    });

    expect(result).toContainEqual({
      id: 'transcript:0',
      modality: 'transcript',
      startTime: 10,
      endTime: 11.5,
      speakerId: 'Speaker A',
      value: 'lihat angka ini',
      confidence: null,
      provenance: 'transcript',
    });
  });

  it('maps a transcript segment with audio readings to a separate audio evidence item', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      transcript: [
        transcriptSegment({
          start: 0,
          end: 1,
          rmsDb: -18.2,
          peakDb: -6,
          speakingRateWordsPerSecond: 3.1,
        }),
      ],
    });

    const audio = result.find((item) => item.modality === 'audio');
    expect(audio).toMatchObject({ id: 'audio:0', startTime: 0, endTime: 1 });
    expect(audio?.value).toContain('rms');
  });

  it('does not fabricate audio evidence when a segment has no audio readings at all', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      transcript: [transcriptSegment({})],
    });

    expect(result.some((item) => item.modality === 'audio')).toBe(false);
  });

  it('maps a scene cut event to zero-width instant evidence', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      sceneCutEvents: [sceneCutEvent({ t: 5, type: 'hard_cut' })],
    });

    expect(result).toContainEqual({
      id: 'scene:0',
      modality: 'scene',
      startTime: 5,
      endTime: 5,
      speakerId: null,
      value: 'hard_cut',
      confidence: null,
      provenance: 'sceneCutEvents',
    });
  });

  it('maps an OCR track to interval evidence carrying its own confidence', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      ocrTracks: [ocrTrack({ startTime: 4, endTime: 6, text: '$500 Million', confidence: 0.95 })],
    });

    expect(result).toContainEqual({
      id: 'ocr:0',
      modality: 'ocr',
      startTime: 4,
      endTime: 6,
      speakerId: null,
      value: '$500 Million',
      confidence: 0.95,
      provenance: 'ocrTracks',
    });
  });

  it('maps an object track to interval evidence', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      objectTracks: [objectTrack({ startTime: 4, endTime: 6, category: 'car', confidence: 0.7 })],
    });

    expect(result).toContainEqual({
      id: 'object:0',
      modality: 'object',
      startTime: 4,
      endTime: 6,
      speakerId: null,
      value: 'car',
      confidence: 0.7,
      provenance: 'objectTracks',
    });
  });

  it('maps a classified facial emotion sample to instant evidence', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      facialEmotions: [facialEmotionSample({ t: 3, emotion: 'surprise', score: 0.6 })],
    });

    expect(result).toContainEqual({
      id: 'face:0',
      modality: 'face',
      startTime: 3,
      endTime: 3,
      speakerId: null,
      value: 'surprise',
      confidence: 0.6,
      provenance: 'facialEmotions',
    });
  });

  it('skips a facial emotion sample with no face found', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      facialEmotions: [facialEmotionSample({ emotion: null, score: null })],
    });

    expect(result.some((item) => item.modality === 'face')).toBe(false);
  });

  it('maps a recognized gesture sample to instant evidence', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      gestures: [gestureSample({ t: 2, gesture: 'pointing_up', confidence: 0.75 })],
    });

    expect(result).toContainEqual({
      id: 'gesture:0',
      modality: 'gesture',
      startTime: 2,
      endTime: 2,
      speakerId: null,
      value: 'pointing_up',
      confidence: 0.75,
      provenance: 'gestures',
    });
  });

  it.each([null, 'none'] as const)('skips a gesture sample of %p', (gesture) => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      gestures: [gestureSample({ gesture })],
    });

    expect(result.some((item) => item.modality === 'gesture')).toBe(false);
  });

  it('maps a speaker timeline entry to interval evidence with speaker attribution', () => {
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      speakerTimeline: [speakerTimelineEntry({ speaker: 'Speaker A', start: 0, end: 2 })],
    });

    expect(result).toContainEqual({
      id: 'speaker:0',
      modality: 'speaker',
      startTime: 0,
      endTime: 2,
      speakerId: 'Speaker A',
      value: 'Speaker A speaking',
      confidence: null,
      provenance: 'speakerTimeline',
    });
  });

  it('does not read raw active-speaker samples - speakerTimeline is the only speaker evidence source', () => {
    // No activeSpeakerSamples field exists on NormalizeEvidenceInput at all - this test exists to
    // document that omission is deliberate (see normalize-evidence.ts's module comment), not an
    // oversight to "fix" later.
    const result = normalizeEvidence({
      ...EMPTY_INPUT,
      speakerTimeline: [speakerTimelineEntry({})],
    });

    expect(result.filter((item) => item.modality === 'speaker')).toHaveLength(1);
  });
});
