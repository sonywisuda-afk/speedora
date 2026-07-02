import { VideoStatus } from '@viral-clip-app/shared';

export const STEPS: VideoStatus[] = [
  VideoStatus.UPLOADED,
  VideoStatus.TRANSCRIBED,
  VideoStatus.CLIPS_DETECTED,
  VideoStatus.RENDERED,
];

export const STEP_LABELS: Record<VideoStatus, string> = {
  [VideoStatus.UPLOADED]: 'Uploaded',
  [VideoStatus.TRANSCRIBED]: 'Transcribed',
  [VideoStatus.CLIPS_DETECTED]: 'Clips detected',
  [VideoStatus.RENDERED]: 'Rendered',
  [VideoStatus.FAILED]: 'Failed',
};

export function ProgressSteps({ status }: { status: VideoStatus }) {
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
