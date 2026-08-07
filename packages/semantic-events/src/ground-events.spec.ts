import type { ObjectTrack, OcrTextTrack } from '@speedora/contracts';
import { groundEvents } from './ground-events';
import type { RawSemanticEvent } from './extract-raw-events';

const BOUNDING_BOX = { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.1 };

function ocrTrack(overrides: Partial<OcrTextTrack>): OcrTextTrack {
  return {
    trackId: 1,
    text: '$500 Million',
    boundingBox: BOUNDING_BOX,
    confidence: 0.9,
    startTime: 4,
    endTime: 6,
    durationSeconds: 2,
    appearsFrames: 3,
    persistenceScore: 0.5,
    motionScore: null,
    nearFace: null,
    language: null,
    regexFlags: { isPriceLike: true, isNameLike: false },
    category: 'price',
    categoryConfidence: 0.9,
    classificationMethod: 'HybridRuleEngine',
    ...overrides,
  };
}

function objectTrack(overrides: Partial<ObjectTrack>): ObjectTrack {
  return {
    trackId: 1,
    category: 'chart',
    boundingBox: BOUNDING_BOX,
    confidence: 0.9,
    startTime: 4,
    endTime: 6,
    durationSeconds: 2,
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

describe('groundEvents', () => {
  it('attaches evidence concurrent with each event and keeps its LLM-provided reason', () => {
    const events: RawSemanticEvent[] = [
      { type: 'money', t: 5, confidence: 0.9, importance: 0.8, reason: 'states a specific figure' },
    ];

    const result = groundEvents(events, [ocrTrack({})], [objectTrack({})]);

    expect(result).toEqual([
      {
        type: 'money',
        t: 5,
        confidence: 0.9,
        importance: 0.8,
        reason: 'states a specific figure',
        evidence: [
          { source: 'ocr', text: '$500 Million', t: 5 },
          { source: 'object', text: 'chart', t: 5 },
        ],
      },
    ]);
  });

  it('returns empty evidence when nothing is concurrent, without failing', () => {
    const events: RawSemanticEvent[] = [
      { type: 'confession', t: 50, confidence: 0.6, importance: 0.5, reason: 'admits something' },
    ];

    const result = groundEvents(events, [ocrTrack({})], [objectTrack({})]);

    expect(result[0].evidence).toEqual([]);
  });

  it('falls back to describeEventType when the LLM reason is empty', () => {
    const events: RawSemanticEvent[] = [
      { type: 'warning', t: 1, confidence: 0.5, importance: 0.5, reason: '' },
    ];

    const result = groundEvents(events, [], []);

    expect(result[0].reason).toBe('The speaker cautions the viewer against something.');
  });
});
