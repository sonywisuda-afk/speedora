import type { VideoReportData } from '@speedora/contracts';
import { buildVideoReportPresentation } from './video-report-presentation';

// pptxgenjs is a real CJS dependency (same as exceljs - see
// xlsx/video-report-workbook.spec.ts's own comment on why that avoids the
// ESM wall @react-pdf/renderer needs a mock for) but, unlike exceljs, has no
// public API to read slide/table content back out of a built presentation
// (its own .d.ts comments out `_slides` - write-only by design, closer to
// @react-pdf/renderer's Document than exceljs's Workbook). So this mirrors
// pdf/video-report-document.spec.ts's "does not throw across every report
// shape" style - buildVideoReportPresentation() itself (construction) is
// exercised directly here.
//
// The actual .write({ outputType: 'nodebuffer' }) call is NOT run in this
// suite: pptxgenjs's Node write path does a real dynamic import() for one of
// its media-handling deps (loadNodeDeps), which throws "A dynamic import
// callback was invoked without --experimental-vm-modules" under this
// project's default (non-VM-modules) Jest config - confirmed by a real
// failing run, not a guess. Same category of tooling wall as
// pdf/video-report-document.spec.ts's ESM issue, just surfacing at write()
// time instead of import time. The real end-to-end serialization (actual
// .pptx bytes, verified as a genuine ZIP/OOXML archive) was verified once
// manually via `ts-node` outside Jest - see the Phase D plan's live
// verification section.

function baseReport(overrides: Partial<VideoReportData> = {}): VideoReportData {
  return {
    cover: { videoTitle: 'How I 10x-ed my morning routine', thumbnailUrl: '/videos/v1/thumbnail' },
    videoSummary: { durationSeconds: 600, clipCount: 1, averageHighlightScore: 72 },
    timeline: {
      events: [
        { toStatus: 'RENDERED', occurredAt: '2026-07-17T03:00:00.000Z', errorMessage: null },
      ],
    },
    highlight: {
      entries: [
        {
          clipId: 'clip-1',
          highlightScore: 72,
          highlightConfidence: 0.6,
          highlightReason: 'Strong hook and clear CTA',
          breakdown: [],
          topFactors: [
            {
              signal: 'audio',
              feature: 'averageRmsDb',
              weightedContribution: 0.07,
              description: 'Loud and clear',
            },
          ],
          prediction: null,
          recommendation: null,
          highlightRank: 1,
        },
      ],
    },
    topMoments: {
      moments: [
        {
          clipId: 'clip-1',
          hookText: 'You will not believe this',
          thumbnailUrl: null,
          highlightScore: 72,
          highlightRank: 1,
        },
      ],
    },
    faceAnalysis: {
      entries: [
        {
          clipId: 'clip-1',
          features: {
            dominantEmotion: 'happy',
            emotionTransitions: 2,
            peakConfidence: 0.9,
            stability: 0.5,
          },
        },
      ],
    },
    speechAnalysis: {
      entries: [
        {
          clipId: 'clip-1',
          audioFeatures: null,
          vocalEmotion: { dominantEmotion: 'hap', counts: { hap: 2 } },
        },
      ],
    },
    ocrSummary: { entries: [{ clipId: 'clip-1', features: null }] },
    keyword: {
      entries: [
        {
          clipId: 'clip-1',
          keywords: ['focus'],
          hashtags: ['productivity'],
          topics: ['self-improvement'],
        },
      ],
    },
    cta: { entries: [{ clipId: 'clip-1', ctaText: 'Subscribe for more', ctaStrength: 65 }] },
    thumbnail: { entries: [{ clipId: 'clip-1', thumbnailUrl: '/clips/clip-1/thumbnail' }] },
    ...overrides,
  };
}

describe('buildVideoReportPresentation', () => {
  it('does not throw for a fully-populated report', () => {
    expect(() => buildVideoReportPresentation(baseReport())).not.toThrow();
  });

  it('does not throw for a video with zero clips', () => {
    const empty = baseReport({
      highlight: { entries: [] },
      topMoments: { moments: [] },
      faceAnalysis: { entries: [] },
      speechAnalysis: { entries: [] },
      ocrSummary: { entries: [] },
      keyword: { entries: [] },
      cta: { entries: [] },
      thumbnail: { entries: [] },
    });
    expect(() => buildVideoReportPresentation(empty)).not.toThrow();
  });

  it('does not throw for a video whose title/timeline are empty', () => {
    const noMeta = baseReport({
      cover: { videoTitle: null, thumbnailUrl: null },
      timeline: { events: [] },
    });
    expect(() => buildVideoReportPresentation(noMeta)).not.toThrow();
  });
});
