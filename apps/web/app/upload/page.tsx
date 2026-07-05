'use client';

import { TranscriptionProvider, VideoStatus } from '@speedora/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Nav } from '@/components/Nav';
import { ProcessingStatus } from '@/components/processing/ProcessingStatus';
import { AuthGate } from '@/components/upload/AuthGate';
import { EngineChoice } from '@/components/upload/EngineChoice';
import { ForgotPasswordForm } from '@/components/upload/ForgotPasswordForm';
import { ImportTabs } from '@/components/upload/ImportTabs';
import { UploadErrorPanel } from '@/components/upload/UploadErrorPanel';
import { UploadProgress } from '@/components/upload/UploadProgress';
import {
  forgotPassword,
  getVideo,
  importYoutubeVideo,
  login,
  register,
  retryVideo,
  uploadVideo,
  type VideoWithClipsDto,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

const POLL_INTERVAL_MS = 2000;

export default function UploadPage() {
  const { user, setUser, checkingAuth, logout } = useAuth();

  const [authView, setAuthView] = useState<'login' | 'register' | 'forgot-password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Chosen fresh per video via EngineChoice, reset back to null once a full
  // upload/import cycle finishes (handleUploadAnother) - never persisted as
  // an account-level setting.
  const [provider, setProvider] = useState<TranscriptionProvider | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importingUrl, setImportingUrl] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

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
        authView === 'login' ? await login(email, password) : await register(email, password);
      setUser(authedUser);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);
    setForgotSubmitting(true);
    try {
      const { message } = await forgotPassword(forgotEmail);
      setForgotMessage(message);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setForgotSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    setVideo(null);
    setFile(null);
    setEmail('');
    setPassword('');
  }

  function startUpload(toUpload: File) {
    if (!provider) return;
    setFile(toUpload);
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    uploadVideo(toUpload, provider, { onProgress: setUploadProgress, signal: controller.signal })
      .then((uploaded) => {
        setVideo({ ...uploaded, clips: [] });
        setFile(null);
        setUploading(false);
      })
      .catch((err) => {
        setUploading(false);
        if (err instanceof DOMException && err.name === 'AbortError') {
          setFile(null);
          return;
        }
        setUploadError(err instanceof Error ? err.message : 'Upload gagal. Coba lagi.');
      });
  }

  function handleCancelUpload() {
    abortControllerRef.current?.abort();
  }

  function handleYoutubeImport(url: string) {
    if (!provider) return;
    setUploadError(null);
    setImportingUrl(true);

    importYoutubeVideo(url, provider)
      .then((imported) => {
        setVideo({ ...imported, clips: [] });
      })
      .catch((err) => {
        setUploadError(err instanceof Error ? err.message : 'Import gagal. Coba lagi.');
      })
      .finally(() => {
        setImportingUrl(false);
      });
  }

  function handleRetryUpload() {
    if (file) startUpload(file);
  }

  function handleChooseAnother() {
    setFile(null);
    setUploadError(null);
  }

  function handleUploadAnother() {
    setVideo(null);
    setFile(null);
    setUploadError(null);
    setProvider(null);
  }

  async function handleRetryPipeline() {
    if (!video) return;
    setRetryError(null);
    setRetrying(true);
    try {
      const updated = await retryVideo(video.id);
      setVideo(updated);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Gagal menjalankan ulang.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="px-6 pt-12">
        <div className="mx-auto max-w-xl">
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Speedora
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Upload video kamu dan dapatkan klip pendek siap-viral secara otomatis.
          </p>

          {checkingAuth ? null : !user ? (
            <div className="mt-8">
              {authView === 'forgot-password' ? (
                <ForgotPasswordForm
                  email={forgotEmail}
                  submitting={forgotSubmitting}
                  message={forgotMessage}
                  error={forgotError}
                  onEmailChange={setForgotEmail}
                  onSubmit={handleForgotSubmit}
                  onBack={() => {
                    setAuthView('login');
                    setForgotMessage(null);
                    setForgotError(null);
                  }}
                />
              ) : (
                <AuthGate
                  mode={authView}
                  email={email}
                  password={password}
                  submitting={authSubmitting}
                  error={authError}
                  onEmailChange={setEmail}
                  onPasswordChange={setPassword}
                  onSubmit={handleAuthSubmit}
                  onToggleMode={() => {
                    setAuthView(authView === 'login' ? 'register' : 'login');
                    setAuthError(null);
                  }}
                  onForgotPassword={() => {
                    setForgotEmail(email);
                    setAuthView('forgot-password');
                  }}
                />
              )}
            </div>
          ) : (
            <Nav user={user} onLogout={handleLogout} />
          )}
        </div>
      </div>

      {user && !checkingAuth && !video ? (
        <div className="px-6 py-6">
          <div className="mx-auto max-w-xl">
            {!provider ? (
              <EngineChoice onReady={setProvider} />
            ) : uploading ? (
              <UploadProgress
                file={file!}
                progress={uploadProgress}
                onCancel={handleCancelUpload}
              />
            ) : uploadError ? (
              <UploadErrorPanel
                message={uploadError}
                onRetry={file ? handleRetryUpload : undefined}
                onChooseAnother={handleChooseAnother}
              />
            ) : (
              <ImportTabs
                onFileAccepted={startUpload}
                onFileRejected={setUploadError}
                onImport={handleYoutubeImport}
                importing={importingUrl}
              />
            )}
          </div>
        </div>
      ) : null}

      {user && !checkingAuth && video ? (
        <ProcessingStatus
          video={video}
          retrying={retrying}
          retryError={retryError}
          onRetry={handleRetryPipeline}
          onUploadAnother={handleUploadAnother}
        />
      ) : null}
    </main>
  );
}
