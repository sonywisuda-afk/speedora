import { QueueName } from '@speedora/shared';
import { Queue, type DefaultJobOptions } from 'bullmq';
import { createRedisConnection } from './redis';

// Bounds how long finished jobs linger in Redis - without this, every job
// (complete or failed) accumulates forever. Completed jobs are kept only
// briefly (nothing reads them once done); failed jobs are kept much longer
// with no count cap, since BullMQ has no separate dead-letter-queue
// primitive - "failed jobs kept and queryable" is the practical equivalent
// of a DLQ for this library, and a human diagnosing an incident needs them
// to still be there days later, not just a fixed count back.
const defaultJobOptions: DefaultJobOptions = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 30 * 24 * 60 * 60 },
};

// Quality Validation roadmap (Fase 0 design, Phase 1) - apps/api enqueues
// directly into this for a normal upload/import
// (VideosService.upload()/importFromYoutube()/retry()), and
// import-youtube.worker.ts self-chains into it on a successful download
// (replacing what used to be a direct TRANSCRIBE self-chain - see
// QueueName.PROBE_VIDEO's own comment for why TRANSCRIBE itself is no
// longer self-chained into by anything in apps/worker).
export const probeVideoQueue = new Queue(QueueName.PROBE_VIDEO, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

export const detectClipsQueue = new Queue(QueueName.DETECT_CLIPS, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

export const renderClipQueue = new Queue(QueueName.RENDER_CLIP, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// Pre-Processing Settings roadmap (Phase 3) - render-clip.worker.ts's own
// automatic trigger for Publishing Expansion Phase 7B's existing platform
// copy generator (previously apps/api's POST /clips/:id/platform-copy was
// this queue's only producer - see GeneratePlatformCopyJobData's own
// comment in packages/shared - this is the first time apps/worker needs to
// be a producer for it too, same "first producer beyond the original one"
// shape transcribeQueue's own comment describes).
export const generatePlatformCopyQueue = new Queue(QueueName.GENERATE_PLATFORM_COPY, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// Fase 6c - schedule-publish-clip.worker.ts's poller enqueues into this once
// a SCHEDULED PublishRecord's scheduledAt arrives (publish-clip.worker.ts
// itself never needed a producer-side Queue here in Fase 6b, since it's a
// leaf job that doesn't self-chain to anything).
export const publishClipQueue = new Queue(QueueName.PUBLISH_CLIP, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// The repeatable trigger queue for the poller itself - see
// schedule-publish-clip.worker.ts's scheduleRepeatingTrigger().
export const schedulePublishClipQueue = new Queue(QueueName.SCHEDULE_PUBLISH_CLIP, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// The repeatable trigger queue for sync-publish-stats.worker.ts (Fase 6e) -
// that job is self-contained (fetches stats and updates Postgres directly,
// no further job to hand off to), so this is its only queue.
export const syncPublishStatsQueue = new Queue(QueueName.SYNC_PUBLISH_STATS, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// The repeatable trigger queue for alert-engine.worker.ts (Sprint 4C) -
// self-contained (evaluates every registered AlertRule and writes
// Notification/AlertState rows directly, no further job to hand off to),
// same shape as syncPublishStatsQueue above.
export const alertEngineQueue = new Queue(QueueName.ALERT_ENGINE, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// Milestone 04d - produced by recordNotification()'s deps.enqueueDelivery
// (both apps/api and apps/worker call sites, via notificationDeliveryEnqueuer.ts
// on this side), consumed by notification-delivery.worker.ts. Same
// "apps/api is sole producer, apps/worker sole consumer" shape as
// exportGenerateQueue - apps/worker still needs this Queue instance itself
// though, since 4 of the 6 recordNotification() call sites live here.
export const notificationDeliveryQueue = new Queue(QueueName.NOTIFICATION_DELIVERY, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// The repeatable trigger queue for telegram-chat-discovery.worker.ts
// (Milestone 04e) - self-contained (polls Telegram's getUpdates and writes
// NotificationWebhook rows directly, no further job to hand off to), same
// shape as alertEngineQueue above.
export const telegramChatDiscoveryQueue = new Queue(QueueName.TELEGRAM_CHAT_DISCOVERY, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// The repeatable trigger queue for sync-follower-count.worker.ts (Sprint
// 6F) - self-contained (fetches follower counts and writes
// SocialAccountFollowerSnapshot rows directly, no further job to hand off
// to), same shape as syncPublishStatsQueue above.
export const syncFollowerCountQueue = new Queue(QueueName.SYNC_FOLLOWER_COUNT, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

// PR #45 (Production Metrics Collection) - the repeatable trigger queue for
// metrics-snapshot.worker.ts - self-contained (snapshots every queue's
// counts/metrics and every live worker heartbeat into Postgres, no further
// job to hand off to), same shape as syncPublishStatsQueue above.
export const metricsSnapshotQueue = new Queue(QueueName.METRICS_SNAPSHOT, {
  connection: createRedisConnection(),
  defaultJobOptions,
});
