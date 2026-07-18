import { NotificationChannel, type PrismaClient } from './generated/prisma/client';
import { decryptWebhookUrl } from './webhook-encryption';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 10_000;

// Milestone 04e - validates a bot token AND fetches the bot's own username
// in one call, so the "message your bot" onboarding UI can render a
// t.me/<username> deep link with no second Telegram round-trip.
// Framework-agnostic (throws a plain Error, never a Nest exception) - lives
// in packages/database (Node-only, already the common dependency of
// apps/api/apps/worker) rather than being duplicated in apps/api, same
// "one implementation, not one per consumer" reasoning as webhook-encryption.ts.
interface TelegramGetMeResponse {
  ok: boolean;
  result?: { username?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id: number } };
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

export async function getTelegramBotInfo(botToken: string): Promise<{ username: string }> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = res.ok
    ? ((await res.json().catch(() => null)) as TelegramGetMeResponse | null)
    : null;
  if (!body?.ok || !body.result?.username) {
    throw new Error('Invalid Telegram bot token');
  }
  return { username: body.result.username };
}

// Milestone 04e - the chat_id-discovery poller (long-polling, per the
// user's explicit architectural choice: no new public route, works in dev
// without a publicly reachable URL). Queries every NotificationWebhook row
// still awaiting discovery (channel=TELEGRAM, chatId=null - a row drops out
// of this query permanently once connected, so the poll set only shrinks).
// Each row is its own try/catch - one bad token/network blip must not block
// discovery for every other pending user in the same tick, unlike the
// notification-delivery worker's "whole job throws" model, since this one
// tick covers N independent users' onboarding.
//
// Accepts the first message of any kind, not a strict `/start` text match -
// a freshly-created bot has no plausible sender besides its owner, and
// requiring an exact string match adds a real failure mode (autocorrect,
// deep-link variants) that would silently strand a user in "pending"
// forever. The onboarding UI still instructs "send /start"; this just
// doesn't gate on it server-side.
//
// The update offset is persisted REGARDLESS of whether a chat_id was found
// this tick - this is the durable, exactly-once-processing guarantee: a
// /start message must never be reprocessed after an apps/worker restart,
// which an in-memory offset could not guarantee.
export async function discoverTelegramChatIds(
  prisma: Pick<PrismaClient, 'notificationWebhook'>,
): Promise<void> {
  const pending = await prisma.notificationWebhook.findMany({
    where: { channel: NotificationChannel.TELEGRAM, chatId: null },
  });

  for (const row of pending) {
    try {
      const botToken = decryptWebhookUrl(row.url);
      const offset = (row.telegramUpdateOffset ?? -1) + 1;
      const res = await fetch(
        `${TELEGRAM_API_BASE}/bot${botToken}/getUpdates?offset=${offset}&timeout=0`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) continue;

      const body = (await res.json().catch(() => null)) as TelegramGetUpdatesResponse | null;
      const updates: TelegramUpdate[] = body?.ok ? (body.result ?? []) : [];
      if (updates.length === 0) continue;

      const lastUpdateId = Math.max(...updates.map((u) => u.update_id));
      const chatId = updates.find((u) => u.message?.chat?.id != null)?.message?.chat?.id;

      await prisma.notificationWebhook.update({
        where: { id: row.id },
        data: {
          telegramUpdateOffset: lastUpdateId + 1,
          ...(chatId != null ? { chatId: String(chatId) } : {}),
        },
      });
    } catch (error) {
      console.warn(`[discoverTelegramChatIds] failed for webhook ${row.id}`, error);
    }
  }
}
