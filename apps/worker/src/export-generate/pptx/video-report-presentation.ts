import type { VideoReportData } from '@speedora/contracts';
import PptxGenJS from 'pptxgenjs';

const NA = 'n/a';

function fmt(value: string | number | null): string {
  return value === null || value === '' ? NA : String(value);
}

// Export format expansion (Phase D) - same 4-section grouping
// xlsx/video-report-workbook.ts already proved sufficient for a video-scoped
// report (Overview/Clips/AI Analysis), as slides instead of sheets. Not a
// slide-per-clip design - unbounded for a long video, same reasoning the
// XLSX builder's one-row-per-clip table already applies within a page limit
// PowerPoint doesn't have but a slide deck still shouldn't abuse.
export function buildVideoReportPresentation(report: VideoReportData): PptxGenJS {
  const pres = new PptxGenJS();
  pres.author = 'Speedora Export Center';
  pres.title = fmt(report.cover.videoTitle);

  // Slide 1: Cover.
  const cover = pres.addSlide();
  cover.addText(fmt(report.cover.videoTitle), {
    x: 0.5,
    y: 2,
    w: 9,
    h: 1.5,
    fontSize: 32,
    bold: true,
    align: 'center',
  });
  cover.addText('Video Report', {
    x: 0.5,
    y: 3.3,
    w: 9,
    h: 0.5,
    fontSize: 16,
    color: '666666',
    align: 'center',
  });

  // Slide 2: Video Summary + Timeline.
  const summary = pres.addSlide();
  summary.addText('Ringkasan Video', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true });
  summary.addText(
    [
      { text: `Durasi: ${fmt(report.videoSummary.durationSeconds)} detik\n` },
      { text: `Jumlah Klip: ${report.videoSummary.clipCount}\n` },
      {
        text: `Skor Highlight Rata-rata: ${fmt(report.videoSummary.averageHighlightScore)}`,
      },
    ],
    { x: 0.5, y: 1.1, w: 9, h: 1.5, fontSize: 16 },
  );
  if (report.timeline.events.length > 0) {
    const rows: PptxGenJS.TableRow[] = [
      [
        { text: 'Waktu', options: { bold: true } },
        { text: 'Status', options: { bold: true } },
      ],
      ...report.timeline.events.map((event): PptxGenJS.TableRow => {
        const value = event.errorMessage
          ? `${event.toStatus} - ${event.errorMessage}`
          : event.toStatus;
        return [{ text: event.occurredAt }, { text: value }];
      }),
    ];
    summary.addTable(rows, { x: 0.5, y: 2.8, w: 9, fontSize: 11, autoPage: false });
  }

  // Slide 3: per-clip summary table (highlight + CTA + keywords), same
  // clipId join pattern xlsx/video-report-workbook.ts's addClipsSheet uses.
  if (report.highlight.entries.length > 0) {
    const clips = pres.addSlide();
    clips.addText('Detail Klip', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true });

    const ctaByClip = new Map(report.cta.entries.map((entry) => [entry.clipId, entry]));
    const keywordByClip = new Map(report.keyword.entries.map((entry) => [entry.clipId, entry]));

    const header: PptxGenJS.TableRow = [
      { text: 'Klip', options: { bold: true } },
      { text: 'Skor', options: { bold: true } },
      { text: 'Rank', options: { bold: true } },
      { text: 'CTA', options: { bold: true } },
      { text: 'Keywords', options: { bold: true } },
    ];
    const rows: PptxGenJS.TableRow[] = [
      header,
      ...report.highlight.entries.map((entry): PptxGenJS.TableRow => {
        const cta = ctaByClip.get(entry.clipId);
        const keyword = keywordByClip.get(entry.clipId);
        return [
          { text: entry.clipId },
          { text: fmt(entry.highlightScore) },
          { text: fmt(entry.highlightRank) },
          { text: fmt(cta?.ctaText ?? null) },
          { text: keyword && keyword.keywords.length > 0 ? keyword.keywords.join(', ') : NA },
        ];
      }),
    ];
    clips.addTable(rows, { x: 0.3, y: 1.1, w: 9.4, fontSize: 10, autoPage: false });
  }

  // Slide 4: AI analysis summary (dominant face/vocal emotion, subtitle
  // coverage, top factors) - same join pattern as addAiAnalysisSheet.
  if (report.highlight.entries.length > 0) {
    const analysis = pres.addSlide();
    analysis.addText('Analisis AI', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true });

    const faceByClip = new Map(report.faceAnalysis.entries.map((entry) => [entry.clipId, entry]));
    const speechByClip = new Map(
      report.speechAnalysis.entries.map((entry) => [entry.clipId, entry]),
    );
    const ocrByClip = new Map(report.ocrSummary.entries.map((entry) => [entry.clipId, entry]));

    const header: PptxGenJS.TableRow = [
      { text: 'Klip', options: { bold: true } },
      { text: 'Ekspresi Wajah', options: { bold: true } },
      { text: 'Emosi Suara', options: { bold: true } },
      { text: 'Cakupan Subtitle', options: { bold: true } },
      { text: 'Top Factors', options: { bold: true } },
    ];
    const rows: PptxGenJS.TableRow[] = [
      header,
      ...report.highlight.entries.map((entry): PptxGenJS.TableRow => {
        const face = faceByClip.get(entry.clipId);
        const speech = speechByClip.get(entry.clipId);
        const ocr = ocrByClip.get(entry.clipId);
        const topFactors =
          entry.topFactors.map((factor) => `${factor.signal}/${factor.feature}`).join(', ') || NA;
        return [
          { text: entry.clipId },
          { text: fmt(face?.features?.dominantEmotion ?? null) },
          { text: fmt(speech?.vocalEmotion.dominantEmotion ?? null) },
          { text: fmt(ocr?.features?.subtitleCoverageRate ?? null) },
          { text: topFactors },
        ];
      }),
    ];
    analysis.addTable(rows, { x: 0.3, y: 1.1, w: 9.4, fontSize: 10, autoPage: false });
  }

  return pres;
}
