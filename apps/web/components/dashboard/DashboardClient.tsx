'use client';

import {
  PublishStatus,
  VideoStatus,
  type CampaignDto,
  type PaginatedVideos,
  type PublishRecord,
  type RecurringScheduleDto,
  type SocialAccount,
} from '@speedora/shared';
import { AlertTriangle, ExternalLink, Ghost, Trash2, Trophy, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import {
  memo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import { type FolderSelection, ProjectFolderSidebar } from './ProjectFolderSidebar';
import { QuickActions } from './QuickActions';
import { RecentProjectsGrid } from './RecentProjectsGrid';
import { SearchBar } from './SearchBar';
import { UploadVideoQuickAction } from './UploadVideoQuickAction';

type VideoClip = VideoWithClipsDto['clips'][number];

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

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - same
// convention as lib/scheduling.ts's own getPublishStatusLabel (a separate
// copy, kept in Indonesian to match the rest of this dashboard - see that
// file's own comment on why). Falls back to the raw value plus a
// console.warn instead of silently rendering nothing for a live
// frontend/backend version skew.
function getPublishStatusLabel(status: string): string {
  if (status in PUBLISH_STATUS_LABELS) {
    return PUBLISH_STATUS_LABELS[status as PublishStatus];
  }
  console.warn(
    `[DashboardClient] unknown PublishStatus "${status}" - falling back to the raw value. ` +
      'This means the API sent a status this frontend build does not recognize yet.',
  );
  return status;
}

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

// Phase F (performance hardening) - ClipRow is the expensive part of this
// list (video preview, publish/schedule form, publish-record history) that
// used to have zero memoization boundary at all: DashboardClient kept every
// per-clip interactive value (selectedAccountId, scheduleInput, etc.) in one
// Record<clipId, value> state object each, so typing into a single clip's
// schedule input re-rendered and reconciled EVERY clip in EVERY video.
//
// Fixed by (a) wrapping every handler this component receives in
// useCallback below (a stable function reference is required for
// React.memo's shallow prop comparison to actually bail out), and (b)
// deriving per-clip PRIMITIVES (booleans/strings, never a shared Record) at
// each call site right before rendering a ClipRow, so a keystroke in one
// clip's input produces an unchanged prop value for every sibling clip -
// same "extract the specific slice, not the whole state blob" discipline
// already used by ActivityRow/ProjectCard/QueueItem elsewhere in this
// dashboard. Plain useState setters (setConfirmDeleteClipId,
// setSelectedAccountId, etc.) are already stable across renders and are
// passed straight through rather than wrapped - only the real async
// handlers need useCallback.
interface ClipRowProps {
  videoId: string;
  clip: VideoClip;
  isBest: boolean;
  isConfirmingDelete: boolean;
  setConfirmDeleteClipId: Dispatch<SetStateAction<string | null>>;
  setDeleteClipError: Dispatch<SetStateAction<{ clipId: string; message: string } | null>>;
  isDeletingClip: boolean;
  deleteClipErrorMessage: string | null;
  onDeleteClip: (videoId: string, clipId: string) => void;
  accounts: SocialAccount[] | null;
  selectedAccountIdOverride: string | undefined;
  setSelectedAccountId: Dispatch<SetStateAction<Record<string, string>>>;
  isPublishing: boolean;
  isScheduling: boolean;
  publishErrorMessage: string | null;
  scheduleValue: string;
  setScheduleInput: Dispatch<SetStateAction<Record<string, string>>>;
  campaignIdValue: string;
  setSelectedCampaignId: Dispatch<SetStateAction<Record<string, string>>>;
  recurringScheduleIdValue: string;
  setSelectedRecurringScheduleId: Dispatch<SetStateAction<Record<string, string>>>;
  publishableCampaigns: CampaignDto[];
  publishableSchedules: RecurringScheduleDto[];
  onPublish: (clipId: string, socialAccountId: string, campaignId?: string) => void;
  onSchedule: (
    clipId: string,
    socialAccountId: string,
    localDateTime: string,
    campaignId?: string,
  ) => void;
  onQueueToSchedule: (
    clipId: string,
    socialAccountId: string,
    recurringScheduleId: string,
    campaignId?: string,
  ) => void;
  // Pre-filtered by the caller to null unless the id actually belongs to
  // one of THIS clip's own publishRecords - see the two callers below.
  cancelingRecordId: string | null;
  onCancelScheduled: (clipId: string, recordId: string) => void;
  reschedulingRecordId: string | null;
  setReschedulingRecordId: Dispatch<SetStateAction<string | null>>;
  rescheduleValue: string;
  setRescheduleInput: Dispatch<SetStateAction<Record<string, string>>>;
  onReschedule: (clipId: string, recordId: string, localDateTime: string) => void;
  scheduleActionErrorMessage: { recordId: string; message: string } | null;
}

const ClipRow = memo(function ClipRow({
  videoId,
  clip,
  isBest,
  isConfirmingDelete,
  setConfirmDeleteClipId,
  setDeleteClipError,
  isDeletingClip,
  deleteClipErrorMessage,
  onDeleteClip,
  accounts,
  selectedAccountIdOverride,
  setSelectedAccountId,
  isPublishing,
  isScheduling,
  publishErrorMessage,
  scheduleValue,
  setScheduleInput,
  campaignIdValue,
  setSelectedCampaignId,
  recurringScheduleIdValue,
  setSelectedRecurringScheduleId,
  publishableCampaigns,
  publishableSchedules,
  onPublish,
  onSchedule,
  onQueueToSchedule,
  cancelingRecordId,
  onCancelScheduled,
  reschedulingRecordId,
  setReschedulingRecordId,
  rescheduleValue,
  setRescheduleInput,
  onReschedule,
  scheduleActionErrorMessage,
}: ClipRowProps) {
  const busy = isPublishing || isScheduling;

  return (
    <li
      className={cn(
        'rounded-md border p-3',
        isBest ? 'border-primary/60 bg-primary/5' : 'border-border bg-muted',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScoreGauge score={clip.viralityScore} size={32} />
          <span className="font-mono text-xs text-muted-foreground">
            {clip.startTime.toFixed(1)}s–{clip.endTime.toFixed(1)}s
          </span>
          {isBest && (
            <Badge variant="outline" className="gap-1 border-primary text-primary">
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
            <Link href={`/videos/${videoId}/edit?clip=${clip.id}`}>Edit</Link>
          </Button>
          {clip.highlightScore !== null && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/videos/${videoId}/explainability?clip=${clip.id}`}>
                AI Explainability
              </Link>
            </Button>
          )}
          {clip.publishRecords.length > 0 && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/videos/${videoId}/performance?clip=${clip.id}`}>Performance</Link>
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
            <span className="font-mono text-xs text-muted-foreground">Merender...</span>
          )}
          {isConfirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="font-body text-xs text-muted-foreground">Hapus?</span>
              <button
                onClick={() => onDeleteClip(videoId, clip.id)}
                disabled={isDeletingClip}
                className="font-body text-xs font-medium text-destructive underline underline-offset-2 disabled:opacity-50"
              >
                {isDeletingClip ? 'Menghapus...' : 'Ya, hapus'}
              </button>
              <button
                onClick={() => setConfirmDeleteClipId(null)}
                disabled={isDeletingClip}
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
      {deleteClipErrorMessage && (
        <p className="mt-1 font-body text-xs text-destructive">{deleteClipErrorMessage}</p>
      )}

      {clip.downloadUrl && (
        <video
          key={clip.id}
          src={clipStreamUrl(clip.id)}
          crossOrigin="use-credentials"
          controls
          preload="metadata"
          className="mt-3 max-h-80 rounded-md bg-slate-950"
          style={{ aspectRatio: '9/16' }}
        />
      )}

      {clip.hookText && (
        <p className="mt-2 font-body text-sm italic text-foreground">&quot;{clip.hookText}&quot;</p>
      )}
      {clip.hashtags.length > 0 && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">
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
          const selectedId = selectedAccountIdOverride ?? accounts[0].id;
          const selectedAccount = accounts.find((a) => a.id === selectedId) ?? accounts[0];
          return (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {accounts.length > 1 && !recurringScheduleIdValue && (
                  <select
                    value={selectedId}
                    onChange={(e) =>
                      setSelectedAccountId((prev) => ({ ...prev, [clip.id]: e.target.value }))
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 font-body text-xs text-foreground"
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {platformLabel(account.platform)} — {account.displayName}
                      </option>
                    ))}
                  </select>
                )}
                {recurringScheduleIdValue ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      onQueueToSchedule(
                        clip.id,
                        selectedId,
                        recurringScheduleIdValue,
                        campaignIdValue || undefined,
                      )
                    }
                  >
                    {isScheduling ? 'Menambahkan ke antrian...' : 'Queue to Schedule'}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onPublish(clip.id, selectedId, campaignIdValue || undefined)}
                    >
                      {isPublishing
                        ? 'Publishing...'
                        : `Publish ke ${platformLabel(selectedAccount.platform)}`}
                    </Button>
                    <input
                      type="datetime-local"
                      value={scheduleValue}
                      onChange={(e) =>
                        setScheduleInput((prev) => ({ ...prev, [clip.id]: e.target.value }))
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !scheduleValue}
                      onClick={() =>
                        scheduleValue &&
                        onSchedule(clip.id, selectedId, scheduleValue, campaignIdValue || undefined)
                      }
                    >
                      {isScheduling ? 'Menjadwalkan...' : 'Jadwalkan'}
                    </Button>
                  </>
                )}
              </div>
              {(publishableCampaigns.length > 0 || publishableSchedules.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {publishableCampaigns.length > 0 && (
                    <select
                      value={campaignIdValue}
                      onChange={(e) =>
                        setSelectedCampaignId((prev) => ({ ...prev, [clip.id]: e.target.value }))
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-muted-foreground"
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
                      value={recurringScheduleIdValue}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedRecurringScheduleId((prev) => ({ ...prev, [clip.id]: id }));
                        const schedule = publishableSchedules.find((s) => s.id === id);
                        if (schedule) {
                          setSelectedAccountId((prev) => ({
                            ...prev,
                            [clip.id]: schedule.socialAccountId,
                          }));
                        }
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-muted-foreground"
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
              <PlatformCopyPanel clipId={clip.id} platform={selectedAccount.platform} />
            </div>
          );
        })()}
      {publishErrorMessage && (
        <p className="mt-2 font-body text-xs text-destructive">{publishErrorMessage}</p>
      )}
      {clip.publishRecords.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border pt-2">
          {clip.publishRecords.map((record) => (
            <li key={record.id} className="font-body text-xs text-muted-foreground">
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
                      onClick={() => onCancelScheduled(clip.id, record.id)}
                      disabled={cancelingRecordId === record.id}
                      className="text-destructive underline disabled:opacity-50"
                    >
                      {cancelingRecordId === record.id ? 'Membatalkan...' : 'Batalkan'}
                    </button>
                    <button
                      onClick={() =>
                        setReschedulingRecordId((prev) => (prev === record.id ? null : record.id))
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
                        value={rescheduleValue}
                        onChange={(e) =>
                          setRescheduleInput((prev) => ({ ...prev, [record.id]: e.target.value }))
                        }
                        className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (rescheduleValue) {
                            onReschedule(clip.id, record.id, rescheduleValue);
                          }
                        }}
                      >
                        Simpan
                      </Button>
                    </div>
                  )}
                  {scheduleActionErrorMessage &&
                    scheduleActionErrorMessage.recordId === record.id && (
                      <p className="text-destructive">{scheduleActionErrorMessage.message}</p>
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
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span>
                      {record.status === PublishStatus.PUBLISHED
                        ? publishedLabel(record)
                        : getPublishStatusLabel(record.status)}
                      {record.status === PublishStatus.FAILED && record.errorMessage
                        ? ` - ${record.errorMessage}`
                        : ''}
                    </span>
                  )}
                  {record.status === PublishStatus.PUBLISHED && statsLine(record) && (
                    <p
                      className={cn(
                        'mt-0.5 font-mono',
                        isBest ? 'text-primary' : 'text-muted-foreground',
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
});

interface VideoRowProps {
  video: VideoWithClipsDto;
  bestClipId: string | null;
  isConfirmingDeleteVideo: boolean;
  setConfirmDeleteId: Dispatch<SetStateAction<string | null>>;
  isDeletingVideo: boolean;
  deleteErrorMessage: string | null;
  setDeleteError: Dispatch<SetStateAction<{ videoId: string; message: string } | null>>;
  onDeleteVideo: (videoId: string) => void;
  isRetrying: boolean;
  retryErrorMessage: string | null;
  onRetry: (videoId: string) => void;
  confirmDeleteClipId: string | null;
  setConfirmDeleteClipId: Dispatch<SetStateAction<string | null>>;
  deletingClipId: string | null;
  deleteClipError: { clipId: string; message: string } | null;
  setDeleteClipError: Dispatch<SetStateAction<{ clipId: string; message: string } | null>>;
  onDeleteClip: (videoId: string, clipId: string) => void;
  accounts: SocialAccount[] | null;
  selectedAccountId: Record<string, string>;
  setSelectedAccountId: Dispatch<SetStateAction<Record<string, string>>>;
  publishingClipId: string | null;
  schedulingClipId: string | null;
  publishError: { clipId: string; message: string } | null;
  scheduleInput: Record<string, string>;
  setScheduleInput: Dispatch<SetStateAction<Record<string, string>>>;
  selectedCampaignId: Record<string, string>;
  setSelectedCampaignId: Dispatch<SetStateAction<Record<string, string>>>;
  selectedRecurringScheduleId: Record<string, string>;
  setSelectedRecurringScheduleId: Dispatch<SetStateAction<Record<string, string>>>;
  publishableCampaigns: CampaignDto[];
  publishableSchedules: RecurringScheduleDto[];
  onPublish: (clipId: string, socialAccountId: string, campaignId?: string) => void;
  onSchedule: (
    clipId: string,
    socialAccountId: string,
    localDateTime: string,
    campaignId?: string,
  ) => void;
  onQueueToSchedule: (
    clipId: string,
    socialAccountId: string,
    recurringScheduleId: string,
    campaignId?: string,
  ) => void;
  cancelingRecordId: string | null;
  onCancelScheduled: (clipId: string, recordId: string) => void;
  reschedulingRecordId: string | null;
  setReschedulingRecordId: Dispatch<SetStateAction<string | null>>;
  rescheduleInput: Record<string, string>;
  setRescheduleInput: Dispatch<SetStateAction<Record<string, string>>>;
  onReschedule: (clipId: string, recordId: string, localDateTime: string) => void;
  scheduleActionError: { recordId: string; message: string } | null;
}

// Phase F (performance hardening) - the per-video wrapper (header links,
// ProgressSteps, delete-confirm, FAILED/RENDERED branch). Cheap to
// re-render on its own (no per-video Record-keyed state exists at this
// level - confirmDeleteId/deletingId/deleteError/retryingId/retryError are
// plain nullable values, already narrowed to this-video-or-not by the
// caller below) - the real cost this pass targets is ClipRow's subtree,
// isolated by narrowing every cross-clip shared value to a per-clip
// primitive right here, in this component's own clips.map(), before ever
// reaching ClipRow's props.
const VideoRow = memo(function VideoRow({
  video,
  bestClipId,
  isConfirmingDeleteVideo,
  setConfirmDeleteId,
  isDeletingVideo,
  deleteErrorMessage,
  setDeleteError,
  onDeleteVideo,
  isRetrying,
  retryErrorMessage,
  onRetry,
  confirmDeleteClipId,
  setConfirmDeleteClipId,
  deletingClipId,
  deleteClipError,
  setDeleteClipError,
  onDeleteClip,
  accounts,
  selectedAccountId,
  setSelectedAccountId,
  publishingClipId,
  schedulingClipId,
  publishError,
  scheduleInput,
  setScheduleInput,
  selectedCampaignId,
  setSelectedCampaignId,
  selectedRecurringScheduleId,
  setSelectedRecurringScheduleId,
  publishableCampaigns,
  publishableSchedules,
  onPublish,
  onSchedule,
  onQueueToSchedule,
  cancelingRecordId,
  onCancelScheduled,
  reschedulingRecordId,
  setReschedulingRecordId,
  rescheduleInput,
  setRescheduleInput,
  onReschedule,
  scheduleActionError,
}: VideoRowProps) {
  return (
    <li
      id={`video-${video.id}`}
      className="scroll-mt-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 className="sr-only">Riwayat lengkap untuk {video.title ?? 'video tanpa judul'}</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">
          {new Date(video.createdAt).toLocaleString()}
        </p>
        <div className="flex items-center gap-3">
          {video.clips.length > 0 && (
            <Link
              href={`/videos/${video.id}/edit`}
              className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary"
            >
              Edit Timeline
            </Link>
          )}
          {video.clips.length > 0 && (
            <Link
              href={`/videos/${video.id}/review`}
              className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary"
            >
              Review Mode
            </Link>
          )}
          {video.clips.some((clip) => (clip.ocrTracks?.length ?? 0) > 0) && (
            <Link
              href={`/videos/${video.id}/ocr-review`}
              className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary"
            >
              OCR Review
            </Link>
          )}
          {video.clips.some((clip) => clip.highlightScore !== null) && (
            <Link
              href={`/videos/${video.id}/explainability`}
              className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary"
            >
              AI Explainability
            </Link>
          )}
          {video.clips.some((clip) => clip.publishRecords.length > 0) && (
            <Link
              href={`/videos/${video.id}/performance`}
              className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary"
            >
              Performance
            </Link>
          )}
          <ShareDialog videoId={video.id} />
          {isConfirmingDeleteVideo ? (
            <span className="flex items-center gap-2">
              <span className="font-body text-xs text-muted-foreground">Hapus?</span>
              <button
                onClick={() => onDeleteVideo(video.id)}
                disabled={isDeletingVideo}
                className="font-body text-xs font-medium text-destructive underline underline-offset-2 disabled:opacity-50"
              >
                {isDeletingVideo ? 'Menghapus...' : 'Ya, hapus'}
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={isDeletingVideo}
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
      {deleteErrorMessage && (
        <p className="mt-2 font-body text-xs text-destructive">{deleteErrorMessage}</p>
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
              <p className="font-body text-sm text-foreground">Video ini gagal diproses.</p>
              {retryErrorMessage && (
                <p className="mt-1 font-body text-xs text-destructive">{retryErrorMessage}</p>
              )}
              <Button
                size="sm"
                className="mt-2"
                disabled={isRetrying}
                onClick={() => onRetry(video.id)}
              >
                {isRetrying ? 'Menjalankan Ulang...' : 'Jalankan Ulang'}
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
                // Per-clip narrowing - see this file's own ClipRow comment
                // for why this has to happen here, not be forwarded raw.
                const clipRecordIds = new Set(clip.publishRecords.map((r) => r.id));
                return (
                  <ClipRow
                    key={clip.id}
                    videoId={video.id}
                    clip={clip}
                    isBest={clip.id === bestClipId}
                    isConfirmingDelete={confirmDeleteClipId === clip.id}
                    setConfirmDeleteClipId={setConfirmDeleteClipId}
                    setDeleteClipError={setDeleteClipError}
                    isDeletingClip={deletingClipId === clip.id}
                    deleteClipErrorMessage={
                      deleteClipError?.clipId === clip.id ? deleteClipError.message : null
                    }
                    onDeleteClip={onDeleteClip}
                    accounts={accounts}
                    selectedAccountIdOverride={selectedAccountId[clip.id]}
                    setSelectedAccountId={setSelectedAccountId}
                    isPublishing={publishingClipId === clip.id}
                    isScheduling={schedulingClipId === clip.id}
                    publishErrorMessage={
                      publishError?.clipId === clip.id ? publishError.message : null
                    }
                    scheduleValue={scheduleInput[clip.id] ?? ''}
                    setScheduleInput={setScheduleInput}
                    campaignIdValue={selectedCampaignId[clip.id] ?? ''}
                    setSelectedCampaignId={setSelectedCampaignId}
                    recurringScheduleIdValue={selectedRecurringScheduleId[clip.id] ?? ''}
                    setSelectedRecurringScheduleId={setSelectedRecurringScheduleId}
                    publishableCampaigns={publishableCampaigns}
                    publishableSchedules={publishableSchedules}
                    onPublish={onPublish}
                    onSchedule={onSchedule}
                    onQueueToSchedule={onQueueToSchedule}
                    cancelingRecordId={
                      cancelingRecordId && clipRecordIds.has(cancelingRecordId)
                        ? cancelingRecordId
                        : null
                    }
                    onCancelScheduled={onCancelScheduled}
                    reschedulingRecordId={
                      reschedulingRecordId && clipRecordIds.has(reschedulingRecordId)
                        ? reschedulingRecordId
                        : null
                    }
                    setReschedulingRecordId={setReschedulingRecordId}
                    rescheduleValue={
                      reschedulingRecordId && clipRecordIds.has(reschedulingRecordId)
                        ? (rescheduleInput[reschedulingRecordId] ?? '')
                        : ''
                    }
                    setRescheduleInput={setRescheduleInput}
                    onReschedule={onReschedule}
                    scheduleActionErrorMessage={
                      scheduleActionError && clipRecordIds.has(scheduleActionError.recordId)
                        ? scheduleActionError
                        : null
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
});

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

  // Project/Folder sidebar navigation (Collaboration roadmap follow-up) -
  // {projectId: null, folderId: null} means "no filter", the exact
  // pre-existing default view. Declared before the videos SWR hook below so
  // its key/fetcher can react to a selection change.
  const [folderSelection, setFolderSelection] = useState<FolderSelection>({
    projectId: null,
    folderId: null,
  });
  const isFiltered = folderSelection.projectId !== null || folderSelection.folderId !== null;

  // Page 1 is server-rendered (fallbackData) then SWR-polled every 2s, same
  // cadence as the original hand-rolled setInterval - just with dedup/
  // revalidate-on-focus for free. Pages beyond 1 (via "Load More") are kept
  // in separate, un-polled state and merged for rendering. fallbackData only
  // applies to the exact unfiltered key (SWR keys the cache on the whole
  // array) - selecting a project/folder always forces a real fetch rather
  // than briefly flashing the unfiltered SSR data under a mismatched filter.
  const {
    data,
    error: videosError,
    mutate,
  } = useSWR<PaginatedVideos>(
    ['videos', DEFAULT_LIMIT, folderSelection.projectId, folderSelection.folderId],
    () =>
      listVideos({
        limit: DEFAULT_LIMIT,
        projectId: folderSelection.projectId ?? undefined,
        folderId: folderSelection.folderId ?? undefined,
      }),
    {
      fallbackData: isFiltered
        ? undefined
        : { videos: initialVideos, nextCursor: initialNextCursor },
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

  // A "load more" cursor from one filter is meaningless once the selection
  // changes - same reset-on-filter-change convention the Clip Library page
  // already established for its own extraClips/extraCursor.
  useEffect(() => {
    setExtraVideos([]);
    setExtraCursor(null);
    setHasLoadedMore(false);
  }, [folderSelection.projectId, folderSelection.folderId]);

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
      const result = await listVideos({
        cursor: cursorForNextLoad,
        limit: DEFAULT_LIMIT,
        projectId: folderSelection.projectId ?? undefined,
        folderId: folderSelection.folderId ?? undefined,
      });
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
  const updateVideos = useCallback(
    (updater: (videos: VideoWithClipsDto[]) => VideoWithClipsDto[]) => {
      mutate((current) => current && { ...current, videos: updater(current.videos) }, {
        revalidate: false,
      });
      setExtraVideos((prev) => updater(prev));
    },
    [mutate],
  );

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
  // Phase F (performance hardening) - memoized (not a bare .filter() on
  // every render) since these are now passed all the way down into every
  // ClipRow's props. Without this, even the `?? []` fallback alone produces
  // a brand new array reference every DashboardClient render (regardless of
  // whether campaignsForPublish/schedulesForPublish actually changed),
  // which defeats ClipRow's React.memo for every clip in every video -
  // caught by DashboardClient.spec.tsx's own render-count regression test.
  const publishableCampaigns = useMemo(
    () =>
      (campaignsForPublish?.campaigns ?? []).filter(
        (c) => c.status !== 'CANCELLED' && c.status !== 'COMPLETED',
      ),
    [campaignsForPublish],
  );
  const publishableSchedules = useMemo(
    () => (schedulesForPublish?.recurringSchedules ?? []).filter((s) => s.active),
    [schedulesForPublish],
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

  const replaceClipPublishRecords = useCallback(
    (clipId: string, updater: (records: PublishRecord[]) => PublishRecord[]) => {
      updateVideos((videos) =>
        videos.map((video) => ({
          ...video,
          clips: video.clips.map((clip) =>
            clip.id === clipId ? { ...clip, publishRecords: updater(clip.publishRecords) } : clip,
          ),
        })),
      );
    },
    [updateVideos],
  );

  const handlePublish = useCallback(
    async (clipId: string, socialAccountId: string, campaignId?: string) => {
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
    },
    [replaceClipPublishRecords],
  );

  const handleSchedule = useCallback(
    async (clipId: string, socialAccountId: string, localDateTime: string, campaignId?: string) => {
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
    },
    [replaceClipPublishRecords],
  );

  // Phase 6 (Scheduling) - queues a clip against a RecurringSchedule's next
  // open slot. The server computes scheduledAt itself (ignores any client
  // value) and is authoritative on socialAccountId, so this never sends a
  // scheduledAt - see ClipsService.publish().
  const handleQueueToSchedule = useCallback(
    async (
      clipId: string,
      socialAccountId: string,
      recurringScheduleId: string,
      campaignId?: string,
    ) => {
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
    },
    [replaceClipPublishRecords],
  );

  const handleCancelScheduled = useCallback(
    async (clipId: string, recordId: string) => {
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
    },
    [replaceClipPublishRecords],
  );

  const handleReschedule = useCallback(
    async (clipId: string, recordId: string, localDateTime: string) => {
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
    },
    [replaceClipPublishRecords],
  );

  const handleRetry = useCallback(
    async (videoId: string) => {
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
    },
    [updateVideos],
  );

  // Optimistic (matching the existing clip-delete convention below) - the
  // row disappears immediately rather than waiting a full round trip; on
  // failure, re-fetch the real first page (a snapshot rollback could
  // resurrect state a poll has since moved past).
  const handleDeleteVideo = useCallback(
    async (videoId: string) => {
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
    },
    [updateVideos, mutate],
  );

  const handleDeleteClip = useCallback(
    async (videoId: string, clipId: string) => {
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
    },
    [updateVideos, mutate],
  );

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
      <div className="mx-auto flex max-w-6xl items-start gap-6">
        {/* Project/Folder sidebar navigation (Collaboration roadmap follow-up) - a fixed-width
            column beside the existing content, which keeps its own original max-w-3xl reading
            width unchanged below rather than stretching to fill the wider container. */}
        <ProjectFolderSidebar
          workspaceId={activeWorkspaceId}
          selection={folderSelection}
          onSelect={setFolderSelection}
        />
        <div className="max-w-3xl flex-1">
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Speedora
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Riwayat video dan klip kamu.
          </p>

          <Nav user={user} onLogout={logout} />

          <div className="mt-6 space-y-6">
            <SearchBar />
            <QuickActions videos={videos} />
            {children}
            <ProcessingQueue videos={videos} />
            {videos.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
                    Recent Projects
                  </h2>
                  {/* Dashboard Improvement Sprint Phase B - read-only, so
                    unlike UploadVideoQuickAction this is a plain link, not
                    gated on activeWorkspaceId (falls back to the requester's
                    personal workspace the same way GET /videos itself
                    does). */}
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/videos/history">View All</Link>
                  </Button>
                </div>
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
            <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border bg-muted px-6 py-16 text-center">
              <UploadCloud className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="mt-4 font-display text-xl uppercase tracking-wide text-foreground">
                Belum Ada Video
              </p>
              <p className="mt-1 max-w-sm font-body text-sm text-muted-foreground">
                Upload rekaman pertama kamu dan lihat klip siap-viral pertama muncul di sini.
              </p>
              <UploadVideoQuickAction
                workspaceId={activeWorkspaceId}
                label="Upload Video Sekarang"
                size="lg"
                className="mt-6"
              />
            </div>
          ) : (
            <ul className="mt-6 space-y-4">
              {videos.map((video) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  bestClipId={bestClipId}
                  isConfirmingDeleteVideo={confirmDeleteId === video.id}
                  setConfirmDeleteId={setConfirmDeleteId}
                  isDeletingVideo={deletingId === video.id}
                  deleteErrorMessage={
                    deleteError?.videoId === video.id ? deleteError.message : null
                  }
                  setDeleteError={setDeleteError}
                  onDeleteVideo={handleDeleteVideo}
                  isRetrying={retryingId === video.id}
                  retryErrorMessage={retryError?.videoId === video.id ? retryError.message : null}
                  onRetry={handleRetry}
                  confirmDeleteClipId={confirmDeleteClipId}
                  setConfirmDeleteClipId={setConfirmDeleteClipId}
                  deletingClipId={deletingClipId}
                  deleteClipError={deleteClipError}
                  setDeleteClipError={setDeleteClipError}
                  onDeleteClip={handleDeleteClip}
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  setSelectedAccountId={setSelectedAccountId}
                  publishingClipId={publishingClipId}
                  schedulingClipId={schedulingClipId}
                  publishError={publishError}
                  scheduleInput={scheduleInput}
                  setScheduleInput={setScheduleInput}
                  selectedCampaignId={selectedCampaignId}
                  setSelectedCampaignId={setSelectedCampaignId}
                  selectedRecurringScheduleId={selectedRecurringScheduleId}
                  setSelectedRecurringScheduleId={setSelectedRecurringScheduleId}
                  publishableCampaigns={publishableCampaigns}
                  publishableSchedules={publishableSchedules}
                  onPublish={handlePublish}
                  onSchedule={handleSchedule}
                  onQueueToSchedule={handleQueueToSchedule}
                  cancelingRecordId={cancelingRecordId}
                  onCancelScheduled={handleCancelScheduled}
                  reschedulingRecordId={reschedulingRecordId}
                  setReschedulingRecordId={setReschedulingRecordId}
                  rescheduleInput={rescheduleInput}
                  setRescheduleInput={setRescheduleInput}
                  onReschedule={handleReschedule}
                  scheduleActionError={scheduleActionError}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
