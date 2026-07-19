import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// Sprint 6K (Conversion) - a narrow, single-purpose raw ioredis client for
// short-lived click-dedup keys only (SET NX EX), same hand-rolled-client
// shape as NotificationPublisherService (redis-pubsub/) and
// RedisThrottlerStorage (auth/) - no general-purpose injectable Redis
// client exists in this app, and this use case (a single atomic SET NX)
// doesn't need one. Every key written here has a short TTL and is never
// read back except within that same window - nothing here is durable
// storage.
@Injectable()
export class ClickDedupService implements OnModuleDestroy {
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  // Returns true the FIRST time this exact key is seen within the debounce
  // window (the caller should record a real click); false for every
  // repeat within that window (a browser retry, a double-click, a
  // link-preview bot's own duplicate fetch immediately after a real
  // click). A fuzzy, best-effort debounce, not a cryptographic guarantee -
  // the right tradeoff for a window this short.
  async isFirstOccurrence(key: string, windowSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', windowSeconds, 'NX');
    return result === 'OK';
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
