'use client';

import { CAPTION_STYLES, type CaptionStyle, type ClipScores } from '@speedora/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { LetterboxBand } from '@/components/signature/LetterboxBand';
import { LiveReel } from '@/components/signature/LiveReel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clipDownloadUrl, videoSourceUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTimelineStore, type TimelineClip } from '@/lib/timelineStore';

// Guards against a drag collapsing a clip to zero/negative length. The
// backend also validates startTime < endTime independently (ClipsService.update).
const MIN_CLIP_SECONDS = 1;

// Short labels for the segmented toggle below - order matches CAPTION_STYLES.
const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  DEFAULT: 'Default',
  KARAOKE: 'Karaoke',
  BOLD_HIGHLIGHT: 'Bold Highlight',
};

// Fase 8 (Content Intelligence) - display labels for ClipScores' keys, in
// the order shown in the breakdown panel below.
const SCORE_LABELS: Record<keyof ClipScores, string> = {
  hookStrength: 'Hook Strength',
  educationalValue: 'Educational Value',
  practicalValue: 'Practical Value',
  curiosity: 'Curiosity',
  emotion: 'Emotion',
  storytelling: 'Storytelling',
  novelty: 'Novelty',
  trustAuthority: 'Trust/Authority',
  ctaStrength: 'CTA Strength',
};

// Matches detect-clips.worker.ts's INTENTS - a plain lookup with an 'other'
// fallback for any value this frontend doesn't recognize yet, rather than
// crashing on an unfamiliar intent string.
const INTENT_LABELS: Record<string, string> = {
  educate: 'Edukasi',
  entertain: 'Hiburan',
  persuade: 'Persuasi',
  inspire: 'Inspirasi',
  story: 'Cerita',
  other: 'Lainnya',
};

// Fase 12 (Speaker Diarization) - a small fixed palette rather than the
// app's own 2-color signal-cyan/signal-pink accent pair, which isn't enough
// to tell more than 2 speakers apart. diarization.ts's assignSpeakerLabels()
// always names speakers "Speaker A", "Speaker B", ... in order of first
// appearance, so the letter itself is a stable, deterministic palette index -
// no hashing needed.
const SPEAKER_COLORS = [
  'text-signal-cyan',
  'text-signal-pink',
  'text-amber-400',
  'text-violet-400',
  'text-emerald-400',
];

function speakerColorClass(speaker: string): string {
  const letter = speaker.replace('Speaker ', '').charCodeAt(0) - 'A'.charCodeAt(0);
  const index = Number.isNaN(letter) ? 0 : letter;
  return SPEAKER_COLORS[((index % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length];
}

// Fase 13 (Vocal Emotion Detection) - superb/wav2vec2-base-superb-er's raw
// IEMOCAP labels ("neu"/"hap"/"ang"/"sad"), translated to a single emoji for
// a compact, at-a-glance tag in the transcript strip below. An unfamiliar
// label (a future model swap, or just anything this map doesn't cover) is
// omitted entirely rather than showing a placeholder - same "don't fabricate
// what isn't there" spirit as the rest of this app's optional-signal fields.
const EMOTION_EMOJI: Record<string, string> = {
  neu: '😐',
  hap: '😊',
  ang: '😠',
  sad: '😢',
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

  // Set when the browser can't decode the source video (e.g. an older
  // YouTube import stored as AV1 - see youtube.ts, which now prefers H.264 -
  // or a direct upload in a codec this browser lacks). Without this, the
  // preview just shows a dead player and the timeline can't render (duration
  // stays 0), making the whole editor look broken even though trimming by
  // caption/hook edits, render and download all still work.
  const [previewUnsupported, setPreviewUnsupported] = useState(false);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  // Caption overlay is a best-effort approximation of the FFmpeg libass
  // burn-in (bold white text, black outline) - not a pixel match, and
  // doesn't attempt to preview the KARAOKE/BOLD_HIGHLIGHT presets' per-word
  // styling (same "approximate is fine" call as Fase 1's plain preview).
  // Crucially it's drawn INSIDE the centered 9:16 crop band (matching the
  // pink crop indicator), sized to and word-wrapped within that width - so it
  // reflects where/how the caption lands on the rendered vertical clip,
  // instead of spanning the full 16:9 frame and appearing to spill outside
  // the 9:16 output. Redrawn every frame so it tracks currentTime smoothly
  // while scrubbing, not just on the ~4/sec `timeupdate` event.
  useEffect(() => {
    let raf: number;

    function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
      const words = text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    function draw() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const active = transcript.find(
            (seg) => video.currentTime >= seg.start && video.currentTime < seg.end,
          );
          if (active) {
            // The 9:16 output is the centered vertical slice of the 16:9
            // preview - same fraction as the crop indicator's 34.18% side
            // bands (1 - 2 * 0.3418 = 0.3164 wide).
            const regionWidth = canvas.width * 0.3164;
            const centerX = canvas.width / 2;
            // Font sized to the narrow 9:16 width (not the full frame) so it
            // matches the burned-in caption's relative size on the output.
            const fontSize = Math.max(13, Math.round(regionWidth * 0.09));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.lineWidth = Math.max(2, fontSize * 0.16);
            ctx.strokeStyle = 'black';
            ctx.fillStyle = 'white';

            const lines = wrapLines(ctx, active.text, regionWidth * 0.92);
            const lineHeight = fontSize * 1.2;
            // Stack lines up from a bottom margin within the region.
            const bottom = canvas.height - fontSize * 0.9;
            lines.forEach((line, i) => {
              const y = bottom - (lines.length - 1 - i) * lineHeight;
              ctx.strokeText(line, centerX, y);
              ctx.fillText(line, centerX, y);
            });
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
    <div className="space-y-3">
      <div>
        <LetterboxBand />
        <div
          className="relative w-full overflow-hidden bg-bay-black"
          style={{ aspectRatio: '16/9' }}
        >
          <video
            ref={videoRef}
            src={videoSourceUrl(videoId)}
            crossOrigin="use-credentials"
            controls
            className="h-full w-full"
            onLoadedMetadata={() => {
              setPreviewUnsupported(false);
              handleLoadedMetadata();
            }}
            onTimeUpdate={handleTimeUpdate}
            onError={() => setPreviewUnsupported(true)}
          />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          {previewUnsupported && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bay-black/85 px-6 text-center">
              <p className="font-body text-sm text-paper-white">
                Pratinjau tidak bisa diputar di browser ini.
              </p>
              <p className="font-body text-xs text-muted-foreground">
                Format video sumber tidak didukung — kamu tetap bisa mengatur caption, render, dan
                unduh klip di bawah.
              </p>
            </div>
          )}

          {/* Static 9:16 crop indicator - the real crop path tracks a face
              and moves (see CLAUDE.md's Smart Reframe), but that path isn't
              exposed to the frontend, so this shows the honest baseline: a
              centered slice at the eventual output aspect ratio, not a fake
              animated prediction of where it'll actually crop. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-[34.18%] border-r border-signal-pink/40 bg-bay-black/70"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-[34.18%] border-l border-signal-pink/40 bg-bay-black/70"
            aria-hidden="true"
          />
          <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-wide text-chrome">
            Pratinjau 9:16
          </span>
        </div>
        <LetterboxBand />
      </div>

      <div>
        <div ref={trackRef}>
          <LiveReel
            variant="ruler"
            durationSeconds={duration}
            currentTime={playhead}
            onSeek={seekTo}
          >
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
                    className={cn(
                      'absolute top-1 h-8 cursor-pointer rounded-sm transition-colors',
                      isSelected ? 'bg-signal-pink' : 'bg-chrome/40 hover:bg-chrome/60',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {isSelected && (
                      <>
                        <div
                          onPointerDown={startHandleDrag(clip, 'start')}
                          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-paper-white"
                        />
                        <div
                          onPointerDown={startHandleDrag(clip, 'end')}
                          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-paper-white"
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </LiveReel>
        </div>

        <div className="relative mt-1.5 h-5 w-full">
          {selectedClip &&
            duration > 0 &&
            transcript
              .filter((seg) => seg.end > selectedClip.startTime && seg.start < selectedClip.endTime)
              .map((seg, i) => {
                const segStart = Math.max(seg.start, selectedClip.startTime);
                const segEnd = Math.min(seg.end, selectedClip.endTime);
                const left = (segStart / duration) * 100;
                const width = ((segEnd - segStart) / duration) * 100;
                // Undefined for a video with no speaker data (diarization
                // never ran, failed, or found nothing) - falls back to the
                // original single-color look, same as before Fase 12.
                const colorClass = seg.speaker ? speakerColorClass(seg.speaker) : 'text-signal-cyan';
                const emoji = seg.emotion ? EMOTION_EMOJI[seg.emotion] : undefined;
                const titleParts = [seg.speaker, seg.text].filter(Boolean);
                return (
                  <div
                    key={i}
                    title={titleParts.join(': ')}
                    className={cn(
                      'absolute h-5 truncate rounded-sm bg-signal-cyan/10 px-1 font-mono text-[10px] leading-5',
                      colorClass,
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {emoji ? `${emoji} ` : ''}
                    {seg.text}
                  </div>
                );
              })}
        </div>
      </div>

      {selectedClip && (
        <div className="rounded-lg border border-border bg-slate-panel p-4">
          <p className="font-mono text-xs text-muted-foreground">
            {formatTime(selectedClip.startTime)} – {formatTime(selectedClip.endTime)} ·{' '}
            <span className="text-signal-pink">{Math.round(selectedClip.viralityScore)}</span>/100
          </p>

          <div className="mt-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Gaya Caption
            </Label>
            <div className="mt-1.5 inline-flex rounded-md border border-border">
              {CAPTION_STYLES.map((style, i) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setCaptionStyle(selectedClip.id, style)}
                  className={cn(
                    'px-3 py-1.5 font-mono text-xs transition-colors',
                    i > 0 && 'border-l border-border',
                    selectedClip.captionStyle === style
                      ? 'bg-signal-pink text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {CAPTION_STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label
              htmlFor="hook-text"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Hook (~3 detik pembuka)
            </Label>
            <Input
              id="hook-text"
              value={selectedClip.hookText ?? ''}
              onChange={(e) => setHookText(selectedClip.id, e.target.value)}
              placeholder='mis. "Kamu nggak akan percaya apa yang terjadi..."'
            />
          </div>

          <div className="mt-3 space-y-1.5">
            <Label
              htmlFor="hashtags"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Hashtag (pisahkan spasi/koma)
            </Label>
            <Input
              // Uncontrolled + remounted per clip (key), committing the
              // parsed array only on blur - a controlled input here would
              // re-derive its value from hashtags.join(' ') on every
              // keystroke, stripping the trailing space/comma the user just
              // typed and making it impossible to start a second word.
              key={selectedClip.id}
              id="hashtags"
              defaultValue={selectedClip.hashtags.join(' ')}
              onBlur={(e) => setHashtags(selectedClip.id, parseHashtagsInput(e.target.value))}
              placeholder="mis. fyp viral fashion"
            />
          </div>

          {selectedClip.reason ? (
            <div className="mt-4 rounded-md border border-border bg-slate-panel p-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Kenapa klip ini dipilih
              </p>
              <p className="mt-1 font-body text-sm text-foreground">{selectedClip.reason}</p>

              {selectedClip.scores ? (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {(Object.keys(SCORE_LABELS) as Array<keyof ClipScores>).map((key) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {SCORE_LABELS[key]}
                      </span>
                      <span className="font-mono text-xs text-signal-cyan">
                        {selectedClip.scores![key]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedClip.intent || selectedClip.topics.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedClip.intent ? (
                    <Badge variant="muted">
                      {INTENT_LABELS[selectedClip.intent] ?? selectedClip.intent}
                    </Badge>
                  ) : null}
                  {selectedClip.topics.map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {selectedClip.ctaText ? (
                <p className="mt-2 font-body text-xs italic text-muted-foreground">
                  CTA: &quot;{selectedClip.ctaText}&quot;
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedClip.saveError && (
            <p className="mt-2 text-xs text-destructive">{selectedClip.saveError}</p>
          )}
          {selectedClip.renderError && (
            <p className="mt-2 text-xs text-destructive">{selectedClip.renderError}</p>
          )}
          {selectedClip.dirty && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Belum disimpan — simpan sebelum merender.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveClip(selectedClip.id)}
              disabled={!selectedClip.dirty || selectedClip.saving}
            >
              {selectedClip.saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => renderClip(selectedClip.id)}
              disabled={selectedClip.dirty || selectedClip.rendering}
            >
              {selectedClip.rendering ? 'Merender...' : 'Render'}
            </Button>
            {selectedClip.downloadUrl && !selectedClip.rendering && (
              <Button size="sm" variant="ghost" asChild>
                <a href={clipDownloadUrl(selectedClip.downloadUrl)}>Unduh Render Saat Ini</a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
