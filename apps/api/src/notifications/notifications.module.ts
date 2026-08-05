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
//
// V2 MUST be registered before V1: both controllers ultimately match the
// literal path /notifications/v2 (V2's own @Delete() there, but also V1's
// @Delete(':id') on /notifications/:id, since ':id' is a wildcard segment
// that matches the literal string "v2" too). Express/Nest resolve
// ambiguous matches in registration order, not by specificity, so with V1
// first `DELETE /notifications/v2` was being swallowed by V1's
// deleteOne(id: 'v2', ...), producing a spurious "Notification v2 not
// found" 404 instead of ever reaching NotificationsV2Service.remove.
@Module({
  controllers: [NotificationsV2Controller, NotificationsController],
  providers: [NotificationsService, NotificationsV2Service],
})
export class NotificationsModule {}
