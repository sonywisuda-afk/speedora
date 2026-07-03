'use client';

import { CAPTION_STYLES, type CaptionStyle } from '@viral-clip-app/shared';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { clipDownloadUrl, videoSourceUrl } from '../lib/api';
import { useTimelineStore, type TimelineClip } from '../lib/timelineStore';

// Guards against a drag collapsing a clip to zero/negative length. The
// backend also validates startTime < endTime independently (ClipsService.update).
const MIN_CLIP_SECONDS = 1;

// Human-readable labels for the CAPTION_STYLES preset enum - order matches
// the <select> option order below.
const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  DEFAULT: 'Default',
  KARAOKE: 'Karaoke (word-synced highlight)',
  BOLD_HIGHLIGHT: 'Bold highlight (keywords)',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Free-text "one input, space/comma separated" editing for hashtags, rather
// than a chip/tag-picker widget - simplest UI that still round-trips
// cleanly with the plain string[] the API stores.
function parseHashtagsInput(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter((tag) => tag.length > 0);
}

export function TimelineEditor({ videoId }: { videoId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const duration = useTimelineStore((s) => s.duration);
  const setDuration = useTimelineStore((s) => s.setDuration);
  const playhead = useTimelineStore((s) => s.playhead);
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);
  const clips = useTimelineStore((s) => s.clips);
  const transcript = useTimelineStore((s) => s.transcript);
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const setClipRange = useTimelineStore((s) => s.setClipRange);
  const setCaptionStyle = useTimelineStore((s) => s.setCaptionStyle);
  const setHookText = useTimelineStore((s) => s.setHookText);
  const setHashtags = useTimelineStore((s) => s.setHashtags);
  const saveClip = useTimelineStore((s) => s.saveClip);
  const renderClip = useTimelineStore((s) => s.renderClip);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  // Caption overlay is a best-effort approximation of the FFmpeg libass
  // burn-in (bold white text, black outline, bottom-center) - not a pixel
  // match, and doesn't attempt to preview the KARAOKE/BOLD_HIGHLIGHT presets'
  // per-word styling (same "approximate is fine" call as Fase 1's plain
  // preview). Redrawn every frame while playing so it tracks currentTime
  // smoothly during scrubbing, not just on the ~4/sec `timeupdate` event.
  useEffect(() => {
    let raf: number;

    function draw() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const active = transcript.find(
            (seg) => video.currentTime >= seg.start && video.currentTime < seg.end,
          );
          if (active && canvas.width > 0) {
            const fontSize = Math.max(16, Math.round(canvas.height * 0.06));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const x = canvas.width / 2;
            const y = canvas.height - fontSize * 0.75;
            ctx.lineWidth = Math.max(2, fontSize * 0.15);
            ctx.strokeStyle = 'black';
            ctx.strokeText(active.text, x, y);
            ctx.fillStyle = 'white';
            ctx.fillText(active.text, x, y);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [transcript]);

  function handleLoadedMetadata() {
    if (videoRef.current) setDuration(videoRef.current.duration);
  }

  function handleTimeUpdate() {
    if (videoRef.current) setPlayhead(videoRef.current.currentTime);
  }

  function timeFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function seekTo(time: number) {
    if (videoRef.current) videoRef.current.currentTime = time;
    setPlayhead(time);
  }

  function startHandleDrag(clip: TimelineClip, edge: 'start' | 'end') {
    return (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectClip(clip.id);

      function onMove(moveEvent: PointerEvent) {
        const t = timeFromClientX(moveEvent.clientX);
        if (edge === 'start') {
          const newStart = Math.max(0, Math.min(t, clip.endTime - MIN_CLIP_SECONDS));
          setClipRange(clip.id, newStart, clip.endTime);
          seekTo(newStart);
        } else {
          const newEnd = Math.min(duration, Math.max(t, clip.startTime + MIN_CLIP_SECONDS));
          setClipRange(clip.id, clip.startTime, newEnd);
          seekTo(newEnd);
        }
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
  }

  return (
    <div>
      <div
        className="relative w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: '16/9' }}
      >
        <video
          ref={videoRef}
          src={videoSourceUrl(videoId)}
          crossOrigin="use-credentials"
          controls
          className="h-full w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div className="mt-4">
        <div
          ref={trackRef}
          className="relative h-10 w-full cursor-pointer rounded bg-neutral-200"
          onClick={(e) => seekTo(timeFromClientX(e.clientX))}
        >
          {duration > 0 && (
            <div
              className="pointer-events-none absolute top-0 h-full w-0.5 bg-red-500"
              style={{ left: `${(playhead / duration) * 100}%` }}
            />
          )}
          {duration > 0 &&
            clips.map((clip) => {
              const left = (clip.startTime / duration) * 100;
              const width = ((clip.endTime - clip.startTime) / duration) * 100;
              const isSelected = clip.id === selectedClipId;
              return (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectClip(clip.id);
                  }}
                  className={`absolute top-1 h-8 rounded ${
                    isSelected ? 'bg-neutral-900' : 'bg-neutral-400'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {isSelected && (
                    <>
                      <div
                        onPointerDown={startHandleDrag(clip, 'start')}
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white"
                      />
                      <div
                        onPointerDown={startHandleDrag(clip, 'end')}
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white"
                      />
                    </>
                  )}
                </div>
              );
            })}
        </div>

        <div className="relative mt-2 h-6 w-full">
          {selectedClip &&
            duration > 0 &&
            transcript
              .filter((seg) => seg.end > selectedClip.startTime && seg.start < selectedClip.endTime)
              .map((seg, i) => {
                const segStart = Math.max(seg.start, selectedClip.startTime);
                const segEnd = Math.min(seg.end, selectedClip.endTime);
                const left = (segStart / duration) * 100;
                const width = ((segEnd - segStart) / duration) * 100;
                return (
                  <div
                    key={i}
                    title={seg.text}
                    className="absolute h-6 truncate rounded bg-blue-200 px-1 text-[10px] leading-6 text-blue-900"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {seg.text}
                  </div>
                );
              })}
        </div>
      </div>

      {selectedClip && (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm font-medium">
            Clip: {formatTime(selectedClip.startTime)} - {formatTime(selectedClip.endTime)} ·{' '}
            {Math.round(selectedClip.viralityScore)}/100
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm text-neutral-700">
            Caption style:
            <select
              value={selectedClip.captionStyle}
              onChange={(e) => setCaptionStyle(selectedClip.id, e.target.value as CaptionStyle)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {CAPTION_STYLES.map((style) => (
                <option key={style} value={style}>
                  {CAPTION_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-sm text-neutral-700">
            Hook (first ~3s opener):
            <input
              type="text"
              value={selectedClip.hookText ?? ''}
              onChange={(e) => setHookText(selectedClip.id, e.target.value)}
              placeholder="e.g. You won't believe what happened next..."
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="mt-2 block text-sm text-neutral-700">
            Hashtags (space or comma separated):
            <input
              // Uncontrolled + remounted per clip (key), committing the
              // parsed array only on blur - a controlled input here would
              // re-derive its value from hashtags.join(' ') on every
              // keystroke, stripping the trailing space/comma the user just
              // typed and making it impossible to start a second word.
              key={selectedClip.id}
              type="text"
              defaultValue={selectedClip.hashtags.join(' ')}
              onBlur={(e) => setHashtags(selectedClip.id, parseHashtagsInput(e.target.value))}
              placeholder="e.g. fyp viral fashion"
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          {selectedClip.saveError && (
            <p className="mt-1 text-sm text-red-600">{selectedClip.saveError}</p>
          )}
          {selectedClip.renderError && (
            <p className="mt-1 text-sm text-red-600">{selectedClip.renderError}</p>
          )}
          {selectedClip.dirty && (
            <p className="mt-1 text-sm text-neutral-500">
              Unsaved changes - save before rendering.
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => saveClip(selectedClip.id)}
              disabled={!selectedClip.dirty || selectedClip.saving}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {selectedClip.saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => renderClip(selectedClip.id)}
              disabled={selectedClip.dirty || selectedClip.rendering}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {selectedClip.rendering ? 'Rendering...' : 'Render'}
            </button>
            {selectedClip.downloadUrl && !selectedClip.rendering && (
              <a
                href={clipDownloadUrl(selectedClip.downloadUrl)}
                className="text-sm font-medium text-neutral-900 underline"
              >
                Download current render
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
