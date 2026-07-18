import type { Notification } from '@speedora/database';

// Milestone 04d - thin, mechanical payload formatters, one per outbound
// channel. No templating system - every field is a direct passthrough of
// the already-written Notification row, same restraint as every toDto() in
// this codebase.

export function formatSlackPayload(notification: Notification): { text: string } {
  return { text: `*${notification.title}*\n${notification.body}` };
}

export function formatDiscordPayload(notification: Notification): { content: string } {
  return { content: `**${notification.title}**\n${notification.body}` };
}

// Milestone 04e - no `parse_mode` field at all (defaults to Telegram's
// plain-text mode) - deliberately avoids MarkdownV2's escaping subsystem
// and legacy Markdown's `_`/`*` footgun in arbitrary notification titles,
// same plain-text restraint as Slack/Discord's own V1 formatters above.
export function formatTelegramPayload(
  notification: Notification,
  chatId: string,
): { chat_id: string; text: string } {
  return { chat_id: chatId, text: `${notification.title}\n\n${notification.body}` };
}

// A raw JSON mirror of NotificationDto - an arbitrary receiving endpoint
// needs structured fields, not a chat-formatted string.
export function formatGenericWebhookPayload(notification: Notification): {
  type: string;
  title: string;
  body: string;
  videoId: string | null;
  clipId: string | null;
  metadata: unknown;
  createdAt: string;
} {
  return {
    type: notification.type,
    title: notification.title,
    body: notification.body,
    videoId: notification.videoId,
    clipId: notification.clipId,
    metadata: notification.metadata,
    createdAt: notification.createdAt.toISOString(),
  };
}
