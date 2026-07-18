import * as Sentry from '@sentry/node';
import { ExportJobStatus, ExportType, recordNotification } from '@speedora/database';
import { buildAnalyticsReportData } from '@speedora/analytics-report';
import { buildVideoReportData } from '@speedora/report-builder';
import type { AnalyticsReportData, VideoReportData } from '@speedora/contracts';
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
import { buildAnalyticsReportInputFromPrisma } from './build-analytics-report-input';
import { buildVideoReportInputFromPrisma } from './build-video-report-input';
import { buildAnalyticsReportDocument } from './pdf/analytics-report-document';
import { buildBrandReportDocument } from './pdf/brand-report-document';
import { buildHighlightReportDocument } from './pdf/highlight-report-document';
import { buildVideoReportDocument } from './pdf/video-report-document';
import { buildVideoReportWorkbook } from './xlsx/video-report-workbook';

const logger = forStage('export-generate');

async function fetchBrandKit(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { brandLogoUrl: true, brandPrimaryColor: true },
  });
  return {
    logoUrl: user.brandLogoUrl ? '/brand-kit/logo' : null,
    primaryColor: user.brandPrimaryColor,
  };
}

// Sprint 03d - one shared VideoReportData (built once above, regardless of
// output format) fans out into 4 renderers here. EXCEL is the only
// non-PDF branch; HIGHLIGHT_REPORT/BRAND_REPORT are both still
// @react-pdf/renderer documents, just a different document builder.
// BRAND_REPORT is the only branch that needs an extra Prisma read (the
// job's own user's Brand Kit fields) - deliberately not fetched for every
// job, only when actually needed.
async function renderVideoReportBuffer(
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
      const brandKit = await fetchBrandKit(userId);
      return renderToBuffer(buildBrandReportDocument(report, brandKit) as never);
    }
    case ExportType.PDF:
    default:
      return renderToBuffer(buildVideoReportDocument(report) as never);
  }
}

// Analytics Report (account-wide) - always PDF, always Brand-Kit-styled
// (same graceful-fallback-to-default-palette posture as BRAND_REPORT, not a
// separate branded/unbranded pair like the video-report family has).
async function renderAnalyticsReportBuffer(
  report: AnalyticsReportData,
  userId: string,
): Promise<Buffer> {
  const brandKit = await fetchBrandKit(userId);
  return renderToBuffer(buildAnalyticsReportDocument(report, brandKit) as never);
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
        videoId: exportJob.videoId ?? undefined,
        type: exportJob.type,
      });

      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: ExportJobStatus.PROCESSING },
      });

      try {
        let buffer: Buffer;
        let notificationBody: string;

        if (exportJob.type === ExportType.ANALYTICS_REPORT) {
          // Account-wide - no video/statusEvents fetch, no videoId anywhere
          // in this branch. See build-analytics-report-input.ts for why this
          // adapter owns its own Prisma querying rather than just narrowing
          // already-fetched rows the way buildVideoReportInputFromPrisma does.
          const input = await buildAnalyticsReportInputFromPrisma(prisma, {
            userId: exportJob.userId,
          });
          const report = buildAnalyticsReportData(input);
          buffer = await renderAnalyticsReportBuffer(report, exportJob.userId);
          notificationBody = 'Laporan analytics kamu sudah siap diunduh.';
        } else {
          const [video, statusEvents] = await Promise.all([
            prisma.video.findUniqueOrThrow({
              where: { id: exportJob.videoId as string },
              include: { clips: true, transcriptSegments: { orderBy: { start: 'asc' } } },
            }),
            prisma.videoStatusEvent.findMany({
              where: { videoId: exportJob.videoId as string },
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
          buffer = await renderVideoReportBuffer(exportJob.type, report, exportJob.userId);
          notificationBody = `Laporan export untuk video "${video.title}" sudah siap diunduh.`;
        }

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
        // videoId is omitted entirely for ANALYTICS_REPORT (recordNotification's
        // videoId param is already optional) rather than passed as null.
        await recordNotification(
          prisma,
          {
            userId: exportJob.userId,
            type: 'EXPORT_READY',
            title: 'Export siap diunduh',
            body: notificationBody,
            ...(exportJob.videoId ? { videoId: exportJob.videoId } : {}),
            metadata: { exportJobId, exportType: exportJob.type },
          },
          { publish: publishNotification },
        ).catch((error) => {
          logger.warn('failed to record EXPORT_READY notification', { exportJobId }, error);
        });

        logger.info('export generated', {
          jobId: exportJobId,
          videoId: exportJob.videoId ?? undefined,
          resultUrl,
        });
        return { exportJobId, resultUrl };
      } catch (error) {
        logger.error(
          'export generation failed',
          { jobId: exportJobId, videoId: exportJob.videoId ?? undefined },
          error,
        );
        Sentry.captureException(error, {
          tags: { exportJobId, videoId: exportJob.videoId ?? 'none' },
        });

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
