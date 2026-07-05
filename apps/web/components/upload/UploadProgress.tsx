import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LiveReel } from '@/components/signature/LiveReel';

// Real XHR upload.onprogress events are sparse - especially on a fast/local
// connection, the browser may only fire two or three of them for a whole
// upload (e.g. straight from 0% to 74% to 100%), which reads as the bar
// jumping rather than counting up. This ticks the displayed percentage up
// by 1 every STEP_MS toward the latest real value (read via a ref so the
// interval doesn't need to restart every time real progress ticks), so the
// user always sees every 1% step in order - never a value ahead of the real
// underlying progress, just a smoothed climb toward it.
const STEP_MS = 12;

function useSmoothedProgress(target: number): number {
  const [displayed, setDisplayed] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayed((prev) => {
        const clampedTarget = Math.floor(Math.min(100, Math.max(0, targetRef.current)));
        return prev < clampedTarget ? prev + 1 : prev;
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, []);

  return displayed;
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

export function UploadProgress({
  file,
  progress,
  onCancel,
}: {
  file: File;
  progress: number;
  onCancel: () => void;
}) {
  const displayedProgress = useSmoothedProgress(progress);

  return (
    <div className="rounded-lg border border-border bg-slate-panel p-6">
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 pl-3">{formatSize(file.size)}</span>
      </div>

      <div className="mt-4">
        <LiveReel variant="progress" progress={displayedProgress} label="Mengupload video" />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Batalkan Upload
        </Button>
      </div>
    </div>
  );
}
