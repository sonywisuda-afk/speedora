import { QueueName } from '@viral-clip-app/shared';
import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const detectClipsQueue = new Queue(QueueName.DETECT_CLIPS, {
  connection: createRedisConnection(),
});

export const renderClipQueue = new Queue(QueueName.RENDER_CLIP, {
  connection: createRedisConnection(),
});

// Fase 6c - schedule-publish-clip.worker.ts's poller enqueues into this once
// a SCHEDULED PublishRecord's scheduledAt arrives (publish-clip.worker.ts
// itself never needed a producer-side Queue here in Fase 6b, since it's a
// leaf job that doesn't self-chain to anything).
export const publishClipQueue = new Queue(QueueName.PUBLISH_CLIP, {
  connection: createRedisConnection(),
});

// The repeatable trigger queue for the poller itself - see
// schedule-publish-clip.worker.ts's scheduleRepeatingTrigger().
export const schedulePublishClipQueue = new Queue(QueueName.SCHEDULE_PUBLISH_CLIP, {
  connection: createRedisConnection(),
});
