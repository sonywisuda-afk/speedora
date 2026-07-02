'use client';

import { VideoStatus } from '@viral-clip-app/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  clipDownloadUrl,
  getVideo,
  resolveUser,
  uploadVideo,
  type VideoWithClipsDto,
} from '../lib/api';

const USER_STORAGE_KEY = 'viral-clip-app:userId';
const USER_EMAIL_STORAGE_KEY = 'viral-clip-app:userEmail';
const POLL_INTERVAL_MS = 2000;

const STEPS: VideoStatus[] = [
  VideoStatus.UPLOADED,
  VideoStatus.TRANSCRIBED,
  VideoStatus.CLIPS_DETECTED,
  VideoStatus.RENDERED,
];

const STEP_LABELS: Record<VideoStatus, string> = {
  [VideoStatus.UPLOADED]: 'Uploaded',
  [VideoStatus.TRANSCRIBED]: 'Transcribed',
  [VideoStatus.CLIPS_DETECTED]: 'Clips detected',
  [VideoStatus.RENDERED]: 'Rendered',
  [VideoStatus.FAILED]: 'Failed',
};

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resolvingUser, setResolvingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedUserId = localStorage.getItem(USER_STORAGE_KEY);
    const storedEmail = localStorage.getItem(USER_EMAIL_STORAGE_KEY);
    if (storedUserId) setUserId(storedUserId);
    if (storedEmail) setEmail(storedEmail);
  }, []);

  useEffect(() => {
    if (!video || video.status === VideoStatus.RENDERED || video.status === VideoStatus.FAILED) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const updated = await getVideo(video.id);
        setVideo(updated);
      } catch {
        // transient poll failure - try again on the next tick
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [video]);

  async function handleResolveUser(e: FormEvent) {
    e.preventDefault();
    setUserError(null);
    setResolvingUser(true);
    try {
      const user = await resolveUser(email);
      localStorage.setItem(USER_STORAGE_KEY, user.id);
      localStorage.setItem(USER_EMAIL_STORAGE_KEY, user.email);
      setUserId(user.id);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Could not resolve user');
    } finally {
      setResolvingUser(false);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !userId) return;

    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadVideo(userId, file);
      setVideo({ ...uploaded, clips: [] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleReset() {
    setVideo(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">viral-clip-app</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Upload a video and get auto-clipped, captioned highlights.
        </p>

        {!userId ? (
          <form
            onSubmit={handleResolveUser}
            className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <label htmlFor="email" className="block text-sm font-medium">
              Your email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
            {userError && <p className="mt-2 text-sm text-red-600">{userError}</p>}
            <button
              type="submit"
              disabled={resolvingUser}
              className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {resolvingUser ? 'Continuing...' : 'Continue'}
            </button>
          </form>
        ) : (
          <>
            <p className="mt-6 text-sm text-neutral-600">
              Signed in as <span className="font-medium">{email}</span>
            </p>

            {!video ? (
              <form
                onSubmit={handleUpload}
                className="mt-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
              >
                <label htmlFor="file" className="block text-sm font-medium">
                  Video file
                </label>
                <input
                  id="file"
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  required
                  className="mt-2 w-full text-sm"
                />
                {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
                <button
                  type="submit"
                  disabled={uploading}
                  className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </form>
            ) : (
              <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
                <ProgressSteps status={video.status} />

                {video.status === VideoStatus.FAILED && (
                  <p className="mt-4 text-sm text-red-600">
                    Something went wrong processing this video.
                  </p>
                )}

                {video.status === VideoStatus.RENDERED && (
                  <div className="mt-6">
                    <h2 className="text-sm font-medium">Clips</h2>
                    {video.clips.length === 0 ? (
                      <p className="mt-2 text-sm text-neutral-600">
                        No clips were found for this video.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {video.clips.map((clip) => (
                          <li
                            key={clip.id}
                            className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
                          >
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
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <button
                  onClick={handleReset}
                  className="mt-6 text-sm font-medium text-neutral-600 underline"
                >
                  Upload another video
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ProgressSteps({ status }: { status: VideoStatus }) {
  if (status === VideoStatus.FAILED) {
    return <p className="text-sm font-medium text-red-600">{STEP_LABELS[VideoStatus.FAILED]}</p>;
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className={index <= currentIndex ? 'font-medium text-neutral-900' : 'text-neutral-400'}
          >
            {STEP_LABELS[step]}
          </span>
          {index < STEPS.length - 1 && <span className="text-neutral-300">→</span>}
        </li>
      ))}
    </ol>
  );
}
