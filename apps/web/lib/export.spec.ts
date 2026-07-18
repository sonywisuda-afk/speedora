import type { ExportJobDto } from '@speedora/shared';
import { ExportJobStatus, ExportType } from '@speedora/shared';
import {
  ACCOUNT_EXPORT_TYPES,
  EXPORT_TYPES,
  VIDEO_EXPORT_FORMATS,
  exportJobStatusBadge,
  exportTypeLabel,
  isExportJobInFlight,
  latestJobByType,
  videoExportFormatLabel,
} from './export';

function job(overrides: Partial<ExportJobDto>): ExportJobDto {
  return {
    id: 'job-1',
    videoId: 'video-1',
    type: ExportType.PDF,
    status: ExportJobStatus.READY,
    resultUrl: null,
    failReason: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('exportJobStatusBadge', () => {
  it('marks READY as good and FAILED as bad', () => {
    expect(exportJobStatusBadge(ExportJobStatus.READY).tone).toBe('good');
    expect(exportJobStatusBadge(ExportJobStatus.FAILED).tone).toBe('bad');
  });

  it('marks PENDING/PROCESSING as neutral', () => {
    expect(exportJobStatusBadge(ExportJobStatus.PENDING).tone).toBe('neutral');
    expect(exportJobStatusBadge(ExportJobStatus.PROCESSING).tone).toBe('neutral');
  });
});

describe('isExportJobInFlight', () => {
  it('is true only for PENDING/PROCESSING', () => {
    expect(isExportJobInFlight(ExportJobStatus.PENDING)).toBe(true);
    expect(isExportJobInFlight(ExportJobStatus.PROCESSING)).toBe(true);
    expect(isExportJobInFlight(ExportJobStatus.READY)).toBe(false);
    expect(isExportJobInFlight(ExportJobStatus.FAILED)).toBe(false);
  });
});

describe('videoExportFormatLabel', () => {
  it('has a label for every sync export format', () => {
    for (const format of VIDEO_EXPORT_FORMATS) {
      expect(videoExportFormatLabel(format).length).toBeGreaterThan(0);
    }
  });
});

describe('exportTypeLabel', () => {
  it('has a label for every async export type', () => {
    for (const type of EXPORT_TYPES) {
      expect(exportTypeLabel(type).length).toBeGreaterThan(0);
    }
  });

  it('lists all 4 video-scoped export types with no duplicates, excluding ANALYTICS_REPORT', () => {
    expect(new Set(EXPORT_TYPES).size).toBe(4);
    expect(EXPORT_TYPES).toContain(ExportType.PDF);
    expect(EXPORT_TYPES).toContain(ExportType.EXCEL);
    expect(EXPORT_TYPES).toContain(ExportType.HIGHLIGHT_REPORT);
    expect(EXPORT_TYPES).toContain(ExportType.BRAND_REPORT);
    expect(EXPORT_TYPES).not.toContain(ExportType.ANALYTICS_REPORT);
  });

  it('has a label for ANALYTICS_REPORT even though it is not in EXPORT_TYPES', () => {
    expect(exportTypeLabel(ExportType.ANALYTICS_REPORT).length).toBeGreaterThan(0);
  });
});

describe('ACCOUNT_EXPORT_TYPES', () => {
  it('contains only ANALYTICS_REPORT', () => {
    expect(ACCOUNT_EXPORT_TYPES).toEqual([ExportType.ANALYTICS_REPORT]);
  });
});

describe('latestJobByType', () => {
  it('returns an empty object for an empty list', () => {
    expect(latestJobByType([])).toEqual({});
  });

  it('keeps the single job for each type present', () => {
    const pdf = job({ id: 'job-pdf', type: ExportType.PDF });
    const excel = job({ id: 'job-excel', type: ExportType.EXCEL });

    expect(latestJobByType([pdf, excel])).toEqual({
      [ExportType.PDF]: pdf,
      [ExportType.EXCEL]: excel,
    });
  });

  it('keeps only the most recent job when a type has multiple jobs (list already sorted DESC)', () => {
    const newest = job({ id: 'job-newest', type: ExportType.PDF, createdAt: '2026-07-17T02:00:00.000Z' });
    const oldest = job({ id: 'job-oldest', type: ExportType.PDF, createdAt: '2026-07-17T00:00:00.000Z' });

    expect(latestJobByType([newest, oldest])).toEqual({ [ExportType.PDF]: newest });
  });

  it('leaves out types that have no jobs in the list', () => {
    const pdf = job({ type: ExportType.PDF });

    const result = latestJobByType([pdf]);

    expect(result[ExportType.EXCEL]).toBeUndefined();
    expect(result[ExportType.HIGHLIGHT_REPORT]).toBeUndefined();
    expect(result[ExportType.BRAND_REPORT]).toBeUndefined();
  });
});
