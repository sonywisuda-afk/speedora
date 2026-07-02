import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@viral-clip-app/shared';

function parseRedisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

const transcribeQueue = BullModule.registerQueue({ name: QueueName.TRANSCRIBE });
// apps/api never processes these two - they're only ever consumed by
// apps/worker's self-chaining pipeline - but it does need to be able to
// enqueue into them directly to retry a video that failed partway through
// detect-clips or render-clip (see VideosService.retry).
const detectClipsQueue = BullModule.registerQueue({ name: QueueName.DETECT_CLIPS });
const renderClipQueue = BullModule.registerQueue({ name: QueueName.RENDER_CLIP });

@Module({
  imports: [
    // useFactory defers reading REDIS_URL until DI instantiation time, after
    // ConfigModule.forRoot() has loaded the root .env file. Reading it eagerly
    // here (e.g. via forRoot()) would run before that, since Node resolves
    // this module's imports - and its @Module decorator - before AppModule's.
    BullModule.forRootAsync({
      useFactory: () => ({ connection: parseRedisConnection() }),
    }),
    transcribeQueue,
    detectClipsQueue,
    renderClipQueue,
  ],
  exports: [transcribeQueue, detectClipsQueue, renderClipQueue],
})
export class QueueModule {}
