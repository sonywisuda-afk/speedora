import type { OcrTextCategory, OcrTextTrack } from '@speedora/contracts';
import { fromOcrTracks } from './from-ocr-tracks';

function track(overrides: Partial<OcrTextTrack> & { category: OcrTextCategory }): OcrTextTrack {
  return {
    trackId: 1,
    text: 'sample text',
    boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.05 },
    confidence: 0.9,
    startTime: 1,
    endTime: 2,
    durationSeconds: 1,
    appearsFrames: 5,
    persistenceScore: 0.5,
    motionScore: null,
    nearFace: null,
    language: null,
    regexFlags: { isPriceLike: false, isNameLike: false },
    categoryConfidence: 0.8,
    classificationMethod: 'HybridRuleEngine',
    ...overrides,
  };
}

describe('fromOcrTracks', () => {
  it('returns an empty array when ocrTracks is null', () => {
    expect(fromOcrTracks(null)).toEqual([]);
  });

  it('returns an empty array when ocrTracks is empty', () => {
    expect(fromOcrTracks([])).toEqual([]);
  });

  it('suggests ocr_highlight for a "price" track above the confidence threshold', () => {
    const tracks = [track({ category: 'price', categoryConfidence: 0.9, text: '$9.99' })];
    const result = fromOcrTracks(tracks);

    expect(result).toEqual([
      {
        technique: 'ocr_highlight',
        start: 1,
        end: 2,
        score: 0.9,
        reason: expect.stringContaining('$9.99'),
      },
    ]);
  });

  it('suggests ocr_highlight for a "name" track above the confidence threshold', () => {
    const tracks = [track({ category: 'name', categoryConfidence: 0.7 })];
    expect(fromOcrTracks(tracks)).toHaveLength(1);
  });

  it('does not suggest for a "subtitle"/"caption"/"logo"/"slide" track, even at high confidence', () => {
    const tracks = [
      track({ category: 'subtitle', categoryConfidence: 0.99 }),
      track({ category: 'caption', categoryConfidence: 0.99 }),
      track({ category: 'logo', categoryConfidence: 0.99 }),
      track({ category: 'slide', categoryConfidence: 0.99 }),
    ];
    expect(fromOcrTracks(tracks)).toEqual([]);
  });

  it('does not suggest a qualifying category below the confidence threshold', () => {
    const tracks = [track({ category: 'price', categoryConfidence: 0.2 })];
    expect(fromOcrTracks(tracks)).toEqual([]);
  });
});
