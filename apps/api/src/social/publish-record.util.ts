import type {
  PublishRecord as PublishRecordRow,
  PublishStatus as PrismaPublishStatus,
  SocialPlatform as PrismaSocialPlatform,
} from '@speedora/database';
import { PublishStatus, SocialPlatform, type PublishRecord } from '@speedora/shared';

function assertNever(value: never): never {
  throw new Error(`Unhandled enum value: ${JSON.stringify(value)}`);
}

// Prisma's generated PublishStatus and packages/shared's are separately-
// declared TS enums with identical string members (same "Mirrors X"
// convention used throughout this project) - nominally distinct types even
// though they're structurally identical at runtime. This function replaces
// what used to be a blind `as unknown as` cast: the switch has no `default`
// case, so a new schema.prisma PublishStatus member fails to compile here
// (assertNever) until a matching case - and, by necessity, a matching
// packages/shared PublishStatus member - is added, same "Contract
// Synchronization" pattern as dashboard.service.ts's mapActivityEventType.
export function mapPublishStatus(status: PrismaPublishStatus): PublishStatus {
  switch (status) {
    case 'SCHEDULED':
      return PublishStatus.SCHEDULED;
    case 'QUEUED':
      return PublishStatus.QUEUED;
    case 'PUBLISHING':
      return PublishStatus.PUBLISHING;
    case 'PUBLISHED':
      return PublishStatus.PUBLISHED;
    case 'FAILED':
      return PublishStatus.FAILED;
    default:
      return assertNever(status);
  }
}

// Same convention as mapPublishStatus above, for SocialPlatform.
export function mapSocialPlatform(platform: PrismaSocialPlatform): SocialPlatform {
  switch (platform) {
    case 'YOUTUBE':
      return SocialPlatform.YOUTUBE;
    case 'TIKTOK':
      return SocialPlatform.TIKTOK;
    case 'INSTAGRAM':
      return SocialPlatform.INSTAGRAM;
    case 'FACEBOOK':
      return SocialPlatform.FACEBOOK;
    case 'THREADS':
      return SocialPlatform.THREADS;
    case 'LINKEDIN':
      return SocialPlatform.LINKEDIN;
    case 'PINTEREST':
      return SocialPlatform.PINTEREST;
    case 'X':
      return SocialPlatform.X;
    default:
      return assertNever(platform);
  }
}

// Reverse direction of mapSocialPlatform, for the rarer case of taking a
// client-supplied (shared-typed) platform value and writing/comparing it
// against a Prisma column - same exhaustive-switch-plus-assertNever
// convention, just mapping the other way.
export function mapSharedSocialPlatformToPrisma(platform: SocialPlatform): PrismaSocialPlatform {
  switch (platform) {
    case SocialPlatform.YOUTUBE:
      return 'YOUTUBE';
    case SocialPlatform.TIKTOK:
      return 'TIKTOK';
    case SocialPlatform.INSTAGRAM:
      return 'INSTAGRAM';
    case SocialPlatform.FACEBOOK:
      return 'FACEBOOK';
    case SocialPlatform.THREADS:
      return 'THREADS';
    case SocialPlatform.LINKEDIN:
      return 'LINKEDIN';
    case SocialPlatform.PINTEREST:
      return 'PINTEREST';
    case SocialPlatform.X:
      return 'X';
    default:
      return assertNever(platform);
  }
}

// platform is denormalized from the joined SocialAccount so callers
// (ClipsService, VideosService) don't need a separate lookup to show e.g.
// "Published to YouTube".
export function toSharedPublishRecord(
  record: PublishRecordRow & { socialAccount: { platform: PrismaSocialPlatform } },
): PublishRecord {
  return {
    id: record.id,
    clipId: record.clipId,
    socialAccountId: record.socialAccountId,
    platform: mapSocialPlatform(record.socialAccount.platform),
    status: mapPublishStatus(record.status),
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    platformPostId: record.platformPostId,
    errorMessage: record.errorMessage,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    viewCount: record.viewCount,
    likeCount: record.likeCount,
    commentCount: record.commentCount,
    statsUpdatedAt: record.statsUpdatedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    campaignId: record.campaignId,
    recurringScheduleId: record.recurringScheduleId,
  };
}
