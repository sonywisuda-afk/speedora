'use client';

import {
  PublishStatus,
  VideoStatus,
  type PaginatedVideos,
  type PublishRecord,
  type SocialAccount,
} from '@speedora/shared';
import { AlertTriangle, ExternalLink, Ghost, Trash2, Trophy, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ProgressSteps } from '@/components/ProgressSteps';
import { ScoreGauge } from '@/components/ScoreGauge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShareDialog } from '@/components/dashboard/ShareDialog';
import { PlatformCopyPanel } from '@/components/seo/PlatformCopyPanel';
import { PlatformFitHint } from '@/components/seo/PlatformFitHint';
import {
  cancelScheduledPublish,
  clipDownloadUrl,
  clipStreamUrl,
  deleteClip,
  deleteVideo,
  listCampaigns,
  listRecurringSchedules,
  listSocialAccounts,
  listVideos,
  publishClip,
  reschedulePublish,
  retryVideo,
  type UserDto,
  type VideoWithClipsDto,
} from '@/lib/api';
import { platformLabel } from '@/lib/platform-metadata';
import { useAuth } from '@/lib/useAuth';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaceStore';
import { Nav } from '../Nav';
import { ProcessingQueue } from './ProcessingQueue';
import { QuickActions } from './QuickActions';
import { RecentProjectsGrid } from './RecentProjectsGrid';
import { SearchBar } from './SearchBar';

// GET /videos is now cursor-paginated (see PaginatedVideos in
// packages/shared) - this page only ever polls page 1 (the videos a user is
// actively waiting on are always the newest ones); older pages loaded via
// "Load More" are appended locally and never repolled.
const DEFAULT_LIMIT = 20;
const POLL_INTERVAL_MS = 2000;

const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  [PublishStatus.SCHEDULED]: 'Terjadwal',
  [PublishStatus.QUEUED]: 'Antre untuk publish...',
  [PublishStatus.PUBLISHING]: 'Mempublikasikan...',
  [PublishStatus.PUBLISHED]: 'Published',
  [PublishStatus.FAILED]: 'Publish gagal',
};

function publishedLabel(record: PublishRecord): string {
  if (record.platform === 'TIKTOK') {
    return 'Terkirim ke TikTok — buka app TikTok untuk selesaikan posting';
  }
  return PUBLISH_STATUS_LABELS[PublishStatus.PUBLISHED];
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function statsLine(record: PublishRecord): string | null {
  if (record.viewCount === null) {
    if (record.platform === 'TIKTOK') {
      return 'Stats pending — selesaikan posting di app TikTok dulu untuk melihat analitik';
    }
    return null;
  }
  const parts = [`${formatCount(record.viewCount)} views`];
  if (record.likeCount !== null) parts.push(`${formatCount(record.likeCount)} likes`);
  if (record.commentCount !== null) parts.push(`${formatCount(record.commentCount)} komentar`);
  return parts.join(' · ');
}

function isTerminal(status: VideoStatus): boolean {
  return status === VideoStatus.RENDERED || status === VideoStatus.FAILED;
}

function findBestClipId(videos: VideoWithClipsDto[]): string | null {
  let best: { clipId: string; views: number } | null = null;
  for (const video of videos) {
    for (const clip of video.clips) {
      for (const record of clip.publishRecords) {
        if (record.viewCount !== null && (!best || record.viewCount > best.views)) {
          best = { clipId: clip.id, views: record.viewCount };
        }
      }
    }
  }
  return best?.clipId ?? null;
}

export interface DashboardClientProps {
  user: UserDto;
  initialVideos: VideoWithClipsDto[];
  initialNextCursor: string | null;
  children?: ReactNode;
}

export function DashboardClient({
  user: initialUser,
  initialVideos,
  initialNextCursor,
  children,
}: DashboardClientProps) {
  const { user, logout } = useAuth(initialUser);

  // Page 1 is server-rendered (fallbackData) then SWR-polled every 2s, same
  // cadence as the original hand-rolled setInterval - just with dedup/
  // revalidate-on-focus for free. Pages beyond 1 (via "Load More") are kept
  // in separate, un-polled state and merged for rendering.
  const {
    data,
    error: videosError,
    mutate,
  } = useSWR<PaginatedVideos>(
    ['videos', DEFAULT_LIMIT],
    () => listVideos({ limit: DEFAULT_LIMIT }),
    {
      fallbackData: { videos: initialVideos, nextCursor: initialNextCursor },
      refreshInterval: (latestData) =>
        (latestData?.videos ?? initialVideos).every((v) => isTerminal(v.status))
          ? 0
          : POLL_INTERVAL_MS,
    },
  );
  const [extraVideos, setExtraVideos] = useState<VideoWithClipsDto[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const videos = useMemo(() => {
    const seen = new Set<string>();
    const merged: VideoWithClipsDto[] = [];
    for (const video of data?.videos ?? initialVideos) {
      if (!seen.has(video.id)) {
        seen.add(video.id);
        merged.push(video);
      }
    }
    for (const video of extraVideos) {
      if (!seen.has(video.id)) {
        seen.add(video.id);
        merged.push(video);
      }
    }
    return merged;
  }, [data, initialVideos, extraVideos]);

  const cursorForNextLoad = hasLoadedMore ? extraCursor : (data?.nextCursor ?? initialNextCursor);
  const hasMore = cursorForNextLoad !== null;

  async function loadMore() {
    if (!cursorForNextLoad) return;
    setLoadingMore(true);
    try {
      const result = await listVideos({ cursor: cursorForNextLoad, limit: DEFAULT_LIMIT });
      setExtraVideos((prev) => [...prev, ...result.videos]);
      setExtraCursor(result.nextCursor);
      setHasLoadedMore(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // Applies `updater` to whichever bucket(s) actually contain the affected
  // video(s) - a no-op .map() over a bucket that doesn't contain the id in
  // question just returns equivalent entries, so this is safe to call
  // unconditionally rather than first figuring out which bucket a video
  // lives in.
  function updateVideos(updater: (videos: VideoWithClipsDto[]) => VideoWithClipsDto[]) {
    mutate((current) => current && { ...current, videos: updater(current.videos) }, {
      revalidate: false,
    });
    setExtraVideos((prev) => updater(prev));
  }

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ videoId: string; message: string } | null>(null);
  // Two-step delete: first click arms confirmDeleteId, second click deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ videoId: string; message: string } | null>(null);
  // Same two-step pattern, one level down - per clip rather than per video.
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [deleteClipError, setDeleteClipError] = useState<{
    clipId: string;
    message: string;
  } | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<Record<string, string>>({});
  const [publishingClipId, setPublishingClipId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<{ clipId: string; message: string } | null>(
    null,
  );
  const [scheduleInput, setScheduleInput] = useState<Record<string, string>>({});
  const [schedulingClipId, setSchedulingClipId] = useState<string | null>(null);
  const [cancelingRecordId, setCancelingRecordId] = useState<string | null>(null);
  const [reschedulingRecordId, setReschedulingRecordId] = useState<string | null>(null);
  const [rescheduleInput, setRescheduleInput] = useState<Record<string, string>>({});
  const [scheduleActionError, setScheduleActionError] = useState<{
    recordId: string;
    message: string;
  } | null>(null);
  // Phase 6 (Scheduling) - optional Campaign/RecurringSchedule associations
  // on the existing publish flow (Platform -> Schedule -> Campaign optional
  // -> Recurring optional, no separate wizard). Scoped to whichever
  // workspace WorkspaceSwitcher currently has active - if a clip belongs to
  // a different workspace than the one active in the switcher, the backend
  // rejects the mismatch with a clear error surfaced through publishError,
  // same as any other publish failure.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [selectedCampaignId, setSelectedCampaignId] = useState<Record<string, string>>({});
  const [selectedRecurringScheduleId, setSelectedRecurringScheduleId] = useState<
    Record<string, string>
  >({});
  const { data: campaignsForPublish } = useSWR(
    activeWorkspaceId ? ['campaigns-for-publish', activeWorkspaceId] : null,
    () => listCampaigns(activeWorkspaceId as string),
  );
  const { data: schedulesForPublish } = useSWR(
    activeWorkspaceId ? ['schedules-for-publish', activeWorkspaceId] : null,
    () => listRecurringSchedules(activeWorkspaceId as string),
  );
  const publishableCampaigns = (campaignsForPublish?.campaigns ?? []).filter(
    (c) => c.status !== 'CANCELLED' && c.status !== 'COMPLETED',
  );
  const publishableSchedules = (schedulesForPublish?.recurringSchedules ?? []).filter(
    (s) => s.active,
  );

  useEffect(() => {
    let cancelled = false;
    listSocialAccounts()
      .then((fetched) => {
        if (!cancelled) setAccounts(fetched);
      })
      .catch(() => {
        // Not connecting an account is a normal state (Fase 6a is opt-in) -
        // silently leave accounts null/empty rather than surfacing an error
        // for something that isn't blocking the rest of the dashboard.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function replaceClipPublishRecords(
    clipId: string,
    updater: (records: PublishRecord[]) => PublishRecord[],
  ) {
    updateVideos((videos) =>
      videos.map((video) => ({
        ...video,
        clips: video.clips.map((clip) =>
          clip.id === clipId ? { ...clip, publishRecords: updater(clip.publishRecords) } : clip,
        ),
      })),
    );
  }

  async function handlePublish(
    clipId: string,
    socialAccountId: string,
    campaignId?: string,
  ) {
    setPublishError(null);
    setPublishingClipId(clipId);
    try {
      const record = await publishClip(clipId, socialAccountId, undefined, { campaignId });
      replaceClipPublishRecords(clipId, (records) => [...records, record]);
    } catch (err) {
      setPublishError({
        clipId,
        message: err instanceof Error ? err.message : 'Publish gagal',
      });
    } finally {
      setPublishingClipId(null);
    }
  }

  async function handleSchedule(
    clipId: string,
    socialAccountId: string,
    localDateTime: string,
    campaignId?: string,
  ) {
    setPublishError(null);
    setSchedulingClipId(clipId);
    try {
      const scheduledAt = new Date(localDateTime).toISOString();
      const record = await publishClip(clipId, socialAccountId, scheduledAt, { campaignId });
      replaceClipPublishRecords(clipId, (records) => [...records, record]);
      setScheduleInput((prev) => ({ ...prev, [clipId]: '' }));
    } catch (err) {
      setPublishError({ clipId, message: err instanceof Error ? err.message : 'Jadwal gagal' });
    } finally {
      setSchedulingClipId(null);
    }
  }

  // Phase 6 (Scheduling) - queues a clip against a RecurringSchedule's next
  // open slot. The server computes scheduledAt itself (ignores any client
  // value) and is authoritative on socialAccountId, so this never sends a
  // scheduledAt - see ClipsService.publish().
  async function handleQueueToSchedule(
    clipId: string,
    socialAccountId: string,
    recurringScheduleId: string,
    campaignId?: string,
  ) {
    setPublishError(null);
    setSchedulingClipId(clipId);
    try {
      const record = await publishClip(clipId, socialAccountId, undefined, {
        campaignId,
        recurringScheduleId,
      });
      replaceClipPublishRecords(clipId, (records) => [...records, record]);
      setSelectedRecurringScheduleId((prev) => ({ ...prev, [clipId]: '' }));
    } catch (err) {
      setPublishError({
        clipId,
        message: err instanceof Error ? err.message : 'Gagal menambahkan ke antrian',
      });
    } finally {
      setSchedulingClipId(null);
    }
  }

  async function handleCancelScheduled(clipId: string, recordId: string) {
    setScheduleActionError(null);
    setCancelingRecordId(recordId);
    try {
      await cancelScheduledPublish(clipId, recordId);
      replaceClipPublishRecords(clipId, (records) => records.filter((r) => r.id !== recordId));
    } catch (err) {
      setScheduleActionError({
        recordId,
        message: err instanceof Error ? err.message : 'Gagal membatalkan',
      });
    } finally {
      setCancelingRecordId(null);
    }
  }

  async function handleReschedule(clipId: string, recordId: string, localDateTime: string) {
    setScheduleActionError(null);
    try {
      const scheduledAt = new Date(localDateTime).toISOString();
      const updated = await reschedulePublish(clipId, recordId, scheduledAt);
      replaceClipPublishRecords(clipId, (records) =>
        records.map((r) => (r.id === recordId ? updated : r)),
      );
      setReschedulingRecordId(null);
    } catch (err) {
      setScheduleActionError({
        recordId,
        message: err instanceof Error ? err.message : 'Gagal menjadwalkan ulang',
      });
    }
  }

  async function handleRetry(videoId: string) {
    setRetryError(null);
    setRetryingId(videoId);
    try {
      const updated = await retryVideo(videoId);
      updateVideos((videos) => videos.map((v) => (v.id === videoId ? updated : v)));
    } catch (err) {
      setRetryError({
        videoId,
        message: err instanceof Error ? err.message : 'Gagal menjalankan ulang',
      });
    } finally {
      setRetryingId(null);
    }
  }

  // Optimistic (matching the existing clip-delete convention below) - the
  // row disappears immediately rather than waiting a full round trip; on
  // failure, re-fetch the real first page (a snapshot rollback could
  // resurrect state a poll has since moved past).
  async function handleDeleteVideo(videoId: string) {
    setDeleteError(null);
    setDeletingId(videoId);
    updateVideos((videos) => videos.filter((v) => v.id !== videoId));
    setConfirmDeleteId(null);
    try {
      await deleteVideo(videoId);
    } catch (err) {
      setDeleteError({
        videoId,
        message: err instanceof Error ? err.message : 'Gagal menghapus video',
      });
      try {
        await mutate();
      } catch {
        // The next poll tick (or reload) will resync - the delete error
        // above is the message that matters here.
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteClip(videoId: string, clipId: string) {
    setDeleteClipError(null);
    setDeletingClipId(clipId);
    updateVideos((videos) =>
      videos.map((v) =>
        v.id === videoId ? { ...v, clips: v.clips.filter((c) => c.id !== clipId) } : v,
      ),
    );
    setConfirmDeleteClipId(null);
    try {
      await deleteClip(clipId);
    } catch (err) {
      setDeleteClipError({
        clipId,
        message: err instanceof Error ? err.message : 'Gagal menghapus klip',
      });
      try {
        await mutate();
      } catch {
        // Same reasoning as handleDeleteVideo's catch above.
      }
    } finally {
      setDeletingClipId(null);
    }
  }

  const bestClipId = useMemo(() => findBestClipId(videos), [videos]);

  // The Server Component only renders <DashboardClient> when it already
  // found a logged-in user, but a client-side logout() call still needs
  // somewhere to land - same "Masuk" prompt the old fully-client page
  // rendered while checkingAuth/user was still resolving.
  if (!user) {
    return (
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Speedora
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Riwayat video dan klip kamu.
          </p>
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat video kamu.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">Riwayat video dan klip kamu.</p>

        <Nav user={user} onLogout={logout} />

        <div className="mt-6 space-y-6">
          <SearchBar />
          <QuickActions />
          {children}
          <ProcessingQueue videos={videos} />
          {videos.length > 0 && (
            <div>
              <h2 className="mb-2 font-display text-sm uppercase tracking-wide text-muted-foreground">
                Recent Projects
              </h2>
              <RecentProjectsGrid videos={videos} />
              {hasMore && (
                <div className="mt-3 flex justify-center">
                  <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore ? 'Memuat...' : 'Load More'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {videosError && (
          <p className="mt-4 font-body text-sm text-destructive">
            {videosError instanceof Error ? videosError.message : 'Gagal memuat video'}
          </p>
        )}

        {videos.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border bg-slate-panel px-6 py-16 text-center">
            <UploadCloud className="h-10 w-10 text-chrome" aria-hidden="true" />
            <p className="mt-4 font-display text-xl uppercase tracking-wide text-foreground">
              Belum Ada Video
            </p>
            <p className="mt-1 max-w-sm font-body text-sm text-muted-foreground">
              Upload rekaman pertama kamu dan lihat klip siap-viral pertama muncul di sini.
            </p>
            <Button size="lg" className="mt-6" asChild>
              <Link href="/upload">Upload Video Sekarang</Link>
            </Button>
          </div>
        ) : (
          <ul className="mt-6 space-y-4">
            {videos.map((video) => (
              <li
                key={video.id}
                id={`video-${video.id}`}
                className="scroll-mt-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="sr-only">
                  Riwayat lengkap untuk {video.title ?? 'video tanpa judul'}
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs text-muted-foreground">
                    {new Date(video.createdAt).toLocaleString()}
                  </p>
                  <div className="flex items-center gap-3">
                    {video.clips.length > 0 && (
                      <Link
                        href={`/videos/${video.id}/edit`}
                        className="font-body text-sm text-foreground underline underline-offset-2 hover:text-signal-pink"
                      >
                        Edit Timeline
                      </Link>
                    )}
                    {video.clips.length > 0 && (
                      <Link
                        href={`/videos/${video.id}/review`}
                        className="font-body text-sm text-foreground underline underline-offset-2 hover:text-signal-pink"
                      >
                        Review Mode
                      </Link>
                    )}
                    {video.clips.some((clip) => (clip.ocrTracks?.length ?? 0) > 0) && (
                      <Link
                        href={`/videos/${video.id}/ocr-review`}
                        className="font-body text-sm text-foreground underline underline-offset-2 hover:text-signal-pink"
                      >
                        OCR Review
                      </Link>
                    )}
                    {video.clips.some((clip) => clip.highlightScore !== null) && (
                      <Link
                        href={`/videos/${video.id}/explainability`}
                        className="font-body text-sm text-foreground underline underline-offset-2 hover:text-signal-pink"
                      >
                        AI Explainability
                      </Link>
                    )}
                    <ShareDialog videoId={video.id} />
                    {confirmDeleteId === video.id ? (
                      <span className="flex items-center gap-2">
                        <span className="font-body text-xs text-muted-foreground">Hapus?</span>
                        <button
                          onClick={() => handleDeleteVideo(video.id)}
                          disabled={deletingId === video.id}
                          className="font-body text-xs font-medium text-destructive underline underline-offset-2 disabled:opacity-50"
                        >
                          {deletingId === video.id ? 'Menghapus...' : 'Ya, hapus'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deletingId === video.id}
                          className="font-body text-xs text-muted-foreground underline underline-offset-2"
                        >
                          Batal
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setConfirmDeleteId(video.id);
                          setDeleteError(null);
                        }}
                        aria-label="Hapus video"
                        title="Hapus video"
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                {deleteError && deleteError.videoId === video.id && (
                  <p className="mt-2 font-body text-xs text-destructive">{deleteError.message}</p>
                )}
                <div className="mt-2">
                  <ProgressSteps status={video.status} />
                </div>

                {video.status === VideoStatus.FAILED && (
                  <div className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-body text-sm text-foreground">
                          Video ini gagal diproses.
                        </p>
                        {retryError && retryError.videoId === video.id && (
                          <p className="mt-1 font-body text-xs text-destructive">
                            {retryError.message}
                          </p>
                        )}
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={retryingId === video.id}
                          onClick={() => handleRetry(video.id)}
                        >
                          {retryingId === video.id ? 'Menjalankan Ulang...' : 'Jalankan Ulang'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {video.status === VideoStatus.RENDERED && (
                  <div className="mt-4">
                    {video.clips.length === 0 ? (
                      <p className="font-body text-sm text-muted-foreground">
                        Tidak ada klip ditemukan untuk video ini.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {video.clips.map((clip) => {
                          const isBest = clip.id === bestClipId;
                          return (
                            <li
                              key={clip.id}
                              className={cn(
                                'rounded-md border p-3',
                                isBest
                                  ? 'border-signal-pink/60 bg-signal-pink/5'
                                  : 'border-border bg-slate-panel',
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <ScoreGauge score={clip.viralityScore} size={32} />
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {clip.startTime.toFixed(1)}s–{clip.endTime.toFixed(1)}s
                                  </span>
                                  {isBest && (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 border-signal-pink text-signal-pink"
                                    >
                                      <Trophy className="h-3 w-3" aria-hidden="true" />
                                      Performa Terbaik
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* Per-clip (not per-video) - the video-level "Edit
                                      Timeline"/"AI Explainability" links above default
                                      to clip[0]/the top-scored clip regardless of which
                                      clip row this is, so this row needs its own
                                      `?clip=` deep links, same convention as
                                      ClipCard.tsx's own per-clip edit link. */}
                                  <Button size="sm" variant="outline" asChild>
                                    <Link href={`/videos/${video.id}/edit?clip=${clip.id}`}>
                                      Edit
                                    </Link>
                                  </Button>
                                  {clip.highlightScore !== null && (
                                    <Button size="sm" variant="outline" asChild>
                                      <Link
                                        href={`/videos/${video.id}/explainability?clip=${clip.id}`}
                                      >
                                        AI Explainability
                                      </Link>
                                    </Button>
                                  )}
                                  {clip.downloadUrl ? (
                                    <>
                                      <Button size="sm" variant="outline" asChild>
                                        <a href={clipDownloadUrl(clip.downloadUrl)}>Unduh</a>
                                      </Button>
                                      {/* Multi-Platform Publishing Expansion, Phase 5 - Snapchat
                                          has no server-side publish API for third-party apps, and
                                          Creative Kit (its one attach-and-share mechanism) is a
                                          native iOS/Android SDK only - a web page cannot hand off
                                          a specific video to it (no pasteboard/Intent access from
                                          a browser). This is deliberately just the same download
                                          as "Unduh" above, labeled honestly rather than dressed up
                                          as a real automated publish - the user finishes posting
                                          manually inside the Snapchat app themselves, the same
                                          "Sent to inbox, open the app to finish" honesty precedent
                                          as TikTok's Upload-to-Inbox mode (see CLAUDE.md's Publish
                                          Center section). No SocialAccount/PublishRecord/OAuth for
                                          this platform - there is no server-side action at all. */}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        title="Downloads your clip - open Snapchat and add it from your camera roll"
                                        asChild
                                      >
                                        <a href={clipDownloadUrl(clip.downloadUrl)}>
                                          <Ghost className="h-3.5 w-3.5" aria-hidden="true" />
                                          Share to Snapchat
                                        </a>
                                      </Button>
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        Manual publish required - not auto-published
                                      </span>
                                    </>
                                  ) : (
                                    <span className="font-mono text-xs text-muted-foreground">
                                      Merender...
                                    </span>
                                  )}
                                  {confirmDeleteClipId === clip.id ? (
                                    <span className="flex items-center gap-2">
                                      <span className="font-body text-xs text-muted-foreground">
                                        Hapus?
                                      </span>
                                      <button
                                        onClick={() => handleDeleteClip(video.id, clip.id)}
                                        disabled={deletingClipId === clip.id}
                                        className="font-body text-xs font-medium text-destructive underline underline-offset-2 disabled:opacity-50"
                                      >
                                        {deletingClipId === clip.id ? 'Menghapus...' : 'Ya, hapus'}
                                      </button>
                                      <button
                                        onClick={() => setConfirmDeleteClipId(null)}
                                        disabled={deletingClipId === clip.id}
                                        className="font-body text-xs text-muted-foreground underline underline-offset-2"
                                      >
                                        Batal
                                      </button>
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setConfirmDeleteClipId(clip.id);
                                        setDeleteClipError(null);
                                      }}
                                      aria-label="Hapus klip"
                                      title="Hapus klip"
                                      className="text-muted-foreground transition-colors hover:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {deleteClipError && deleteClipError.clipId === clip.id && (
                                <p className="mt-1 font-body text-xs text-destructive">
                                  {deleteClipError.message}
                                </p>
                              )}

                              {clip.downloadUrl && (
                                <video
                                  key={clip.id}
                                  src={clipStreamUrl(clip.id)}
                                  crossOrigin="use-credentials"
                                  controls
                                  preload="metadata"
                                  className="mt-3 max-h-80 rounded-md bg-bay-black"
                                  style={{ aspectRatio: '9/16' }}
                                />
                              )}

                              {clip.hookText && (
                                <p className="mt-2 font-body text-sm italic text-foreground">
                                  &quot;{clip.hookText}&quot;
                                </p>
                              )}
                              {clip.hashtags.length > 0 && (
                                <p className="mt-1 font-mono text-xs text-chrome">
                                  {clip.hashtags.map((tag) => `#${tag}`).join(' ')}
                                </p>
                              )}

                              {clip.downloadUrl &&
                                (() => {
                                  if (!accounts || accounts.length === 0) {
                                    return (
                                      <p className="mt-2 font-body text-xs text-muted-foreground">
                                        <Link href="/social" className="underline">
                                          Hubungkan akun
                                        </Link>{' '}
                                        untuk publish klip ini.
                                      </p>
                                    );
                                  }
                                  const selectedId = selectedAccountId[clip.id] ?? accounts[0].id;
                                  const selectedAccount =
                                    accounts.find((a) => a.id === selectedId) ?? accounts[0];
                                  const scheduleValue = scheduleInput[clip.id] ?? '';
                                  const campaignId = selectedCampaignId[clip.id] ?? '';
                                  const recurringScheduleId =
                                    selectedRecurringScheduleId[clip.id] ?? '';
                                  const busy =
                                    publishingClipId === clip.id || schedulingClipId === clip.id;
                                  return (
                                    <div className="mt-3 space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        {accounts.length > 1 && !recurringScheduleId && (
                                          <select
                                            value={selectedId}
                                            onChange={(e) =>
                                              setSelectedAccountId((prev) => ({
                                                ...prev,
                                                [clip.id]: e.target.value,
                                              }))
                                            }
                                            className="h-8 rounded-md border border-input bg-slate-panel px-2 font-body text-xs text-foreground"
                                          >
                                            {accounts.map((account) => (
                                              <option key={account.id} value={account.id}>
                                                {platformLabel(account.platform)} —{' '}
                                                {account.displayName}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                        {recurringScheduleId ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() =>
                                              handleQueueToSchedule(
                                                clip.id,
                                                selectedId,
                                                recurringScheduleId,
                                                campaignId || undefined,
                                              )
                                            }
                                          >
                                            {schedulingClipId === clip.id
                                              ? 'Menambahkan ke antrian...'
                                              : 'Queue to Schedule'}
                                          </Button>
                                        ) : (
                                          <>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={busy}
                                              onClick={() =>
                                                handlePublish(
                                                  clip.id,
                                                  selectedId,
                                                  campaignId || undefined,
                                                )
                                              }
                                            >
                                              {publishingClipId === clip.id
                                                ? 'Publishing...'
                                                : `Publish ke ${platformLabel(selectedAccount.platform)}`}
                                            </Button>
                                            <input
                                              type="datetime-local"
                                              value={scheduleValue}
                                              onChange={(e) =>
                                                setScheduleInput((prev) => ({
                                                  ...prev,
                                                  [clip.id]: e.target.value,
                                                }))
                                              }
                                              className="h-8 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-foreground"
                                            />
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={busy || !scheduleValue}
                                              onClick={() =>
                                                scheduleValue &&
                                                handleSchedule(
                                                  clip.id,
                                                  selectedId,
                                                  scheduleValue,
                                                  campaignId || undefined,
                                                )
                                              }
                                            >
                                              {schedulingClipId === clip.id
                                                ? 'Menjadwalkan...'
                                                : 'Jadwalkan'}
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                      {(publishableCampaigns.length > 0 ||
                                        publishableSchedules.length > 0) && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          {publishableCampaigns.length > 0 && (
                                            <select
                                              value={campaignId}
                                              onChange={(e) =>
                                                setSelectedCampaignId((prev) => ({
                                                  ...prev,
                                                  [clip.id]: e.target.value,
                                                }))
                                              }
                                              className="h-8 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-muted-foreground"
                                            >
                                              <option value="">No campaign</option>
                                              {publishableCampaigns.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                  {c.name}
                                                </option>
                                              ))}
                                            </select>
                                          )}
                                          {publishableSchedules.length > 0 && (
                                            <select
                                              value={recurringScheduleId}
                                              onChange={(e) => {
                                                const id = e.target.value;
                                                setSelectedRecurringScheduleId((prev) => ({
                                                  ...prev,
                                                  [clip.id]: id,
                                                }));
                                                const schedule = publishableSchedules.find(
                                                  (s) => s.id === id,
                                                );
                                                if (schedule) {
                                                  setSelectedAccountId((prev) => ({
                                                    ...prev,
                                                    [clip.id]: schedule.socialAccountId,
                                                  }));
                                                }
                                              }}
                                              className="h-8 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-muted-foreground"
                                            >
                                              <option value="">Publish now / schedule manually</option>
                                              {publishableSchedules.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                  {s.name} ({platformLabel(s.platform)})
                                                </option>
                                              ))}
                                            </select>
                                          )}
                                        </div>
                                      )}
                                      <PlatformFitHint clipId={clip.id} />
                                      <PlatformCopyPanel
                                        clipId={clip.id}
                                        platform={selectedAccount.platform}
                                      />
                                    </div>
                                  );
                                })()}
                              {publishError && publishError.clipId === clip.id && (
                                <p className="mt-2 font-body text-xs text-destructive">
                                  {publishError.message}
                                </p>
                              )}
                              {clip.publishRecords.length > 0 && (
                                <ul className="mt-3 space-y-2 border-t border-border pt-2">
                                  {clip.publishRecords.map((record) => (
                                    <li
                                      key={record.id}
                                      className="font-body text-xs text-muted-foreground"
                                    >
                                      {record.status === PublishStatus.SCHEDULED ? (
                                        <div className="space-y-1.5">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span>
                                              {platformLabel(record.platform)}: Dijadwalkan untuk{' '}
                                              <span className="font-mono">
                                                {record.scheduledAt
                                                  ? new Date(record.scheduledAt).toLocaleString()
                                                  : 'segera'}
                                              </span>
                                            </span>
                                            <button
                                              onClick={() =>
                                                handleCancelScheduled(clip.id, record.id)
                                              }
                                              disabled={cancelingRecordId === record.id}
                                              className="text-destructive underline disabled:opacity-50"
                                            >
                                              {cancelingRecordId === record.id
                                                ? 'Membatalkan...'
                                                : 'Batalkan'}
                                            </button>
                                            <button
                                              onClick={() =>
                                                setReschedulingRecordId((prev) =>
                                                  prev === record.id ? null : record.id,
                                                )
                                              }
                                              className="underline"
                                            >
                                              Jadwal Ulang
                                            </button>
                                          </div>
                                          {reschedulingRecordId === record.id && (
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="datetime-local"
                                                value={rescheduleInput[record.id] ?? ''}
                                                onChange={(e) =>
                                                  setRescheduleInput((prev) => ({
                                                    ...prev,
                                                    [record.id]: e.target.value,
                                                  }))
                                                }
                                                className="h-8 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-foreground"
                                              />
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                  const value = rescheduleInput[record.id];
                                                  if (value) {
                                                    handleReschedule(clip.id, record.id, value);
                                                  }
                                                }}
                                              >
                                                Simpan
                                              </Button>
                                            </div>
                                          )}
                                          {scheduleActionError &&
                                            scheduleActionError.recordId === record.id && (
                                              <p className="text-destructive">
                                                {scheduleActionError.message}
                                              </p>
                                            )}
                                        </div>
                                      ) : (
                                        <>
                                          {platformLabel(record.platform)}:{' '}
                                          {record.status === PublishStatus.PUBLISHED &&
                                          record.platform === 'YOUTUBE' &&
                                          record.platformPostId ? (
                                            <a
                                              href={`https://youtu.be/${record.platformPostId}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 underline"
                                            >
                                              {publishedLabel(record)}
                                              <ExternalLink
                                                className="h-3 w-3"
                                                aria-hidden="true"
                                              />
                                            </a>
                                          ) : (
                                            <span>
                                              {record.status === PublishStatus.PUBLISHED
                                                ? publishedLabel(record)
                                                : PUBLISH_STATUS_LABELS[record.status]}
                                              {record.status === PublishStatus.FAILED &&
                                              record.errorMessage
                                                ? ` - ${record.errorMessage}`
                                                : ''}
                                            </span>
                                          )}
                                          {record.status === PublishStatus.PUBLISHED &&
                                            statsLine(record) && (
                                              <p
                                                className={cn(
                                                  'mt-0.5 font-mono',
                                                  isBest
                                                    ? 'text-signal-cyan'
                                                    : 'text-muted-foreground',
                                                )}
                                              >
                                                {statsLine(record)}
                                              </p>
                                            )}
                                        </>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
