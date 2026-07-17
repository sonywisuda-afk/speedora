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

const buildVideoReportInputFromPrismaMock = jest.fn();
jest.mock('./build-video-report-input', () => ({
  buildVideoReportInputFromPrisma: (...args: unknown[]) =>
    buildVideoReportInputFromPrismaMock(...args),
}));

const buildVideoReportDataMock = jest.fn();
jest.mock('@speedora/report-builder', () => ({
  buildVideoReportData: (...args: unknown[]) => buildVideoReportDataMock(...args),
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

const renderToBufferMock = jest.fn();
jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: (...args: unknown[]) => renderToBufferMock(...args),
}));

const uploadObjectMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
}));

import { createExportGenerateWorker } from './export-generate.worker';

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
    buildVideoReportDocumentMock.mockReturnValue({});
    buildHighlightReportDocumentMock.mockReturnValue({});
    buildBrandReportDocumentMock.mockReturnValue({});
    writeBufferMock.mockResolvedValue(Buffer.from('PK-fake'));
    buildVideoReportWorkbookMock.mockReturnValue({ xlsx: { writeBuffer: writeBufferMock } });
    renderToBufferMock.mockResolvedValue(Buffer.from('%PDF-fake'));
    uploadObjectMock.mockResolvedValue('etag');
    notificationCreateMock.mockResolvedValue({});
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
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
        title: 'Export siap diunduh',
        body: 'Laporan export untuk video "My video" sudah siap diunduh.',
        videoId: 'video-1',
        clipId: null,
        metadata: { exportJobId: 'job-1', exportType: 'PDF' },
      },
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
    expect(buildBrandReportDocumentMock).toHaveBeenCalledWith(expect.anything(), {
      logoUrl: '/brand-kit/logo',
      primaryColor: '#1D4ED8',
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
      primaryColor: null,
    });
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
