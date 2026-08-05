import { Injectable } from '@nestjs/common';
import {
  ExportJobStatus,
  mapActivityEventType,
  PremiumCreditStatus,
  recordActivityDeletionLog,
  VideoStatus,
  type ActivityEventType as PrismaActivityEventType,
} from '@speedora/database';
import {
  ActivityEventType,
  ExportType,
  type ActivityDeleteResult,
  type ActivityEventDto,
  type DashboardActivityDto,
  type DashboardActivityListQuery,
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

function assertNeverActivityEventType(value: never): never {
  throw new Error(`Unhandled ActivityEventType: ${JSON.stringify(value)}`);
}

// The reverse direction of packages/database's mapActivityEventType (shared
// enum -> Prisma's string-literal union) - needed only here, to turn a
// GET /dashboard/activity?type= filter into a Prisma `where` value. Same
// exhaustive-switch-assertNever posture as the forward mapper.
function mapActivityEventTypeToPrisma(type: ActivityEventType): PrismaActivityEventType {
  switch (type) {
    case ActivityEventType.VIDEO_UPLOADED:
      return 'VIDEO_UPLOADED';
    case ActivityEventType.CLIP_GENERATED:
      return 'CLIP_GENERATED';
    case ActivityEventType.CLIP_EXPORTED:
      return 'CLIP_EXPORTED';
    case ActivityEventType.MEMBER_INVITED:
      return 'MEMBER_INVITED';
    case ActivityEventType.WORKSPACE_DELETED:
      return 'WORKSPACE_DELETED';
    default:
      return assertNeverActivityEventType(type);
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

  // Activity Timeline v2 - cursor pagination, newest first, mirroring
  // NotificationsV2Service.list's exact shape: fetch `limit + 1` rows so the
  // extra row (never returned) answers "is there a next page" without a
  // second count query; `createdAt` carries an `id` tie-breaker so two rows
  // sharing the identical millisecond still sort deterministically across
  // pages. `type`/`q` are optional filters, both AND-combined with the
  // userId scope - `q` matches the denormalized title/description (see
  // ActivityEvent.title's own schema comment for why those columns exist).
  // Deliberately a thin read of ActivityEvent as-is (no joins back to
  // Video/Clip for a live title) - `metadata`/`title`/`description` already
  // carry whatever display context was known at write time, which survives
  // even if the video/clip is later deleted.
  async getActivity(
    userId: string,
    { cursor, limit, type, q }: DashboardActivityListQuery & { limit: number },
  ): Promise<DashboardActivityDto> {
    const trimmedQuery = q?.trim();

    const events = await this.prisma.activityEvent.findMany({
      where: {
        userId,
        ...(type ? { type: mapActivityEventTypeToPrisma(type) } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { title: { contains: trimmedQuery, mode: 'insensitive' as const } },
                { description: { contains: trimmedQuery, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;

    return {
      events: page.map((event): ActivityEventDto => ({
        id: event.id,
        type: mapActivityEventType(event.type),
        videoId: event.videoId,
        clipId: event.clipId,
        metadata: (event.metadata as unknown as Record<string, unknown> | null) ?? null,
        title: event.title,
        description: event.description,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Bulk-delete-by-ids (1-or-many) - idempotent (deleteMany over
  // `id: { in: ids }` never errors on an already-deleted or foreign id) and
  // userId-scoped (never touches another user's rows), same posture as
  // NotificationsV2Service.remove. Fire-and-forget deletion-log write AFTER
  // the delete commits - same "log after, not before" rule
  // WorkspaceService.remove() already documents.
  async removeActivity(userId: string, ids: string[]): Promise<ActivityDeleteResult> {
    if (ids.length === 0) return { count: 0 };

    const { count } = await this.prisma.activityEvent.deleteMany({
      where: { userId, id: { in: ids } },
    });

    recordActivityDeletionLog(this.prisma, {
      userId,
      action: 'DELETE_SELECTED',
      deletedIds: ids,
      count,
    }).catch(() => {});

    return { count };
  }

  // Clear-all - a separate, explicit action (not "bulk delete with an empty
  // ids array", which is a no-op per removeActivity above) since silently
  // inferring "wipe everything" from an empty/missing field would be a
  // landmine. userId-scoped, same as removeActivity.
  async removeAllActivity(userId: string): Promise<ActivityDeleteResult> {
    const { count } = await this.prisma.activityEvent.deleteMany({ where: { userId } });

    recordActivityDeletionLog(this.prisma, { userId, action: 'DELETE_ALL', count }).catch(() => {});

    return { count };
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
