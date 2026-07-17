import {
  NOTIFICATION_REALTIME_CHANNEL,
  type NotificationPublishEvent,
  type PublishNotificationFn,
} from '@speedora/database';
import { createRedisConnection } from './redis';

// Milestone 04c - one shared connection for the whole worker process (not
// one per call site), same "one client, constructed once" convention as
// prisma.ts. This is PUBLISH-only, so it's safe to share - unlike a
// SUBSCRIBE connection (which enters Redis's restricted subscriber mode),
// a publisher connection can be reused freely across every worker file.
const client = createRedisConnection();

export const publishNotification: PublishNotificationFn = async (
  event: NotificationPublishEvent,
) => {
  await client.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(event));
};

export async function closeNotificationPublisher(): Promise<void> {
  await client.quit();
}
