import { QueueName } from '@viral-clip-app/shared';
import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const detectClipsQueue = new Queue(QueueName.DETECT_CLIPS, {
  connection: createRedisConnection(),
});

export const renderClipQueue = new Queue(QueueName.RENDER_CLIP, {
  connection: createRedisConnection(),
});
