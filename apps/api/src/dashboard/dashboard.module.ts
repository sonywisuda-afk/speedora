import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ExportModule } from '../export/export.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// AnalyticsModule: exportCsv() reuses AnalyticsService's already-computed
// Overview + Performance data. ExportModule (Phase E): getExports() reuses
// ExportService's toDto()/mapExportType(). PrismaService needs no import -
// it's @Global() (prisma.module.ts), same as every other module that only
// needs DB access.
@Module({
  imports: [AnalyticsModule, ExportModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
