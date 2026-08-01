import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [QueueModule, WorkspaceModule],
  controllers: [ExportController],
  providers: [ExportService],
  // Phase E (Dashboard & Recent Activity) - DashboardModule reuses toDto()/
  // mapExportType() rather than duplicating the ExportJob -> DTO mapping.
  exports: [ExportService],
})
export class ExportModule {}
