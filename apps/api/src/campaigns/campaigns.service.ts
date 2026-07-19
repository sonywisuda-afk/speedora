import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PublishStatus,
  recordAuditLog,
  WorkspaceRole,
  type Campaign,
  type PublishRecord as PublishRecordRow,
  type SocialAccount as SocialAccountRow,
} from '@speedora/database';
import type {
  CampaignAnalyticsDto,
  CampaignDetailDto,
  CampaignDto,
  CampaignProgress,
  SocialPlatform as SharedSocialPlatform,
  TrendGranularity,
} from '@speedora/shared';
import { CampaignStatus } from '@speedora/shared';
import {
  bucketByPublishPeriod,
  computeCampaignPlatformBreakdown,
  computeCampaignTotals,
  periodsForGranularity,
  type CampaignAnalyticsRecord,
} from '@speedora/analytics-report';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { computeCampaignStatus } from './campaign-status.util';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { UpdateCampaignDto } from './dto/update-campaign.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type JobSummaryInput = Pick<PublishRecordRow, 'status' | 'clipId'> & {
  socialAccount: Pick<SocialAccountRow, 'platform'>;
};

function summarize(
  cancelledAt: Date | null,
  jobs: JobSummaryInput[],
): { status: CampaignStatus; clipCount: number; platformCount: number; progress: CampaignProgress } {
  return {
    status: computeCampaignStatus(cancelledAt, jobs),
    clipCount: new Set(jobs.map((j) => j.clipId)).size,
    platformCount: new Set(jobs.map((j) => j.socialAccount.platform)).size,
    progress: {
      total: jobs.length,
      published: jobs.filter((j) => j.status === PublishStatus.PUBLISHED).length,
      failed: jobs.filter((j) => j.status === PublishStatus.FAILED).length,
    },
  };
}

function toDto(campaign: Campaign, jobs: JobSummaryInput[]): CampaignDto {
  return {
    id: campaign.id,
    workspaceId: campaign.workspaceId,
    name: campaign.name,
    description: campaign.description,
    tag: campaign.tag,
    startDate: campaign.startDate.toISOString(),
    endDate: campaign.endDate.toISOString(),
    createdById: campaign.createdById,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    ...summarize(campaign.cancelledAt, jobs),
  };
}

// Publishing Expansion Phase 6 (Scheduling). Same EDITOR-to-create/ADMIN-
// to-cancel role split as ProjectService's create/delete, and the same
// "log create/cancel, not every plain edit" audit posture. Status is never
// stored - see campaign-status.util.ts's own comment for why.
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateCampaignDto): Promise<CampaignDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.EDITOR);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description ?? null,
        tag: dto.tag ?? null,
        startDate,
        endDate,
        createdById: userId,
      },
    });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'CAMPAIGN_CREATED',
      actorId: userId,
      targetType: 'Campaign',
      targetId: campaign.id,
      metadata: { name: dto.name },
    }).catch(() => {});

    return toDto(campaign, []);
  }

  async listByWorkspace(userId: string, workspaceId: string): Promise<{ campaigns: CampaignDto[] }> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);
    const campaigns = await this.prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        publishRecords: { select: { status: true, clipId: true, socialAccount: { select: { platform: true } } } },
      },
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
    });
    return { campaigns: campaigns.map((c) => toDto(c, c.publishRecords)) };
  }

  private async findOrThrow(id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${id} not found`);
    }
    return campaign;
  }

  async get(userId: string, id: string): Promise<CampaignDetailDto> {
    const campaign = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, campaign.workspaceId, WorkspaceRole.VIEWER);
    const jobs = await this.prisma.publishRecord.findMany({
      where: { campaignId: id },
      include: { socialAccount: true },
      orderBy: { createdAt: 'desc' },
    });
    return { ...toDto(campaign, jobs), publishRecords: jobs.map(toSharedPublishRecord) };
  }

  // Sprint 6E (Campaign-level analytics rollup). One query - the campaign
  // row and every one of its PublishRecords (with each record's latest
  // stats snapshot) come back via a single nested `include`, same "nested
  // include, not a loop that queries per record" pattern as
  // ClipsService.getPerformance / WorkspaceAnalyticsService.getLeaderboard.
  //
  // CampaignStatus (derived below via the same computeCampaignStatus()
  // every other campaign endpoint uses) is purely informational on the
  // response - it never filters or changes any aggregated number. The only
  // status that gates the aggregation is PublishRecord.status === PUBLISHED
  // (the sole status with real PublishRecordStatsSnapshot data) - a
  // CANCELLED or still-RUNNING campaign reports the exact same kind of real
  // numbers, just for however many jobs have actually published so far.
  //
  // "No campaign" publish records are structurally out of scope here (the
  // query is `where: { campaignId: id }`), not a case this endpoint needs
  // to decide about - that question belongs to Sprint 6D's Leaderboard,
  // which already made an explicit call (excluded from Top Campaign, not
  // shown as a synthetic "No Campaign" bucket).
  async getAnalytics(
    userId: string,
    id: string,
    options: { granularity: TrendGranularity },
  ): Promise<CampaignAnalyticsDto> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        publishRecords: {
          include: {
            socialAccount: { select: { platform: true } },
            statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
          },
        },
        // Sprint 6K (Conversion) - only the denormalized clickCount, same
        // "O(1) read per TrackedLink, never a COUNT() scan" reasoning as
        // ClipsService.getPerformance's own trackedLinks select.
        trackedLinks: { select: { clickCount: true } },
      },
    });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${id} not found`);
    }
    await this.access.assertMinRole(userId, campaign.workspaceId, WorkspaceRole.VIEWER);

    const status = computeCampaignStatus(campaign.cancelledAt, campaign.publishRecords);

    const publishedJobs = campaign.publishRecords.filter(
      (job): job is typeof job & { publishedAt: Date } =>
        job.status === PublishStatus.PUBLISHED && job.publishedAt !== null,
    );
    // Single enriched list - analyticsRecords (totals/platform breakdown)
    // and the trend input both read from this same array rather than two
    // separately-derived lists that would need to stay index-aligned.
    const enrichedRecords = publishedJobs.map((job) => {
      const snapshot = job.statsSnapshots[0];
      return {
        platform: job.socialAccount.platform as unknown as SharedSocialPlatform,
        publishedAt: job.publishedAt,
        viewCount: snapshot?.viewCount ?? null,
        likeCount: snapshot?.likeCount ?? null,
        commentCount: snapshot?.commentCount ?? null,
        shareCount: snapshot?.shareCount ?? null,
        engagementScore: snapshot?.engagementScore ?? null,
      };
    });
    const analyticsRecords: CampaignAnalyticsRecord[] = enrichedRecords;

    // The trend window is the campaign's own date range, not an arbitrary
    // "last N days" - clamped to `now` for a still-running campaign so it
    // never shows empty future buckets, and to the campaign's own endDate
    // for one that already finished.
    const now = new Date();
    const referenceNow = campaign.endDate < now ? campaign.endDate : now;
    // bucketByPublishPeriod's daily bucketing already keys by calendar day
    // (ignoring time-of-day), so ceil() alone gives the exact inclusive
    // day count from campaign.startDate through referenceNow - an extra +1
    // here would pad in one bucket before the campaign's actual start date
    // (caught via live verification: a campaign starting 2026-07-01 was
    // showing a spurious 2026-06-30 bucket).
    const spanDays = Math.max(
      1,
      Math.ceil((referenceNow.getTime() - campaign.startDate.getTime()) / MS_PER_DAY),
    );
    const engagementTrend = bucketByPublishPeriod(
      enrichedRecords.map((r) => ({
        publishedAt: r.publishedAt,
        viewCount: r.viewCount,
        engagementScore: r.engagementScore,
      })),
      options.granularity,
      periodsForGranularity(spanDays, options.granularity),
      referenceNow,
    );

    return {
      campaignId: campaign.id,
      status,
      totals: computeCampaignTotals(analyticsRecords),
      platformBreakdown: computeCampaignPlatformBreakdown(analyticsRecords),
      engagementTrend,
      granularity: options.granularity,
      // Sprint 6K (Conversion) - null means "no TrackedLink created for
      // this campaign yet," never a fabricated 0.
      conversionCount:
        campaign.trackedLinks.length > 0
          ? campaign.trackedLinks.reduce((sum, link) => sum + link.clickCount, 0)
          : null,
    };
  }

  async update(userId: string, id: string, dto: UpdateCampaignDto): Promise<CampaignDto> {
    const campaign = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, campaign.workspaceId, WorkspaceRole.EDITOR);

    const startDate = dto.startDate ? new Date(dto.startDate) : campaign.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : campaign.endDate;
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { name: dto.name, description: dto.description, tag: dto.tag, startDate, endDate },
      include: {
        publishRecords: { select: { status: true, clipId: true, socialAccount: { select: { platform: true } } } },
      },
    });
    return toDto(updated, updated.publishRecords);
  }

  // Cancels the campaign and any of its jobs that haven't fired yet - same
  // "SCHEDULED only, hard delete" semantics as
  // ClipsService.cancelScheduledPublish, applied in bulk. A job already
  // QUEUED/PUBLISHING/PUBLISHED/FAILED is left alone, same reasoning as the
  // per-clip cancel: it's either already been handed to the worker or
  // finished, and cancelling here wouldn't stop/undo it.
  async cancel(userId: string, id: string): Promise<CampaignDto> {
    const campaign = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, campaign.workspaceId, WorkspaceRole.ADMIN);

    await this.prisma.publishRecord.deleteMany({
      where: { campaignId: id, status: PublishStatus.SCHEDULED },
    });
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { cancelledAt: new Date() },
      include: {
        publishRecords: { select: { status: true, clipId: true, socialAccount: { select: { platform: true } } } },
      },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: campaign.workspaceId,
      action: 'CAMPAIGN_CANCELLED',
      actorId: userId,
      targetType: 'Campaign',
      targetId: id,
      metadata: { name: campaign.name },
    }).catch(() => {});

    return toDto(updated, updated.publishRecords);
  }

  // Used by ClipsService.publish() when a clip is queued with a
  // campaignId - validates the campaign exists, belongs to the clip's own
  // workspace, and isn't cancelled. No role check here - ClipsService
  // already asserted EDITOR on the clip's own workspace before calling
  // this.
  async assertUsableForQueue(workspaceId: string, campaignId: string): Promise<void> {
    const campaign = await this.findOrThrow(campaignId);
    if (campaign.workspaceId !== workspaceId) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }
    if (campaign.cancelledAt) {
      throw new BadRequestException(`Campaign ${campaignId} is cancelled`);
    }
  }
}
