import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
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

  @Get('activity')
  getActivity(@CurrentUser() user: SafeUser, @Query('limit') limit?: string) {
    return this.dashboardService.getActivity(user.id, parseLimit(limit, DEFAULT_ACTIVITY_LIMIT));
  }

  @Get('export.csv')
  async exportCsv(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const csv = await this.dashboardService.exportCsv(user.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="speedora-report.csv"');
    res.send(withUtf8Bom(csv));
  }
}
