import type { ObjectSample } from '@speedora/contracts';
import { trackObjects } from './track-objects';

function sample(
  t: number,
  detections: {
    category: string;
    box?: Partial<ObjectSample['objects'][number]['boundingBox']>;
    confidence?: number;
  }[],
): ObjectSample {
  return {
    t,
    objects: detections.map(({ category, box, confidence }) => ({
      category,
      boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6, ...box },
      confidence: confidence ?? 0.9,
    })),
  };
}

describe('trackObjects', () => {
  it('groups the same object at the same position across consecutive samples into one track', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person' }]),
      sample(1, [{ category: 'person' }]),
      sample(2, [{ category: 'person' }]),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      category: 'person',
      appearsFrames: 3,
      startTime: 0,
      endTime: 2,
    });
  });

  it('never merges a track across different categories, even at the identical position', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person' }]),
      sample(1, [{ category: 'car' }]),
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks.map((track) => track.category).sort()).toEqual(['car', 'person']);
  });

  it('tolerates up to two missed samples and continues the same track when the object reappears', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person' }]),
      sample(1, []), // missed - brief occlusion
      sample(2, []), // missed again - still within tolerance
      sample(3, [{ category: 'person' }]),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].appearsFrames).toBe(2);
    expect(tracks[0].startTime).toBe(0);
    expect(tracks[0].endTime).toBe(3);
  });

  it('ends a track (and starts a new one) when missed for more than the tolerance', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person' }]),
      sample(1, []),
      sample(2, []),
      sample(3, []), // third consecutive miss - exceeds MAX_MISS_SAMPLES (2)
      sample(4, [{ category: 'person' }]),
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({ appearsFrames: 1, startTime: 0, endTime: 0 });
    expect(tracks[1]).toMatchObject({ appearsFrames: 1, startTime: 4, endTime: 4 });
  });

  it('starts a new track when the same-category object moves too far away (low IoU)', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person', box: { xCenter: 0.1 } }]),
      sample(1, [{ category: 'person', box: { xCenter: 0.9 } }]), // zero overlap with the first
    ]);
    expect(tracks).toHaveLength(2);
  });

  it('tracks multiple simultaneous objects independently without cross-matching categories', () => {
    const tracks = trackObjects([
      sample(0, [
        { category: 'person', box: { xCenter: 0.2 } },
        { category: 'car', box: { xCenter: 0.8 } },
      ]),
      sample(1, [
        { category: 'person', box: { xCenter: 0.2 } },
        { category: 'car', box: { xCenter: 0.8 } },
      ]),
    ]);
    expect(tracks).toHaveLength(2);
    const person = tracks.find((track) => track.category === 'person');
    const car = tracks.find((track) => track.category === 'car');
    expect(person?.appearsFrames).toBe(2);
    expect(car?.appearsFrames).toBe(2);
  });

  it('returns an empty array for samples with no detections at all', () => {
    const tracks = trackObjects([sample(0, []), sample(1, [])]);
    expect(tracks).toEqual([]);
  });

  it('computes persistenceScore as appearsFrames divided by the total sample count', () => {
    const tracks = trackObjects([
      sample(0, [{ category: 'person' }]),
      sample(1, [{ category: 'person' }]),
      sample(2, []),
      sample(3, []),
    ]);
    expect(tracks[0].appearsFrames).toBe(2);
    expect(tracks[0].persistenceScore).toBe(0.5);
  });

  // Batch OI-2 - objectMotionSpeed/objectMotionDirection.
  describe('motionSpeed / motionDirection', () => {
    it('is null for both when the track only appeared in a single frame', () => {
      const tracks = trackObjects([sample(0, [{ category: 'person' }])]);
      expect(tracks[0].motionSpeed).toBeNull();
      expect(tracks[0].motionDirection).toBeNull();
    });

    it('is 0 speed and "static" direction for a perfectly stationary object', () => {
      const tracks = trackObjects([
        sample(0, [{ category: 'person', box: { xCenter: 0.3, yCenter: 0.5 } }]),
        sample(1, [{ category: 'person', box: { xCenter: 0.3, yCenter: 0.5 } }]),
      ]);
      expect(tracks[0].motionSpeed).toBe(0);
      expect(tracks[0].motionDirection).toBe('static');
    });

    it('detects rightward movement, with speed capped at 1 once the delta clears OBJECT_MOTION_CAP', () => {
      // A wide box (0.6) so a 0.2 displacement (comfortably above
      // OBJECT_MOTION_CAP's 0.15) still overlaps enough between samples to
      // satisfy MATCH_COST_THRESHOLD - too narrow a box would make the
      // object un-trackable by pure IoU matching at this displacement (see
      // this module's own "no Kalman-style prediction" caveat).
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.1, yCenter: 0.5, width: 0.6, height: 0.6 } },
        ]),
        sample(1, [
          { category: 'person', box: { xCenter: 0.3, yCenter: 0.5, width: 0.6, height: 0.6 } },
        ]),
      ]);
      expect(tracks[0].motionDirection).toBe('right');
      expect(tracks[0].motionSpeed).toBe(1);
    });

    it('detects downward movement', () => {
      const tracks = trackObjects([
        sample(0, [{ category: 'person', box: { xCenter: 0.5, yCenter: 0.1 } }]),
        sample(1, [{ category: 'person', box: { xCenter: 0.5, yCenter: 0.3 } }]),
      ]);
      expect(tracks[0].motionDirection).toBe('down');
    });

    it('detects a growing bounding box (approaching the camera) as "in"', () => {
      // A 1.5x size increase (not 2x) - large enough to read as zoom, small
      // enough that the smaller box stays fully inside the larger one, so
      // IoU still clears MATCH_COST_THRESHOLD.
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.6 } },
        ]),
        sample(1, [
          { category: 'person', box: { xCenter: 0.5, yCenter: 0.5, width: 0.3, height: 0.9 } },
        ]),
      ]);
      expect(tracks[0].motionDirection).toBe('in');
    });

    it('detects a shrinking bounding box (receding from the camera) as "out"', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.5, yCenter: 0.5, width: 0.3, height: 0.9 } },
        ]),
        sample(1, [
          { category: 'person', box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.6 } },
        ]),
      ]);
      expect(tracks[0].motionDirection).toBe('out');
    });
  });

  // Batch OI-3 - objectOcclusion.
  describe('occlusionScore', () => {
    it('is 0 when the object is alone in every frame', () => {
      const tracks = trackObjects([
        sample(0, [{ category: 'person' }]),
        sample(1, [{ category: 'person' }]),
      ]);
      expect(tracks[0].occlusionScore).toBe(0);
    });

    it('is 0 when another object is present but does not overlap at all', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.1 } },
          { category: 'car', box: { xCenter: 0.9 } },
        ]),
      ]);
      expect(tracks[0].occlusionScore).toBe(0);
      expect(tracks[1].occlusionScore).toBe(0);
    });

    it('is the IoU against the most-overlapping other object, regardless of category', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.3 } },
          { category: 'car', box: { xCenter: 0.4 } },
        ]),
      ]);
      // person spans x:[0.2,0.4], car spans x:[0.3,0.5] -> overlap 0.1,
      // intersection 0.06, union 0.18, iou = 1/3.
      const person = tracks.find((track) => track.category === 'person');
      const car = tracks.find((track) => track.category === 'car');
      expect(person?.occlusionScore).toBeCloseTo(1 / 3);
      expect(car?.occlusionScore).toBeCloseTo(1 / 3);
    });

    it('averages occlusion across a track\'s own appearances (occluded in one frame, alone in another)', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.3 } },
          { category: 'car', box: { xCenter: 0.4 } },
        ]),
        sample(1, [{ category: 'person', box: { xCenter: 0.3 } }]),
      ]);
      const person = tracks.find((track) => track.category === 'person');
      // (1/3 + 0) / 2.
      expect(person?.occlusionScore).toBeCloseTo(1 / 6);
    });
  });

  // Batch OI-4 - objectInteraction, exposed as interactionConfidence (an
  // unweighted mean of proximity, temporal co-presence, and distance
  // trend - see track-objects.ts's computeInteractionConfidence() for the
  // exact formula each test below is hand-verifying).
  describe('interactionConfidence', () => {
    it('is a low but non-zero baseline when the object is alone in every frame', () => {
      const tracks = trackObjects([
        sample(0, [{ category: 'person' }]),
        sample(1, [{ category: 'person' }]),
      ]);
      // proximity = 0 (never anyone nearby), temporalOverlap = 0 (no other
      // track to share screen time with), convergence = 0.5 (neutral - no
      // distance history to judge a trend from). average([0, 0, 0.5]) = 1/6.
      expect(tracks[0].interactionConfidence).toBeCloseTo(1 / 6);
    });

    it('combines proximity, (zero) temporal overlap, and (neutral) convergence for a single shared frame', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.3 } },
          { category: 'car', box: { xCenter: 0.4 } },
        ]),
      ]);
      // distance = 0.1 -> proximity = 1 - 0.1/0.4 = 0.75. Single appearance
      // -> durationSeconds 0 -> temporalOverlap 0, and only 1 distance
      // reading -> convergence stays neutral (0.5).
      // average([0.75, 0, 0.5]) = 1.25/3.
      const person = tracks.find((track) => track.category === 'person');
      expect(person?.interactionConfidence).toBeCloseTo(1.25 / 3);
    });

    it('scores full temporal overlap even when the objects are too far apart for any proximity', () => {
      const tracks = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.1 } },
          { category: 'car', box: { xCenter: 0.9 } },
        ]),
        sample(1, [
          { category: 'person', box: { xCenter: 0.1 } },
          { category: 'car', box: { xCenter: 0.9 } },
        ]),
        sample(2, [
          { category: 'person', box: { xCenter: 0.1 } },
          { category: 'car', box: { xCenter: 0.9 } },
        ]),
      ]);
      // distance = 0.8 throughout (beyond INTERACTION_DISTANCE_CAP of 0.4)
      // -> proximity clamps to 0, and a constant distance -> convergence
      // stays neutral (0.5). Both tracks span the exact same 3 samples ->
      // temporalOverlap = 1 (100% of this track's own duration overlaps
      // with the other track's). average([0, 1, 0.5]) = 0.5.
      const person = tracks.find((track) => track.category === 'person');
      expect(person?.interactionConfidence).toBeCloseTo(0.5);
    });

    it('scores higher when two co-present objects are converging (closing the gap) than diverging', () => {
      const converging = trackObjects([
        sample(0, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.8, width: 0.6, height: 0.6 } },
        ]),
        sample(1, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.8, width: 0.6, height: 0.6 } },
        ]),
        sample(2, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.6, width: 0.6, height: 0.6 } },
        ]),
        sample(3, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.6, width: 0.6, height: 0.6 } },
        ]),
      ]);
      const diverging = trackObjects([
        sample(0, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.6, width: 0.6, height: 0.6 } },
        ]),
        sample(1, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.6, width: 0.6, height: 0.6 } },
        ]),
        sample(2, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.8, width: 0.6, height: 0.6 } },
        ]),
        sample(3, [
          { category: 'person' },
          { category: 'car', box: { xCenter: 0.8, width: 0.6, height: 0.6 } },
        ]),
      ]);

      // person is stationary at the default xCenter 0.3 in every sample, so
      // distances are [0.5,0.5,0.3,0.3] (converging) / [0.3,0.3,0.5,0.5]
      // (diverging) - both share the same average distance (so the same
      // proximity contribution) and the same full temporal overlap, only
      // the trend differs.
      const convergingPerson = converging.find((track) => track.category === 'person');
      const divergingPerson = diverging.find((track) => track.category === 'person');
      expect(convergingPerson?.interactionConfidence).toBeGreaterThan(
        divergingPerson?.interactionConfidence ?? 0,
      );
    });
  });

  // Batch OI-5.
  describe('attentionConfidence', () => {
    it('scales with appearsFrames, capped at CONFIDENCE_FRAME_CAP (5)', () => {
      const single = trackObjects([sample(0, [{ category: 'person' }])]);
      expect(single[0].attentionConfidence).toBeCloseTo(1 / 5);

      const fiveFrames = trackObjects(
        Array.from({ length: 5 }, (_, i) => sample(i, [{ category: 'person' }])),
      );
      expect(fiveFrames[0].attentionConfidence).toBeCloseTo(1);

      const tenFrames = trackObjects(
        Array.from({ length: 10 }, (_, i) => sample(i, [{ category: 'person' }])),
      );
      expect(tenFrames[0].attentionConfidence).toBeCloseTo(1);
    });
  });

  describe('attentionScore', () => {
    it('combines Visibility, (neutral) Activity, and Social domains for a lone single-frame track', () => {
      const tracks = trackObjects([sample(0, [{ category: 'person', confidence: 0.9 }])]);
      // Visibility = average(confidence 0.9, persistenceScore 1/1, 1 -
      // occlusionScore 1) = 2.9/3.
      // Activity = 0.5 (neutral - single appearance, no motion data at all).
      // Social = average(interactionConfidence 1/6 [see interactionConfidence
      // describe block above], partnerScore 0, coPresence/temporalOverlap 0)
      // = (1/6)/3 = 1/18.
      // attentionScore = average(2.9/3, 0.5, 1/18).
      const expected = (2.9 / 3 + 0.5 + 1 / 18) / 3;
      expect(tracks[0].attentionScore).toBeCloseTo(expected);
    });

    it('scores a consistently-directional track higher than an equally-fast but alternating one (Activity domain)', () => {
      const consistent = trackObjects([
        sample(0, [{ category: 'person', box: { xCenter: 0.1 } }]),
        sample(1, [{ category: 'person', box: { xCenter: 0.2 } }]),
        sample(2, [{ category: 'person', box: { xCenter: 0.3 } }]),
        sample(3, [{ category: 'person', box: { xCenter: 0.4 } }]),
      ]);
      const alternating = trackObjects([
        sample(0, [{ category: 'person', box: { xCenter: 0.1 } }]),
        sample(1, [{ category: 'person', box: { xCenter: 0.2 } }]),
        sample(2, [{ category: 'person', box: { xCenter: 0.1 } }]),
        sample(3, [{ category: 'person', box: { xCenter: 0.2 } }]),
      ]);
      // Both tracks have identical motionSpeed (same 0.1 step magnitude
      // throughout) and identical Visibility/Social domains (both lone
      // tracks, same confidence/persistence/occlusion) - only
      // directionConsistency differs (1 for consistent, 0 for alternating),
      // so any attentionScore gap is attributable to that.
      expect(consistent[0].attentionScore).toBeGreaterThan(alternating[0].attentionScore);
    });

    it('scores a track with a nearby co-occurring partner higher than one alone (Social domain)', () => {
      const alone = trackObjects([
        sample(0, [{ category: 'person' }]),
        sample(1, [{ category: 'person' }]),
      ]);
      const withPartner = trackObjects([
        sample(0, [
          { category: 'person', box: { xCenter: 0.3 } },
          { category: 'car', box: { xCenter: 0.35 } },
        ]),
        sample(1, [
          { category: 'person', box: { xCenter: 0.3 } },
          { category: 'car', box: { xCenter: 0.35 } },
        ]),
      ]);
      const alonePerson = alone.find((track) => track.category === 'person');
      const partneredPerson = withPartner.find((track) => track.category === 'person');
      expect(partneredPerson?.attentionScore).toBeGreaterThan(alonePerson?.attentionScore ?? 1);
    });
  });
});
