import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsV2Controller } from './notifications-v2.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsV2Service } from './notifications-v2.service';

// PrismaService needs no import - it's @Global() (prisma.module.ts), same
// as DashboardModule's own comment on this.
//
// Notification Center v2 Phase 3 - NotificationsV2Controller/Service are
// additive siblings, not replacements - registering them here changes
// nothing about the existing V1 controller/service's own routes/behavior.
@Module({
  controllers: [NotificationsController, NotificationsV2Controller],
  providers: [NotificationsService, NotificationsV2Service],
})
export class NotificationsModule {}
