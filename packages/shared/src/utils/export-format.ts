import { ExportType } from '../types/export';

// Sprint 03d - both apps/api (download response headers) and apps/worker
// (upload key/content-type) need this identical mapping - a tiny pure
// function, shared rather than duplicated since drift here would mean the
// two apps disagree on what a job's own resultUrl extension means.
export function exportFileInfo(type: ExportType): { extension: string; contentType: string } {
  if (type === ExportType.EXCEL) {
    return {
      extension: 'xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  // PDF, HIGHLIGHT_REPORT, BRAND_REPORT, ANALYTICS_REPORT all render to PDF
  // (ANALYTICS_REPORT is PDF-only by design, same as Highlight/Brand Report -
  // no Excel variant).
  return { extension: 'pdf', contentType: 'application/pdf' };
}
