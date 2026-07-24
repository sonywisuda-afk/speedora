import * as React from 'react';
import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type {
  CtaSection,
  FaceAnalysisSection,
  HighlightSection,
  KeywordSection,
  OcrSummarySection,
  SpeechAnalysisSection,
  ThumbnailSection,
  TimelineSection,
  TopMomentsSection,
  VideoReportData,
  VideoSummarySection,
} from '@speedora/contracts';

// Shared building blocks for every PDF document builder in this directory
// (video-report-document.ts, highlight-report-document.ts,
// brand-report-document.ts) - extracted in Sprint 03d once a second/third
// document needed the same section-rendering logic, same "extract once
// duplication would start" posture as apps/api's common/csv.util.ts.
//
// No JSX/TSX - apps/worker is a plain Node/tsx/tsc backend with no React/
// JSX build tooling anywhere in it, and adding one for a few document trees
// isn't worth the new tsconfig surface. @react-pdf/renderer's public API is
// just React components + renderToBuffer(); JSX is sugar for
// React.createElement, not a requirement.

const NA = 'n/a';

export function createStyles(accentColor?: string) {
  const accent = accentColor ?? '#111111';
  return StyleSheet.create({
    page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica' },
    title: { fontSize: 20, marginBottom: 4, color: accent },
    subtitle: { fontSize: 11, color: '#666', marginBottom: 16 },
    h2: {
      fontSize: 13,
      marginTop: 18,
      marginBottom: 6,
      fontFamily: 'Helvetica-Bold',
      color: accent,
    },
    h3: { fontSize: 10, marginTop: 8, marginBottom: 3, fontFamily: 'Helvetica-Bold' },
    row: { flexDirection: 'row', marginBottom: 2 },
    label: { width: 150, color: '#555' },
    value: { flex: 1 },
    muted: { color: '#888' },
    divider: { borderBottomWidth: 1, borderBottomColor: '#ddd', marginTop: 4, marginBottom: 4 },
    logo: { width: 80, marginBottom: 8 },
  });
}

type Styles = ReturnType<typeof createStyles>;

function formatValue(value: string | number | null): string {
  return value === null || value === '' ? NA : String(value);
}

// Every builder below closes over one `styles` object (the caller's own -
// createStyles(accentColor) for a branded document, createStyles() for the
// default black/grey palette everywhere else) - Page/StyleSheet.create
// itself stays document-builder-owned, not exported here.
export function createSectionBuilders(styles: Styles) {
  function kv(label: string, value: string | number | null): React.ReactElement {
    return React.createElement(
      View,
      { style: styles.row },
      React.createElement(Text, { style: styles.label }, label),
      React.createElement(Text, { style: styles.value }, formatValue(value)),
    );
  }

  function heading(text: string): React.ReactElement {
    return React.createElement(Text, { style: styles.h2 }, text);
  }

  function subheading(text: string): React.ReactElement {
    return React.createElement(Text, { style: styles.h3 }, text);
  }

  function muted(text: string): React.ReactElement {
    return React.createElement(Text, { style: styles.muted }, text);
  }

  function divider(): React.ReactElement {
    return React.createElement(View, { style: styles.divider });
  }

  // Brand Kit roadmap (P3a) - embeds the logo as an actual image when
  // logoImageDataUri is available (a base64 data URI - @react-pdf/renderer's
  // Image accepts one directly, no separate file/network fetch from inside
  // the PDF renderer). logoImageDataUri is null for a logo the fetch-and-
  // embed step upstream (export-generate.worker.ts's fetchBrandKit)
  // deliberately skipped - today that's any format other than PNG/JPEG
  // (react-pdf's Image doesn't support WebP/GIF/SVG) - in which case this
  // falls back to the original text-only line rather than a broken/blank
  // image. logoUrl alone with no data URI (skipped format) still shows the
  // text fallback; neither present renders nothing.
  function buildBrandLogo(
    logoImageDataUri: string | null,
    logoUrl: string | null,
  ): React.ReactElement | null {
    if (logoImageDataUri) {
      return React.createElement(Image, { style: styles.logo, src: logoImageDataUri });
    }
    if (logoUrl) {
      return React.createElement(Text, { style: styles.muted }, `Brand logo: ${logoUrl}`);
    }
    return null;
  }

  function buildCoverBlock(
    cover: VideoReportData['cover'],
    subtitleText = 'Speedora Export Center - Video Report',
  ): React.ReactElement {
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: styles.title }, formatValue(cover.videoTitle)),
      React.createElement(Text, { style: styles.subtitle }, subtitleText),
    );
  }

  function buildVideoSummaryBlock(summary: VideoSummarySection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Video Summary'),
      kv('Duration (seconds)', summary.durationSeconds),
      kv('Clip Count', summary.clipCount),
      kv('Average Highlight Score', summary.averageHighlightScore),
    );
  }

  function buildTimelineBlock(timeline: TimelineSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Timeline'),
      timeline.events.length === 0
        ? muted('No recorded status events.')
        : React.createElement(
            View,
            null,
            ...timeline.events.map((event) =>
              kv(
                event.occurredAt,
                event.errorMessage ? `${event.toStatus} - ${event.errorMessage}` : event.toStatus,
              ),
            ),
          ),
    );
  }

  function buildHighlightBlock(highlight: HighlightSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Highlight Score + Reason (AI Analysis)'),
      ...highlight.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 8 } },
          subheading(`Clip ${entry.clipId}`),
          kv('Score', entry.highlightScore),
          kv('Confidence', entry.highlightConfidence),
          kv('Rank', entry.highlightRank),
          kv('Reason', entry.highlightReason),
          ...entry.topFactors.map((factor) =>
            React.createElement(
              Text,
              { key: `${entry.clipId}-${factor.signal}-${factor.feature}` },
              `- ${factor.signal}/${factor.feature}: ${factor.description}`,
            ),
          ),
        ),
      ),
    );
  }

  function buildTopMomentsBlock(topMoments: TopMomentsSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Top Moments'),
      ...topMoments.moments.map((moment) =>
        React.createElement(
          Text,
          { key: moment.clipId, style: styles.row },
          `#${formatValue(moment.highlightRank)} - ${formatValue(moment.hookText)} (score: ${formatValue(moment.highlightScore)})`,
        ),
      ),
    );
  }

  function buildFaceAnalysisBlock(faceAnalysis: FaceAnalysisSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Face Analysis'),
      ...faceAnalysis.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 4 } },
          subheading(`Clip ${entry.clipId}`),
          entry.features
            ? kv('Dominant Emotion', entry.features.dominantEmotion)
            : muted('No facial analysis available.'),
        ),
      ),
    );
  }

  function buildSpeechAnalysisBlock(speechAnalysis: SpeechAnalysisSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Speech Analysis'),
      ...speechAnalysis.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 4 } },
          subheading(`Clip ${entry.clipId}`),
          kv('Average RMS (dB)', entry.audioFeatures?.averageRmsDb ?? null),
          kv('Speaking Rate (wps)', entry.audioFeatures?.averageSpeakingRateWordsPerSecond ?? null),
          kv('Dominant Vocal Emotion', entry.vocalEmotion.dominantEmotion),
        ),
      ),
    );
  }

  function buildOcrSummaryBlock(ocrSummary: OcrSummarySection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('OCR Summary'),
      ...ocrSummary.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 4 } },
          subheading(`Clip ${entry.clipId}`),
          entry.features
            ? kv('Subtitle Coverage', entry.features.subtitleCoverageRate)
            : muted('No OCR analysis available.'),
        ),
      ),
    );
  }

  function buildKeywordBlock(keyword: KeywordSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Keywords'),
      ...keyword.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 4 } },
          subheading(`Clip ${entry.clipId}`),
          kv('Keywords', entry.keywords.join(', ') || null),
          kv('Hashtags', entry.hashtags.join(', ') || null),
          kv('Topics', entry.topics.join(', ') || null),
        ),
      ),
    );
  }

  function buildCtaBlock(cta: CtaSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('CTA Detection'),
      ...cta.entries.map((entry) =>
        React.createElement(
          View,
          { key: entry.clipId, style: { marginBottom: 4 } },
          subheading(`Clip ${entry.clipId}`),
          kv('CTA Text', entry.ctaText),
          kv('CTA Strength', entry.ctaStrength),
        ),
      ),
    );
  }

  // Referenced only, not embedded - see ARCHITECTURE-level note in
  // video-report-document.ts on why real image embedding is deferred
  // (thumbnails/logos are served through an authenticated endpoint
  // apps/worker has no fetch path for yet).
  function buildThumbnailBlock(thumbnail: ThumbnailSection): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Thumbnail'),
      ...thumbnail.entries.map((entry) => kv(`Clip ${entry.clipId}`, entry.thumbnailUrl)),
    );
  }

  return {
    kv,
    heading,
    subheading,
    muted,
    divider,
    buildBrandLogo,
    buildCoverBlock,
    buildVideoSummaryBlock,
    buildTimelineBlock,
    buildHighlightBlock,
    buildTopMomentsBlock,
    buildFaceAnalysisBlock,
    buildSpeechAnalysisBlock,
    buildOcrSummaryBlock,
    buildKeywordBlock,
    buildCtaBlock,
    buildThumbnailBlock,
  };
}

export { Page };
export type { Styles };
