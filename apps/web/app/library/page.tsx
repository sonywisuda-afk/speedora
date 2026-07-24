'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Clip } from '@speedora/shared';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { ClipCard } from '@/components/gallery/ClipCard';
import {
  ClipLibraryFilters,
  type ClipLibraryFiltersValue,
} from '@/components/library/ClipLibraryFilters';
import { Nav } from '@/components/Nav';
import { getClipLibrary, getClipLibraryFacets } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const LIMIT = 24;

// AI Clip Library roadmap (P1) - the first cross-video, filterable clip
// listing this app has ever had (every other clip view is nested under one
// Video). Modeled on /leaderboard's simpler client-only SWR page rather than
// /dashboard's server-rendered-then-polled split - this is a net-new route
// with no existing SSR data-fetching to preserve parity with.
export default function ClipLibraryPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [filters, setFilters] = useState<ClipLibraryFiltersValue>({});
  const [extraClips, setExtraClips] = useState<Clip[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const queryParams = useMemo(
    () => ({
      workspaceId: activeWorkspaceId ?? undefined,
      limit: LIMIT,
      platform: filters.platform,
      minDuration: filters.durationBucket?.minDuration,
      maxDuration: filters.durationBucket?.maxDuration,
      emotion: filters.emotion,
      topics: filters.topic ? [filters.topic] : undefined,
      minScore: filters.minScore,
      keyword: filters.keyword,
    }),
    [activeWorkspaceId, filters],
  );

  const { data, error, isLoading } = useSWR(
    user ? ['clip-library', queryParams] : null,
    () => getClipLibrary(queryParams),
  );

  const { data: facets } = useSWR(
    user ? ['clip-library-facets', activeWorkspaceId] : null,
    () => getClipLibraryFacets({ workspaceId: activeWorkspaceId ?? undefined }),
  );

  // A filter change invalidates whatever was loaded via "load more" -
  // extraClips/extraCursor reset the moment queryParams changes (queryParams
  // is a useMemo, so its identity only changes when filters/workspace
  // actually do) - SWR's own key change already re-fetches page 1 for us.
  useEffect(() => {
    setExtraClips([]);
    setExtraCursor(null);
    setHasLoadedMore(false);
  }, [queryParams]);

  const clips = useMemo(() => {
    const seen = new Set<string>();
    const merged: Clip[] = [];
    for (const clip of data?.clips ?? []) {
      if (!seen.has(clip.id)) {
        seen.add(clip.id);
        merged.push(clip);
      }
    }
    for (const clip of extraClips) {
      if (!seen.has(clip.id)) {
        seen.add(clip.id);
        merged.push(clip);
      }
    }
    return merged;
  }, [data, extraClips]);

  const cursorForNextLoad = hasLoadedMore ? extraCursor : (data?.nextCursor ?? null);
  const hasMore = cursorForNextLoad !== null;

  async function loadMore() {
    if (!cursorForNextLoad) return;
    setLoadingMore(true);
    try {
      const result = await getClipLibrary({ ...queryParams, cursor: cursorForNextLoad });
      setExtraClips((prev) => [...prev, ...result.clips]);
      setExtraCursor(result.nextCursor);
      setHasLoadedMore(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
          Clip Library
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Semua klip di workspace kamu, bisa dicari dan difilter lintas video.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat clip library.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            <div className="mt-6">
              <ClipLibraryFilters
                value={filters}
                onChange={setFilters}
                topicOptions={facets?.topics ?? []}
              />
            </div>

            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat clip library'}
              </p>
            )}

            {!error && !isLoading && clips.length === 0 && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Tidak ada klip yang cocok dengan filter ini.
              </p>
            )}

            {clips.length > 0 && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {clips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} />
                ))}
              </div>
            )}

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
