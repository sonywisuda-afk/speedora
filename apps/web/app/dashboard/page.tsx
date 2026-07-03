'use client';

import {
  PublishStatus,
  VideoStatus,
  type PublishRecord,
  type SocialAccount,
} from '@viral-clip-app/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Nav } from '../../components/Nav';
import { ProgressSteps } from '../../components/ProgressSteps';
import {
  cancelScheduledPublish,
  clipDownloadUrl,
  listSocialAccounts,
  listVideos,
  publishClip,
  reschedulePublish,
  retryVideo,
  type VideoWithClipsDto,
} from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

const POLL_INTERVAL_MS = 2000;

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: 'YouTube',
};

const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  // SCHEDULED renders its own "Scheduled for <date>" text (see
  // renderPublishRecord) instead of this generic label.
  [PublishStatus.SCHEDULED]: 'Scheduled',
  [PublishStatus.QUEUED]: 'Queued to publish...',
  [PublishStatus.PUBLISHING]: 'Publishing...',
  [PublishStatus.PUBLISHED]: 'Published',
  [PublishStatus.FAILED]: 'Publish failed',
};

function isTerminal(status: VideoStatus): boolean {
  return status === VideoStatus.RENDERED || status === VideoStatus.FAILED;
}

export default function Dashboard() {
  const { user, checkingAuth, logout } = useAuth();
  const [videos, setVideos] = useState<VideoWithClipsDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ videoId: string; message: string } | null>(null);
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load videos');
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
        message: err instanceof Error ? err.message : 'Publish failed',
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
      setPublishError({ clipId, message: err instanceof Error ? err.message : 'Schedule failed' });
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
        message: err instanceof Error ? err.message : 'Cancel failed',
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
        message: err instanceof Error ? err.message : 'Reschedule failed',
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
        message: err instanceof Error ? err.message : 'Retry failed',
      });
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">viral-clip-app</h1>
        <p className="mt-1 text-sm text-neutral-600">Your uploaded videos and their clips.</p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 text-sm text-neutral-600">
            <Link href="/" className="underline">
              Log in
            </Link>{' '}
            to see your videos.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {videos === null ? null : videos.length === 0 ? (
              <p className="mt-8 text-sm text-neutral-600">
                No videos yet.{' '}
                <Link href="/" className="underline">
                  Upload one
                </Link>{' '}
                to get started.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {videos.map((video) => (
                  <li
                    key={video.id}
                    className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
                  >
                    <p className="text-xs text-neutral-500">
                      {new Date(video.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-2">
                      <ProgressSteps status={video.status} />
                    </div>

                    {video.clips.length > 0 && (
                      <Link
                        href={`/videos/${video.id}/edit`}
                        className="mt-2 inline-block text-sm font-medium text-neutral-900 underline"
                      >
                        Edit timeline
                      </Link>
                    )}

                    {video.status === VideoStatus.FAILED && (
                      <div className="mt-4">
                        <p className="text-sm text-red-600">
                          Something went wrong processing this video.
                        </p>
                        {retryError && retryError.videoId === video.id && (
                          <p className="mt-2 text-sm text-red-600">{retryError.message}</p>
                        )}
                        <button
                          onClick={() => handleRetry(video.id)}
                          disabled={retryingId === video.id}
                          className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {retryingId === video.id ? 'Retrying...' : 'Retry'}
                        </button>
                      </div>
                    )}

                    {video.status === VideoStatus.RENDERED && (
                      <div className="mt-4">
                        {video.clips.length === 0 ? (
                          <p className="text-sm text-neutral-600">
                            No clips were found for this video.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {video.clips.map((clip) => (
                              <li
                                key={clip.id}
                                className="rounded-md border border-neutral-200 px-3 py-2 text-sm"
                              >
                                <div className="flex items-center justify-between">
                                  <span>
                                    {clip.startTime.toFixed(1)}s - {clip.endTime.toFixed(1)}s ·{' '}
                                    {Math.round(clip.viralityScore)}/100
                                  </span>
                                  {clip.downloadUrl ? (
                                    <a
                                      href={clipDownloadUrl(clip.downloadUrl)}
                                      className="font-medium text-neutral-900 underline"
                                    >
                                      Download
                                    </a>
                                  ) : (
                                    <span className="text-neutral-400">Rendering...</span>
                                  )}
                                </div>
                                {/* Suggested hook/hashtags from detect-clips' LLM call - read-only
                                    here, editable via the timeline editor's "Edit timeline" link. */}
                                {clip.hookText && (
                                  <p className="mt-1 italic text-neutral-600">
                                    &quot;{clip.hookText}&quot;
                                  </p>
                                )}
                                {clip.hashtags.length > 0 && (
                                  <p className="mt-1 text-neutral-500">
                                    {clip.hashtags.map((tag) => `#${tag}`).join(' ')}
                                  </p>
                                )}

                                {clip.downloadUrl &&
                                  (() => {
                                    if (!accounts || accounts.length === 0) {
                                      return (
                                        <p className="mt-2 text-xs text-neutral-400">
                                          <Link href="/accounts" className="underline">
                                            Connect an account
                                          </Link>{' '}
                                          to publish this clip.
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
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {accounts.length > 1 && (
                                          <select
                                            value={selectedId}
                                            onChange={(e) =>
                                              setSelectedAccountId((prev) => ({
                                                ...prev,
                                                [clip.id]: e.target.value,
                                              }))
                                            }
                                            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
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
                                        <button
                                          onClick={() => handlePublish(clip.id, selectedId)}
                                          disabled={busy}
                                          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium disabled:opacity-50"
                                        >
                                          {publishingClipId === clip.id
                                            ? 'Publishing...'
                                            : `Publish to ${
                                                PLATFORM_LABELS[selectedAccount.platform] ??
                                                selectedAccount.platform
                                              }`}
                                        </button>
                                        <input
                                          type="datetime-local"
                                          value={scheduleValue}
                                          onChange={(e) =>
                                            setScheduleInput((prev) => ({
                                              ...prev,
                                              [clip.id]: e.target.value,
                                            }))
                                          }
                                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                                        />
                                        <button
                                          onClick={() =>
                                            scheduleValue &&
                                            handleSchedule(clip.id, selectedId, scheduleValue)
                                          }
                                          disabled={busy || !scheduleValue}
                                          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium disabled:opacity-50"
                                        >
                                          {schedulingClipId === clip.id
                                            ? 'Scheduling...'
                                            : 'Schedule'}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                {publishError && publishError.clipId === clip.id && (
                                  <p className="mt-2 text-xs text-red-600">
                                    {publishError.message}
                                  </p>
                                )}
                                {clip.publishRecords.length > 0 && (
                                  <ul className="mt-2 space-y-2">
                                    {clip.publishRecords.map((record) => (
                                      <li key={record.id} className="text-xs text-neutral-500">
                                        {record.status === PublishStatus.SCHEDULED ? (
                                          <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span>
                                                {PLATFORM_LABELS[record.platform] ??
                                                  record.platform}
                                                : Scheduled for{' '}
                                                {record.scheduledAt
                                                  ? new Date(record.scheduledAt).toLocaleString()
                                                  : 'soon'}
                                              </span>
                                              <button
                                                onClick={() =>
                                                  handleCancelScheduled(clip.id, record.id)
                                                }
                                                disabled={cancelingRecordId === record.id}
                                                className="text-red-600 underline disabled:opacity-50"
                                              >
                                                {cancelingRecordId === record.id
                                                  ? 'Canceling...'
                                                  : 'Cancel'}
                                              </button>
                                              <button
                                                onClick={() =>
                                                  setReschedulingRecordId((prev) =>
                                                    prev === record.id ? null : record.id,
                                                  )
                                                }
                                                className="underline"
                                              >
                                                Reschedule
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
                                                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                                                />
                                                <button
                                                  onClick={() => {
                                                    const value = rescheduleInput[record.id];
                                                    if (value) {
                                                      handleReschedule(clip.id, record.id, value);
                                                    }
                                                  }}
                                                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium"
                                                >
                                                  Save
                                                </button>
                                              </div>
                                            )}
                                            {scheduleActionError &&
                                              scheduleActionError.recordId === record.id && (
                                                <p className="text-red-600">
                                                  {scheduleActionError.message}
                                                </p>
                                              )}
                                          </div>
                                        ) : (
                                          <>
                                            {PLATFORM_LABELS[record.platform] ?? record.platform}:{' '}
                                            {record.status === PublishStatus.PUBLISHED &&
                                            record.platformPostId ? (
                                              <a
                                                href={`https://youtu.be/${record.platformPostId}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="underline"
                                              >
                                                {PUBLISH_STATUS_LABELS[record.status]}
                                              </a>
                                            ) : (
                                              <span>
                                                {PUBLISH_STATUS_LABELS[record.status]}
                                                {record.status === PublishStatus.FAILED &&
                                                record.errorMessage
                                                  ? ` - ${record.errorMessage}`
                                                  : ''}
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
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
