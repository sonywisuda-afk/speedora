'use client';

import useSWR from 'swr';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { PreferenceCategoryGroupV2, type NotificationChannelV2 } from '@speedora/shared';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getNotificationPreferencesV2,
  updateChannelPreferenceV2,
  updateInAppPreferenceV2,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const GROUP_LABELS: Record<PreferenceCategoryGroupV2, string> = {
  [PreferenceCategoryGroupV2.UPLOAD]: 'Upload',
  [PreferenceCategoryGroupV2.PROCESSING]: 'Processing',
  [PreferenceCategoryGroupV2.RENDERING]: 'Rendering',
  [PreferenceCategoryGroupV2.PUBLISHING]: 'Publish',
  [PreferenceCategoryGroupV2.ANALYTICS]: 'Analytics',
  [PreferenceCategoryGroupV2.BILLING]: 'Billing',
  [PreferenceCategoryGroupV2.SYSTEM]: 'System',
};

const CHANNEL_LABELS: Record<NotificationChannelV2, string> = {
  IN_APP: 'In-App',
  SLACK: 'Slack',
  DISCORD: 'Discord',
  WEBHOOK: 'Webhook',
  TELEGRAM: 'Telegram',
  EMAIL: 'Email',
  PUSH: 'Push',
  DESKTOP: 'Desktop',
};

// A plain, unstyled checkbox row - deliberately not the fancier Chip/Badge
// treatment elsewhere in this feature. The user's own explicit ask for this
// panel was "tidak perlu terlalu kompleks" (don't overcomplicate) - a
// straightforward label + native checkbox is the simplest correct widget,
// not a missed opportunity for polish.
function PreferenceRow({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 py-2 font-body text-sm',
        disabled ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span>
        {label}
        {hint && <span className="ml-2 font-mono text-xs text-muted-foreground">({hint})</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </label>
  );
}

// Notification Center v2 Phase 5 (Preferences & Delivery) - the simplified
// preferences panel, matching the user's own mockup exactly: In-App grouped
// checkboxes, one "Enabled" checkbox per real delivery channel, "Coming
// Soon" for EMAIL/PUSH/DESKTOP. A SEPARATE component from
// NotificationPreferencesTab (V1, untouched, still the granular per-type
// settings inside NotificationBell's dialog) - this is additive, reachable
// only from the new /notifications page.
export function NotificationPreferencesPanelV2() {
  const { data, isLoading, mutate } = useSWR(
    'notification-preferences-v2',
    getNotificationPreferencesV2,
  );
  const [pending, setPending] = useState<string | null>(null);

  async function handleInAppToggle(group: PreferenceCategoryGroupV2, checked: boolean) {
    setPending(`in-app:${group}`);
    try {
      await updateInAppPreferenceV2(group, checked);
      await mutate();
    } finally {
      setPending(null);
    }
  }

  async function handleChannelToggle(channel: NotificationChannelV2, checked: boolean) {
    setPending(`channel:${channel}`);
    try {
      await updateChannelPreferenceV2(channel, checked);
      await mutate();
    } finally {
      setPending(null);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* P1 accessibility follow-up (Notification Center V2 post-release backlog) -
          role="group" + aria-labelledby is the WAI-ARIA equivalent of fieldset/legend for a
          group of checkboxes, chosen over restructuring into a real <fieldset> to avoid that
          element's own cross-browser layout quirks (default border/padding/min-width) in a
          component the user explicitly asked to keep simple ("tidak perlu terlalu kompleks") -
          zero visual change, screen readers now announce which section a checkbox belongs to. */}
      <div role="group" aria-labelledby="notification-prefs-group-in-app">
        <h3
          id="notification-prefs-group-in-app"
          className="font-display text-xs uppercase tracking-wide text-muted-foreground"
        >
          In-App
        </h3>
        <div className="mt-1 divide-y divide-border">
          {data.inApp.map((preference) => (
            <PreferenceRow
              key={preference.group}
              label={GROUP_LABELS[preference.group]}
              checked={preference.enabled}
              disabled={pending === `in-app:${preference.group}`}
              onChange={(checked) => handleInAppToggle(preference.group, checked)}
            />
          ))}
        </div>
      </div>

      {data.channels.map((channelPreference) => {
        const groupId = `notification-prefs-group-channel-${channelPreference.channel}`;
        return (
          <div key={channelPreference.channel} role="group" aria-labelledby={groupId}>
            <h3
              id={groupId}
              className="font-display text-xs uppercase tracking-wide text-muted-foreground"
            >
              {CHANNEL_LABELS[channelPreference.channel]}
            </h3>
            <div className="mt-1 divide-y divide-border">
              {channelPreference.comingSoon ? (
                <div className="flex items-center justify-between py-2 font-body text-sm text-muted-foreground">
                  <span>{CHANNEL_LABELS[channelPreference.channel]}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                    Coming Soon
                  </span>
                </div>
              ) : (
                <PreferenceRow
                  label="Enabled"
                  checked={channelPreference.enabled}
                  disabled={
                    !channelPreference.configured ||
                    pending === `channel:${channelPreference.channel}`
                  }
                  hint={!channelPreference.configured ? 'belum dikonfigurasi' : undefined}
                  onChange={(checked) => handleChannelToggle(channelPreference.channel, checked)}
                />
              )}
            </div>
          </div>
        );
      })}

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="font-body text-xs text-muted-foreground">{data.essentialNote}</p>
      </div>
    </div>
  );
}
