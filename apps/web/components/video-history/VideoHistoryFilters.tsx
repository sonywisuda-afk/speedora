'use client';

import { useEffect, useState } from 'react';
import type { VideoHistoryStatusFilter, WorkspaceMemberDto } from '@speedora/shared';
import { Input } from '@/components/ui/input';

const SEARCH_DEBOUNCE_MS = 300;

export interface VideoHistoryFiltersValue {
  search?: string;
  status?: VideoHistoryStatusFilter;
  ownerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface VideoHistoryFiltersProps {
  value: VideoHistoryFiltersValue;
  onChange: (value: VideoHistoryFiltersValue) => void;
  // Owner filter is direct-ownership (Video.ownerId), meaningful only where
  // multiple members can own videos - hidden entirely for a personal
  // workspace, same isPersonal boundary WorkspaceMembersDialog already uses.
  owners: WorkspaceMemberDto[];
  isPersonal: boolean;
}

// Dashboard Improvement Sprint Phase B ("View All" video processing
// history) - built only from primitives that already exist in this app:
// native <select> for Status/Owner (same convention as
// ClipLibraryFilters.tsx - no Select/Combobox primitive exists here), plain
// <input type="date"> for the range (DateRangeFilter.tsx is a fixed
// last-N-days bucket toggle for Analytics, not an arbitrary from/to range,
// so this is a sibling, not a reuse).
export function VideoHistoryFilters({
  value,
  onChange,
  owners,
  isPersonal,
}: VideoHistoryFiltersProps) {
  // Local echo so typing feels instant - only the debounced value is
  // reported up, same 300ms debounce convention as ClipLibraryFilters.tsx.
  const [searchInput, setSearchInput] = useState(value.search ?? '');

  useEffect(() => {
    setSearchInput(value.search ?? '');
  }, [value.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (value.search ?? '')) return;
    const timer = setTimeout(() => {
      onChange({ ...value, search: trimmed || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="video-history-search"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Cari
        </label>
        <Input
          id="video-history-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Judul video..."
          className="h-9 w-48"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="video-history-status"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Status
        </label>
        <select
          id="video-history-status"
          value={value.status ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              status: (e.target.value || undefined) as VideoHistoryStatusFilter | undefined,
            })
          }
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        >
          <option value="">Semua status</option>
          <option value="COMPLETED">Selesai</option>
          <option value="RUNNING">Berjalan</option>
          <option value="FAILED">Gagal</option>
        </select>
      </div>

      {!isPersonal && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="video-history-owner"
            className="font-mono text-[10px] uppercase text-muted-foreground"
          >
            Owner
          </label>
          <select
            id="video-history-owner"
            value={value.ownerId ?? ''}
            onChange={(e) => onChange({ ...value, ownerId: e.target.value || undefined })}
            className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
          >
            <option value="">Semua owner</option>
            {owners.map((owner) => (
              <option key={owner.userId} value={owner.userId}>
                {owner.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label
          htmlFor="video-history-date-from"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Dari tanggal
        </label>
        <input
          id="video-history-date-from"
          type="date"
          value={value.dateFrom ?? ''}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="video-history-date-to"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Sampai tanggal
        </label>
        <input
          id="video-history-date-to"
          type="date"
          value={value.dateTo ?? ''}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        />
      </div>
    </div>
  );
}
