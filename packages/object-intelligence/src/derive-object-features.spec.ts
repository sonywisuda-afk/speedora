import type { ObjectTrack } from '@speedora/contracts';
import { deriveObjectFeatures } from './derive-object-features';

function track(overrides: Partial<ObjectTrack> = {}): ObjectTrack {
  return {
    trackId: 0,
    category: 'person',
    boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.6 },
    confidence: 0.9,
    startTime: 0,
    endTime: 2,
    durationSeconds: 2,
    appearsFrames: 3,
    persistenceScore: 0.5,
    motionSpeed: null,
    motionDirection: null,
    occlusionScore: 0,
    interactionConfidence: 0,
    attentionScore: 0.5,
    attentionConfidence: 0.6,
    ...overrides,
  };
}

describe('deriveObjectFeatures', () => {
  it('returns all-null fields when there were zero samples', () => {
    const result = deriveObjectFeatures([], 0);
    expect(result).toEqual({
      objectCount: null,
      dominantObject: null,
      averageObjectsPerFrame: null,
      averageTrackingConfidence: null,
      averagePersistence: null,
      averageMotionSpeed: null,
      averageOcclusionScore: null,
      averageInteractionConfidence: null,
      averageAttentionScore: null,
      averageAttentionConfidence: null,
    });
  });

  it('returns a real objectCount of 0 (not null) when samples ran but found no objects', () => {
    const result = deriveObjectFeatures([], 10);
    expect(result).toEqual({
      objectCount: 0,
      dominantObject: null,
      averageObjectsPerFrame: 0,
      averageTrackingConfidence: null,
      averagePersistence: null,
      averageMotionSpeed: null,
      averageOcclusionScore: null,
      averageInteractionConfidence: null,
      averageAttentionScore: null,
      averageAttentionConfidence: null,
    });
  });

  it('counts distinct tracks as objectCount', () => {
    const result = deriveObjectFeatures(
      [track({ trackId: 0 }), track({ trackId: 1, category: 'car' })],
      10,
    );
    expect(result.objectCount).toBe(2);
  });

  it('picks the category with the most appearsFrames-weighted count as dominantObject', () => {
    const result = deriveObjectFeatures(
      [
        track({ trackId: 0, category: 'person', appearsFrames: 8 }),
        track({ trackId: 1, category: 'car', appearsFrames: 2 }),
      ],
      10,
    );
    expect(result.dominantObject).toBe('person');
  });

  it('breaks a dominantObject tie toward the first-occurring track', () => {
    const result = deriveObjectFeatures(
      [
        track({ trackId: 0, category: 'car', appearsFrames: 5 }),
        track({ trackId: 1, category: 'person', appearsFrames: 5 }),
      ],
      10,
    );
    expect(result.dominantObject).toBe('car');
  });

  it('computes averageObjectsPerFrame as total appearsFrames across all tracks divided by totalSamples', () => {
    const result = deriveObjectFeatures(
      [
        track({ trackId: 0, appearsFrames: 6 }),
        track({ trackId: 1, category: 'car', appearsFrames: 4 }),
      ],
      10,
    );
    expect(result.averageObjectsPerFrame).toBe(1);
  });

  it('computes averageTrackingConfidence and averagePersistence as the mean across tracks', () => {
    const result = deriveObjectFeatures(
      [
        track({ trackId: 0, confidence: 0.8, persistenceScore: 0.4 }),
        track({ trackId: 1, confidence: 0.6, persistenceScore: 0.2 }),
      ],
      10,
    );
    expect(result.averageTrackingConfidence).toBeCloseTo(0.7);
    expect(result.averagePersistence).toBeCloseTo(0.3);
  });

  // Batch OI-2.
  describe('averageMotionSpeed', () => {
    it('averages motionSpeed only across tracks that have a computable value', () => {
      const result = deriveObjectFeatures(
        [
          track({ trackId: 0, motionSpeed: 0.8 }),
          track({ trackId: 1, motionSpeed: 0.4 }),
          // Single-appearance track - no motionSpeed - excluded, not
          // treated as 0.
          track({ trackId: 2, motionSpeed: null }),
        ],
        10,
      );
      expect(result.averageMotionSpeed).toBeCloseTo(0.6);
    });

    it('is null when no tracks have a computable motionSpeed', () => {
      const result = deriveObjectFeatures([track({ trackId: 0, motionSpeed: null })], 10);
      expect(result.averageMotionSpeed).toBeNull();
    });
  });

  // Batch OI-3.
  describe('averageOcclusionScore', () => {
    it('averages occlusionScore across all tracks (never excluded, unlike motionSpeed)', () => {
      const result = deriveObjectFeatures(
        [
          track({ trackId: 0, occlusionScore: 0.8 }),
          track({ trackId: 1, occlusionScore: 0.2 }),
        ],
        10,
      );
      expect(result.averageOcclusionScore).toBeCloseTo(0.5);
    });

    it('is 0 when no tracks ever overlapped with another object', () => {
      const result = deriveObjectFeatures(
        [track({ trackId: 0, occlusionScore: 0 }), track({ trackId: 1, occlusionScore: 0 })],
        10,
      );
      expect(result.averageOcclusionScore).toBe(0);
    });

    it('is null only when there are zero tracks at all', () => {
      const result = deriveObjectFeatures([], 10);
      expect(result.averageOcclusionScore).toBeNull();
    });
  });

  // Batch OI-4.
  describe('averageInteractionConfidence', () => {
    it('averages interactionConfidence across all tracks (never excluded, unlike motionSpeed)', () => {
      const result = deriveObjectFeatures(
        [
          track({ trackId: 0, interactionConfidence: 0.8 }),
          track({ trackId: 1, interactionConfidence: 0.2 }),
        ],
        10,
      );
      expect(result.averageInteractionConfidence).toBeCloseTo(0.5);
    });

    it('is null only when there are zero tracks at all', () => {
      const result = deriveObjectFeatures([], 10);
      expect(result.averageInteractionConfidence).toBeNull();
    });
  });

  // Batch OI-5.
  describe('averageAttentionScore and averageAttentionConfidence', () => {
    it('averages attentionScore and attentionConfidence across all tracks (never excluded)', () => {
      const result = deriveObjectFeatures(
        [
          track({ trackId: 0, attentionScore: 0.8, attentionConfidence: 1 }),
          track({ trackId: 1, attentionScore: 0.2, attentionConfidence: 0.4 }),
        ],
        10,
      );
      expect(result.averageAttentionScore).toBeCloseTo(0.5);
      expect(result.averageAttentionConfidence).toBeCloseTo(0.7);
    });

    it('is null only when there are zero tracks at all', () => {
      const result = deriveObjectFeatures([], 10);
      expect(result.averageAttentionScore).toBeNull();
      expect(result.averageAttentionConfidence).toBeNull();
    });
  });
});
