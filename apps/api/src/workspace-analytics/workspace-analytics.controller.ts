import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { LeaderboardMetric } from '@speedora/shared';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceAnalyticsService } from './workspace-analytics.service';

// Sprint 6D (Leaderboard) - workspace-scoped analytics, parallel to
// AnalyticsController's owner-scoped /analytics/* (never merged into it -
// see the plan's foundational scoping decision). Same "invalid/missing
// query params fall back to a sane default rather than throwing a 400"
// posture as AnalyticsController's own parseDays/parsePlatform.
const VALID_DAYS = [7, 30, 90, 180, 365];
const DEFAULT_DAYS = 30;
const VALID_METRICS: LeaderboardMetric[] = ['views', 'likes', 'comments', 'shares', 'engagementScore'];
const DEFAULT_METRIC: LeaderboardMetric = 'engagementScore';
const DEFAULT_LIMIT = 10;
// "Top 10 or Top 20" - a hard ceiling, not just a default, so a client
// can't request an unbounded leaderboard.
const MAX_LIMIT = 20;
const MIN_LIMIT = 1;

function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return VALID_DAYS.includes(parsed) ? parsed : DEFAULT_DAYS;
}

function parseMetric(raw: string | undefined): LeaderboardMetric {
  return raw && (VALID_METRICS as string[]).includes(raw)
    ? (raw as LeaderboardMetric)
    : DEFAULT_METRIC;
}

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

@Controller('workspaces/:workspaceId/analytics')
@UseGuards(JwtAuthGuard)
export class WorkspaceAnalyticsController {
  constructor(private readonly workspaceAnalytics: WorkspaceAnalyticsService) {}

  @Get('leaderboard')
  getLeaderboard(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Query('metric') metric?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workspaceAnalytics.getLeaderboard(user.id, workspaceId, {
      metric: parseMetric(metric),
      days: parseDays(days),
      limit: parseLimit(limit),
    });
  }

  @Get('followers')
  getFollowers(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Query('days') days?: string,
  ) {
    return this.workspaceAnalytics.getFollowers(user.id, workspaceId, parseDays(days));
  }

  @Get('heatmap')
  getHeatmap(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Query('days') days?: string,
  ) {
    return this.workspaceAnalytics.getHeatmap(user.id, workspaceId, parseDays(days));
  }

  @Get('prediction-model')
  getPredictionModel(@CurrentUser() user: SafeUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaceAnalytics.getPredictionModel(user.id, workspaceId);
  }
}
