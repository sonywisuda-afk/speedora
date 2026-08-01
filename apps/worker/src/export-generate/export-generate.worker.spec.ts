import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const exportJobFindUniqueOrThrowMock = jest.fn();
const exportJobUpdateMock = jest.fn();
const videoFindUniqueOrThrowMock = jest.fn();
const videoStatusEventFindManyMock = jest.fn();
const userFindUniqueOrThrowMock = jest.fn();
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    exportJob: {
      findUniqueOrThrow: (...args: unknown[]) => exportJobFindUniqueOrThrowMock(...args),
      update: (...args: unknown[]) => exportJobUpdateMock(...args),
    },
    video: {
      findUniqueOrThrow: (...args: unknown[]) => videoFindUniqueOrThrowMock(...args),
    },
    videoStatusEvent: {
      findMany: (...args: unknown[]) => videoStatusEventFindManyMock(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrowMock(...args),
    },
    // Notification Center Sprint 4A - recordNotification()'s write for the
    // EXPORT_READY notification.
    notification: {
      create: (...args: unknown[]) => notificationCreateMock(...args),
    },
    // Sprint 4B - recordNotification()'s preference-check read, before the
    // write above.
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
  },
}));

// Milestone 04c - see render-clip.worker.spec.ts's own comment on why this
// worker-local adapter (not @speedora/database itself) is mocked.
const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
}));

// Milestone 04d - same reasoning as notificationPublisher above.
const enqueueNotificationDeliveryMock = jest.fn();
jest.mock('../notificationDeliveryEnqueuer', () => ({
  enqueueNotificationDelivery: (...args: unknown[]) => enqueueNotificationDeliveryMock(...args),
}));

const buildVideoReportInputFromPrismaMock = jest.fn();
jest.mock('./build-video-report-input', () => ({
  buildVideoReportInputFromPrisma: (...args: unknown[]) =>
    buildVideoReportInputFromPrismaMock(...args),
}));

const buildVideoReportDataMock = jest.fn();
jest.mock('@speedora/report-builder', () => ({
  buildVideoReportData: (...args: unknown[]) => buildVideoReportDataMock(...args),
}));

const buildAnalyticsReportInputFromPrismaMock = jest.fn();
jest.mock('./build-analytics-report-input', () => ({
  buildAnalyticsReportInputFromPrisma: (...args: unknown[]) =>
    buildAnalyticsReportInputFromPrismaMock(...args),
}));

const buildAnalyticsReportDataMock = jest.fn();
jest.mock('@speedora/analytics-report', () => ({
  buildAnalyticsReportData: (...args: unknown[]) => buildAnalyticsReportDataMock(...args),
}));

const buildAnalyticsReportDocumentMock = jest.fn();
jest.mock('./pdf/analytics-report-document', () => ({
  buildAnalyticsReportDocument: (...args: unknown[]) => buildAnalyticsReportDocumentMock(...args),
}));

const buildVideoReportDocumentMock = jest.fn();
jest.mock('./pdf/video-report-document', () => ({
  buildVideoReportDocument: (...args: unknown[]) => buildVideoReportDocumentMock(...args),
}));

const buildHighlightReportDocumentMock = jest.fn();
jest.mock('./pdf/highlight-report-document', () => ({
  buildHighlightReportDocument: (...args: unknown[]) => buildHighlightReportDocumentMock(...args),
}));

const buildBrandReportDocumentMock = jest.fn();
jest.mock('./pdf/brand-report-document', () => ({
  buildBrandReportDocument: (...args: unknown[]) => buildBrandReportDocumentMock(...args),
}));

const writeBufferMock = jest.fn();
const buildVideoReportWorkbookMock = jest.fn();
jest.mock('./xlsx/video-report-workbook', () => ({
  buildVideoReportWorkbook: (...args: unknown[]) => buildVideoReportWorkbookMock(...args),
}));

// Export format expansion (Phase D) - same mocking shape as the xlsx builder
// above (pptxgenjs has its own real-module Jest wall - see
// pptx/video-report-presentation.spec.ts's own comment - so this worker spec
// mocks the adapter's dependency on it entirely, same as it already does for
// @react-pdf/renderer below).
const pptxWriteMock = jest.fn();
const buildVideoReportPresentationMock = jest.fn();
jest.mock('./pptx/video-report-presentation', () => ({
  buildVideoReportPresentation: (...args: unknown[]) => buildVideoReportPresentationMock(...args),
}));

const renderToBufferMock = jest.fn();
jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: (...args: unknown[]) => renderToBufferMock(...args),
}));

const uploadObjectMock = jest.fn();
// Brand Kit roadmap (P3a) - real Readable so node:stream/consumers' buffer()
// (used by fetchBrandKit to embed a PNG/JPEG logo) has something real to
// read, rather than mocking that Node builtin too.
const getObjectStreamMock = jest.fn().mockImplementation(async () => {
  const { Readable } = await import('node:stream');
  return Readable.from(Buffer.from('fake-logo-bytes'));
});
jest.mock('@speedora/storage', () => ({
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
}));

import { createExportGenerateWorker, mapExportType } from './export-generate.worker';
import { ExportType } from '@speedora/shared';

function getProcessor() {
  createExportGenerateWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

describe('export-generate worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'PDF',
      status: 'PENDING',
    });
    exportJobUpdateMock.mockResolvedValue({});
    videoFindUniqueOrThrowMock.mockResolvedValue({
      id: 'video-1',
      title: 'My video',
      clips: [],
      transcriptSegments: [],
    });
    videoStatusEventFindManyMock.mockResolvedValue([]);
    userFindUniqueOrThrowMock.mockResolvedValue({ brandLogoUrl: null, brandPrimaryColor: null });
    buildVideoReportInputFromPrismaMock.mockReturnValue({ video: {}, clips: [], statusEvents: [] });
    buildVideoReportDataMock.mockReturnValue({ cover: {} });
    buildAnalyticsReportInputFromPrismaMock.mockResolvedValue({
      generatedAt: '2026-07-18T00:00:00.000Z',
      windowDays: 30,
    });
    buildAnalyticsReportDataMock.mockReturnValue({ cover: {} });
    buildAnalyticsReportDocumentMock.mockReturnValue({});
    buildVideoReportDocumentMock.mockReturnValue({});
    buildHighlightReportDocumentMock.mockReturnValue({});
    buildBrandReportDocumentMock.mockReturnValue({});
    writeBufferMock.mockResolvedValue(Buffer.from('PK-fake'));
    buildVideoReportWorkbookMock.mockReturnValue({ xlsx: { writeBuffer: writeBufferMock } });
    pptxWriteMock.mockResolvedValue(Buffer.from('PK-fake-pptx'));
    buildVideoReportPresentationMock.mockReturnValue({ write: pptxWriteMock });
    renderToBufferMock.mockResolvedValue(Buffer.from('%PDF-fake'));
    uploadObjectMock.mockResolvedValue('etag');
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    publishNotificationMock.mockResolvedValue(undefined);
  });

  it('PDF: marks PROCESSING, renders the document, uploads it, and marks READY', async () => {
    const processor = getProcessor();

    const result = await processor({ data: { exportJobId: 'job-1' } });

    expect(exportJobFindUniqueOrThrowMock).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    expect(exportJobUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'job-1' },
      data: { status: 'PROCESSING' },
    });
    expect(videoFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      include: { clips: true, transcriptSegments: { orderBy: { start: 'asc' } } },
    });
    expect(buildVideoReportDocumentMock).toHaveBeenCalled();
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'exports/job-1.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(exportJobUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1' },
      data: { status: 'READY', resultUrl: 'exports/job-1.pdf' },
    });
    // Notification Center Sprint 4A - Export Ready.
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'EXPORT_READY',
        category: 'RENDERING',
        priority: 'SUCCESS',
        title: 'Export siap diunduh',
        body: 'Laporan export untuk video "My video" sudah siap diunduh.',
        videoId: 'video-1',
        clipId: null,
        metadata: { exportJobId: 'job-1', exportType: 'PDF' },
      },
    });
    // Milestone 04c - Export Ready pushed over SSE in realtime.
    expect(publishNotificationMock).toHaveBeenCalledWith({
      userId: 'user-1',
      notificationId: 'notif-1',
      type: 'EXPORT_READY',
    });
    expect(result).toEqual({ exportJobId: 'job-1', resultUrl: 'exports/job-1.pdf' });
  });

  it('EXCEL: builds a workbook and uploads it as .xlsx with the spreadsheet content type', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'EXCEL',
      status: 'PENDING',
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(buildVideoReportWorkbookMock).toHaveBeenCalled();
    expect(renderToBufferMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'exports/job-1.xlsx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  // Export format expansion (Phase D).
  it('PPTX: builds a presentation and uploads it as .pptx with the presentation content type', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'PPTX',
      status: 'PENDING',
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(buildVideoReportPresentationMock).toHaveBeenCalled();
    expect(pptxWriteMock).toHaveBeenCalledWith({ outputType: 'nodebuffer' });
    expect(renderToBufferMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'exports/job-1.pptx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('HIGHLIGHT_REPORT: uses the highlight document builder, still uploads as .pdf', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'HIGHLIGHT_REPORT',
      status: 'PENDING',
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(buildHighlightReportDocumentMock).toHaveBeenCalled();
    expect(buildVideoReportDocumentMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'exports/job-1.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
  });

  it("BRAND_REPORT: fetches the job owner's brand kit and passes it to the document builder", async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'BRAND_REPORT',
      status: 'PENDING',
    });
    userFindUniqueOrThrowMock.mockResolvedValue({
      brandLogoUrl: 'brand-logos/abc.png',
      brandPrimaryColor: '#1D4ED8',
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(userFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { brandLogoUrl: true, brandPrimaryColor: true },
    });
    expect(getObjectStreamMock).toHaveBeenCalledWith('brand-logos/abc.png');
    expect(buildBrandReportDocumentMock).toHaveBeenCalledWith(expect.anything(), {
      logoUrl: '/brand-kit/logo',
      logoImageDataUri: 'data:image/png;base64,ZmFrZS1sb2dvLWJ5dGVz',
      primaryColor: '#1D4ED8',
    });
  });

  it('BRAND_REPORT: skips embedding (text-fallback only) for a non-PNG/JPEG logo format', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'BRAND_REPORT',
      status: 'PENDING',
    });
    userFindUniqueOrThrowMock.mockResolvedValue({
      brandLogoUrl: 'brand-logos/abc.webp',
      brandPrimaryColor: null,
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(getObjectStreamMock).not.toHaveBeenCalled();
    expect(buildBrandReportDocumentMock).toHaveBeenCalledWith(expect.anything(), {
      logoUrl: '/brand-kit/logo',
      logoImageDataUri: null,
      primaryColor: null,
    });
  });

  it('BRAND_REPORT: passes a null logoUrl when no brand logo is set', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'BRAND_REPORT',
      status: 'PENDING',
    });
    const processor = getProcessor();

    await processor({ data: { exportJobId: 'job-1' } });

    expect(buildBrandReportDocumentMock).toHaveBeenCalledWith(expect.anything(), {
      logoUrl: null,
      logoImageDataUri: null,
      primaryColor: null,
    });
  });

  it('ANALYTICS_REPORT: skips the video/statusEvents fetch, uses the account-wide adapter, no videoId in the notification', async () => {
    exportJobFindUniqueOrThrowMock.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: null,
      type: 'ANALYTICS_REPORT',
      status: 'PENDING',
    });
    const processor = getProcessor();

    const result = await processor({ data: { exportJobId: 'job-1' } });

    expect(videoFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(videoStatusEventFindManyMock).not.toHaveBeenCalled();
    expect(buildAnalyticsReportInputFromPrismaMock).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
    });
    expect(buildAnalyticsReportDocumentMock).toHaveBeenCalled();
    expect(buildVideoReportDocumentMock).not.toHaveBeenCalled();
    // BRAND_REPORT-style Brand Kit lookup, always run for this type.
    expect(userFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { brandLogoUrl: true, brandPrimaryColor: true },
    });
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'exports/job-1.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'EXPORT_READY',
        title: 'Export siap diunduh',
        body: 'Laporan analytics kamu sudah siap diunduh.',
        metadata: { exportJobId: 'job-1', exportType: 'ANALYTICS_REPORT' },
      }),
    });
    const notificationCall = notificationCreateMock.mock.calls[0][0];
    expect(notificationCall.data.videoId).toBeNull();
    expect(result).toEqual({ exportJobId: 'job-1', resultUrl: 'exports/job-1.pdf' });
  });

  it('marks FAILED with the error message and rethrows when generation fails', async () => {
    buildVideoReportDataMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const processor = getProcessor();

    await expect(processor({ data: { exportJobId: 'job-1' } })).rejects.toThrow('boom');

    expect(exportJobUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1' },
      data: { status: 'FAILED', failReason: 'boom' },
    });
    expect(captureExceptionMock).toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it('never uploads or marks READY when rendering throws', async () => {
    renderToBufferMock.mockRejectedValue(new Error('render exploded'));
    const processor = getProcessor();

    await expect(processor({ data: { exportJobId: 'job-1' } })).rejects.toThrow('render exploded');
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(exportJobUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1' },
      data: { status: 'FAILED', failReason: 'render exploded' },
    });
  });
});

// Contract Governance audit (2026-08-01) - proves mapExportType (the
// replacement for the old `as unknown as` cast) round-trips every real
// Prisma ExportType. If a future schema.prisma addition isn't wired into
// this mapper, the build fails before this test can even run (assertNever)
// - this test guards the mapping's runtime correctness, not its
// exhaustiveness, which is a compile-time guarantee.
describe('mapExportType', () => {
  it('maps every known Prisma ExportType to its shared counterpart', () => {
    expect(mapExportType('PDF')).toBe(ExportType.PDF);
    expect(mapExportType('EXCEL')).toBe(ExportType.EXCEL);
    expect(mapExportType('HIGHLIGHT_REPORT')).toBe(ExportType.HIGHLIGHT_REPORT);
    expect(mapExportType('BRAND_REPORT')).toBe(ExportType.BRAND_REPORT);
    expect(mapExportType('ANALYTICS_REPORT')).toBe(ExportType.ANALYTICS_REPORT);
    // Export format expansion (Phase D).
    expect(mapExportType('PPTX')).toBe(ExportType.PPTX);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapExportType('SOMETHING_NEW' as never)).toThrow(/Unhandled ExportType/);
  });
});
