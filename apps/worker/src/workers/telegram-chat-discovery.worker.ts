import { discoverTelegramChatIds } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';
import { prisma } from '../prisma';
import { telegramChatDiscoveryQueue } from '../queues';
import { createRedisConnection } from '../redis';

// Milestone 04e - long-polling chat_id discovery (the user's explicit
// architectural choice over Telegram's setWebhook: no new public route,
// works in dev without a publicly reachable URL). This is a synchronous-
// feeling onboarding moment (a human clicks Save, switches to Telegram,
// sends a message, switches back within ~1 minute), unlike
// ALERT_CHECK_INTERVAL_MS's 30-minute default - 15s keeps it feeling
// responsive without hammering Telegram's API, since each tick is N
// sequential api.telegram.org calls (one per still-pending bot) and that
// set only grows with concurrently-mid-onboarding users, shrinking
// permanently per connection. Configurable without a redeploy, same
// posture as every other repeatable trigger's interval constant.
const TELEGRAM_CHAT_DISCOVERY_INTERVAL_MS =
  Number(process.env.TELEGRAM_CHAT_DISCOVERY_INTERVAL_MS) || 15 * 1000;

const TELEGRAM_CHAT_DISCOVERY_TRIGGER_JOB_ID = 'telegram-chat-discovery-poll';

// Idempotent, same pattern as every other repeatable trigger in this
// codebase (alert-engine.worker.ts, sync-publish-stats.worker.ts) - called
// once at startup (see main.ts).
export async function scheduleRepeatingTrigger(): Promise<void> {
  await telegramChatDiscoveryQueue.add(
    QueueName.TELEGRAM_CHAT_DISCOVERY,
    {},
    {
      repeat: { every: TELEGRAM_CHAT_DISCOVERY_INTERVAL_MS },
      jobId: TELEGRAM_CHAT_DISCOVERY_TRIGGER_JOB_ID,
    },
  );
}

// Thin wrapper - all the actual discovery logic (durable offset
// persistence, per-row error isolation, chat_id extraction) lives in
// packages/database's discoverTelegramChatIds, exhaustively tested there.
export function createTelegramChatDiscoveryWorker(): Worker {
  return new Worker(
    QueueName.TELEGRAM_CHAT_DISCOVERY,
    async () => {
      await discoverTelegramChatIds(prisma);
    },
    { connection: createRedisConnection() },
  );
}
