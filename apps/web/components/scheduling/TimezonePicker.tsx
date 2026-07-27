'use client';

import { listIanaTimezones } from '@/lib/timezones';

export interface TimezonePickerProps {
  value: string;
  onChange: (timezone: string) => void;
}

// Native <select> over the full IANA list - same convention as ShareDialog's
// role picker (no Select UI primitive exists in this app). The list is long
// (400+ zones) but a browser's native <select> handles that fine without a
// combobox/search component this app doesn't have yet.
export function TimezonePicker({ value, onChange }: TimezonePickerProps) {
  const zones = listIanaTimezones();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
