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
  ],
  exports: [transcribeQueue],
})
export class QueueModule {}
