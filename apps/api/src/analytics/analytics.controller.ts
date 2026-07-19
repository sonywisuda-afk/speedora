import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SocialPlatform } from '@speedora/database';
import type { TrendGranularity } from '@speedora/shared';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

// Milestones 5A/5B (Analytics Dashboard). Every route here is per-user,
// ownership-scoped data (never system-wide) - JwtAuthGuard at the class
// level, same convention as ClipsController/VideosController. Not modeled
// on MonitoringModule (docs/monitoring.md), which is deliberately
// unauthenticated/system-wide operational data.
// Sprint 6B added 180/365 - a coarser granularity (monthly/yearly) over a
// 7/30/90-day window would only ever show 1-3 buckets, which isn't a useful
// trend. days still just bounds the same fetchPublishedRecords() window
// platformComparison/growthSummary/aiSummary all share.
const VALID_DAYS = [7, 30, 90, 180, 365];
const DEFAULT_DAYS = 30;
const MIN_LIMIT = 1;
// Stabilization Pass - aligned to the same 1-50 ceiling as VideosController/
// WorkspaceController's own parseLimit (previously 100). The 50 default
// passed at each call site below is unchanged, so this only tightens what a
// client can explicitly request past that.
const MAX_LIMIT = 50;
const VALID_GRANULARITIES: TrendGranularity[] = ['daily', 'weekly', 'monthly', 'yearly'];
const DEFAULT_GRANULARITY: TrendGranularity = 'daily';

// Invalid/missing query params fall back to a sane default rather than
// throwing a 400 - these are display filters, not data-integrity-critical
// input, so a typo'd `?days=abc` degrading to "show the default range"
// is friendlier than an error page.
function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return VALID_DAYS.includes(parsed) ? parsed : DEFAULT_DAYS;
}

function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

function parsePlatform(raw: string | undefined): SocialPlatform | undefined {
  return raw && (Object.values(SocialPlatform) as string[]).includes(raw)
    ? (raw as SocialPlatform)
    : undefined;
}

function parseGranularity(raw: string | undefined): TrendGranularity {
  return raw && (VALID_GRANULARITIES as string[]).includes(raw)
    ? (raw as TrendGranularity)
    : DEFAULT_GRANULARITY;
}

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: SafeUser) {
    return this.analyticsService.getOverview(user.id);
  }

  @Get('performance')
  getPerformance(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('platform') platform?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.analyticsService.getPerformance(user.id, {
      days: parseDays(days),
      platform: parsePlatform(platform),
      granularity: parseGranularity(granularity),
    });
  }

  @Get('performance/clips')
  getPerformanceClips(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('platform') platform?: string,
    @Query('videoId') videoId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getPerformanceClips(user.id, {
      days: parseDays(days),
      platform: parsePlatform(platform),
      videoId: videoId || undefined,
      limit: parseLimit(limit, 50),
    });
  }

  @Get('performance/videos')
  getPerformanceVideos(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('platform') platform?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getPerformanceVideos(user.id, {
      days: parseDays(days),
      platform: parsePlatform(platform),
      limit: parseLimit(limit, 50),
    });
  }

  @Get('followers')
  getFollowers(@CurrentUser() user: SafeUser, @Query('days') days?: string) {
    return this.analyticsService.getFollowers(user.id, parseDays(days));
  }

  @Get('heatmap')
  getHeatmap(@CurrentUser() user: SafeUser, @Query('days') days?: string) {
    return this.analyticsService.getHeatmap(user.id, parseDays(days));
  }
}
