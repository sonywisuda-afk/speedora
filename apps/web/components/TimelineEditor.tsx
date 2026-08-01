'use client';

import {
  BUILT_IN_SUBTITLE_PRESETS,
  CAPTION_STYLES,
  CaptionStyle,
  FONT_FAMILIES,
  type ClipScores,
  type FontFamily,
} from '@speedora/shared';
import { KEYWORD_PATTERN } from '@speedora/subtitles';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import useSWR from 'swr';

import { LetterboxBand } from '@/components/signature/LetterboxBand';
import { LiveReel } from '@/components/signature/LiveReel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clipDownloadUrl,
  createSubtitlePreset,
  listSubtitlePresets,
  videoSourceUrl,
} from '@/lib/api';
import { FONT_FAMILY_CSS } from '@/lib/subtitleFonts';
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

// Matches detect-clips.worker.ts's INTENTS (@speedora/contracts' own
// CLIP_INTENTS). Record<ClipIntent, string> instead of Record<string,
// string> so the compiler rejects a build that adds a new intent without a
// label here; intentLabel() below is the separate runtime-only safety net
// for an unfamiliar intent string (loosely typed at the DTO boundary),
// rather than crashing on it.
type ClipIntent = 'educate' | 'entertain' | 'persuade' | 'inspire' | 'story' | 'other';

const INTENT_LABELS: Record<ClipIntent, string> = {
  educate: 'Edukasi',
  entertain: 'Hiburan',
  persuade: 'Persuasi',
  inspire: 'Inspirasi',
  story: 'Cerita',
  other: 'Lainnya',
};

// Runtime-only safety net (same convention as FaceReviewPanel.tsx's
// emotionLabel) - `intent` is loosely typed `string | null` at the DTO
// boundary (Clip.intent), so an unrecognized value degrades to the raw
// value instead of crashing the Record<ClipIntent, string> lookup.
function intentLabel(intent: string): string {
  return intent in INTENT_LABELS ? INTENT_LABELS[intent as ClipIntent] : intent;
}

// Fase 12 (Speaker Diarization) - a small fixed palette, independent of the
// design system's semantic tokens on purpose: these 5 hex values are a
// cross-system rendering contract with apps/worker's build-ass.ts (its
// SPEAKER_ASS_COLORS documents the exact same values) - burned-in captions
// are rendered server-side from this exact palette, so this UI can't repaint
// it when the design system's primary/secondary hues change without
// desyncing from what actually gets rendered into the video. Expressed as
// Tailwind arbitrary-value classes (not named tokens) for the first two
// slots so the on-screen speaker label still matches the burned-in caption
// color exactly. diarization.ts's assignSpeakerLabels() always names
// speakers "Speaker A", "Speaker B", ... in order of first appearance, so
// the letter itself is a stable, deterministic palette index - no hashing
// needed.
const SPEAKER_COLORS = [
  'text-[#22E6D6]',
  'text-[#FF3B7F]',
  'text-amber-400',
  'text-violet-400',
  'text-emerald-400',
];

// Same palette as SPEAKER_COLORS above, as hex - used for the canvas caption
// preview's speaker-color base fill (Subtitle Presets roadmap, P3b) so the
// editor and the actual burned-in captions agree, same reasoning as
// SPEAKER_COLORS' own comment.
//
// Intentionally hardcoded. Shared with Worker caption renderer
// (apps/worker's build-ass.ts SPEAKER_ASS_COLORS). Do not convert to
// semantic tokens without updating the worker renderer to match - the two
// must stay byte-for-byte identical or the editor preview and the actual
// burned-in captions will disagree.
const SPEAKER_HEX_COLORS = ['#22E6D6', '#FF3B7F', '#FBBF24', '#A78BFA', '#34D399'];

function speakerIndex(speaker: string): number {
  const letter = speaker.replace('Speaker ', '').charCodeAt(0) - 'A'.charCodeAt(0);
  const index = Number.isNaN(letter) ? 0 : letter;
  return ((index % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length;
}

function speakerColorClass(speaker: string): string {
  return SPEAKER_COLORS[speakerIndex(speaker)];
}

function speakerHexColor(speaker: string): string {
  return SPEAKER_HEX_COLORS[speakerIndex(speaker)];
}

// Subtitle Presets roadmap (P3b) - resolves a per-clip fontFamily override
// into a real, loaded CSS font-family string for the canvas preview
// (FONT_FAMILY_CSS, from next/font/google). No per-clip override (null,
// meaning "use Brand Kit resolution") previews as Inter - the same
// best-effort-approximation posture this preview already has (see this
// file's own "NOT a pixel match" comment above draw()); the actual Brand
// Kit font isn't fetched here just for the preview.
function previewFontCss(fontFamily: string | null | undefined): string {
  const key = (fontFamily ?? 'Inter') as FontFamily;
  return `${FONT_FAMILY_CSS[key] ?? FONT_FAMILY_CSS.Inter}, sans-serif`;
}

// Fase 13 (Vocal Emotion Detection) - superb/wav2vec2-base-superb-er's raw
// IEMOCAP labels, @speedora/contracts' own VOCAL_EMOTIONS (apps/web has no
// dependency on @speedora/contracts, so this is a plain local mirror type,
// not an import - same convention as clip-library.ts's FacialEmotion),
// translated to a single emoji for a compact, at-a-glance tag in the
// transcript strip below. Record<VocalEmotion, string> instead of
// Record<string, string> so the compiler rejects a build that adds a new
// vocal-emotion class without an emoji here. emotionEmoji() below preserves
// the original behavior for an unfamiliar label (a future model swap, or
// anything this map doesn't cover): omitted entirely rather than showing a
// placeholder, same "don't fabricate what isn't there" spirit as the rest
// of this app's optional-signal fields.
type VocalEmotion = 'neu' | 'hap' | 'ang' | 'sad';

const EMOTION_EMOJI: Record<VocalEmotion, string> = {
  neu: '😐',
  hap: '😊',
  ang: '😠',
  sad: '😢',
};

function emotionEmoji(emotion: string): string | undefined {
  return emotion in EMOTION_EMOJI ? EMOTION_EMOJI[emotion as VocalEmotion] : undefined;
}

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
  const setSpeakerColorCaptions = useTimelineStore((s) => s.setSpeakerColorCaptions);
  const setCaptionLanguage = useTimelineStore((s) => s.setCaptionLanguage);
  const setFontFamily = useTimelineStore((s) => s.setFontFamily);
  const applyPreset = useTimelineStore((s) => s.applyPreset);
  const setWatermarkEnabled = useTimelineStore((s) => s.setWatermarkEnabled);
  const setIntroEnabled = useTimelineStore((s) => s.setIntroEnabled);
  const setOutroEnabled = useTimelineStore((s) => s.setOutroEnabled);
  const setHookText = useTimelineStore((s) => s.setHookText);
  const setHashtags = useTimelineStore((s) => s.setHashtags);
  const saveClip = useTimelineStore((s) => s.saveClip);
  const renderClip = useTimelineStore((s) => s.renderClip);

  // Subtitle Presets roadmap (P3b) - built-ins are a fixed constant (never
  // touch the DB); custom ones are the requester's own saved
  // SubtitlePreset rows.
  const { data: presetsData, mutate: mutatePresets } = useSWR(
    'subtitle-presets',
    listSubtitlePresets,
  );
  const customPresets = presetsData?.presets ?? [];
  const [savingPresetName, setSavingPresetName] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  // Set when the browser can't decode the source video (e.g. an older
  // YouTube import stored as AV1 - see youtube.ts, which now prefers H.264 -
  // or a direct upload in a codec this browser lacks). Without this, the
  // preview just shows a dead player and the timeline can't render (duration
  // stays 0), making the whole editor look broken even though trimming by
  // caption/hook edits, render and download all still work.
  const [previewUnsupported, setPreviewUnsupported] = useState(false);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  // Subtitle Studio roadmap (P2f) - which languages actually have at least
  // one translated segment (translation itself is requested from the
  // Subtitle Studio panel, not here) - this picker only chooses among
  // languages that already exist.
  const availableCaptionLanguages = Array.from(
    new Set(transcript.flatMap((segment) => Object.keys(segment.translations ?? {}))),
  );

  // Caption overlay is a best-effort approximation of the FFmpeg libass
  // burn-in (bold white text, black outline), NOT a pixel match - but
  // Subtitle Studio roadmap (P2e) closes the gap that used to make all 3
  // CaptionStyle presets look identical here: KARAOKE now progressively
  // highlights already-spoken words (mirroring build-ass.ts's \k fill), and
  // BOLD_HIGHLIGHT now bolds/colours the same KEYWORD_PATTERN tokens
  // build-ass.ts itself matches (imported from @speedora/subtitles so the
  // two never drift). Crucially it's drawn INSIDE the centered 9:16 crop
  // band (matching the pink crop indicator), sized to and word-wrapped
  // within that width - so it reflects where/how the caption lands on the
  // rendered vertical clip, instead of spanning the full 16:9 frame and
  // appearing to spill outside the 9:16 output. Redrawn every frame so it
  // tracks currentTime smoothly while scrubbing, not just on the ~4/sec
  // `timeupdate` event.
  useEffect(() => {
    let raf: number;
    const HIGHLIGHT_COLOR = '#FFFF00'; // matches build-ass.ts's ASS HIGHLIGHT_COLOR

    interface StyledWord {
      text: string;
      bold: boolean;
      color: string;
    }

    function toStyledWords(
      active: (typeof transcript)[number],
      style: CaptionStyle,
      currentTime: number,
      baseColor: string,
    ): StyledWord[] {
      if (style === 'KARAOKE' && active.words && active.words.length > 0) {
        return active.words.map((word) => ({
          text: word.word,
          bold: false,
          color: currentTime >= word.start ? HIGHLIGHT_COLOR : baseColor,
        }));
      }
      const tokens = active.text.split(/\s+/).filter(Boolean);
      if (style === 'BOLD_HIGHLIGHT') {
        return tokens.map((token) => {
          const stripped = token.replace(/^[.,!?;:"'“”]+|[.,!?;:"'“”]+$/g, '');
          const isKeyword = KEYWORD_PATTERN.test(stripped);
          return {
            text: token,
            bold: isKeyword,
            color: isKeyword ? HIGHLIGHT_COLOR : baseColor,
          };
        });
      }
      return tokens.map((token) => ({ text: token, bold: false, color: baseColor }));
    }

    // Wraps styled words into lines by measuring each word with ITS OWN
    // bold/plain font (a KARAOKE/BOLD_HIGHLIGHT word can be wider bold than
    // plain) - unlike the old single-string wrapLines, this can't just
    // measure a joined string since font weight varies word-to-word.
    function wrapStyledWords(
      ctx: CanvasRenderingContext2D,
      words: StyledWord[],
      maxWidth: number,
      fontSize: number,
      fontCss: string,
    ): StyledWord[][] {
      const spaceWidth = (() => {
        ctx.font = `${fontSize}px ${fontCss}`;
        return ctx.measureText(' ').width;
      })();
      const lines: StyledWord[][] = [];
      let current: StyledWord[] = [];
      let currentWidth = 0;
      for (const word of words) {
        ctx.font = `${word.bold ? 'bold ' : ''}${fontSize}px ${fontCss}`;
        const wordWidth = ctx.measureText(word.text).width;
        const addedWidth = currentWidth === 0 ? wordWidth : currentWidth + spaceWidth + wordWidth;
        if (addedWidth > maxWidth && current.length > 0) {
          lines.push(current);
          current = [word];
          currentWidth = wordWidth;
        } else {
          current.push(word);
          currentWidth = addedWidth;
        }
      }
      if (current.length > 0) lines.push(current);
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
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.lineWidth = Math.max(2, fontSize * 0.16);
            ctx.strokeStyle = 'black';

            const style = selectedClip?.captionStyle ?? CaptionStyle.DEFAULT;
            const speakerColorCaptions = selectedClip?.speakerColorCaptions ?? false;
            const baseColor =
              speakerColorCaptions && active.speaker ? speakerHexColor(active.speaker) : 'white';
            const fontCss = previewFontCss(selectedClip?.fontFamily);
            const styledWords = toStyledWords(active, style, video.currentTime, baseColor);
            const lines = wrapStyledWords(ctx, styledWords, regionWidth * 0.92, fontSize, fontCss);
            const spaceWidth = (() => {
              ctx.font = `${fontSize}px ${fontCss}`;
              return ctx.measureText(' ').width;
            })();
            const lineHeight = fontSize * 1.2;
            const bottom = canvas.height - fontSize * 0.9;

            lines.forEach((line, i) => {
              const y = bottom - (lines.length - 1 - i) * lineHeight;
              const lineWidth = line.reduce((sum, word, wi) => {
                ctx.font = `${word.bold ? 'bold ' : ''}${fontSize}px ${fontCss}`;
                return sum + ctx.measureText(word.text).width + (wi > 0 ? spaceWidth : 0);
              }, 0);
              let x = centerX - lineWidth / 2;
              for (const word of line) {
                ctx.font = `${word.bold ? 'bold ' : ''}${fontSize}px ${fontCss}`;
                ctx.fillStyle = word.color;
                ctx.strokeText(word.text, x, y);
                ctx.fillText(word.text, x, y);
                x += ctx.measureText(word.text).width + spaceWidth;
              }
            });
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [
    transcript,
    selectedClip?.captionStyle,
    selectedClip?.speakerColorCaptions,
    selectedClip?.fontFamily,
  ]);

  // Subtitle Presets roadmap (P3b) - option values are "built-in:<key>" or
  // "custom:<id>" so a single <select> can address both lists without id
  // collisions; applyPreset() bulk-sets captionStyle/speakerColorCaptions/
  // fontFamily in one state update, same dirty/saveClip batch as every
  // other clip field.
  function handleApplyPreset(clipId: string, value: string) {
    if (!value) return;
    const [kind, key] = value.split(':', 2);
    const preset =
      kind === 'built-in'
        ? BUILT_IN_SUBTITLE_PRESETS.find((p) => p.key === key)
        : customPresets.find((p) => p.id === key);
    if (preset) applyPreset(clipId, preset);
  }

  async function handleSaveAsPreset(clip: TimelineClip) {
    const name = savingPresetName?.trim();
    if (!name) return;
    setPresetError(null);
    try {
      await createSubtitlePreset({
        name,
        captionStyle: clip.captionStyle,
        speakerColorCaptions: clip.speakerColorCaptions,
        fontFamily: clip.fontFamily ?? undefined,
      });
      await mutatePresets();
      setSavingPresetName(null);
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Gagal menyimpan preset');
    }
  }

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
          className="relative w-full overflow-hidden bg-slate-950"
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
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/85 px-6 text-center">
              <p className="font-body text-sm text-slate-50">
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
            className="pointer-events-none absolute inset-y-0 left-0 w-[34.18%] border-r border-primary/40 bg-slate-950/70"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-[34.18%] border-l border-primary/40 bg-slate-950/70"
            aria-hidden="true"
          />
          <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-wide text-slate-400">
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
                      isSelected
                        ? 'bg-primary'
                        : 'bg-muted-foreground/40 hover:bg-muted-foreground/60',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {isSelected && (
                      <>
                        <div
                          onPointerDown={startHandleDrag(clip, 'start')}
                          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-primary-foreground"
                        />
                        <div
                          onPointerDown={startHandleDrag(clip, 'end')}
                          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary-foreground"
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
                const colorClass = seg.speaker ? speakerColorClass(seg.speaker) : 'text-primary';
                const emoji = seg.emotion ? emotionEmoji(seg.emotion) : undefined;
                const titleParts = [seg.speaker, seg.text].filter(Boolean);
                return (
                  <div
                    key={i}
                    title={titleParts.join(': ')}
                    className={cn(
                      'absolute h-5 truncate rounded-sm bg-primary/10 px-1 font-mono text-[10px] leading-5',
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
        <div className="rounded-lg border border-border bg-muted p-4">
          <p className="font-mono text-xs text-muted-foreground">
            {formatTime(selectedClip.startTime)} – {formatTime(selectedClip.endTime)} ·{' '}
            <span className="text-primary">{Math.round(selectedClip.viralityScore)}</span>/100
          </p>

          {/* Subtitle Presets roadmap (P3b) - a convenience bulk-setter over
              the granular Gaya Caption/Warna Per Pembicara/Font controls
              below, not a replacement - picking one just fills those in,
              and any of them can still be fine-tuned afterward. */}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Preset Subtitle
              </Label>
              <select
                value=""
                onChange={(e) => handleApplyPreset(selectedClip.id, e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
              >
                <option value="">Pilih preset...</option>
                <optgroup label="Built-in">
                  {BUILT_IN_SUBTITLE_PRESETS.map((preset) => (
                    <option key={preset.key} value={`built-in:${preset.key}`}>
                      {preset.name}
                    </option>
                  ))}
                </optgroup>
                {customPresets.length > 0 && (
                  <optgroup label="Preset Saya">
                    {customPresets.map((preset) => (
                      <option key={preset.id} value={`custom:${preset.id}`}>
                        {preset.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {savingPresetName === null ? (
              <Button size="sm" variant="outline" onClick={() => setSavingPresetName('')}>
                Simpan sebagai preset
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={savingPresetName}
                  onChange={(e) => setSavingPresetName(e.target.value)}
                  placeholder="Nama preset"
                  className="h-8 w-40 font-mono text-xs"
                />
                <Button size="sm" onClick={() => handleSaveAsPreset(selectedClip)}>
                  Simpan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSavingPresetName(null);
                    setPresetError(null);
                  }}
                >
                  Batal
                </Button>
              </div>
            )}
          </div>
          {presetError && <p className="mt-1 font-body text-xs text-destructive">{presetError}</p>}

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
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {CAPTION_STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </div>

          {/* Subtitle Studio roadmap (P2c/P2f) - orthogonal to the preset
              above, both flow through the same dirty/saveClip batch. */}
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedClip.speakerColorCaptions}
                onChange={(e) => setSpeakerColorCaptions(selectedClip.id, e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Warna per pembicara
            </label>

            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedClip.watermarkEnabled}
                onChange={(e) => setWatermarkEnabled(selectedClip.id, e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Terapkan watermark
            </label>

            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedClip.introEnabled}
                onChange={(e) => setIntroEnabled(selectedClip.id, e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Terapkan intro
            </label>

            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedClip.outroEnabled}
                onChange={(e) => setOutroEnabled(selectedClip.id, e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Terapkan outro
            </label>

            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Font Caption
              </Label>
              <select
                value={selectedClip.fontFamily ?? ''}
                onChange={(e) => setFontFamily(selectedClip.id, e.target.value || null)}
                className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
              >
                <option value="">Default (Brand Kit)</option>
                {FONT_FAMILIES.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>

            {availableCaptionLanguages.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Bahasa Caption
                </Label>
                <select
                  value={selectedClip.captionLanguage ?? ''}
                  onChange={(e) => setCaptionLanguage(selectedClip.id, e.target.value || null)}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
                >
                  <option value="">Asli (tidak diterjemahkan)</option>
                  {availableCaptionLanguages.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <div className="mt-4 rounded-md border border-border bg-muted p-3">
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
                      <span className="font-mono text-xs text-primary">
                        {selectedClip.scores![key]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedClip.intent || selectedClip.topics.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedClip.intent ? (
                    <Badge variant="muted">{intentLabel(selectedClip.intent)}</Badge>
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
