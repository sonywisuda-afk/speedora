'use client';

import { useEffect, useRef } from 'react';
import { videoSourceUrl } from '@/lib/api';
import { useTimelineStore } from '@/lib/timelineStore';

// Sprint 5G (Review Mode) - a fixed frame-time step (1/30s, a reasonable
// assumption for typical web video - this codebase stores no per-video fps
// metadata) rather than relying on requestVideoFrameCallback, which isn't
// available in every browser this app supports. Pausing before stepping
// keeps the stepped position stable (a playing <video> would drift past it
// immediately).
const FRAME_SECONDS = 1 / 30;

export function FrameByFrameViewer({ videoId }: { videoId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playhead = useTimelineStore((s) => s.playhead);
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);

  // Sprint 5G - Review Mode's own playhead source of truth is the video
  // element's timeupdate event (same pattern as TimelineEditor), but other
  // panels (Comments' "comment at this moment," Transcript's segment
  // highlight) all read the SAME useTimelineStore.playhead - so seeking
  // from another panel needs to move this <video> element too.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - playhead) > FRAME_SECONDS) {
      video.currentTime = playhead;
    }
    // Only re-sync when playhead changes from OUTSIDE this component (e.g.
    // clicking a transcript segment) - re-running on every local
    // timeupdate would fight the video element's own playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead]);

  function step(deltaFrames: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const next = Math.max(0, video.currentTime + deltaFrames * FRAME_SECONDS);
    video.currentTime = next;
    setPlayhead(next);
  }

  return (
    <div>
      <div className="relative w-full overflow-hidden bg-bay-black" style={{ aspectRatio: '16/9' }}>
        <video
          ref={videoRef}
          src={videoSourceUrl(videoId)}
          crossOrigin="use-credentials"
          controls
          className="h-full w-full"
          onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
        />
      </div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <button
          onClick={() => step(-30)}
          className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-slate-panel"
        >
          -1s
        </button>
        <button
          onClick={() => step(-1)}
          className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-slate-panel"
        >
          -1 frame
        </button>
        <span className="min-w-[6rem] text-center font-mono text-xs text-foreground">
          {playhead.toFixed(2)}s
        </span>
        <button
          onClick={() => step(1)}
          className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-slate-panel"
        >
          +1 frame
        </button>
        <button
          onClick={() => step(30)}
          className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-slate-panel"
        >
          +1s
        </button>
      </div>
    </div>
  );
}
