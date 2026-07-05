import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@speedora/shared';

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
  ],
  exports: [
    importYoutubeQueue,
    transcribeQueue,
    detectClipsQueue,
    renderClipQueue,
    publishClipQueue,
  ],
})
export class QueueModule {}
