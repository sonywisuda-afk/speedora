'use client';

import useSWR from 'swr';
import { NotificationType, type NotificationPreferenceDto } from '@speedora/shared';
import { getNotificationPreferences, updateNotificationPreference } from '@/lib/api';
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

// Fixed grid of 4 known types x 2 toggles (Inbox/IN_APP, Toast) - immediate-
// effect PATCH on each click, no Save button, same posture ExportTypeRow's
// per-row actions already use.
export function NotificationPreferencesTab() {
  const { data, mutate } = useSWR('notification-preferences', getNotificationPreferences);
  const preferences = data?.preferences ?? [];

  async function toggle(type: NotificationType, field: 'enabled' | 'toast', value: boolean) {
    await updateNotificationPreference(type, { [field]: value });
    mutate();
  }

  function rowFor(type: NotificationType): NotificationPreferenceDto {
    return preferences.find((p) => p.type === type) ?? { type, enabled: true, toast: true };
  }

  return (
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
