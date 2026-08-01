'use client';

import type { Clip, OcrTextCategory, OcrTextTrack } from '@speedora/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LiveReel } from '@/components/signature/LiveReel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { videoSourceUrl } from '@/lib/api';
import {
  buildExportPayload,
  downloadJson,
  getOcrCategoryLabel,
  loadReviewState,
  OCR_CATEGORY_LABELS,
  OCR_TEXT_CATEGORIES,
  saveReviewState,
  trackKey,
  type OcrReviewState,
} from '@/lib/ocrReview';
import { cn } from '@/lib/utils';

// OCR dataset annotation tool - deliberately a SEPARATE page/component from
// TimelineEditor.tsx, per explicit user instruction: "Timeline Editor
// fokus pada editing. OCR Review fokus pada validasi machine output.
// Workflow dan kebutuhan UI-nya berbeda." Shares the LiveReel component
// (timeline/seek bar) and the same <video>+canvas-overlay pattern as
// TimelineEditor, but is not wired into it and doesn't touch its state.
//
// Reviewer workflow (see the wireframe the user provided): video with OCR
// box overlay on top, a timeline below it, a searchable/filterable track
// list on the left, and a detail panel on the right showing the
// classifier's prediction next to a category button-group + Save. Built
// for THROUGHPUT ("kalau nanti dataset menjadi ribuan track, efisiensi jauh
// lebih penting daripada tampilan") - keyboard shortcuts (1-6 for category,
// Enter/Shift+Enter to navigate), auto-seek to a track's first frame on
// selection, an "unreviewed only" filter, and a running progress count are
// all part of that, not decoration.

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// A track's startTime/endTime are clip-relative (see @speedora/contracts'
// ocrTextTrackSchema) - the source video preview plays in ABSOLUTE
// (source-relative) time, same convention TimelineEditor already uses for
// its own clip startTime/endTime. Every place this component reads/writes
// video.currentTime needs this conversion.
function toAbsoluteTime(clip: Pick<Clip, 'startTime'>, clipRelativeSeconds: number): number {
  return clip.startTime + clipRelativeSeconds;
}

interface OcrReviewerProps {
  videoId: string;
  clips: Clip[];
}

export function OcrReviewer({ videoId, clips }: OcrReviewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reviewableClips = useMemo(
    () => clips.filter((clip) => (clip.ocrTracks?.length ?? 0) > 0),
    [clips],
  );

  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    reviewableClips[0]?.id ?? null,
  );
  const selectedClip = reviewableClips.find((c) => c.id === selectedClipId) ?? null;
  const tracks: OcrTextTrack[] = useMemo(() => selectedClip?.ocrTracks ?? [], [selectedClip]);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewUnsupported, setPreviewUnsupported] = useState(false);

  const [reviewState, setReviewState] = useState<OcrReviewState>({});
  useEffect(() => {
    setReviewState(loadReviewState(videoId));
  }, [videoId]);
  useEffect(() => {
    saveReviewState(videoId, reviewState);
  }, [videoId, reviewState]);

  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(tracks[0]?.trackId ?? null);
  const [pendingCategory, setPendingCategory] = useState<OcrTextCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);

  const filteredTracks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tracks.filter((track) => {
      if (query && !track.text.toLowerCase().includes(query)) return false;
      if (unreviewedOnly && selectedClip && reviewState[trackKey(selectedClip.id, track.trackId)]) {
        return false;
      }
      return true;
    });
  }, [tracks, searchQuery, unreviewedOnly, selectedClip, reviewState]);

  const reviewedCount = selectedClip
    ? tracks.filter((t) => reviewState[trackKey(selectedClip.id, t.trackId)]).length
    : 0;
  const progressPercent = tracks.length > 0 ? Math.round((reviewedCount / tracks.length) * 100) : 0;

  const selectedTrack = tracks.find((t) => t.trackId === selectedTrackId) ?? null;

  function selectTrack(track: OcrTextTrack | null) {
    setSelectedTrackId(track?.trackId ?? null);
    if (selectedClip && track) {
      setPendingCategory(reviewState[trackKey(selectedClip.id, track.trackId)] ?? null);
      // "lompat ke frame pertama track" - jump the preview to this track's
      // own first appearance, not just wherever the playhead already was.
      if (videoRef.current) {
        videoRef.current.currentTime = toAbsoluteTime(selectedClip, track.startTime);
      }
    } else {
      setPendingCategory(null);
    }
  }

  function commitCurrentTrack() {
    if (!selectedClip || !selectedTrack || !pendingCategory) return;
    setReviewState((state) => ({
      ...state,
      [trackKey(selectedClip.id, selectedTrack.trackId)]: pendingCategory,
    }));
  }

  function moveToOffset(offset: number) {
    if (filteredTracks.length === 0) return;
    const currentIndex = filteredTracks.findIndex((t) => t.trackId === selectedTrackId);
    const nextIndex =
      currentIndex === -1
        ? 0
        : Math.min(filteredTracks.length - 1, Math.max(0, currentIndex + offset));
    selectTrack(filteredTracks[nextIndex]);
  }

  // Keyboard shortcuts - the whole point of this tool per the user's own
  // framing ("satu reviewer bisa memberi label ribuan OCR region per
  // hari"). Ignored while focus is in a text input (the search box) so
  // typing "1" to search doesn't get eaten as a category shortcut.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const tag = (target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (!selectedTrack) return;

      const digit = Number(e.key);
      if (digit >= 1 && digit <= OCR_TEXT_CATEGORIES.length) {
        e.preventDefault();
        setPendingCategory(OCR_TEXT_CATEGORIES[digit - 1]);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          moveToOffset(-1);
        } else {
          commitCurrentTrack();
          moveToOffset(1);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrack, pendingCategory, filteredTracks, selectedClip]);

  // OCR box overlay - bounding boxes are normalized [0,1] against the
  // SOURCE frame's own native dimensions (see detect_ocr_text.py), the same
  // coordinate space the <video>+<canvas> pair already share via
  // TimelineEditor's identical "canvas sized to video.clientWidth/Height"
  // approach - so this works correctly even though the preview box below is
  // forced to a fixed 16:9 aspect ratio regardless of the source's real one.
  useEffect(() => {
    let raf: number;

    function draw() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && selectedClip) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const track of tracks) {
            const start = toAbsoluteTime(selectedClip, track.startTime);
            const end = toAbsoluteTime(selectedClip, track.endTime);
            if (video.currentTime < start || video.currentTime > end) continue;

            const { xCenter, yCenter, width, height } = track.boundingBox;
            const x = (xCenter - width / 2) * canvas.width;
            const y = (yCenter - height / 2) * canvas.height;
            const w = width * canvas.width;
            const h = height * canvas.height;

            const isSelected = track.trackId === selectedTrackId;
            const isReviewed = Boolean(reviewState[trackKey(selectedClip.id, track.trackId)]);
            ctx.lineWidth = isSelected ? 3 : 1.5;
            ctx.strokeStyle = isSelected ? '#f472b6' : isReviewed ? '#34d399' : '#fbbf24';
            ctx.strokeRect(x, y, w, h);

            ctx.font = '11px monospace';
            ctx.fillStyle = ctx.strokeStyle;
            ctx.textBaseline = 'bottom';
            ctx.fillText(track.text.slice(0, 40), x, Math.max(11, y - 2));
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tracks, selectedClip, selectedTrackId, reviewState]);

  function handleExport() {
    const payload = buildExportPayload(reviewableClips, reviewState);
    downloadJson(`ocr-labeled-tracks-${videoId}.json`, payload);
  }

  const totalReviewed = Object.keys(reviewState).length;

  if (reviewableClips.length === 0) {
    return (
      <p className="mt-6 font-body text-sm text-muted-foreground">
        Belum ada klip di video ini yang punya data OCR untuk direview.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {reviewableClips.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {reviewableClips.map((clip) => (
            <button
              key={clip.id}
              type="button"
              onClick={() => {
                setSelectedClipId(clip.id);
                selectTrack((clip.ocrTracks ?? [])[0] ?? null);
              }}
              className={cn(
                'rounded-md border px-3 py-1.5 font-mono text-xs',
                clip.id === selectedClipId
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {formatTime(clip.startTime)}–{formatTime(clip.endTime)} ({clip.ocrTracks?.length ?? 0}
              )
            </button>
          ))}
        </div>
      )}

      <div className="relative w-full overflow-hidden bg-slate-950" style={{ aspectRatio: '16/9' }}>
        <video
          ref={videoRef}
          src={videoSourceUrl(videoId)}
          crossOrigin="use-credentials"
          controls
          className="h-full w-full"
          onLoadedMetadata={() => {
            setPreviewUnsupported(false);
            if (videoRef.current) setDuration(videoRef.current.duration);
          }}
          onTimeUpdate={() => {
            if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
          }}
          onError={() => setPreviewUnsupported(true)}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {previewUnsupported && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/85 px-6 text-center">
            <p className="font-body text-sm text-slate-50">
              Pratinjau tidak bisa diputar di browser ini.
            </p>
          </div>
        )}
      </div>

      <LiveReel
        variant="ruler"
        durationSeconds={duration}
        currentTime={currentTime}
        onSeek={(t) => {
          if (videoRef.current) videoRef.current.currentTime = t;
          setCurrentTime(t);
        }}
      >
        {selectedClip &&
          duration > 0 &&
          tracks.map((track) => {
            const start = toAbsoluteTime(selectedClip, track.startTime);
            const end = toAbsoluteTime(selectedClip, track.endTime);
            const left = (start / duration) * 100;
            const width = ((end - start) / duration) * 100;
            const isReviewed = Boolean(reviewState[trackKey(selectedClip.id, track.trackId)]);
            return (
              <div
                key={track.trackId}
                onClick={(e) => {
                  e.stopPropagation();
                  selectTrack(track);
                }}
                className={cn(
                  'absolute top-1 h-6 cursor-pointer rounded-sm',
                  track.trackId === selectedTrackId
                    ? 'bg-primary'
                    : isReviewed
                      ? 'bg-success/60 hover:bg-success/80'
                      : 'bg-warning/60 hover:bg-warning/80',
                )}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
                title={track.text}
              />
            );
          })}
      </LiveReel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border border-border bg-muted p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Track List — {reviewedCount}/{tracks.length} direview ({progressPercent}%)
            </p>
            <button
              type="button"
              onClick={() => setUnreviewedOnly((v) => !v)}
              className={cn(
                'rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wide',
                unreviewedOnly
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              Unreviewed only
            </button>
          </div>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari teks track..."
            className="mb-2"
          />
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {filteredTracks.length === 0 && (
              <li className="font-body text-xs text-muted-foreground">Tidak ada track.</li>
            )}
            {filteredTracks.map((track) => {
              const isReviewed = selectedClip
                ? Boolean(reviewState[trackKey(selectedClip.id, track.trackId)])
                : false;
              return (
                <li key={track.trackId}>
                  <button
                    type="button"
                    onClick={() => selectTrack(track)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-body text-sm',
                      track.trackId === selectedTrackId
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        isReviewed ? 'bg-success' : 'bg-warning',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      Track #{track.trackId} — &quot;{track.text}&quot;
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-muted p-4">
          {selectedTrack ? (
            <>
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Predicted
              </p>
              <p className="mt-1 font-body text-sm text-foreground">
                {getOcrCategoryLabel(selectedTrack.category)} (
                {selectedTrack.categoryConfidence.toFixed(2)})
              </p>

              <p className="mt-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Actual
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {OCR_TEXT_CATEGORIES.map((category, i) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setPendingCategory(category)}
                    className={cn(
                      'rounded-sm border px-2.5 py-1.5 font-mono text-xs',
                      pendingCategory === category
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {i + 1}. {OCR_CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                className="mt-3"
                disabled={!pendingCategory}
                onClick={() => {
                  commitCurrentTrack();
                  moveToOffset(1);
                }}
              >
                Save
              </Button>

              <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                1–6 pilih kategori · Enter simpan + lanjut · Shift+Enter kembali
              </p>
            </>
          ) : (
            <p className="font-body text-sm text-muted-foreground">Pilih sebuah track.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="muted">{totalReviewed} track direview di seluruh video</Badge>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={totalReviewed === 0}>
          Export JSON
        </Button>
      </div>
    </div>
  );
}
