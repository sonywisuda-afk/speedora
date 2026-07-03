import type {
  PublishRecord as PublishRecordRow,
  SocialPlatform as DbSocialPlatform,
} from '@viral-clip-app/database';
import type { PublishRecord, PublishStatus, SocialPlatform } from '@viral-clip-app/shared';

// Prisma's generated PublishStatus/SocialPlatform and packages/shared's are
// separately-declared TS enums with identical string members (same
// "Mirrors X" convention used throughout this project) - nominally
// distinct types even though they're structurally identical at runtime,
// hence the explicit casts. platform is denormalized from the joined
// SocialAccount so callers (ClipsService, VideosService) don't need a
// separate lookup to show e.g. "Published to YouTube".
export function toSharedPublishRecord(
  record: PublishRecordRow & { socialAccount: { platform: DbSocialPlatform } },
): PublishRecord {
  return {
    id: record.id,
    clipId: record.clipId,
    socialAccountId: record.socialAccountId,
    platform: record.socialAccount.platform as unknown as SocialPlatform,
    status: record.status as unknown as PublishStatus,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    platformPostId: record.platformPostId,
    errorMessage: record.errorMessage,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}
