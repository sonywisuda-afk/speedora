import { Injectable } from '@nestjs/common';
import {
  ActivityEventType as PrismaActivityEventType,
  ExportJobStatus,
  PremiumCreditStatus,
  VideoStatus,
} from '@speedora/database';
import {
  ActivityEventType,
  ExportType,
  type ActivityEventDto,
  type DashboardActivityDto,
  type DashboardExportsDto,
  type DashboardStatsDto,
} from '@speedora/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExportService, mapExportType } from '../export/export.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildDashboardReportCsv } from './dashboard-export.util';

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ActivityEventType: ${JSON.stringify(value)}`);
}

// Prisma's ActivityEventType (packages/database, generated from
// schema.prisma) and packages/shared's ActivityEventType are nominally
// distinct types with identical runtime string values - this function is the
// one place that bridges them, replacing what used to be a blind
// `as unknown as` cast. The switch has no `default` case: adding a new
// member to schema.prisma's enum widens the parameter type here, and the
// assertNever call fails to compile until a matching case (and, by
// necessity, a matching packages/shared ActivityEventType member) is added -
// this is what makes the next ActivityEventType addition fail at compile
// time in apps/api itself, not just silently pass through to the frontend.
function mapActivityEventType(type: PrismaActivityEventType): ActivityEventType {
  switch (type) {
    case 'VIDEO_UPLOADED':
      return ActivityEventType.VIDEO_UPLOADED;
    case 'CLIP_GENERATED':
      return ActivityEventType.CLIP_GENERATED;
    case 'CLIP_EXPORTED':
      return ActivityEventType.CLIP_EXPORTED;
    case 'MEMBER_INVITED':
      return ActivityEventType.MEMBER_INVITED;
    case 'WORKSPACE_DELETED':
      return ActivityEventType.WORKSPACE_DELETED;
    default:
      return assertNever(type);
  }
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly exportService: ExportService,
  ) {}

  // Statistics Row. Every query below is scoped to `ownerId: userId` (or
  // the equivalent nested relation filter), same posture as every other
  // per-user endpoint in this app - run in parallel, same "fetch everything
  // at once" convention as AnalyticsService.getOverview.
  async getStats(userId: string): Promise<DashboardStatsDto> {
    const monthStart = startOfMonth();

    const [
      totalVideos,
      totalClips,
      terminalVideos,
      sourceSizeAgg,
      outputSizeAgg,
      monthlyVideos,
      monthlyClips,
      premiumCreditsThisMonth,
    ] = await Promise.all([
      this.prisma.video.count({ where: { ownerId: userId } }),
      this.prisma.clip.count({ where: { video: { ownerId: userId } } }),
      // Processing time is only meaningful once a video has actually
      // finished (RENDERED) or given up (FAILED) - see VideoStatusEvent's
      // own comment on why the first->last event span is a free proxy for
      // "how long this took," no new aggregation infra needed.
      this.prisma.video.findMany({
        where: { ownerId: userId, status: { in: [VideoStatus.RENDERED, VideoStatus.FAILED] } },
        select: { statusEvents: { orderBy: { createdAt: 'asc' }, select: { createdAt: true } } },
      }),
      this.prisma.video.aggregate({
        where: { ownerId: userId },
        _sum: { sourceSizeBytes: true },
      }),
      this.prisma.clip.aggregate({
        where: { video: { ownerId: userId } },
        _sum: { outputSizeBytes: true },
      }),
      this.prisma.video.count({ where: { ownerId: userId, createdAt: { gte: monthStart } } }),
      this.prisma.clip.count({
        where: { video: { ownerId: userId }, createdAt: { gte: monthStart } },
      }),
      this.prisma.premiumCredit.count({
        where: { userId, status: PremiumCreditStatus.PAID, createdAt: { gte: monthStart } },
      }),
    ]);

    const durations = terminalVideos
      .filter((video) => video.statusEvents.length >= 2)
      .map((video) => {
        const first = video.statusEvents[0].createdAt.getTime();
        const last = video.statusEvents[video.statusEvents.length - 1].createdAt.getTime();
        return (last - first) / 1000;
      });

    return {
      totalVideos,
      totalClips,
      avgProcessingTimeSeconds: average(durations),
      storageUsedBytes:
        (sourceSizeAgg._sum.sourceSizeBytes ?? 0) + (outputSizeAgg._sum.outputSizeBytes ?? 0),
      monthlyVideos,
      monthlyClips,
      premiumCreditsThisMonth,
    };
  }

  // Activity Timeline - newest first, capped by the controller's parsed
  // `limit`. Deliberately a thin read of ActivityEvent as-is (no joins back
  // to Video/Clip for a live title) - `metadata` already carries whatever
  // display context was known at write time (e.g. a video's title), which
  // survives even if the video/clip is later deleted.
  async getActivity(userId: string, limit: number): Promise<DashboardActivityDto> {
    const events = await this.prisma.activityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      events: events.map((event): ActivityEventDto => ({
        id: event.id,
        type: mapActivityEventType(event.type),
        videoId: event.videoId,
        clipId: event.clipId,
        metadata: (event.metadata as unknown as Record<string, unknown> | null) ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  // Phase E (Dashboard & Recent Activity) - Export Center visibility.
  // Deliberately a fresh set of `prisma.exportJob` queries, not a call into
  // ExportService.listRecent() (that method requires a videoId/type filter -
  // see its own comment - this is the account-wide rollup those per-video
  // Export Center tabs don't need). All-time (not windowed), same convention
  // as getStats() above.
  async getExports(userId: string): Promise<DashboardExportsDto> {
    const [recentJobs, statusCounts, typeCounts, lastReady] = await Promise.all([
      this.prisma.exportJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.exportJob.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.exportJob.groupBy({
        by: ['type'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.exportJob.findFirst({
        where: { userId, status: ExportJobStatus.READY },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);

    let pendingCount = 0;
    let processingCount = 0;
    let readyCount = 0;
    let failedCount = 0;
    for (const row of statusCounts) {
      if (row.status === ExportJobStatus.PENDING) pendingCount = row._count._all;
      else if (row.status === ExportJobStatus.PROCESSING) processingCount = row._count._all;
      else if (row.status === ExportJobStatus.READY) readyCount = row._count._all;
      else if (row.status === ExportJobStatus.FAILED) failedCount = row._count._all;
    }
    const totalExports = pendingCount + processingCount + readyCount + failedCount;

    const exportsByType = Object.fromEntries(
      Object.values(ExportType).map((type) => [type, 0]),
    ) as Record<ExportType, number>;
    for (const row of typeCounts) {
      exportsByType[mapExportType(row.type)] = row._count._all;
    }

    const terminalCount = readyCount + failedCount;

    return {
      recentExports: recentJobs.map((job) => this.exportService.toDto(job)),
      totalExports,
      pendingCount,
      processingCount,
      failedCount,
      readyCount,
      successRate: terminalCount > 0 ? readyCount / terminalCount : null,
      lastReadyAt: lastReady?.updatedAt.toISOString() ?? null,
      exportsByType,
    };
  }

  // Export Report quick action - reuses AnalyticsService's already-computed
  // Overview + 30-day Performance data rather than a new data pipeline (see
  // buildDashboardReportCsv's own comment).
  async exportCsv(userId: string): Promise<string> {
    const [overview, performance] = await Promise.all([
      this.analytics.getOverview(userId),
      this.analytics.getPerformance(userId, { days: 30 }),
    ]);

    return buildDashboardReportCsv(overview, performance);
  }
}
