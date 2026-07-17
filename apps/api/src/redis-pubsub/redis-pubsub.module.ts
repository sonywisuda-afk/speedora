import { Global, Module } from '@nestjs/common';
import { NotificationPublisherService } from './notification-publisher.service';
import { NotificationSubscriberService } from './notification-subscriber.service';

// Milestone 04c - @Global() so any consumer (VideosService today,
// NotificationsController's SSE route, a future Alert Engine) can inject
// NotificationPublisherService/NotificationSubscriberService without an
// explicit per-module import - same reasoning PrismaModule is @Global().
@Global()
@Module({
  providers: [NotificationPublisherService, NotificationSubscriberService],
  exports: [NotificationPublisherService, NotificationSubscriberService],
})
export class RedisPubSubModule {}
