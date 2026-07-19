import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WorkspaceAnalyticsController } from './workspace-analytics.controller';
import { WorkspaceAnalyticsService } from './workspace-analytics.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [WorkspaceAnalyticsController],
  providers: [WorkspaceAnalyticsService],
})
export class WorkspaceAnalyticsModule {}
