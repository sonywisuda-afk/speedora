import type { ObjectTrack, OcrTextTrack } from '@speedora/contracts';
import { findConcurrentEvidence } from './find-concurrent-evidence';

const BOUNDING_BOX = { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.1 };

function ocrTrack(overrides: Partial<OcrTextTrack>): OcrTextTrack {
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

function objectTrack(overrides: Partial<ObjectTrack>): ObjectTrack {
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

describe('findConcurrentEvidence', () => {
  it('returns empty when no tracks overlap the window', () => {
    const ocr = [ocrTrack({ startTime: 20, endTime: 21, text: 'far away' })];
    const objects = [objectTrack({ startTime: 20, endTime: 21, category: 'car' })];

    expect(findConcurrentEvidence(5, 2, ocr, objects)).toEqual([]);
  });

  it('includes an OCR track whose span overlaps the window', () => {
    const ocr = [ocrTrack({ startTime: 4, endTime: 6, text: '$500 Million' })];

    const result = findConcurrentEvidence(5, 2, ocr, []);

    expect(result).toEqual([{ source: 'ocr', text: '$500 Million', t: 5 }]);
  });

  it('includes an object track whose span overlaps the window', () => {
    const objects = [objectTrack({ startTime: 4, endTime: 6, category: 'laptop' })];

    const result = findConcurrentEvidence(5, 2, [], objects);

    expect(result).toEqual([{ source: 'object', text: 'laptop', t: 5 }]);
  });

  it('excludes a track that ends exactly at the window start (touching, not overlapping)', () => {
    const ocr = [ocrTrack({ startTime: 1, endTime: 3, text: 'touching' })];

    // window is [3, 7] - track ends exactly at 3, no real overlap.
    expect(findConcurrentEvidence(5, 2, ocr, [])).toEqual([]);
  });

  it('deduplicates identical (source, text) pairs from multiple nearby tracks', () => {
    const ocr = [
      ocrTrack({ trackId: 1, startTime: 4, endTime: 5, text: 'Breaking News' }),
      ocrTrack({ trackId: 2, startTime: 5, endTime: 6, text: 'Breaking News' }),
    ];

    const result = findConcurrentEvidence(5, 2, ocr, []);

    expect(result).toHaveLength(1);
  });

  it('sorts by proximity to t and caps at 3 results', () => {
    const ocr = [
      ocrTrack({ trackId: 1, startTime: 3, endTime: 3.5, text: 'far' }), // midpoint 3.25, distance 1.75
      ocrTrack({ trackId: 2, startTime: 4.8, endTime: 5.2, text: 'near' }), // midpoint 5.0, distance 0
      ocrTrack({ trackId: 3, startTime: 4, endTime: 4.6, text: 'mid' }), // midpoint 4.3, distance 0.7
    ];
    const objects = [
      objectTrack({ trackId: 1, startTime: 4, endTime: 6, category: 'a' }),
      objectTrack({ trackId: 2, startTime: 4, endTime: 6, category: 'b' }),
    ];

    const result = findConcurrentEvidence(5, 2, ocr, objects);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ source: 'ocr', text: 'near', t: 5 });
  });
});
