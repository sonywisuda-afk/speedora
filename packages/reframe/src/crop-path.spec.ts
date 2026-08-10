import type { FaceSample, TranscriptWordInput } from '@speedora/contracts';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  findEmphasisWords,
} from './crop-path';

function word(text: string, start: number, end: number): TranscriptWordInput {
  return { word: text, start, end };
}

describe('computeCropDimensions', () => {
  it('crops width and keeps full height for a landscape (16:9) source', () => {
    const result = computeCropDimensions(1920, 1080);

    expect(result.height).toBe(1080);
    expect(result.width).toBeLessThan(1920);
    // Matches 9:16 within one rounding step (even-number rounding).
    expect(result.width / result.height).toBeCloseTo(9 / 16, 1);
  });

  it('crops height and keeps full width for an already-portrait source', () => {
    const result = computeCropDimensions(1080, 1920);

    expect(result.width).toBe(1080);
    expect(result.height).toBeLessThanOrEqual(1920);
  });

  it('always returns even dimensions (libx264/yuv420p requirement)', () => {
    const result = computeCropDimensions(321, 241);

    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });

  // Output Resolution/Quality audit, Phase 1 (foundation) - targetAspectRatio generalization.
  // Every existing call above (2-arg, default 9/16) is untouched by this parameter's addition.
  describe('targetAspectRatio override', () => {
    it('crops a landscape source to a square (1:1) by cropping width down to the full height', () => {
      const result = computeCropDimensions(1920, 1080, 1);

      expect(result).toEqual({ width: 1080, height: 1080 });
    });

    it('crops a portrait source to a square (1:1) by cropping height down to the full width', () => {
      const result = computeCropDimensions(1080, 1920, 1);

      expect(result).toEqual({ width: 1080, height: 1080 });
    });

    it('keeps a 16:9 source at its own full 16:9 size when the target IS 16:9 (no-op crop)', () => {
      const result = computeCropDimensions(1920, 1080, 16 / 9);

      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    it('never upscales a portrait source asked for 16:9 - crops height down from the full width instead', () => {
      // A 1080-wide portrait source has no 1920px of horizontal information to give a full-height
      // 16:9 crop - the audit's own rule 1 ("don't upscale without an explicit reason") wins over
      // reaching a canonical 1920x1080 size here. Correct AR, real (smaller) resolution, no
      // upscale/pad/stretch.
      const result = computeCropDimensions(1080, 1920, 16 / 9);

      expect(result.width).toBe(1080);
      expect(result.width).toBeLessThanOrEqual(1080);
      expect(result.height).toBeLessThanOrEqual(1920);
      expect(result.width / result.height).toBeCloseTo(16 / 9, 1);
    });
  });
});

describe('findEmphasisWords', () => {
  it('picks out numbers, ALL-CAPS words, and quoted phrases', () => {
    const words = [
      word('so', 0, 0.2),
      word('50%', 0.2, 0.5),
      word('NEVER', 0.5, 0.8),
      word('"insane"', 0.8, 1.2),
      word('the', 1.2, 1.4),
      word('growth.', 1.4, 1.7),
    ];

    expect(findEmphasisWords(words)).toEqual([words[1], words[2], words[3]]);
  });

  it('strips surrounding punctuation before matching', () => {
    // "NEVER," (trailing comma) should still match ALL-CAPS once stripped.
    expect(findEmphasisWords([word('NEVER,', 0, 0.3)])).toEqual([word('NEVER,', 0, 0.3)]);
  });

  it('returns an empty array when nothing qualifies', () => {
    expect(findEmphasisWords([word('just', 0, 0.2), word('talking', 0.2, 0.5)])).toEqual([]);
  });
});

describe('buildCropPath', () => {
  const crop = { width: 136, height: 240 }; // matches a 320x240 source cropped to 9:16
  const sourceWidth = 320;
  const sourceHeight = 240;

  it('returns null when there is no detected face and no emphasis word anywhere in the clip', () => {
    const samples: FaceSample[] = [
      { t: 0, box: null },
      { t: 1, box: null },
    ];

    expect(buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)).toBeNull();
  });

  it('returns null for an empty sample list and no emphasis words', () => {
    expect(buildCropPath([], [], crop, sourceWidth, sourceHeight, 1)).toBeNull();
  });

  it('centers the crop on the detected face, only moving the axis that is actually cropped', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path).not.toBeNull();
    // Face centered at xCenter=0.5 -> pixel 160 -> crop x = 160 - 136/2 = 92.
    expect(path![0].x).toBe(92);
    // Height isn't cropped for this landscape source (crop.height === sourceHeight) - y never moves.
    expect(path!.every((p) => p.y === 0)).toBe(true);
  });

  it('clamps the crop position so it never goes outside the frame', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.01, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path![0].x).toBeGreaterThanOrEqual(0);
  });

  it('clamps the crop position at the far edge too', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.99, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path![0].x).toBeLessThanOrEqual(sourceWidth - crop.width);
  });

  it('linearly interpolates between two known samples', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 80 - 68 = 12
      { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 240 - 68 = 172
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)!;
    // CROP_PATH_STEP_SECONDS is 0.2, so 0.5 itself is never a path point -
    // 0.4 (40% of the way from t=0 to t=1) is.
    const point = path.find((p) => Math.abs(p.t - 0.4) < 1e-6);

    expect(point).toBeDefined();
    // 40% of the way from x=12 to x=172 is 12 + (172-12)*0.4 = 76.
    expect(point!.x).toBe(76);
  });

  it('holds the nearest known position flat for samples with no detected face', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
      { t: 1, box: null },
      { t: 2, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 2)!;

    // No face detected anywhere except t=0 and t=2, both at the same
    // position - the path should stay flat at that x the whole time.
    expect(path.every((p) => p.x === path[0].x)).toBe(true);
  });

  it('spans the full clip duration, holding the last known face position flat past the last sample', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 3)!;

    expect(path[path.length - 1].t).toBeCloseTo(3, 3);
  });

  describe('auto zoom (emphasis words)', () => {
    it('builds a zoom-only path (no face data) centered on the frame, punching in at an emphasis word', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.3)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2)!;

      expect(path).not.toBeNull();
      // At the emphasis word's start (t=1), zoom should be at its peak -
      // crop shrinks to 70% of its base size (MAX_ZOOM_IN_FRACTION = 0.3).
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      expect(atPeak.width).toBeLessThan(crop.width);
      expect(atPeak.height).toBeLessThan(crop.height);

      // Well before/after the envelope, the crop is back to its base size.
      const before = path.find((p) => Math.abs(p.t - 0) < 1e-6)!;
      const after = path.find((p) => Math.abs(p.t - 2) < 1e-6)!;
      expect(before.width).toBe(crop.width);
      expect(after.width).toBe(crop.width);
    });

    // Pre-Processing Settings roadmap (Phase 2).
    it('applies a custom maxZoomInFraction override instead of the 0.3 default', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.3)];

      const defaultPath = buildCropPath(
        samples,
        emphasisWords,
        crop,
        sourceWidth,
        sourceHeight,
        2,
      )!;
      const strongerPath = buildCropPath(
        samples,
        emphasisWords,
        crop,
        sourceWidth,
        sourceHeight,
        2,
        0.6,
      )!;

      const defaultPeak = defaultPath.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      const strongerPeak = strongerPath.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      expect(strongerPeak.width).toBeLessThan(defaultPeak.width);
    });

    it('a maxZoomInFraction of 0 disables the punch-in entirely', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.3)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2, 0)!;

      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      expect(atPeak.width).toBe(crop.width);
      expect(atPeak.height).toBe(crop.height);
    });

    it('re-centers the zoomed crop on the same point the pan would have used', () => {
      const samples: FaceSample[] = [
        { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 } },
      ];
      const emphasisWords = [word('50%', 0, 0.1)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 0.5)!;
      const atPeak = path.find((p) => Math.abs(p.t - 0) < 1e-6)!;

      const baseCenterX = 92 + crop.width / 2; // face-centered base crop x from the earlier test
      const zoomedCenterX = atPeak.x + atPeak.width / 2;
      expect(zoomedCenterX).toBeCloseTo(baseCenterX, 0);
    });

    it('combines overlapping emphasis words by taking the strongest zoom, not stacking them', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.2), word('100%', 1.05, 1.3)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2)!;
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;

      // Still exactly the single-word peak shrink, not smaller than that.
      expect(atPeak.width).toBe(Math.round((crop.width * 0.7) / 2) * 2);
    });
  });

  // Visual Emphasis Engine Phase C3 ("Focus Shift" - see docs/ai/
  // visual-emphasis-engine.md).
  describe('focus shift (Phase C3)', () => {
    it('holds flat before/after a focus-shift window and snaps within it, instead of drifting across the full sample gap', () => {
      const samples: FaceSample[] = [
        { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 12
        { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 172
      ];
      const focusShifts = [{ start: 0.4, end: 0.6 }];

      const withShift = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        1,
        undefined,
        focusShifts,
      )!;
      const at = (t: number) => withShift.find((p) => Math.abs(p.t - t) < 1e-6)!;

      // Without Phase C3, t=0.2 would already be 20% of the way from 12 to
      // 172 (x=44, see the plain "linearly interpolates" test above) - held
      // flat at the pre-shift position instead.
      expect(at(0.2).x).toBe(12);
      // Held exactly at the pre-shift position right up to the window start.
      expect(at(0.4).x).toBe(12);
      // Snapped to the post-shift position by the window end.
      expect(at(0.6).x).toBe(172);
      // Held flat at the post-shift position afterward too.
      expect(at(0.8).x).toBe(172);
    });

    it('falls back to the default drift for a shift window with no bracketing known sample (clip-start edge case)', () => {
      const samples: FaceSample[] = [
        { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
        { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } },
      ];
      // Starts before the first known sample - no `pre` point exists.
      const focusShifts = [{ start: -0.5, end: -0.3 }];

      const withShift = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        1,
        undefined,
        focusShifts,
      )!;
      const withoutShift = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)!;

      expect(withShift).toEqual(withoutShift);
    });

    it('keeps the exact pre-C3 drift behavior when no focus shifts are passed (default empty array)', () => {
      const samples: FaceSample[] = [
        { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
        { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } },
      ];

      const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)!;
      const at04 = path.find((p) => Math.abs(p.t - 0.4) < 1e-6)!;

      expect(at04.x).toBe(76);
    });
  });

  // Visual Emphasis Engine Phase C4 ("Digital Push" - see docs/ai/
  // visual-emphasis-engine.md). Extends the SAME zoomEnvelopeAt() envelope
  // "auto zoom (emphasis words)" above already exercises - these tests
  // deliberately reuse that describe block's own numbers/shape wherever
  // possible to prove digitalPushStarts is a second TRIGGER SOURCE, not a
  // second zoom MECHANISM.
  describe('digital push (Phase C4)', () => {
    it('builds a zoom-only path (no face data, no emphasis words) from a digital-push moment alone', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];

      const path = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        2,
        undefined,
        [],
        [1],
      )!;

      expect(path).not.toBeNull();
      // Identical peak shrink to the plain emphasis-word test above -
      // exactly the same envelope, just a different trigger source.
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      expect(atPeak.width).toBeLessThan(crop.width);
      const before = path.find((p) => Math.abs(p.t - 0) < 1e-6)!;
      expect(before.width).toBe(crop.width);
    });

    it('keeps the exact pre-C4 behavior when no digital-push moments are passed (default empty array)', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.3)];

      const withoutArg = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2)!;
      const withEmptyArg = buildCropPath(
        samples,
        emphasisWords,
        crop,
        sourceWidth,
        sourceHeight,
        2,
        undefined,
        [],
        [],
      )!;

      expect(withEmptyArg).toEqual(withoutArg);
    });

    it('does not fire a zoom-only path when digitalPushStarts is empty and there is no other signal (regression: still returns null)', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];

      expect(
        buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 2, undefined, [], []),
      ).toBeNull();
    });

    it('combines an emphasis word and an overlapping digital-push moment by taking the strongest zoom, never stacking them', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.2)];
      // Lands close enough to the emphasis word's own envelope to overlap.
      const digitalPushStarts = [1.05];

      const path = buildCropPath(
        samples,
        emphasisWords,
        crop,
        sourceWidth,
        sourceHeight,
        2,
        undefined,
        [],
        digitalPushStarts,
      )!;
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;

      // Still exactly the single-trigger peak shrink (same expression the
      // "combines overlapping emphasis words" test above uses) - two
      // overlapping trigger SOURCES read as one combined trigger SET, the
      // same max-reduce every emphasis-word-only case already goes
      // through, not two independent zooms added together.
      expect(atPeak.width).toBe(Math.round((crop.width * 0.7) / 2) * 2);
    });

    it('fires two independent, non-overlapping zoom envelopes for two well-separated digital-push moments', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const digitalPushStarts = [1, 5];

      const path = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        6,
        undefined,
        [],
        digitalPushStarts,
      )!;

      const firstPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      const secondPeak = path.find((p) => Math.abs(p.t - 5) < 1e-6)!;
      const between = path.find((p) => Math.abs(p.t - 3) < 1e-6)!;
      expect(firstPeak.width).toBeLessThan(crop.width);
      expect(secondPeak.width).toBeLessThan(crop.width);
      // Back to base size well between the two, unaffected envelopes.
      expect(between.width).toBe(crop.width);
    });
  });

  // Visual Emphasis Integration Audit, Gate B1 (docs/ai/
  // visual-emphasis-integration-audit.md) - EVIDENCE GATHERING for the
  // audit's one HIGH/unmitigated finding: Focus Shift and Digital Push
  // both write into this SAME buildCropPath() call (pan-snap vs.
  // zoom-punch) with no merge/priority rule between them, unlike Digital
  // Push's own max-reduce with Auto Zoom above. Per the user's own
  // explicit instruction ("jangan langsung memilih rule sebelum melihat
  // hasilnya" - don't pick an arbitration rule before seeing the
  // results), this describe block does NOT fix or arbitrate anything -
  // it only proves, with exact numbers, what currently happens when the
  // two windows coincide. The actual arbitration decision (does one win,
  // do they coexist as-is, is damping needed) belongs to whoever reviews
  // this evidence next.
  describe('Gate B1 evidence: focus shift × digital push overlap (no arbitration - observation only)', () => {
    // Widened to a 0.4s window (start=0.4, end=0.8) so the snap ramp has a
    // genuine INTERMEDIATE sample on buildCropPath()'s own
    // CROP_PATH_STEP_SECONDS (0.2s) grid at t=0.6, between the window's
    // own start/end - t=0.5 is never actually sampled, only 0, 0.2, 0.4,
    // 0.6, 0.8, 1.0 are.
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 12
      { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 172
    ];
    const focusShifts = [{ start: 0.4, end: 0.8 }];
    // start=0.4 puts the zoom envelope's full-peak HOLD window at
    // [0.4, 0.8] (ZOOM_HOLD_SECONDS=0.4 after start) - deliberately chosen
    // to exactly match the focus-shift snap window above, the worst-case
    // overlap (peak zoom for the ENTIRE snap, not just part of it).
    const digitalPushStarts = [0.4];
    // Even-number width rounding (roundToEven() - a real libx264/yuv420p
    // requirement, not a test artifact) means the peak width is 96, not
    // the un-rounded 136*0.7=95.2 - every assertion below uses this exact
    // rounded value, the same one "builds a zoom-only path"/"combines
    // overlapping emphasis words" above already rely on.
    const peakZoomWidth = Math.round((crop.width * 0.7) / 2) * 2; // 96

    it('pans AND zooms simultaneously for the full duration a focus-shift window and a digital-push hold overlap - no arbitration exists today', () => {
      const path = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        1,
        undefined,
        focusShifts,
        digitalPushStarts,
      )!;
      const at = (t: number) => path.find((p) => Math.abs(p.t - t) < 1e-6)!;

      // FACT 1: the snap and the zoom peak really do coincide, at every
      // sampled instant across the whole overlap - not an approximation.
      expect(at(0.4).width).toBe(peakZoomWidth);
      expect(at(0.6).width).toBe(peakZoomWidth);
      expect(at(0.8).width).toBe(peakZoomWidth);

      // FACT 2: the position is actively, rapidly changing (the snap
      // ramp) at the SAME instants the frame is already zoomed to its
      // tightest punch-in. The absolute x is NOT the raw pan target
      // (12/92/172, what "focus shift (Phase C3)" above asserts with no
      // zoom active) - it's re-centered for the current zoom level
      // ("re-centers the zoomed crop on the same point the pan would have
      // used" above), adding a CONSTANT +20px offset here
      // ((crop.width-peakZoomWidth)/2 = (136-96)/2) since the zoom stays
      // at its peak for the whole overlap. The underlying 160px pan span
      // is unaffected (32 -> 112 -> 192, still 160px total) - only the
      // absolute starting/ending position shifts uniformly. This coupling
      // (the pan's own rendered position depends on whatever zoom level
      // is simultaneously active) is itself part of Gate B1's evidence -
      // not obvious from reading either technique's own code in
      // isolation.
      expect(at(0.4).x).toBe(32); // snap not yet started (12 + 20 recenter offset)
      expect(at(0.6).x).toBe(112); // mid-snap - actively panning (92 + 20)
      expect(at(0.8).x).toBe(192); // snap complete (172 + 20)

      // FACT 3: no damping/reduction is applied to either signal because
      // the other is also active - the zoom's own magnitude at t=0.6 is
      // identical to a digital-push moment firing ALONE with nothing else
      // happening (see "builds a zoom-only path" above, same 0.7 factor,
      // same peakZoomWidth) - confirming there is currently NO
      // arbitration, damping, or priority rule between these two
      // techniques. Whether that combined pan+zoom reads as intentional
      // emphasis or as chaos is a Gate B5 (visual) judgment, not decided
      // by this test.
      const zoomAloneWidth = buildCropPath(
        [{ t: 0, box: null }],
        [],
        crop,
        sourceWidth,
        sourceHeight,
        1,
        undefined,
        [],
        [0.4],
      )!.find((p) => Math.abs(p.t - 0.6) < 1e-6)!.width;
      expect(at(0.6).width).toBe(zoomAloneWidth);
    });

    it('quantifies the combined motion: 160px of pan (over 100% of the crop width) compressed into the same 0.4s the frame is 30% zoomed in', () => {
      const path = buildCropPath(
        samples,
        [],
        crop,
        sourceWidth,
        sourceHeight,
        1,
        undefined,
        focusShifts,
        digitalPushStarts,
      )!;
      const start = path.find((p) => Math.abs(p.t - 0.4) < 1e-6)!;
      const end = path.find((p) => Math.abs(p.t - 0.8) < 1e-6)!;

      const panDistancePx = Math.abs(end.x - start.x);
      const panFractionOfCropWidth = panDistancePx / crop.width;
      // The ROUNDED width (96), not the ideal 0.3 - roundToEven()'s own
      // even-number requirement means the actual shrink is ~0.294, a
      // documented, real ~0.006 deviation from the nominal
      // MAX_ZOOM_IN_FRACTION, not a bug in this test's own math.
      const zoomShrinkFraction = 1 - end.width / crop.width;

      // Documented as raw numbers, not a pass/fail threshold - there is no
      // "acceptable" cutoff decided anywhere in this codebase yet. This
      // test exists so the exact figures are machine-verified and can't
      // silently drift if either technique's own constants change later.
      expect(panDistancePx).toBe(160);
      expect(panFractionOfCropWidth).toBeCloseTo(1.176, 2); // >100% of the crop's own width, in 0.4s
      expect(zoomShrinkFraction).toBeCloseTo(0.294, 3);
    });
  });
});

describe('buildSendCmdScript', () => {
  it('formats one sendcmd line per path point, setting x, y, w, and h', () => {
    const script = buildSendCmdScript(
      [
        { t: 0, x: 10, y: 0, width: 136, height: 240 },
        { t: 0.2, x: 20, y: 0, width: 120, height: 210 },
      ],
      'crop@reframe',
    );

    expect(script).toBe(
      '0 crop@reframe x 10, crop@reframe y 0, crop@reframe w 136, crop@reframe h 240;\n' +
        '0.2 crop@reframe x 20, crop@reframe y 0, crop@reframe w 120, crop@reframe h 210;',
    );
  });
});
