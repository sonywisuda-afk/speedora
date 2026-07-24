// Same ESM/CJS mock as video-report-document.spec.ts - see that file's own
// comment for why @react-pdf/renderer is mocked rather than loaded for
// real in Jest.
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  View: 'View',
  Text: 'Text',
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
}));

import type { VideoReportData } from '@speedora/contracts';
import { buildBrandReportDocument } from './brand-report-document';

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
          topFactors: [],
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
    faceAnalysis: { entries: [{ clipId: 'clip-1', features: null }] },
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
      entries: [{ clipId: 'clip-1', keywords: ['focus'], hashtags: [], topics: [] }],
    },
    cta: { entries: [{ clipId: 'clip-1', ctaText: 'Subscribe for more', ctaStrength: 65 }] },
    thumbnail: { entries: [{ clipId: 'clip-1', thumbnailUrl: '/clips/clip-1/thumbnail' }] },
    ...overrides,
  };
}

describe('buildBrandReportDocument', () => {
  it('does not throw with a fully-configured brand kit (text-only logo fallback)', () => {
    expect(() =>
      buildBrandReportDocument(baseReport(), {
        logoUrl: '/brand-kit/logo',
        logoImageDataUri: null,
        primaryColor: '#1D4ED8',
      }),
    ).not.toThrow();
  });

  it('does not throw with an embeddable (PNG/JPEG) logo image', () => {
    expect(() =>
      buildBrandReportDocument(baseReport(), {
        logoUrl: '/brand-kit/logo',
        logoImageDataUri: 'data:image/png;base64,Zm9v',
        primaryColor: '#1D4ED8',
      }),
    ).not.toThrow();
  });

  it('does not throw with no brand kit configured (graceful default styling)', () => {
    expect(() =>
      buildBrandReportDocument(baseReport(), {
        logoUrl: null,
        logoImageDataUri: null,
        primaryColor: null,
      }),
    ).not.toThrow();
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
    expect(() =>
      buildBrandReportDocument(empty, {
        logoUrl: null,
        logoImageDataUri: null,
        primaryColor: null,
      }),
    ).not.toThrow();
  });
});
