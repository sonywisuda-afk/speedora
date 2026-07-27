'use client';

import { Button } from '@/components/ui/button';

// Appears only once something is selected - not a permanently-reserved
// empty toolbar row. Focus stays on whichever checkbox/button the user was
// already on (nothing here steals focus on mount), so screen-reader users
// aren't yanked around when the toolbar appears/disappears.
export function NotificationBulkToolbar({
  selectedCount,
  onMarkRead,
  onArchive,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Aksi massal notifikasi"
      className="flex flex-wrap items-center gap-2 rounded-md border border-primary bg-primary-surface px-3 py-2"
    >
      <span className="font-body text-sm font-medium text-foreground" aria-live="polite">
        {selectedCount} dipilih
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onMarkRead}>
          Tandai Dibaca
        </Button>
        <Button size="sm" variant="outline" onClick={onArchive}>
          Arsipkan
        </Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>
          Hapus
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Batal
        </Button>
      </div>
    </div>
  );
}
