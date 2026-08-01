'use client';

import type { VideoHistoryRow as VideoHistoryRowDto, VideoHistorySortBy } from '@speedora/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import {
  VideoHistoryFilters,
  type VideoHistoryFiltersValue,
} from '@/components/video-history/VideoHistoryFilters';
import { VideoHistoryPagination } from '@/components/video-history/VideoHistoryPagination';
import { VideoHistoryRow } from '@/components/video-history/VideoHistoryRow';
import { getWorkspace, listVideoHistory } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const LIMIT = 20;

// Dashboard Improvement Sprint Phase B - modeled directly on
// apps/web/app/library/page.tsx's ClipLibraryPage: client-only, no SSR
// data-fetching to preserve parity with (net-new route, same reasoning
// ClipLibraryPage's own comment gives). sortBy newest/oldest paginate via
// cursor ("Load More", same accumulate-and-dedup pattern as ClipLibraryPage);
// sortBy processingTime/topScore paginate via page number instead (see
// VideosService.findHistory's comment for why) - filterKey deliberately
// excludes `page` so changing page doesn't itself trigger the
// reset-pagination-state effect below, only a real filter/sort change does.
export default function VideoHistoryPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [filters, setFilters] = useState<VideoHistoryFiltersValue>({});
  const [sortBy, setSortBy] = useState<VideoHistorySortBy>('newest');
  const [page, setPage] = useState(1);
  const [extraRows, setExtraRows] = useState<VideoHistoryRowDto[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const isOffsetMode = sortBy === 'processingTime' || sortBy === 'topScore';

  const { data: workspace } = useSWR(
    user && activeWorkspaceId ? ['workspace-detail', activeWorkspaceId] : null,
    () => getWorkspace(activeWorkspaceId as string),
  );

  const filterKey = useMemo(
    () => ({ workspaceId: activeWorkspaceId ?? undefined, ...filters, sortBy }),
    [activeWorkspaceId, filters, sortBy],
  );

  useEffect(() => {
    setExtraRows([]);
    setExtraCursor(null);
    setHasLoadedMore(false);
    setPage(1);
  }, [filterKey]);

  const queryParams = useMemo(
    () => ({ ...filterKey, limit: LIMIT, page: isOffsetMode ? page : undefined }),
    [filterKey, isOffsetMode, page],
  );

  const { data, error, isLoading } = useSWR(user ? ['video-history', queryParams] : null, () =>
    listVideoHistory(queryParams),
  );

  const rows = useMemo(() => {
    if (isOffsetMode) return data?.videos ?? [];
    const seen = new Set<string>();
    const merged: VideoHistoryRowDto[] = [];
    for (const row of data?.videos ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      }
    }
    for (const row of extraRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      }
    }
    return merged;
  }, [data, extraRows, isOffsetMode]);

  const cursorForNextLoad = hasLoadedMore ? extraCursor : (data?.nextCursor ?? null);
  const hasMore = !isOffsetMode && cursorForNextLoad !== null;

  async function loadMore() {
    if (!cursorForNextLoad) return;
    setLoadingMore(true);
    try {
      const result = await listVideoHistory({ ...queryParams, cursor: cursorForNextLoad });
      setExtraRows((prev) => [...prev, ...result.videos]);
      setExtraCursor(result.nextCursor);
      setHasLoadedMore(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
          Riwayat Video
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Semua video yang pernah kamu upload atau import, bisa dicari dan difilter.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat riwayat video.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
              <VideoHistoryFilters
                value={filters}
                onChange={setFilters}
                owners={workspace?.members ?? []}
                isPersonal={workspace?.isPersonal ?? true}
              />
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="video-history-sort"
                  className="font-mono text-[10px] uppercase text-muted-foreground"
                >
                  Urutkan
                </label>
                <select
                  id="video-history-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as VideoHistorySortBy)}
                  className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
                >
                  <option value="newest">Terbaru</option>
                  <option value="oldest">Terlama</option>
                  <option value="processingTime">Waktu Proses</option>
                  <option value="topScore">Skor Tertinggi</option>
                </select>
              </div>
            </div>

            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat riwayat video'}
              </p>
            )}

            {!error && !isLoading && rows.length === 0 && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Tidak ada video yang cocok dengan filter ini.
              </p>
            )}

            {rows.length > 0 && (
              <ul className="mt-6 space-y-3">
                {rows.map((video) => (
                  <VideoHistoryRow key={video.id} video={video} />
                ))}
              </ul>
            )}

            <VideoHistoryPagination
              sortBy={sortBy}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              page={page}
              totalPages={data?.totalPages ?? null}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </main>
  );
}
