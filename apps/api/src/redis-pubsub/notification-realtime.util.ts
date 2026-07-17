import type { MessageEvent } from '@nestjs/common';
import type { NotificationPublishEvent } from '@speedora/database';

// Milestone 04c - pure, directly-testable helpers extracted out of
// NotificationSubscriberService/NotificationsController.stream() so the
// per-connection filtering/shaping logic doesn't need a real Redis
// connection or a Nest bootstrap to test.

export function matchesUser(event: NotificationPublishEvent, userId: string): boolean {
  return event.userId === userId;
}

export function toMessageEvent(event: NotificationPublishEvent): MessageEvent {
  return { data: event };
}
