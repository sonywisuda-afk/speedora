import type {
  BuildVideoReportInput,
  ReportClipInput,
  TimelineEvent,
  VideoReportData,
} from '@speedora/contracts';
import { filterSegmentsForClip, type Clip, type TranscriptSegment } from '@speedora/shared';
import { toCsvRow } from '../common/csv.util';

// Only what this file's functions actually read off a Clip DTO - VideosService.
// mapVideoWithClips's inferred return type never got captionStyle narrowed to
// the shared CaptionStyle union (a pre-existing, harmless gap - nothing else
// reads that field off it), which makes the FULL Clip type not quite
// assignable from it. Narrowing the parameter to just these fields sidesteps
// that mismatch and, per this codebase's own "a module's input contract
// should only demand what it actually uses" convention, is the more correct
// shape anyway.
export type ReportSourceClip = Pick<
  Clip,
  | 'id'
  | 'startTime'
  | 'endTime'
  | 'hookText'
  | 'thumbnailUrl'
  | 'keywords'
  | 'hashtags'
  | 'topics'
  | 'intent'
  | 'ctaText'
  | 'scores'
  | 'facialFeatures'
  | 'ocrFeatures'
  | 'audioFeatures'
  | 'highlightScore'
  | 'highlightConfidence'
  | 'highlightReason'
  | 'highlightBreakdown'
  | 'highlightExplainability'
  | 'highlightPrediction'
  | 'highlightRecommendation'
  | 'highlightRank'
>;

const NA = 'n/a';

function orNa(value: string | number | null): string | number {
  return value ?? NA;
}

// Narrows one Clip DTO (already fully explainability-narrowed by
// VideosService.mapVideoWithClips - see this codebase's own comment there)
// plus its own clip-scoped segments (already filtered by the caller via
// @speedora/shared's filterSegmentsForClip) into report-builder's input
// shape. ctaText/ctaStrength are a straight read of already-computed
// detect-clips LLM output, never re-derived (see packages/contracts'
// export-center.ts comment on the same point).
export function toReportClipInput(
  clip: ReportSourceClip,
  clipSegments: TranscriptSegment[],
): ReportClipInput {
  return {
    id: clip.id,
    startTime: clip.startTime,
    endTime: clip.endTime,
    hookText: clip.hookText,
    thumbnailUrl: clip.thumbnailUrl,
    keywords: clip.keywords,
    hashtags: clip.hashtags,
    topics: clip.topics,
    intent: clip.intent,
    ctaText: clip.ctaText,
    ctaStrength: clip.scores?.ctaStrength ?? null,
    facialFeatures: clip.facialFeatures,
    ocrFeatures: clip.ocrFeatures,
    audioFeatures: clip.audioFeatures,
    segments: clipSegments.map((segment) => ({ emotion: segment.emotion })),
    highlightScore: clip.highlightScore,
    highlightConfidence: clip.highlightConfidence,
    highlightReason: clip.highlightReason,
    highlightBreakdown: clip.highlightBreakdown,
    highlightTopFactors: clip.highlightExplainability.topFactors,
    highlightPrediction: clip.highlightPrediction,
    highlightRecommendation: clip.highlightRecommendation,
    highlightRank: clip.highlightRank,
  };
}

export function buildVideoReportInput(
  video: {
    title: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    clips: ReportSourceClip[];
  },
  allSegments: TranscriptSegment[],
  statusEvents: TimelineEvent[],
): BuildVideoReportInput {
  return {
    video: {
      title: video.title,
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
    },
    clips: video.clips.map((clip) =>
      toReportClipInput(clip, filterSegmentsForClip(allSegments, clip.startTime, clip.endTime)),
    ),
    statusEvents,
  };
}

// Deliberately a flatter view than the JSON report: cover/summary/timeline/
// highlight(score+reason+rank)/topMoments/keyword/cta/thumbnail only - the
// deeply nested per-signal detail (breakdown, face/speech/OCR analysis)
// stays JSON-only, same "CSV is the simple summary, JSON is the full dump"
// posture as dashboard-export.util.ts's own CSV.
export function buildVideoReportCsv(report: VideoReportData): string {
  const lines: string[] = ['Section,ClipId,Field,Value'];

  lines.push(toCsvRow(['Cover', '', 'Video Title', orNa(report.cover.videoTitle)]));
  lines.push(toCsvRow(['Cover', '', 'Thumbnail URL', orNa(report.cover.thumbnailUrl)]));

  lines.push(
    toCsvRow([
      'Video Summary',
      '',
      'Duration (seconds)',
      orNa(report.videoSummary.durationSeconds),
    ]),
  );
  lines.push(toCsvRow(['Video Summary', '', 'Clip Count', report.videoSummary.clipCount]));
  lines.push(
    toCsvRow([
      'Video Summary',
      '',
      'Average Highlight Score',
      orNa(report.videoSummary.averageHighlightScore),
    ]),
  );

  for (const event of report.timeline.events) {
    const value = event.errorMessage ? `${event.toStatus} - ${event.errorMessage}` : event.toStatus;
    lines.push(toCsvRow(['Timeline', '', event.occurredAt, value]));
  }

  for (const entry of report.highlight.entries) {
    lines.push(toCsvRow(['Highlight', entry.clipId, 'Score', orNa(entry.highlightScore)]));
    lines.push(
      toCsvRow(['Highlight', entry.clipId, 'Confidence', orNa(entry.highlightConfidence)]),
    );
    lines.push(toCsvRow(['Highlight', entry.clipId, 'Reason', orNa(entry.highlightReason)]));
    lines.push(toCsvRow(['Highlight', entry.clipId, 'Rank', orNa(entry.highlightRank)]));
  }

  for (const moment of report.topMoments.moments) {
    lines.push(toCsvRow(['Top Moments', moment.clipId, 'Hook', orNa(moment.hookText)]));
  }

  for (const entry of report.keyword.entries) {
    lines.push(toCsvRow(['Keyword', entry.clipId, 'Keywords', entry.keywords.join('; ') || NA]));
    lines.push(toCsvRow(['Keyword', entry.clipId, 'Hashtags', entry.hashtags.join('; ') || NA]));
    lines.push(toCsvRow(['Keyword', entry.clipId, 'Topics', entry.topics.join('; ') || NA]));
  }

  for (const entry of report.cta.entries) {
    lines.push(toCsvRow(['CTA', entry.clipId, 'Text', orNa(entry.ctaText)]));
    lines.push(toCsvRow(['CTA', entry.clipId, 'Strength', orNa(entry.ctaStrength)]));
  }

  for (const entry of report.thumbnail.entries) {
    lines.push(toCsvRow(['Thumbnail', entry.clipId, 'Thumbnail URL', orNa(entry.thumbnailUrl)]));
  }

  return lines.join('\n') + '\n';
}

// Export format expansion (Phase D) - unlike buildVideoReportCsv's
// deliberately flat "simple summary" (see its own comment), Markdown/HTML
// are meant to be read as a narrative report, so both cover every
// VideoReportData section - same full coverage as the PDF document
// (apps/worker/src/export-generate/pdf/video-report-document.ts). Both join
// AI-signal sections to the highlight entries by clipId (same Map-lookup
// pattern xlsx/video-report-workbook.ts already uses), since highlight.entries
// is guaranteed one-per-clip while face/speech/ocr entries only exist where
// that detector actually ran.
// Escapes free text for safe embedding in the Markdown report. Order
// matters: literal backslashes first (so the punctuation-escaping pass
// below doesn't double-escape backslashes it adds itself), then &/</> -
// CommonMark-compliant renderers pass raw inline/block HTML through
// unchanged, so an unescaped "<script>" in a hookText/highlightReason would
// reach a browser as real HTML the moment this .md is rendered by a viewer
// (GitHub, a docs site, VS Code preview, etc.) - then embedded newlines
// collapsed to a space (every value here sits on one bullet/heading line;
// a literal newline would otherwise break out of that line and let a
// second line of attacker-controlled text be parsed as its own fresh
// Markdown block, e.g. a real "# Heading" at true column 0). With newlines
// already neutralized, a value can never actually START a new line, so
// list/heading markers (-, +, #, 1.) are only ever cosmetic mid-text and
// don't need escaping for structural safety - only the constructs that are
// exploitable INLINE, anywhere in a line, are escaped: `code`, *emphasis*,
// _emphasis_, [link]/![image] syntax, and a literal # (harmless mid-line in
// real CommonMark, escaped anyway since it's cheap and this report's own
// "# " video-title line is the one place a value legitimately starts a
// line). Deliberately NOT escaping ., -, !, (, ), |, ~ - none are
// structurally exploitable here, and doing so would visibly uglify normal
// prose (dates, parentheticals, punctuation) for no real safety gain.
function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([`*_[\]#!])/g, '\\$1');
}

function mdText(value: string | number | null): string {
  if (value === null || value === '') return NA;
  return typeof value === 'number' ? String(value) : escapeMarkdown(value);
}

function mdList(values: string[]): string {
  return values.length > 0 ? values.map(escapeMarkdown).join(', ') : NA;
}

export function buildVideoReportMarkdown(report: VideoReportData): string {
  const faceByClip = new Map(report.faceAnalysis.entries.map((entry) => [entry.clipId, entry]));
  const speechByClip = new Map(report.speechAnalysis.entries.map((entry) => [entry.clipId, entry]));
  const ocrByClip = new Map(report.ocrSummary.entries.map((entry) => [entry.clipId, entry]));
  const keywordByClip = new Map(report.keyword.entries.map((entry) => [entry.clipId, entry]));
  const ctaByClip = new Map(report.cta.entries.map((entry) => [entry.clipId, entry]));
  const thumbnailByClip = new Map(report.thumbnail.entries.map((entry) => [entry.clipId, entry]));

  const lines: string[] = [];
  lines.push(`# ${mdText(report.cover.videoTitle)}`, '');
  lines.push(`Thumbnail: ${mdText(report.cover.thumbnailUrl)}`, '');

  lines.push('## Ringkasan Video', '');
  lines.push(`- Durasi: ${mdText(report.videoSummary.durationSeconds)} detik`);
  lines.push(`- Jumlah Klip: ${report.videoSummary.clipCount}`);
  lines.push(`- Skor Highlight Rata-rata: ${mdText(report.videoSummary.averageHighlightScore)}`);
  lines.push('');

  if (report.timeline.events.length > 0) {
    lines.push('## Timeline Pemrosesan', '');
    for (const event of report.timeline.events) {
      const value = event.errorMessage
        ? `${event.toStatus} - ${event.errorMessage}`
        : event.toStatus;
      lines.push(`- ${mdText(event.occurredAt)}: ${mdText(value)}`);
    }
    lines.push('');
  }

  if (report.topMoments.moments.length > 0) {
    lines.push('## Momen Terbaik', '');
    for (const moment of report.topMoments.moments) {
      lines.push(
        `- **#${mdText(moment.highlightRank)}** (${moment.clipId}, skor ${mdText(moment.highlightScore)}): ${mdText(moment.hookText)}`,
      );
    }
    lines.push('');
  }

  if (report.highlight.entries.length > 0) {
    lines.push('## Detail Per Klip', '');
    for (const entry of report.highlight.entries) {
      const face = faceByClip.get(entry.clipId);
      const speech = speechByClip.get(entry.clipId);
      const ocr = ocrByClip.get(entry.clipId);
      const keyword = keywordByClip.get(entry.clipId);
      const cta = ctaByClip.get(entry.clipId);
      const thumbnail = thumbnailByClip.get(entry.clipId);

      lines.push(`### Klip ${entry.clipId}`, '');
      lines.push(`- Skor Highlight: ${mdText(entry.highlightScore)}`);
      lines.push(`- Confidence: ${mdText(entry.highlightConfidence)}`);
      lines.push(`- Rank: ${mdText(entry.highlightRank)}`);
      lines.push(`- Alasan: ${mdText(entry.highlightReason)}`);
      lines.push(`- Keywords: ${keyword ? mdList(keyword.keywords) : NA}`);
      lines.push(`- Hashtags: ${keyword ? mdList(keyword.hashtags) : NA}`);
      lines.push(`- Topics: ${keyword ? mdList(keyword.topics) : NA}`);
      lines.push(
        `- CTA: ${mdText(cta?.ctaText ?? null)} (strength: ${mdText(cta?.ctaStrength ?? null)})`,
      );
      lines.push(`- Ekspresi Wajah Dominan: ${mdText(face?.features?.dominantEmotion ?? null)}`);
      lines.push(`- Emosi Suara Dominan: ${mdText(speech?.vocalEmotion.dominantEmotion ?? null)}`);
      lines.push(`- Cakupan Subtitle: ${mdText(ocr?.features?.subtitleCoverageRate ?? null)}`);
      lines.push(`- Thumbnail: ${mdText(thumbnail?.thumbnailUrl ?? null)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Same escaping-only-where-needed posture as every user-facing template in
// this codebase - only genuinely free-text fields (title, hook, reason,
// cta, keywords/hashtags/topics) get escaped; ids/urls/numbers never
// contain markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function esc(value: string | number | null): string {
  return value === null || value === '' ? NA : escapeHtml(String(value));
}

function escList(values: string[]): string {
  return values.length > 0 ? escapeHtml(values.join(', ')) : NA;
}

export function buildVideoReportHtml(report: VideoReportData): string {
  const faceByClip = new Map(report.faceAnalysis.entries.map((entry) => [entry.clipId, entry]));
  const speechByClip = new Map(report.speechAnalysis.entries.map((entry) => [entry.clipId, entry]));
  const ocrByClip = new Map(report.ocrSummary.entries.map((entry) => [entry.clipId, entry]));
  const keywordByClip = new Map(report.keyword.entries.map((entry) => [entry.clipId, entry]));
  const ctaByClip = new Map(report.cta.entries.map((entry) => [entry.clipId, entry]));
  const thumbnailByClip = new Map(report.thumbnail.entries.map((entry) => [entry.clipId, entry]));

  const timelineRows = report.timeline.events
    .map((event) => {
      const value = event.errorMessage
        ? `${event.toStatus} - ${event.errorMessage}`
        : event.toStatus;
      return `<li>${esc(event.occurredAt)}: ${esc(value)}</li>`;
    })
    .join('\n');

  const topMomentRows = report.topMoments.moments
    .map(
      (moment) =>
        `<li>#${esc(moment.highlightRank)} (${esc(moment.clipId)}, skor ${esc(moment.highlightScore)}): ${esc(moment.hookText)}</li>`,
    )
    .join('\n');

  const clipSections = report.highlight.entries
    .map((entry) => {
      const face = faceByClip.get(entry.clipId);
      const speech = speechByClip.get(entry.clipId);
      const ocr = ocrByClip.get(entry.clipId);
      const keyword = keywordByClip.get(entry.clipId);
      const cta = ctaByClip.get(entry.clipId);
      const thumbnail = thumbnailByClip.get(entry.clipId);

      return `
        <section class="clip">
          <h3>Klip ${esc(entry.clipId)}</h3>
          <ul>
            <li>Skor Highlight: ${esc(entry.highlightScore)}</li>
            <li>Confidence: ${esc(entry.highlightConfidence)}</li>
            <li>Rank: ${esc(entry.highlightRank)}</li>
            <li>Alasan: ${esc(entry.highlightReason)}</li>
            <li>Keywords: ${keyword ? escList(keyword.keywords) : NA}</li>
            <li>Hashtags: ${keyword ? escList(keyword.hashtags) : NA}</li>
            <li>Topics: ${keyword ? escList(keyword.topics) : NA}</li>
            <li>CTA: ${esc(cta?.ctaText ?? null)} (strength: ${esc(cta?.ctaStrength ?? null)})</li>
            <li>Ekspresi Wajah Dominan: ${esc(face?.features?.dominantEmotion ?? null)}</li>
            <li>Emosi Suara Dominan: ${esc(speech?.vocalEmotion.dominantEmotion ?? null)}</li>
            <li>Cakupan Subtitle: ${esc(ocr?.features?.subtitleCoverageRate ?? null)}</li>
            <li>Thumbnail: ${esc(thumbnail?.thumbnailUrl ?? null)}</li>
          </ul>
        </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${esc(report.cover.videoTitle)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1, h2, h3 { line-height: 1.3; }
  section.clip { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  ul { padding-left: 1.25rem; }
</style>
</head>
<body>
  <h1>${esc(report.cover.videoTitle)}</h1>
  <p>Thumbnail: ${esc(report.cover.thumbnailUrl)}</p>

  <h2>Ringkasan Video</h2>
  <ul>
    <li>Durasi: ${esc(report.videoSummary.durationSeconds)} detik</li>
    <li>Jumlah Klip: ${esc(report.videoSummary.clipCount)}</li>
    <li>Skor Highlight Rata-rata: ${esc(report.videoSummary.averageHighlightScore)}</li>
  </ul>

  ${report.timeline.events.length > 0 ? `<h2>Timeline Pemrosesan</h2>\n<ul>\n${timelineRows}\n</ul>` : ''}

  ${report.topMoments.moments.length > 0 ? `<h2>Momen Terbaik</h2>\n<ul>\n${topMomentRows}\n</ul>` : ''}

  ${report.highlight.entries.length > 0 ? `<h2>Detail Per Klip</h2>\n${clipSections}` : ''}
</body>
</html>
`;
}
