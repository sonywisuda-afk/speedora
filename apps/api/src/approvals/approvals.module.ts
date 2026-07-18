import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  // QueueModule: NotificationDeliveryProducer. WorkspaceModule:
  // WorkspaceAccessService.
  imports: [QueueModule, WorkspaceModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
