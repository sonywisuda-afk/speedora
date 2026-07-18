import * as Sentry from '@sentry/node';
import { decryptWebhookUrl, NotificationChannel } from '@speedora/database';
import { QueueName, type NotificationDeliveryJobData } from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { forStage } from '../logger';
import {
  formatDiscordPayload,
  formatGenericWebhookPayload,
  formatSlackPayload,
  formatTelegramPayload,
} from '../notification-delivery/payload-formatters';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

const logger = forStage('notification-delivery');

const DELIVERY_CHANNELS: NotificationChannel[] = [
  NotificationChannel.SLACK,
  NotificationChannel.DISCORD,
  NotificationChannel.WEBHOOK,
  NotificationChannel.TELEGRAM,
];

const FETCH_TIMEOUT_MS = 10_000;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

// Milestone 04d - delivers one already-written Notification row to every
// SLACK/DISCORD/WEBHOOK destination the recipient has both enabled (a
// NotificationPreference row) AND configured (a NotificationWebhook row) -
// the intersection of the two is what actually gets a POST. Deliberately
// does the enabled/configured resolution itself (not recordNotification()),
// so a future 04e TELEGRAM channel is a change only here, never upstream.
//
// One job covers every enabled channel for a notification - if one
// destination's POST fails, the whole job throws and BullMQ retries the
// whole thing, which can re-post to an already-succeeded destination.
// Accepted V1 risk (see the approved plan's "Explicit V1 cuts") - no
// per-channel delivery ledger.
export function createNotificationDeliveryWorker(): Worker<NotificationDeliveryJobData> {
  return new Worker<NotificationDeliveryJobData>(
    QueueName.NOTIFICATION_DELIVERY,
    async (job: Job<NotificationDeliveryJobData>) => {
      const { notificationId } = job.data;
      const notification = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      });

      const enabledPreferences = await prisma.notificationPreference.findMany({
        where: {
          userId: notification.userId,
          type: notification.type,
          channel: { in: DELIVERY_CHANNELS },
          enabled: true,
        },
        select: { channel: true },
      });
      if (enabledPreferences.length === 0) return;

      const enabledChannels = enabledPreferences.map((p) => p.channel);
      const webhooks = await prisma.notificationWebhook.findMany({
        where: { userId: notification.userId, channel: { in: enabledChannels } },
      });
      if (webhooks.length === 0) return;

      for (const webhook of webhooks) {
        // Milestone 04e - a TELEGRAM row can be enabled+configured-as-a-
        // preference while still pending chat_id discovery (the bot token
        // was saved, but the user hasn't messaged their bot yet). That's
        // "not ready yet," not a delivery failure - skip silently rather
        // than throwing, same posture as the worker's own "does nothing
        // when enabled but no destination configured" check above, one
        // level deeper.
        if (webhook.channel === NotificationChannel.TELEGRAM && webhook.chatId === null) {
          logger.info('skipping telegram delivery - chat_id not yet discovered', {
            notificationId,
            userId: notification.userId,
          });
          continue;
        }

        const secret = decryptWebhookUrl(webhook.url);
        // For every other channel the decrypted secret IS the POST target.
        // For TELEGRAM it's a bot token that BUILDS the request URL - the
        // one place this loop must genuinely branch, not just pick a
        // different payload formatter.
        const url =
          webhook.channel === NotificationChannel.TELEGRAM
            ? `${TELEGRAM_API_BASE}/bot${secret}/sendMessage`
            : secret;
        const payload =
          webhook.channel === NotificationChannel.SLACK
            ? formatSlackPayload(notification)
            : webhook.channel === NotificationChannel.DISCORD
              ? formatDiscordPayload(notification)
              : webhook.channel === NotificationChannel.TELEGRAM
                ? formatTelegramPayload(notification, webhook.chatId as string)
                : formatGenericWebhookPayload(notification);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const error = new Error(
            `Notification delivery to ${webhook.channel} failed with status ${response.status}`,
          );
          logger.error(
            'notification delivery failed',
            { notificationId, channel: webhook.channel, status: response.status },
            error,
          );
          Sentry.captureException(error, {
            tags: { notificationId, channel: webhook.channel },
          });
          throw error;
        }
      }

      logger.info('notification delivered', {
        notificationId,
        channels: webhooks.map((w) => w.channel),
      });
    },
    { connection: createRedisConnection() },
  );
}
