import * as React from 'react';
import { Document } from '@react-pdf/renderer';
import type { VideoReportData } from '@speedora/contracts';
import { createSectionBuilders, createStyles, Page } from './sections';

export interface BrandKitForDocument {
  logoUrl: string | null;
  // Brand Kit roadmap (P3a) - base64 data URI, only set for a PNG/JPEG logo
  // (see sections.ts's buildBrandLogo comment for why other formats fall
  // back to the text-only logoUrl line instead).
  logoImageDataUri: string | null;
  primaryColor: string | null;
}

// Sprint 03d - the same full 11-section content as the plain video report,
// styled with the user's own Brand Kit colors instead of the default
// black/grey palette. Falls back to the default palette when no
// primaryColor is set (graceful degradation, not a blocked export - see
// schema.prisma's own comment on User.brandPrimaryColor). Logo is embedded
// as a real image when possible (Brand Kit roadmap P3a) - see
// sections.ts's buildBrandLogo.
export function buildBrandReportDocument(
  report: VideoReportData,
  brandKit: BrandKitForDocument,
): React.ReactElement {
  const styles = createStyles(brandKit.primaryColor ?? undefined);
  const {
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
  } = createSectionBuilders(styles);

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      buildCoverBlock(report.cover, 'Speedora Export Center - Brand Report'),
      buildBrandLogo(brandKit.logoImageDataUri, brandKit.logoUrl),
      buildVideoSummaryBlock(report.videoSummary),
      divider(),
      buildTimelineBlock(report.timeline),
      divider(),
      buildHighlightBlock(report.highlight),
      divider(),
      buildTopMomentsBlock(report.topMoments),
      divider(),
      buildFaceAnalysisBlock(report.faceAnalysis),
      buildSpeechAnalysisBlock(report.speechAnalysis),
      buildOcrSummaryBlock(report.ocrSummary),
      divider(),
      buildKeywordBlock(report.keyword),
      buildCtaBlock(report.cta),
      divider(),
      buildThumbnailBlock(report.thumbnail),
    ),
  );
}
