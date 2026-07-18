'use client';

import type { Clip } from '@speedora/shared';
import { useTimelineStore } from '@/lib/timelineStore';

const EMOTION_LABELS: Record<string, string> = {
  neu: 'Netral',
  hap: 'Senang',
  ang: 'Marah',
  sad: 'Sedih',
  sur: 'Terkejut',
  fea: 'Takut',
  dis: 'Jijik',
};

function dominantEmotions(samples: Clip['facialEmotions']): string {
  if (!samples || samples.length === 0) return 'Tidak ada data wajah';
  const counts = new Map<string, number>();
  for (const s of samples) {
    if (!s.emotion) continue;
    counts.set(s.emotion, (counts.get(s.emotion) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Wajah terdeteksi, emosi tidak terklasifikasi';
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return sorted
    .slice(0, 3)
    .map(([emotion, count]) => `${EMOTION_LABELS[emotion] ?? emotion} (${count})`)
    .join(', ');
}

function onScreenRatio(landmarks: Clip['faceLandmarks']): string {
  if (!landmarks || landmarks.length === 0) return '—';
  const withFace = landmarks.filter((l) => l.boundingBox !== null).length;
  return `${Math.round((withFace / landmarks.length) * 100)}%`;
}

// Sprint 5G (Review Mode) - purely a read-only presentation of Face
// Intelligence signals the frozen AI pipeline already computed
// (facialEmotions/faceLandmarks, wired into the Fusion Engine at weight 0
// - see docs/ai/vision.md). No new detection logic - this panel exists
// because Face Intelligence had no review UI anywhere in the app before
// this. Clicking a clip seeks Frame-by-Frame/the video player to its start
// via the shared useTimelineStore.playhead.
export function FaceReviewPanel({ clips }: { clips: Clip[] }) {
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);

  if (clips.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada klip.</p>;
  }

  return (
    <div className="space-y-2">
      {clips.map((clip) => (
        <button
          key={clip.id}
          onClick={() => setPlayhead(clip.startTime)}
          className="block w-full rounded-md border border-border bg-slate-panel p-3 text-left font-body text-sm hover:border-signal-pink/40"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {clip.startTime.toFixed(1)}s–{clip.endTime.toFixed(1)}s
            </span>
            <span className="font-mono text-xs text-chrome">
              Wajah di layar: {onScreenRatio(clip.faceLandmarks)}
            </span>
          </div>
          <p className="mt-1 text-foreground">{dominantEmotions(clip.facialEmotions)}</p>
        </button>
      ))}
    </div>
  );
}
