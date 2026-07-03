'use client';

import { VideoStatus } from '@viral-clip-app/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Nav } from '../../components/Nav';
import { ProgressSteps } from '../../components/ProgressSteps';
import { clipDownloadUrl, listVideos, retryVideo, type VideoWithClipsDto } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

const POLL_INTERVAL_MS = 2000;

function isTerminal(status: VideoStatus): boolean {
  return status === VideoStatus.RENDERED || status === VideoStatus.FAILED;
}

export default function Dashboard() {
  const { user, checkingAuth, logout } = useAuth();
  const [videos, setVideos] = useState<VideoWithClipsDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ videoId: string; message: string } | null>(null);
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
