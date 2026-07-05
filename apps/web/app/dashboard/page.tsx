'use client';

import {
  PublishStatus,
  VideoStatus,
  type PublishRecord,
  type SocialAccount,
} from '@speedora/shared';
import { AlertTriangle, ExternalLink, Trash2, Trophy, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Nav } from '../../components/Nav';
import { ProgressSteps } from '../../components/ProgressSteps';
import { ScoreGauge } from '../../components/ScoreGauge';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  cancelScheduledPublish,
  clipDownloadUrl,
  deleteClip,
  deleteVideo,
  listSocialAccounts,
  listVideos,
  publishClip,
  reschedulePublish,
  retryVideo,
  type VideoWithClipsDto,
} from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { cn } from '../../lib/utils';

const POLL_INTERVAL_MS = 2000;

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
};

const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  // SCHEDULED renders its own "Dijadwalkan untuk <date>" text (see the
  // publishRecords list below) instead of this generic label.
  [PublishStatus.SCHEDULED]: 'Terjadwal',
  [PublishStatus.QUEUED]: 'Antre untuk publish...',
  [PublishStatus.PUBLISHING]: 'Mempublikasikan...',
  // Overridden for TIKTOK below - "PUBLISHED" there just means TikTok
  // accepted the upload into the user's inbox, not that it's actually live
  // (Upload to Inbox mode, see CLAUDE.md's Fase 6d section).
  [PublishStatus.PUBLISHED]: 'Published',
  [PublishStatus.FAILED]: 'Publish gagal',
};

// TikTok's "Upload to Inbox" mode (Fase 6d) never makes a clip actually go
// live via this API call alone - the user still has to open the TikTok app
// and finish posting themselves, so "Published" would be misleading.
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

// Fase 6e - snapshot-only stats (see CLAUDE.md), refreshed periodically by
// apps/worker's sync-publish-stats job. TikTok's Upload to Inbox mode
// (Fase 6d) means real stats only become fetchable once the user finishes
// posting the draft themselves from their TikTok inbox - until then this
// shows an explicit pending message (rather than nothing, which could look
// like a stuck loading state) instead of the usual "not synced yet" null.
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

// Highlight cuma SATU klip berperforma terbaik (view count tertinggi di
// antara publish record yang sudah punya stats asli) - warna aksen dipakai
// sebagai sinyal prioritas, bukan diwarnai rata di semua angka performa.
function findBestClipId(videos: VideoWithClipsDto[] | null): string | null {
  if (!videos) return null;
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

export default function Dashboard() {
  const { user, checkingAuth, logout } = useAuth();
  const [videos, setVideos] = useState<VideoWithClipsDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  // Fase 6c - scheduling a new publish (per clip) and canceling/rescheduling
  // an existing SCHEDULED one (per record).
  const [scheduleInput, setScheduleInput] = useState<Record<string, string>>({});
  const [schedulingClipId, setSchedulingClipId] = useState<string | null>(null);
  const [cancelingRecordId, setCancelingRecordId] = useState<string | null>(null);
  const [reschedulingRecordId, setReschedulingRecordId] = useState<string | null>(null);
  const [rescheduleInput, setRescheduleInput] = useState<Record<string, string>>({});
  const [scheduleActionError, setScheduleActionError] = useState<{
    recordId: string;
    message: string;
  } | null>(null);
  // The interval callback below is created once per user (not re-created on
  // every fetch), so it needs a ref rather than the `videos` state directly
  // to see the latest value instead of whatever it was on mount.
  const videosRef = useRef<VideoWithClipsDto[] | null>(null);

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function fetchVideos() {
      try {
        const fetched = await listVideos();
        if (!cancelled) setVideos(fetched);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat video');
      }
    }

    fetchVideos();
    const interval = setInterval(() => {
      if (videosRef.current?.every((v) => isTerminal(v.status))) return;
      fetchVideos();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

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
  }, [user]);

  async function handlePublish(clipId: string, socialAccountId: string) {
    setPublishError(null);
    setPublishingClipId(clipId);
    try {
      const record = await publishClip(clipId, socialAccountId);
      setVideos(
        (prev) =>
          prev?.map((video) => ({
            ...video,
            clips: video.clips.map((clip) =>
              clip.id === clipId
                ? { ...clip, publishRecords: [...clip.publishRecords, record] }
                : clip,
            ),
          })) ?? prev,
      );
    } catch (err) {
      setPublishError({
        clipId,
        message: err instanceof Error ? err.message : 'Publish gagal',
      });
    } finally {
      setPublishingClipId(null);
    }
  }

  function replaceClipPublishRecords(
    clipId: string,
    updater: (records: PublishRecord[]) => PublishRecord[],
  ) {
    setVideos(
      (prev) =>
        prev?.map((video) => ({
          ...video,
          clips: video.clips.map((clip) =>
            clip.id === clipId ? { ...clip, publishRecords: updater(clip.publishRecords) } : clip,
          ),
        })) ?? prev,
    );
  }

  async function handleSchedule(clipId: string, socialAccountId: string, localDateTime: string) {
    setPublishError(null);
    setSchedulingClipId(clipId);
    try {
      const scheduledAt = new Date(localDateTime).toISOString();
      const record = await publishClip(clipId, socialAccountId, scheduledAt);
      replaceClipPublishRecords(clipId, (records) => [...records, record]);
      setScheduleInput((prev) => ({ ...prev, [clipId]: '' }));
    } catch (err) {
      setPublishError({ clipId, message: err instanceof Error ? err.message : 'Jadwal gagal' });
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
      setVideos((prev) => prev?.map((v) => (v.id === videoId ? updated : v)) ?? prev);
    } catch (err) {
      setRetryError({
        videoId,
        message: err instanceof Error ? err.message : 'Gagal menjalankan ulang',
      });
    } finally {
      setRetryingId(null);
    }
  }

  async function handleDeleteVideo(videoId: string) {
    setDeleteError(null);
    setDeletingId(videoId);
    try {
      await deleteVideo(videoId);
      setVideos((prev) => prev?.filter((v) => v.id !== videoId) ?? prev);
      setConfirmDeleteId(null);
    } catch (err) {
      setDeleteError({
        videoId,
        message: err instanceof Error ? err.message : 'Gagal menghapus video',
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteClip(videoId: string, clipId: string) {
    setDeleteClipError(null);
    setDeletingClipId(clipId);
    try {
      await deleteClip(clipId);
      setVideos(
        (prev) =>
          prev?.map((v) =>
            v.id === videoId ? { ...v, clips: v.clips.filter((c) => c.id !== clipId) } : v,
          ) ?? prev,
      );
      setConfirmDeleteClipId(null);
    } catch (err) {
      setDeleteClipError({
        clipId,
        message: err instanceof Error ? err.message : 'Gagal menghapus klip',
      });
    } finally {
      setDeletingClipId(null);
    }
  }

  const bestClipId = findBestClipId(videos);

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
          Speedora
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">Riwayat video dan klip kamu.</p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat video kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {videos === null ? null : videos.length === 0 ? (
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
                  <li key={video.id} className="rounded-lg border border-border bg-card p-5">
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
                                      {clip.downloadUrl ? (
                                        <Button size="sm" variant="outline" asChild>
                                          <a href={clipDownloadUrl(clip.downloadUrl)}>Unduh</a>
                                        </Button>
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

                                  {/* Inline preview of the actually-rendered clip (9:16 crop + burned-in
                                      caption), not the original source - so a clip is recognizable at a
                                      glance instead of being a blind "Unduh" link. crossOrigin matches
                                      the pattern used for /videos/:id/source in TimelineEditor.tsx, since
                                      this endpoint is also JwtAuthGuard-protected and cross-origin in dev. */}
                                  {clip.downloadUrl && (
                                    <video
                                      key={clip.id}
                                      src={clipDownloadUrl(clip.downloadUrl)}
                                      crossOrigin="use-credentials"
                                      controls
                                      preload="metadata"
                                      className="mt-3 max-h-80 rounded-md bg-bay-black"
                                      style={{ aspectRatio: '9/16' }}
                                    />
                                  )}

                                  {/* Suggested hook/hashtags from detect-clips' LLM call - read-only
                                      here, editable via the timeline editor's "Edit Timeline" link. */}
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
                                      const busy =
                                        publishingClipId === clip.id || schedulingClipId === clip.id;
                                      return (
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                          {accounts.length > 1 && (
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
                                                  {PLATFORM_LABELS[account.platform] ??
                                                    account.platform}{' '}
                                                  — {account.displayName}
                                                </option>
                                              ))}
                                            </select>
                                          )}
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() => handlePublish(clip.id, selectedId)}
                                          >
                                            {publishingClipId === clip.id
                                              ? 'Publishing...'
                                              : `Publish ke ${
                                                  PLATFORM_LABELS[selectedAccount.platform] ??
                                                  selectedAccount.platform
                                                }`}
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
                                              handleSchedule(clip.id, selectedId, scheduleValue)
                                            }
                                          >
                                            {schedulingClipId === clip.id
                                              ? 'Menjadwalkan...'
                                              : 'Jadwalkan'}
                                          </Button>
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
                                                  {PLATFORM_LABELS[record.platform] ??
                                                    record.platform}
                                                  : Dijadwalkan untuk{' '}
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
                                              {PLATFORM_LABELS[record.platform] ?? record.platform}:{' '}
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
                                                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
          </>
        )}
      </div>
    </main>
  );
}
