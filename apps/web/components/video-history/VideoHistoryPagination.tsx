'use client';

import type { VideoHistorySortBy } from '@speedora/shared';
import { Button } from '@/components/ui/button';

export interface VideoHistoryPaginationProps {
  sortBy: VideoHistorySortBy;
  // Cursor mode (sortBy newest/oldest).
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  // Page-number mode (sortBy processingTime/topScore) - see
  // VideosService.findHistory's comment for why these two sort modes can't
  // share cursor pagination.
  page: number;
  totalPages: number | null;
  onPageChange: (page: number) => void;
}

export function VideoHistoryPagination({
  sortBy,
  hasMore,
  loadingMore,
  onLoadMore,
  page,
  totalPages,
  onPageChange,
}: VideoHistoryPaginationProps) {
  const isOffsetMode = sortBy === 'processingTime' || sortBy === 'topScore';

  if (isOffsetMode) {
    if (totalPages === null || totalPages <= 1) return null;
    return (
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Sebelumnya
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          Halaman {page} dari {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    );
  }

  if (!hasMore) return null;
  return (
    <div className="mt-6 flex justify-center">
      <Button size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
        {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
      </Button>
    </div>
  );
}
