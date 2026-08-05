'use client';

import { Button } from '@/components/ui/button';

// Activity Timeline v2 - near-direct port of
// components/notifications/NotificationBulkToolbar.tsx: appears only once
// something is selected, no focus-stealing on mount/unmount.
export function ActivityBulkToolbar({
  selectedCount,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Aksi massal aktivitas"
      className="flex flex-wrap items-center gap-2 rounded-md border border-primary bg-primary-surface px-3 py-2"
    >
      <span className="font-body text-sm font-medium text-foreground" aria-live="polite">
        {selectedCount} dipilih
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" onClick={onDelete}>
          Hapus Terpilih
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Batal
        </Button>
      </div>
    </div>
  );
}
