'use client';

import { VideoStatus } from '@viral-clip-app/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Nav } from '../components/Nav';
import { ProgressSteps } from '../components/ProgressSteps';
import {
  clipDownloadUrl,
  getVideo,
  login,
  register,
  retryVideo,
  uploadVideo,
  type VideoWithClipsDto,
} from '../lib/api';
import { useAuth } from '../lib/useAuth';

const POLL_INTERVAL_MS = 2000;

export default function Home() {
  const { user, setUser, checkingAuth, logout } = useAuth();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const authedUser =
        authMode === 'login' ? await login(email, password) : await register(email, password);
      setUser(authedUser);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    setVideo(null);
    setEmail('');
    setPassword('');
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadVideo(file);
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

  async function handleRetry() {
    if (!video) return;
    setRetryError(null);
    setRetrying(true);
    try {
      const updated = await retryVideo(video.id);
      setVideo(updated);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">viral-clip-app</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Upload a video and get auto-clipped, captioned highlights.
        </p>

        {checkingAuth ? null : !user ? (
          <form
            onSubmit={handleAuthSubmit}
            className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-sm font-medium">
              {authMode === 'login' ? 'Log in' : 'Create an account'}
            </h2>

            <label htmlFor="email" className="mt-4 block text-sm font-medium">
              Email
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

            <label htmlFor="password" className="mt-4 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="At least 8 characters"
            />

            {authError && <p className="mt-2 text-sm text-red-600">{authError}</p>}

            <button
              type="submit"
              disabled={authSubmitting}
              className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {authSubmitting ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Register'}
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError(null);
              }}
              className="mt-4 block text-sm text-neutral-600 underline"
            >
              {authMode === 'login'
                ? "Don't have an account? Register"
                : 'Already have an account? Log in'}
            </button>
          </form>
        ) : (
          <>
            <Nav user={user} onLogout={handleLogout} />

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
                  <div className="mt-4">
                    <p className="text-sm text-red-600">
                      Something went wrong processing this video.
                    </p>
                    {retryError && <p className="mt-2 text-sm text-red-600">{retryError}</p>}
                    <button
                      onClick={handleRetry}
                      disabled={retrying}
                      className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {retrying ? 'Retrying...' : 'Retry'}
                    </button>
                  </div>
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
