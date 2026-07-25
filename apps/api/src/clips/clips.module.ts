import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { QueueModule } from '../queue/queue.module';
import { RecurringSchedulesModule } from '../recurring-schedules/recurring-schedules.module';
import { SocialModule } from '../social/social.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ClipQueryParserService } from './clip-query-parser.service';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  // SocialModule: ClipsService.publish() needs SocialAccountsService to
  // validate the target account belongs to the requester before enqueueing
  // a publish-clip job (Fase 6b). StorageModule: ClipsService.remove()
  // cleans up a deleted clip's rendered output object. WorkspaceModule:
  // WorkspaceAccessService (Sprint 5A) replaces the old ownerId checks.
  // CampaignsModule/RecurringSchedulesModule (Publishing Expansion Phase 6):
  // ClipsService.publish() validates/resolves a campaignId/recurringScheduleId
  // when a clip is queued against one.
  imports: [
    QueueModule,
    SocialModule,
    StorageModule,
    WorkspaceModule,
    CampaignsModule,
    RecurringSchedulesModule,
  ],
  controllers: [ClipsController],
  providers: [ClipsService, ClipQueryParserService],
})
export class ClipsModule {}
