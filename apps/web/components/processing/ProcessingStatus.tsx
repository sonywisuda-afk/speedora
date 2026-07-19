'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { VideoStatus } from '@speedora/shared';

import { ClipGrid } from '@/components/gallery/ClipGrid';
import { StagePanel, type StageState } from '@/components/processing/StagePanel';
import { LiveReel } from '@/components/signature/LiveReel';
import { Button } from '@/components/ui/button';
import type { VideoWithClipsDto } from '@/lib/api';
import { cn } from '@/lib/utils';

// Matches the landing page's "Cara Kerja" step names (HowItWorks.tsx) so the
// same 3-stage pipeline reads as one consistent mental model end to end.
const STAGES = [
  { status: VideoStatus.UPLOADED, label: 'Transcribe', activeCopy: 'Mentranskrip audio' },
  { status: VideoStatus.TRANSCRIBED, label: 'Auto-Clip', activeCopy: 'Mendeteksi momen menarik' },
  {
    status: VideoStatus.CLIPS_DETECTED,
    label: 'Render & Caption',
    activeCopy: 'Merender & menulis caption',
  },
] as const;

const STAGE_ORDER = [
  VideoStatus.UPLOADED,
  VideoStatus.TRANSCRIBED,
  VideoStatus.CLIPS_DETECTED,
  VideoStatus.RENDERED,
];

// How often the displayed progress creeps +1% toward the current stage's
// ceiling while waiting for the next real checkpoint (see displayedPercent).
const CREEP_INTERVAL_MS = 1000;

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function ProcessingStatus({
  video,
  retrying,
  retryError,
  onRetry,
  onUploadAnother,
}: {
  video: VideoWithClipsDto;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onUploadAnother: () => void;
}) {
  const isImporting = video.status === VideoStatus.IMPORTING;
  const isFailed = video.status === VideoStatus.FAILED;
  const isDone = video.status === VideoStatus.RENDERED;

  // FAILED doesn't carry "which stage" on its own - the last real,
  // non-FAILED status we observed IS the stage that was running when it
  // failed, since polling always sees a job's start status before its
  // terminal one within this session.
  const lastActiveStatusRef = useRef<VideoStatus>(isFailed ? VideoStatus.UPLOADED : video.status);
  useEffect(() => {
    if (video.status !== VideoStatus.FAILED) lastActiveStatusRef.current = video.status;
  }, [video.status]);
  const effectiveStatus = isFailed ? lastActiveStatusRef.current : video.status;
  // IMPORTING isn't one of the 3 STAGES (Transcribe/Auto-Clip/Render) - a
  // video imported from YouTube that fails before the download ever
  // finishes has effectiveStatus === IMPORTING here, which STAGE_ORDER
  // doesn't contain at all (see STAGE_ORDER below).
  const failedDuringImport = isFailed && effectiveStatus === VideoStatus.IMPORTING;
  const currentIndex = STAGE_ORDER.indexOf(effectiveStatus);
  const stageSpanPercent = 100 / (STAGE_ORDER.length - 1);
  const baseProgressPercent = currentIndex === -1 ? 0 : currentIndex * stageSpanPercent;
  // Real backend-reported progress (apps/worker's transcribe.worker.ts
  // writes checkpoints to Video.transcribeProgress - never a fabricated
  // animation) filling in this stage's slice of the bar, rather than
  // sitting flat at baseProgressPercent for the whole Transcribe stage.
  const withinStageProgress =
    !isFailed && effectiveStatus === VideoStatus.UPLOADED && video.transcribeProgress != null
      ? (video.transcribeProgress / 100) * stageSpanPercent
      : 0;
  // Render & Caption stage progress is real too, and already in the polled
  // payload: each clip's downloadUrl flips non-null as its render-clip job
  // finishes, so "2 of 3 clips rendered" fills 2/3 of this stage's slice.
  const renderStageProgress =
    !isFailed && effectiveStatus === VideoStatus.CLIPS_DETECTED && video.clips.length > 0
      ? (video.clips.filter((clip) => clip.downloadUrl !== null).length / video.clips.length) *
        stageSpanPercent
      : 0;
  const progressPercent = baseProgressPercent + withinStageProgress + renderStageProgress;

  // What the bar actually shows: real checkpoints are the floor (the bar
  // jumps up to them the moment they arrive and never rolls back), and
  // between checkpoints it advances +1% per tick so the user sees steady
  // movement instead of long flat stretches. The creep is capped 1% below
  // the current stage's end - only a real status change from the backend
  // unlocks the boundary, so the bar can never claim a stage finished that
  // didn't.
  const creepCeiling = Math.min(99, baseProgressPercent + stageSpanPercent - 1);
  const [displayedPercent, setDisplayedPercent] = useState(0);
  useEffect(() => {
    if (isDone || isFailed) return;
    const interval = setInterval(() => {
      setDisplayedPercent((current) => {
        const floor = Math.max(current, progressPercent);
        return floor < creepCeiling ? Math.min(creepCeiling, floor + 1) : floor;
      });
    }, CREEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isDone, isFailed, progressPercent, creepCeiling]);

  // Same real-checkpoint-floor-plus-1%-creep pattern as displayedPercent
  // above, scoped to the IMPORTING stage - it's a standalone screen (not
  // one of the 3 STAGES/STAGE_ORDER entries), so it gets its own 0-99
  // range rather than a slice of the multi-stage bar. Real percentages
  // come from yt-dlp's own download progress (see
  // import-youtube.worker.ts's reportProgress) - a large video on a slow/
  // variable connection can legitimately sit at one number for a while;
  // the creep exists so that wait doesn't read as a dead screen.
  const importProgressPercent = video.importProgress ?? 0;
  const [importDisplayedPercent, setImportDisplayedPercent] = useState(0);
  useEffect(() => {
    if (!isImporting) return;
    const interval = setInterval(() => {
      setImportDisplayedPercent((current) => {
        const floor = Math.max(current, importProgressPercent);
        return floor < 99 ? Math.min(99, floor + 1) : floor;
      });
    }, CREEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isImporting, importProgressPercent]);

  // Real elapsed wall-clock time since this screen started watching the
  // job - a ticking clock, not a progress fabrication. Freezes once the
  // job reaches a terminal state.
  const startedAtRef = useRef(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (isDone || isFailed) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isDone, isFailed]);

  // Only meaningful once isImporting/isDone/failedDuringImport are all
  // ruled out - at that point video.status is necessarily one of the 3
  // STAGES entries, so currentIndex is guaranteed 0-2, never -1.
  const activeStage = currentIndex >= 0 ? STAGES[currentIndex] : null;

  return (
    <div className="flex min-h-[calc(100vh-160px)] flex-col items-center justify-center bg-bay-black px-6 py-16">
      <div className={cn('w-full', isDone ? 'max-w-5xl' : 'max-w-2xl')}>
        <p className="text-center font-mono text-xs text-muted-foreground">VIDEO {video.id}</p>

        {isFailed ? (
          <div className="mt-8 flex flex-col items-center text-center">
            <AlertTriangle className="h-16 w-16 text-destructive" aria-hidden="true" />
            <h2 className="mt-6 font-display text-3xl uppercase tracking-wide text-foreground">
              Pemrosesan Gagal
            </h2>
            <p className="mt-3 max-w-md font-body text-muted-foreground">
              {failedDuringImport ? (
                <>Gagal mengunduh video dari YouTube. Coba jalankan ulang.</>
              ) : (
                <>
                  Terjadi kesalahan saat tahap{' '}
                  <span className="font-medium text-destructive">{activeStage?.label}</span>. Coba
                  jalankan ulang tahap ini.
                </>
              )}
            </p>
            {retryError ? (
              <p className="mt-2 font-body text-sm text-destructive">{retryError}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" disabled={retrying} onClick={onRetry}>
                {retrying ? 'Menjalankan Ulang...' : 'Jalankan Ulang'}
              </Button>
              <Button size="lg" variant="outline" onClick={onUploadAnother}>
                Upload Video Lain
              </Button>
            </div>

            {!failedDuringImport && (
              // TODO(UI backlog, Stabilization Pass Area 4 Visual QA): fixed
              // grid-cols-3 with no mobile breakpoint - unlike the rest of
              // this app's stat/summary grids (e.g. apps/web/app/analytics/
              // page.tsx's `sm:grid-cols-2 lg:grid-cols-4`), this squeezes on
              // a narrow phone viewport instead of stacking. Same issue at
              // line ~260 below and in apps/web/app/campaigns/[id]/page.tsx.
              // Not fixed yet - flagged only, approved to stay as backlog.
              <div className="mt-12 grid w-full grid-cols-3 gap-4">
                {STAGES.map((stage, i) => (
                  <StagePanel
                    key={stage.status}
                    label={stage.label}
                    state={
                      i < currentIndex
                        ? 'complete'
                        : i === currentIndex
                          ? 'failed'
                          : ('pending' as StageState)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : isDone ? (
          <div className="mt-8 flex flex-col items-center text-center">
            <CheckCircle2 className="h-16 w-16 text-signal-cyan" aria-hidden="true" />
            <h2 className="mt-6 font-display text-3xl uppercase tracking-wide text-foreground">
              Klip Siap
            </h2>
            <p className="mt-2 font-mono text-sm text-muted-foreground">
              Selesai dalam {formatElapsed(elapsedSeconds)} — {video.clips.length} klip ditemukan
            </p>

            <div className="mt-10 w-full">
              <LiveReel variant="progress" progress={100} label="Selesai" />
            </div>

            <div className="mt-8 w-full text-left">
              <ClipGrid videoId={video.id} clips={video.clips} />
            </div>

            <Button variant="ghost" size="sm" className="mt-8" onClick={onUploadAnother}>
              Upload Video Lain
            </Button>
          </div>
        ) : isImporting ? (
          <div className="mt-8 flex flex-col items-center text-center">
            <p className="font-mono text-2xl text-signal-cyan">
              Mengunduh dari YouTube... {formatElapsed(elapsedSeconds)}
            </p>
            <p className="mt-2 font-body text-sm text-muted-foreground">
              Video besar di koneksi yang lambat bisa makan waktu - setelah unduhan selesai, video
              masuk ke pipeline yang sama seperti upload langsung.
            </p>
            <div className="mt-10 w-full">
              <LiveReel
                variant="progress"
                progress={importDisplayedPercent}
                label="Mengunduh dari YouTube"
              />
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <p className="text-center font-mono text-2xl text-signal-cyan">
              Memproses... {formatElapsed(elapsedSeconds)}
            </p>

            <div className="mt-10">
              <LiveReel
                variant="progress"
                progress={displayedPercent}
                label={activeStage?.activeCopy}
              />
            </div>

            {/* TODO(UI backlog, Stabilization Pass Area 4): same missing-breakpoint issue as line ~190 above. */}
            <div className="mt-12 grid grid-cols-3 gap-4">
              {STAGES.map((stage, i) => (
                <StagePanel
                  key={stage.status}
                  label={stage.label}
                  state={
                    i < currentIndex
                      ? 'complete'
                      : i === currentIndex
                        ? 'active'
                        : ('pending' as StageState)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
