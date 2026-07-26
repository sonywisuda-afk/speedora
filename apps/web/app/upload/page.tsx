'use client';

import {
  secondsToTimestamp,
  TranscriptionProvider,
  VideoStatus,
  type ProcessingOptions,
} from '@speedora/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Nav } from '@/components/Nav';
import { ProcessingSettings } from '@/components/processing-settings/ProcessingSettings';
import { ProcessingStatus } from '@/components/processing/ProcessingStatus';
import { QualityValidation } from '@/components/quality-validation/QualityValidation';
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
  startProcessing,
  uploadVideo,
  type VideoWithClipsDto,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { readBrowserVideoMetadata, type BrowserVideoMetadata } from '@/lib/video-metadata';

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

  // Quality Validation roadmap (Fase 0 design, Phase 1) - Processing
  // Settings now renders AFTER upload, once probing finishes (status
  // PENDING_SETTINGS is unambiguous). While status is still UPLOADED, width
  // stays null until probe-video.worker.ts writes it - the same "one coarse
  // status, a data field as the real sub-state signal" convention
  // transcribeProgress/importProgress already use - so this distinguishes
  // "still probing" from "a real transcribe pass in progress" (status is
  // UPLOADED again after startProcessing, this time with width populated).
  const isProbing = video?.status === VideoStatus.UPLOADED && video.width == null;
  const isPendingSettings = video?.status === VideoStatus.PENDING_SETTINGS;
  const [startingProcessing, setStartingProcessing] = useState(false);
  const [startProcessingError, setStartProcessingError] = useState<string | null>(null);

  // Quality Validation roadmap (Fase 0 design, Phase 3) - the browser tier's
  // instant preview (see lib/video-metadata.ts), read the moment a local
  // file is picked, shown only while isProbing. Best-effort/display-only -
  // never sent to the server, never blocks the real upload, and simply
  // absent for a YouTube import (no local File to read - see the Fase 0
  // design's explicit browser-vs-import asymmetry note).
  const [browserPreview, setBrowserPreview] = useState<BrowserVideoMetadata | null>(null);
  // Gates ProcessingSettings behind the QualityValidation check-list screen
  // once a video reaches PENDING_SETTINGS - reset per video, not global.
  const [validationAcknowledged, setValidationAcknowledged] = useState(false);

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
    setBrowserPreview(null);
    // Fire-and-forget - a failed/unsupported browser read just leaves the
    // preview absent (isProbing's screen still works fine without it), same
    // "best-effort, never blocks the real flow" posture as every other
    // optional preview in this codebase.
    readBrowserVideoMetadata(toUpload)
      .then(setBrowserPreview)
      .catch(() => {});

    const controller = new AbortController();
    abortControllerRef.current = controller;

    uploadVideo(toUpload, provider, {
      onProgress: setUploadProgress,
      signal: controller.signal,
    })
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
    setStartProcessingError(null);
    setBrowserPreview(null);
    setValidationAcknowledged(false);
  }

  // Quality Validation roadmap (Fase 0 design, Phase 1) - "Kembali" from
  // Processing Settings. Unlike the pre-Phase-1 flow (where "back" meant
  // "go back to EngineChoice, before any file existed"), the file/video
  // already exists at this point - abandons this upload attempt (the video
  // row is simply left sitting in PENDING_SETTINGS server-side, same as a
  // user closing the tab mid-flow at any other stage already does today)
  // and returns to file/URL selection for the same provider choice.
  function handleBackFromSettings() {
    setVideo(null);
    setFile(null);
    setUploadError(null);
    setStartProcessingError(null);
    setBrowserPreview(null);
    setValidationAcknowledged(false);
  }

  async function handleStartProcessing(options: ProcessingOptions) {
    if (!video) return;
    setStartProcessingError(null);
    setStartingProcessing(true);
    try {
      const updated = await startProcessing(video.id, options);
      setVideo(updated);
    } catch (err) {
      setStartProcessingError(
        err instanceof Error ? err.message : 'Gagal memulai pemrosesan. Coba lagi.',
      );
    } finally {
      setStartingProcessing(false);
    }
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

      {/* Quality Validation roadmap (Fase 0 design, Phase 1/3) - "still
          probing" gets its own lightweight screen rather than falling into
          ProcessingStatus's 3-stage bar, which doesn't have a slot for this
          pre-Transcribe stage. browserPreview (Phase 3's browser tier) is
          shown here as a provisional preview while the authoritative
          server-side probe is still in flight - absent for a YouTube
          import or if the browser couldn't read it. */}
      {user && !checkingAuth && video && isProbing ? (
        <div className="flex min-h-[calc(100vh-160px)] flex-col items-center justify-center px-6 py-16 text-center">
          <p className="font-mono text-2xl text-info">Menganalisis video...</p>
          <p className="mt-2 max-w-md font-body text-sm text-muted-foreground">
            Memeriksa resolusi, durasi, dan kualitas video sebelum lanjut ke pengaturan.
          </p>
          {browserPreview ? (
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              {browserPreview.width}×{browserPreview.height} ·{' '}
              {secondsToTimestamp(browserPreview.durationSeconds)} ·{' '}
              {(browserPreview.sizeBytes / 1024 ** 2).toFixed(1)} MB
            </p>
          ) : null}
        </div>
      ) : null}

      {user && !checkingAuth && video && isPendingSettings && !validationAcknowledged ? (
        <div className="px-6 py-6">
          <div className="mx-auto max-w-xl">
            <QualityValidation
              video={video}
              onContinue={() => setValidationAcknowledged(true)}
              onBack={handleBackFromSettings}
            />
          </div>
        </div>
      ) : null}

      {user && !checkingAuth && video && isPendingSettings && validationAcknowledged ? (
        <div className="px-6 py-6">
          <div className="mx-auto max-w-xl">
            {startProcessingError ? (
              <p className="mb-4 font-body text-sm text-destructive">{startProcessingError}</p>
            ) : null}
            <ProcessingSettings
              onReady={handleStartProcessing}
              onBack={() => setValidationAcknowledged(false)}
              submitting={startingProcessing}
            />
          </div>
        </div>
      ) : null}

      {user && !checkingAuth && video && !isProbing && !isPendingSettings ? (
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
