'use client';

import { useTimelineStore } from '@/lib/timelineStore';

const EMOTION_LABELS: Record<string, string> = {
  neu: 'Netral',
  hap: 'Senang',
  ang: 'Marah',
  sad: 'Sedih',
};

// Sprint 5G (Review Mode) - read-only transcript walkthrough, click a
// segment to seek (shared useTimelineStore.playhead, same source
// FrameByFrameViewer/CommentsPanel already read/write). No new data - the
// transcript was already loaded into the store by the Review Mode shell's
// own load() call, same as the Timeline Editor.
export function TranscriptReviewPanel() {
  const transcript = useTimelineStore((s) => s.transcript);
  const playhead = useTimelineStore((s) => s.playhead);
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);

  if (transcript.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Transkrip tidak tersedia.</p>;
  }

  return (
    <ul className="max-h-96 space-y-1 overflow-y-auto">
      {transcript.map((segment, i) => {
        const active = playhead >= segment.start && playhead < segment.end;
        return (
          <li key={i}>
            <button
              onClick={() => setPlayhead(segment.start)}
              className={`w-full rounded-md px-2 py-1.5 text-left font-body text-sm ${
                active ? 'bg-signal-pink/10 text-signal-pink' : 'text-foreground hover:bg-slate-panel'
              }`}
            >
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                {segment.start.toFixed(1)}s
              </span>
              {segment.speaker && (
                <span className="mr-2 font-mono text-xs text-chrome">{segment.speaker}</span>
              )}
              {segment.text}
              {segment.emotion && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({EMOTION_LABELS[segment.emotion] ?? segment.emotion})
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
