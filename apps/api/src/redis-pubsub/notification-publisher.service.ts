import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { NOTIFICATION_REALTIME_CHANNEL, type NotificationPublishEvent } from '@speedora/database';
import { Redis } from 'ioredis';

// Milestone 04c - a raw, purpose-built ioredis client, same shape as
// RedisThrottlerStorage (../auth/redis-throttler-storage.service.ts) - a
// real precedent in this codebase for a hand-rolled Redis client inside a
// Nest class, rather than trying to reuse @nestjs/bullmq's own internal
// connection (which it fully owns/encapsulates, with no exported raw
// client). PUBLISH-only, so unlike NotificationSubscriberService this
// never enters Redis's restricted subscriber mode.
@Injectable()
export class NotificationPublisherService implements OnModuleDestroy {
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  async publish(event: NotificationPublishEvent): Promise<void> {
    await this.client.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(event));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
