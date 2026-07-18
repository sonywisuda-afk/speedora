'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  NotificationChannel,
  NotificationType,
  type NotificationPreferenceDto,
  type NotificationWebhookDto,
} from '@speedora/shared';
import {
  deleteNotificationWebhook,
  getNotificationPreferences,
  getNotificationWebhooks,
  updateNotificationPreference,
  upsertNotificationWebhook,
  upsertTelegramWebhook,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NOTIFICATION_TYPE_LABELS } from '@/lib/notification-definitions';
import { cn } from '@/lib/utils';

// Sprint 4B - no Switch/Checkbox primitive exists anywhere in this app;
// building one small local control here rather than adding a Radix Switch
// package for one use site, same restraint the toast system applied to
// zustand over a new Radix dependency.
function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors',
        checked ? 'bg-signal-pink' : 'bg-slate-panel',
        disabled && 'opacity-40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

const OUTBOUND_CHANNELS: Array<{ channel: NotificationChannel; label: string }> = [
  { channel: NotificationChannel.SLACK, label: 'Slack' },
  { channel: NotificationChannel.DISCORD, label: 'Discord' },
  { channel: NotificationChannel.WEBHOOK, label: 'Webhook Generik' },
];

// Milestone 04d - one row per outbound channel, a URL input + Save + a
// configured/not-configured status + Remove. Unlike the Inbox/Toast
// switches (immediate-effect, no Save), a webhook destination needs an
// explicit Save since it's free-text input, not a toggle.
function DestinationRow({
  channel,
  label,
  configured,
  onSaved,
}: {
  channel: NotificationChannel;
  label: string;
  configured: boolean;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await upsertNotificationWebhook(channel, url);
      setUrl('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await deleteNotificationWebhook(channel);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
      <span className="w-28 shrink-0 font-body text-sm text-foreground">{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[10px] uppercase tracking-wide',
          configured ? 'text-emerald-400' : 'text-muted-foreground',
        )}
      >
        {configured ? 'Terhubung' : 'Belum diatur'}
      </span>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={configured ? 'Ganti URL webhook...' : 'https://...'}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-body text-sm text-foreground"
      />
      {error && <span className="font-body text-xs text-destructive">{error}</span>}
      <Button size="sm" variant="outline" disabled={saving || !url} onClick={handleSave}>
        Simpan
      </Button>
      {configured && (
        <Button size="sm" variant="ghost" disabled={saving} onClick={handleRemove}>
          Hapus
        </Button>
      )}
    </div>
  );
}

// Milestone 04e - a genuinely different flow from DestinationRow, not a
// generalized merge: a bot token (not a URL) input, and a distinct
// "pending" in-between state (token saved, waiting for the user to message
// their own bot) neither "not configured" nor "configured" captures. Not
// folded into OUTBOUND_CHANNELS's array, same "fixed small set, not
// data-driven" reasoning that array's own component choice already uses.
function TelegramDestinationRow({
  webhook,
  onSaved,
}: {
  webhook: NotificationWebhookDto | undefined;
  onSaved: () => void;
}) {
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = webhook?.configured ?? false;
  const pending = webhook?.pending ?? false;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await upsertTelegramWebhook(token);
      setToken('');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan token bot');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await deleteNotificationWebhook(NotificationChannel.TELEGRAM);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const showInput = editing || (!configured && !pending);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
      <span className="w-28 shrink-0 font-body text-sm text-foreground">Telegram</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[10px] uppercase tracking-wide',
          configured
            ? 'text-emerald-400'
            : pending
              ? 'text-signal-pink'
              : 'text-muted-foreground',
        )}
      >
        {configured ? 'Terhubung' : pending ? 'Menunggu konfirmasi...' : 'Belum diatur'}
      </span>

      {showInput ? (
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token bot dari @BotFather..."
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-body text-sm text-foreground"
        />
      ) : pending && webhook?.telegramBotUsername ? (
        <a
          href={`https://t.me/${webhook.telegramBotUsername}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 font-body text-sm text-signal-pink underline"
        >
          Buka t.me/{webhook.telegramBotUsername} dan kirim /start
        </a>
      ) : (
        <span className="flex-1" />
      )}

      {error && <span className="font-body text-xs text-destructive">{error}</span>}

      {showInput ? (
        <Button size="sm" variant="outline" disabled={saving || !token} onClick={handleSave}>
          Simpan
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(true)}>
          Ganti token
        </Button>
      )}
      {(configured || pending) && (
        <Button size="sm" variant="ghost" disabled={saving} onClick={handleRemove}>
          Hapus
        </Button>
      )}
    </div>
  );
}

// Fixed grid of every NotificationType x Inbox/Toast toggles (Sprint 4B),
// plus one toggle column per configured outbound channel (Milestone 04d) -
// immediate-effect PATCH on each click, no Save button, same posture
// ExportTypeRow's per-row actions already use. Webhook destinations
// themselves (above the grid) DO need a Save button, since they're
// free-text URL input, not a toggle.
export function NotificationPreferencesTab() {
  const { data, mutate } = useSWR('notification-preferences', () => getNotificationPreferences());
  // Milestone 04e - polls only while a TELEGRAM row is pending (token
  // saved, chat_id not yet discovered), stopping the instant the backend's
  // discovery poller finds it - no manual interval/effect teardown needed.
  // 5s is faster than the backend's own 15s discovery tick, cheap against a
  // plain Postgres-row GET, so onboarding still feels responsive.
  const { data: webhooksData, mutate: mutateWebhooks } = useSWR(
    'notification-webhooks',
    getNotificationWebhooks,
    { refreshInterval: (latest) => (latest?.webhooks.some((w) => w.pending) ? 5000 : 0) },
  );
  const preferences = data?.preferences ?? [];
  const webhooks = webhooksData?.webhooks ?? [];

  // Fixed, known set of 4 outbound channels - not a dynamic list, so 4
  // explicit useSWR calls (each null-keyed until its destination is
  // configured) rather than looping useSWR, which hooks can't do. Gated on
  // `configured` (not `pending` for TELEGRAM) - the per-type toggle column
  // should only appear once delivery can actually happen.
  const slack = useSWR(
    webhooks.find((w) => w.channel === NotificationChannel.SLACK)?.configured
      ? ['notification-preferences', NotificationChannel.SLACK]
      : null,
    () => getNotificationPreferences(NotificationChannel.SLACK),
  );
  const discord = useSWR(
    webhooks.find((w) => w.channel === NotificationChannel.DISCORD)?.configured
      ? ['notification-preferences', NotificationChannel.DISCORD]
      : null,
    () => getNotificationPreferences(NotificationChannel.DISCORD),
  );
  const webhook = useSWR(
    webhooks.find((w) => w.channel === NotificationChannel.WEBHOOK)?.configured
      ? ['notification-preferences', NotificationChannel.WEBHOOK]
      : null,
    () => getNotificationPreferences(NotificationChannel.WEBHOOK),
  );
  const telegram = useSWR(
    webhooks.find((w) => w.channel === NotificationChannel.TELEGRAM)?.configured
      ? ['notification-preferences', NotificationChannel.TELEGRAM]
      : null,
    () => getNotificationPreferences(NotificationChannel.TELEGRAM),
  );

  const channelColumns = [
    { channel: NotificationChannel.SLACK, label: 'Slack', swr: slack },
    { channel: NotificationChannel.DISCORD, label: 'Discord', swr: discord },
    { channel: NotificationChannel.WEBHOOK, label: 'Webhook', swr: webhook },
    { channel: NotificationChannel.TELEGRAM, label: 'Telegram', swr: telegram },
  ].filter((c) => webhooks.find((w) => w.channel === c.channel)?.configured);

  async function toggle(type: NotificationType, field: 'enabled' | 'toast', value: boolean) {
    await updateNotificationPreference(type, { [field]: value });
    mutate();
  }

  async function toggleChannel(
    type: NotificationType,
    channel: NotificationChannel,
    value: boolean,
    columnMutate: () => void,
  ) {
    await updateNotificationPreference(type, { enabled: value, channel });
    columnMutate();
  }

  function rowFor(type: NotificationType): NotificationPreferenceDto {
    return preferences.find((p) => p.type === type) ?? { type, enabled: true, toast: true };
  }

  function channelRowFor(
    type: NotificationType,
    columnData: NotificationPreferenceDto[] | undefined,
  ): NotificationPreferenceDto {
    return columnData?.find((p) => p.type === type) ?? { type, enabled: true, toast: true };
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-display text-xs uppercase tracking-wide text-muted-foreground">
          Tujuan Notifikasi Keluar
        </h3>
        {OUTBOUND_CHANNELS.map(({ channel, label }) => (
          <DestinationRow
            key={channel}
            channel={channel}
            label={label}
            configured={webhooks.find((w) => w.channel === channel)?.configured ?? false}
            onSaved={() => mutateWebhooks()}
          />
        ))}
        <TelegramDestinationRow
          webhook={webhooks.find((w) => w.channel === NotificationChannel.TELEGRAM)}
          onSaved={() => mutateWebhooks()}
        />
      </div>

      <div className="space-y-2">
        {Object.values(NotificationType).map((type) => {
          const row = rowFor(type);
          return (
            <div
              key={type}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <span className="font-body text-sm text-foreground">
                {NOTIFICATION_TYPE_LABELS[type]}
              </span>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 font-body text-xs text-muted-foreground">
                  Inbox
                  <Switch
                    checked={row.enabled}
                    onChange={(value) => toggle(type, 'enabled', value)}
                    label={`Tampilkan ${NOTIFICATION_TYPE_LABELS[type]} di Inbox`}
                  />
                </label>
                <label className="flex items-center gap-2 font-body text-xs text-muted-foreground">
                  Toast
                  <Switch
                    checked={row.enabled && row.toast}
                    disabled={!row.enabled}
                    onChange={(value) => toggle(type, 'toast', value)}
                    label={`Tampilkan Toast untuk ${NOTIFICATION_TYPE_LABELS[type]}`}
                  />
                </label>
                {channelColumns.map(({ channel, label, swr }) => {
                  const channelRow = channelRowFor(type, swr.data?.preferences);
                  return (
                    <label
                      key={channel}
                      className="flex items-center gap-2 font-body text-xs text-muted-foreground"
                    >
                      {label}
                      <Switch
                        checked={channelRow.enabled}
                        onChange={(value) => toggleChannel(type, channel, value, () => swr.mutate())}
                        label={`Kirim ${NOTIFICATION_TYPE_LABELS[type]} ke ${label}`}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
