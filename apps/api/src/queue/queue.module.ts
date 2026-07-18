import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@speedora/shared';
import { NotificationDeliveryProducer } from './notification-delivery.producer';

function parseRedisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

// apps/api is the only enqueuer of this one (POST /videos/import-youtube) -
// apps/worker's import-youtube job consumes it and self-chains into
// transcribeQueue below, same shape as every other stage in this pipeline.
const importYoutubeQueue = BullModule.registerQueue({ name: QueueName.IMPORT_YOUTUBE });
const transcribeQueue = BullModule.registerQueue({ name: QueueName.TRANSCRIBE });
// apps/api never processes these three - they're only ever consumed by
// apps/worker - but it does need to be able to enqueue into detectClips/
// renderClip directly to retry a video that failed partway through
// detect-clips or render-clip (see VideosService.retry), and into
// publishClip whenever a user hits "Publish now" (see ClipsService.publish).
const detectClipsQueue = BullModule.registerQueue({ name: QueueName.DETECT_CLIPS });
const renderClipQueue = BullModule.registerQueue({ name: QueueName.RENDER_CLIP });
const publishClipQueue = BullModule.registerQueue({ name: QueueName.PUBLISH_CLIP });
// apps/api never produces into either of these (both are apps/worker-only
// repeatable triggers - see schedule-publish-clip.worker.ts/
// sync-publish-stats.worker.ts) - registered here read-only, purely so
// MonitoringModule's /queues and /workers can report on every queue in the
// system, not just the ones apps/api happens to enqueue into.
const schedulePublishClipQueue = BullModule.registerQueue({
  name: QueueName.SCHEDULE_PUBLISH_CLIP,
});
const syncPublishStatsQueue = BullModule.registerQueue({ name: QueueName.SYNC_PUBLISH_STATS });
// Sprint 03c (Export Center roadmap) - apps/api is the sole producer (POST
// /export), apps/worker's export-generate.worker.ts the sole consumer -
// same shape as importYoutubeQueue above, not the "registered read-only for
// monitoring" case schedulePublishClipQueue/syncPublishStatsQueue are.
const exportGenerateQueue = BullModule.registerQueue({ name: QueueName.EXPORT_GENERATE });
// Milestone 04d - apps/api is sole producer (VideosService's 2
// recordNotification() call sites, via NotificationDeliveryProducer below),
// apps/worker's notification-delivery.worker.ts the sole consumer - same
// shape as exportGenerateQueue above.
const notificationDeliveryQueue = BullModule.registerQueue({
  name: QueueName.NOTIFICATION_DELIVERY,
});
// Publishing Expansion Phase 7B (AI SEO) - apps/api is sole producer (POST
// /clips/:id/platform-copy), apps/worker's generate-platform-copy.worker.ts
// the sole consumer - same shape as exportGenerateQueue above.
const generatePlatformCopyQueue = BullModule.registerQueue({
  name: QueueName.GENERATE_PLATFORM_COPY,
});

@Module({
  imports: [
    // useFactory defers reading REDIS_URL until DI instantiation time, after
    // ConfigModule.forRoot() has loaded the root .env file. Reading it eagerly
    // here (e.g. via forRoot()) would run before that, since Node resolves
    // this module's imports - and its @Module decorator - before AppModule's.
    BullModule.forRootAsync({
      useFactory: () => ({ connection: parseRedisConnection() }),
    }),
    importYoutubeQueue,
    transcribeQueue,
    detectClipsQueue,
    renderClipQueue,
    publishClipQueue,
    schedulePublishClipQueue,
    syncPublishStatsQueue,
    exportGenerateQueue,
    notificationDeliveryQueue,
    generatePlatformCopyQueue,
  ],
  providers: [NotificationDeliveryProducer],
  exports: [
    importYoutubeQueue,
    transcribeQueue,
    detectClipsQueue,
    renderClipQueue,
    publishClipQueue,
    schedulePublishClipQueue,
    syncPublishStatsQueue,
    exportGenerateQueue,
    notificationDeliveryQueue,
    generatePlatformCopyQueue,
    NotificationDeliveryProducer,
  ],
})
export class QueueModule {}
