import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// Authentication Foundation Sprint 4 (Attack Protection) - a narrow,
// single-purpose raw ioredis client, same hand-rolled-client shape as
// ClickDedupService/RedisThrottlerStorage/NotificationPublisherService - no
// general-purpose injectable Redis client exists in this app.
//
// Deliberately hand-rolled rather than reusing @nestjs/throttler
// (RedisThrottlerStorage's own machinery): that guard architecture has one
// fixed blockDuration per named throttler, no hook for a per-key GROWING
// delay. This is a second, complementary dimension to the existing IP-based
// ThrottlerGuard (5/min flat, unchanged) - keyed by email instead of IP, so
// an attacker rotating IPs against one account is still slowed down.
@Injectable()
export class LoginBackoffService implements OnModuleDestroy {
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  // No delay for the first 3 failures; beyond that, delay doubles each time
  // (1s, 2s, 4s, 8s, ...) capped at 5 minutes. 30 minutes of inactivity
  // fully resets the counter - no permanent lockout from a stale key.
  private static readonly FREE_ATTEMPTS = 3;
  private static readonly BASE_DELAY_MS = 1_000;
  private static readonly MAX_DELAY_MS = 300_000;
  private static readonly WINDOW_SECONDS = 30 * 60;

  private keyFor(email: string): string {
    return `login-backoff:${email.trim().toLowerCase()}`;
  }

  async checkAllowed(email: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const nextAllowedAt = await this.client.hget(this.keyFor(email), 'nextAllowedAt');
    if (!nextAllowedAt) return { allowed: true, retryAfterMs: 0 };

    const remaining = Number(nextAllowedAt) - Date.now();
    if (remaining <= 0) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: remaining };
  }

  async recordFailure(email: string): Promise<void> {
    const key = this.keyFor(email);
    const count = await this.client.hincrby(key, 'count', 1);

    if (count > LoginBackoffService.FREE_ATTEMPTS) {
      const delay = Math.min(
        LoginBackoffService.MAX_DELAY_MS,
        LoginBackoffService.BASE_DELAY_MS * 2 ** (count - LoginBackoffService.FREE_ATTEMPTS - 1),
      );
      await this.client.hset(key, 'nextAllowedAt', Date.now() + delay);
    }
    await this.client.expire(key, LoginBackoffService.WINDOW_SECONDS);
  }

  async reset(email: string): Promise<void> {
    await this.client.del(this.keyFor(email));
  }

  // Reused by AuthService.computeLoginRisk as the "repeated failures"
  // signal - single source of truth for "how many recent failures," not a
  // second tracking mechanism duplicated as a Postgres query.
  async getFailureCount(email: string): Promise<number> {
    const count = await this.client.hget(this.keyFor(email), 'count');
    return count ? Number(count) : 0;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
