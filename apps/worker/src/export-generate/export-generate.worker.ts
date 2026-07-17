import * as Sentry from '@sentry/node';
import { ExportJobStatus, ExportType, recordNotification } from '@speedora/database';
import { buildVideoReportData } from '@speedora/report-builder';
import type { VideoReportData } from '@speedora/contracts';
import {
  exportFileInfo,
  QueueName,
  type ExportGenerateJobData,
  type ExportGenerateJobResult,
  type ExportType as SharedExportType,
} from '@speedora/shared';
import { uploadObject } from '@speedora/storage';
import { renderToBuffer } from '@react-pdf/renderer';
import { Worker, type Job } from 'bullmq';
import { forStage } from '../logger';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { buildVideoReportInputFromPrisma } from './build-video-report-input';
import { buildBrandReportDocument } from './pdf/brand-report-document';
import { buildHighlightReportDocument } from './pdf/highlight-report-document';
import { buildVideoReportDocument } from './pdf/video-report-document';
import { buildVideoReportWorkbook } from './xlsx/video-report-workbook';

const logger = forStage('export-generate');

// Sprint 03d - one shared VideoReportData (built once above, regardless of
// output format) fans out into 4 renderers here. EXCEL is the only
// non-PDF branch; HIGHLIGHT_REPORT/BRAND_REPORT are both still
// @react-pdf/renderer documents, just a different document builder.
// BRAND_REPORT is the only branch that needs an extra Prisma read (the
// job's own user's Brand Kit fields) - deliberately not fetched for every
// job, only when actually needed.
async function renderExportBuffer(
  type: ExportType,
  report: VideoReportData,
  userId: string,
): Promise<Buffer> {
  switch (type) {
    case ExportType.EXCEL: {
      const workbook = buildVideoReportWorkbook(report);
      const raw = await workbook.xlsx.writeBuffer();
      return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    }
    case ExportType.HIGHLIGHT_REPORT:
      return renderToBuffer(buildHighlightReportDocument(report) as never);
    case ExportType.BRAND_REPORT: {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { brandLogoUrl: true, brandPrimaryColor: true },
      });
      return renderToBuffer(
        buildBrandReportDocument(report, {
          logoUrl: user.brandLogoUrl ? '/brand-kit/logo' : null,
          primaryColor: user.brandPrimaryColor,
        }) as never,
      );
    }
    case ExportType.PDF:
    default:
      return renderToBuffer(buildVideoReportDocument(report) as never);
  }
}

export function createExportGenerateWorker(): Worker<
  ExportGenerateJobData,
  ExportGenerateJobResult
> {
  return new Worker<ExportGenerateJobData, ExportGenerateJobResult>(
    QueueName.EXPORT_GENERATE,
    async (job: Job<ExportGenerateJobData>) => {
      const { exportJobId } = job.data;
      // The ExportJob row (created synchronously by ExportService.create()
      // before enqueueing) is the single source of truth for what to
      // generate - re-fetched here rather than trusting the job payload,
      // same convention as publish-clip.worker.ts's PublishRecord re-fetch.
      const exportJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: exportJobId } });

      logger.info('generating export', {
        jobId: exportJobId,
        videoId: exportJob.videoId,
        type: exportJob.type,
      });

      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: ExportJobStatus.PROCESSING },
      });

      try {
        const [video, statusEvents] = await Promise.all([
          prisma.video.findUniqueOrThrow({
            where: { id: exportJob.videoId },
            include: { clips: true, transcriptSegments: { orderBy: { start: 'asc' } } },
          }),
          prisma.videoStatusEvent.findMany({
            where: { videoId: exportJob.videoId },
            orderBy: { createdAt: 'asc' },
          }),
        ]);

        const input = buildVideoReportInputFromPrisma({
          video,
          clips: video.clips,
          segments: video.transcriptSegments,
          statusEvents: statusEvents.map((event) => ({
            toStatus: event.toStatus,
            occurredAt: event.createdAt.toISOString(),
            errorMessage: event.errorMessage,
          })),
        });

        const report = buildVideoReportData(input);
        const buffer = await renderExportBuffer(exportJob.type, report, exportJob.userId);

        // Prisma's own ExportType enum and @speedora/shared's are nominally
        // distinct TS enum types even though they share the same runtime
        // string values (same "narrow via a cast at the one call site that
        // needs it" convention used in apps/api's export.controller.ts).
        const { extension, contentType } = exportFileInfo(
          exportJob.type as unknown as SharedExportType,
        );
        const resultUrl = `exports/${exportJobId}.${extension}`;
        await uploadObject(resultUrl, buffer, contentType);

        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: { status: ExportJobStatus.READY, resultUrl },
        });

        // Notification Center Sprint 4A - Export Ready. video/exportJob are
        // already in scope from the fetches above, zero extra query.
        // Milestone 04c - deps.publish pushes this over SSE in realtime.
        await recordNotification(
          prisma,
          {
            userId: exportJob.userId,
            type: 'EXPORT_READY',
            title: 'Export siap diunduh',
            body: `Laporan export untuk video "${video.title}" sudah siap diunduh.`,
            videoId: exportJob.videoId,
            metadata: { exportJobId, exportType: exportJob.type },
          },
          { publish: publishNotification },
        ).catch((error) => {
          logger.warn('failed to record EXPORT_READY notification', { exportJobId }, error);
        });

        logger.info('export generated', {
          jobId: exportJobId,
          videoId: exportJob.videoId,
          resultUrl,
        });
        return { exportJobId, resultUrl };
      } catch (error) {
        logger.error(
          'export generation failed',
          { jobId: exportJobId, videoId: exportJob.videoId },
          error,
        );
        Sentry.captureException(error, { tags: { exportJobId, videoId: exportJob.videoId } });

        // No automatic BullMQ retry for this queue (unlike publish-clip) -
        // every failure is this job's only/final attempt, so the row goes
        // FAILED unconditionally rather than only on a last-attempt check.
        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: ExportJobStatus.FAILED,
            failReason: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
