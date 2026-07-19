import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from '../auth/redis-throttler-storage.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ClickDedupService } from './click-dedup.service';
import { RedirectController } from './redirect.controller';
import { RedirectService } from './redirect.service';
import { TrackedLinksController } from './tracked-links.controller';
import { TrackedLinksService } from './tracked-links.service';

@Module({
  imports: [
    WorkspaceModule,
    // A separate ThrottlerModule registration from AuthModule's own
    // (different throttler `name`, so the two never share a bucket) -
    // AuthModule's 5-per-60s login limit would make a real, legitimately
    // popular tracked link unusable within seconds. 30 requests per 10s
    // per IP is a coarse backstop against a scripted flood, not the real
    // duplicate-click protection (see RedirectService's own debounce) -
    // generous enough that real traffic (multiple users behind the same
    // NAT/corporate proxy, a link-preview bot immediately followed by a
    // real click) never trips it. Same Redis-backed storage as AuthModule
    // (shared across every apps/api replica, not an independent in-memory
    // counter per replica).
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'redirect', ttl: 10_000, limit: 30 }],
        storage: new RedisThrottlerStorage(),
      }),
    }),
  ],
  controllers: [TrackedLinksController, RedirectController],
  providers: [TrackedLinksService, RedirectService, ClickDedupService],
})
export class TrackedLinksModule {}
