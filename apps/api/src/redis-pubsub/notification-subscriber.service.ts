import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { NOTIFICATION_REALTIME_CHANNEL, type NotificationPublishEvent } from '@speedora/database';
import { Redis } from 'ioredis';
import { Subject } from 'rxjs';

// Milestone 04c - the ONE shared Redis SUBSCRIBE connection for the whole
// process. ioredis (like Redis itself) puts a connection that issues
// SUBSCRIBE into a restricted "subscriber mode" - it can never also PUBLISH
// or run other commands - so this must stay a separate connection from
// NotificationPublisherService's, and there must only ever be one of these,
// fanning out in-process via an RxJS Subject to every per-connection SSE
// Observable (NotificationsController.stream()) rather than each HTTP
// connection opening its own SUBSCRIBE (which Redis pub/sub isn't meant
// for and wouldn't scale).
@Injectable()
export class NotificationSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  private readonly subject = new Subject<NotificationPublishEvent>();

  readonly stream$ = this.subject.asObservable();

  async onModuleInit(): Promise<void> {
    await this.client.subscribe(NOTIFICATION_REALTIME_CHANNEL);
    this.client.on('message', (_channel: string, message: string) => {
      try {
        this.subject.next(JSON.parse(message) as NotificationPublishEvent);
      } catch {
        // Malformed payload - drop it, never crash the shared subscriber
        // over one bad message (every producer here JSON.stringifies its
        // own well-typed NotificationPublishEvent, so this is defensive,
        // not an expected path).
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
