import { Body, Controller, Delete, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ActivityEventType, type ActivityDeleteRequest } from '@speedora/shared';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { withUtf8Bom } from '../common/csv.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

const MIN_LIMIT = 1;
// Stabilization Pass - aligned to the same 1-50 ceiling as VideosController/
// WorkspaceController's own parseLimit (previously 100, an unexplained third
// ceiling alongside those two).
const MAX_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 20;

// Same "invalid/missing query param falls back to a sane default rather
// than throwing" posture as AnalyticsController's own parseLimit - this is
// a display filter, not data-integrity-critical input.
function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

// Sprint 1-2 (Dashboard Redesign) - every route here is per-user,
// ownership-scoped data, same convention as AnalyticsController (contrast
// with OpsAiController, which is deliberately system-wide/role-gated).
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  getStats(@CurrentUser() user: SafeUser) {
    return this.dashboardService.getStats(user.id);
  }

  // Activity Timeline v2 - cursor/type/q are all optional filters; an
  // invalid/unrecognized `type` degrades to "no filter" via resolveType
  // rather than throwing, same posture as NotificationsV2Controller's own
  // resolveState/resolveCategory/resolvePriority helpers (this is a read
  // filter, not data-integrity-critical input).
  @Get('activity')
  getActivity(
    @CurrentUser() user: SafeUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
  ) {
    return this.dashboardService.getActivity(user.id, {
      cursor,
      limit: parseLimit(limit, DEFAULT_ACTIVITY_LIMIT),
      type: this.resolveType(type),
      q,
    });
  }

  // Bulk-delete-by-ids (1-or-many, body-driven) vs. clear-all below -
  // deliberately two fully literal, different-segment-count routes (no
  // dynamic `:id` segment anywhere on this controller), structurally immune
  // to the wildcard-route-collision bug class fixed earlier in
  // notifications.module.ts (that required a `:id`-shaped route somewhere
  // in the mix; there isn't one here).
  @Delete('activity')
  removeActivity(@CurrentUser() user: SafeUser, @Body() dto: ActivityDeleteRequest) {
    return this.dashboardService.removeActivity(user.id, dto.ids ?? []);
  }

  @Delete('activity/all')
  removeAllActivity(@CurrentUser() user: SafeUser) {
    return this.dashboardService.removeAllActivity(user.id);
  }

  private resolveType(raw: string | undefined): ActivityEventType | undefined {
    if (raw && Object.values(ActivityEventType).includes(raw as ActivityEventType)) {
      return raw as ActivityEventType;
    }
    return undefined;
  }

  // Phase E (Dashboard & Recent Activity) - Export Center visibility.
  @Get('exports')
  getExports(@CurrentUser() user: SafeUser) {
    return this.dashboardService.getExports(user.id);
  }

  @Get('export.csv')
  async exportCsv(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const csv = await this.dashboardService.exportCsv(user.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="speedora-report.csv"');
    res.send(withUtf8Bom(csv));
  }
}
