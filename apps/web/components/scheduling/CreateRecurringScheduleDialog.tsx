'use client';

import { SocialPlatform, type SocialAccount } from '@speedora/shared';
import { useMemo, useState } from 'react';
import { createRecurringSchedule } from '@/lib/api';
import { platformLabel } from '@/lib/platform-metadata';
import { guessLocalTimezone } from '@/lib/timezones';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DaysOfWeekPicker } from './DaysOfWeekPicker';
import { TimezonePicker } from './TimezonePicker';

// Phase 6 (Scheduling), Frontend part B - RecurringSchedule creation.
// platform/socialAccountId aren't editable after creation (see
// UpdateRecurringScheduleDto's comment) so this dialog is the only place
// they're ever set.
export function CreateRecurringScheduleDialog({
  workspaceId,
  accounts,
  onCreated,
}: {
  workspaceId: string;
  accounts: SocialAccount[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<SocialPlatform | ''>('');
  const [socialAccountId, setSocialAccountId] = useState('');
  const [timezone, setTimezone] = useState(guessLocalTimezone());
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsForPlatform = useMemo(
    () => accounts.filter((a) => a.platform === platform),
    [accounts, platform],
  );

  function reset() {
    setName('');
    setPlatform('');
    setSocialAccountId('');
    setDaysOfWeek([]);
    setTimeOfDay('09:00');
    setError(null);
  }

  async function handleCreate() {
    if (!platform) return;
    setError(null);
    setCreating(true);
    try {
      await createRecurringSchedule(workspaceId, {
        name,
        platform,
        socialAccountId,
        timezone,
        daysOfWeek,
        timeOfDay,
      });
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat schedule');
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = name.trim() && platform && socialAccountId && daysOfWeek.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">+ Schedule</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Recurring Schedule</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekday mornings"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Platform
              </label>
              <select
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value as SocialPlatform);
                  setSocialAccountId('');
                }}
                className="h-9 w-full rounded-md border border-input bg-slate-panel px-2 font-body text-sm text-foreground"
              >
                <option value="">Select platform</option>
                {Object.values(SocialPlatform).map((p) => (
                  <option key={p} value={p}>
                    {platformLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Account
              </label>
              <select
                value={socialAccountId}
                onChange={(e) => setSocialAccountId(e.target.value)}
                disabled={!platform || accountsForPlatform.length === 0}
                className="h-9 w-full rounded-md border border-input bg-slate-panel px-2 font-body text-sm text-foreground disabled:opacity-50"
              >
                <option value="">
                  {platform && accountsForPlatform.length === 0
                    ? 'No account connected'
                    : 'Select account'}
                </option>
                {accountsForPlatform.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Timezone
            </label>
            <TimezonePicker value={timezone} onChange={setTimezone} />
          </div>

          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Days
              </label>
              <DaysOfWeekPicker value={daysOfWeek} onChange={setDaysOfWeek} />
            </div>
            <div className="w-28 space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Time
              </label>
              <Input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
            </div>
          </div>

          {error && <p className="font-body text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button disabled={creating || !canSubmit} onClick={handleCreate}>
            {creating ? 'Membuat...' : 'Buat Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
