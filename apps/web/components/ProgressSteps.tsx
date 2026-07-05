import { VideoStatus } from '@speedora/shared';

export const STEPS: VideoStatus[] = [
  VideoStatus.UPLOADED,
  VideoStatus.TRANSCRIBED,
  VideoStatus.CLIPS_DETECTED,
  VideoStatus.RENDERED,
];

export const STEP_LABELS: Record<VideoStatus, string> = {
  // Only reachable for a video imported via YouTube URL (Fase 7) - not part
  // of STEPS below since it's a pre-pipeline stage, not one of the 3
  // Transcribe/Auto-Clip/Render steps every video (imported or uploaded
  // directly) goes through identically once it has a real sourceUrl.
  [VideoStatus.IMPORTING]: 'Mengunduh dari YouTube...',
  [VideoStatus.UPLOADED]: 'Diupload',
  [VideoStatus.TRANSCRIBED]: 'Transkrip Selesai',
  [VideoStatus.CLIPS_DETECTED]: 'Klip Terdeteksi',
  [VideoStatus.RENDERED]: 'Selesai Dirender',
  [VideoStatus.FAILED]: 'Gagal',
};

export function ProgressSteps({ status }: { status: VideoStatus }) {
  if (status === VideoStatus.FAILED) {
    return <p className="text-sm font-medium text-destructive">{STEP_LABELS[VideoStatus.FAILED]}</p>;
  }
  if (status === VideoStatus.IMPORTING) {
    return (
      <p className="text-sm font-medium text-signal-cyan">{STEP_LABELS[VideoStatus.IMPORTING]}</p>
    );
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol className="flex flex-wrap items-center gap-2 font-body text-sm">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span className={index <= currentIndex ? 'font-medium text-foreground' : 'text-muted-foreground'}>
            {STEP_LABELS[step]}
          </span>
          {index < STEPS.length - 1 && (
            <span className="text-muted-foreground" aria-hidden="true">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
