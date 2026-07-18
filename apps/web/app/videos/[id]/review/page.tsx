'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApprovalPanel } from '@/components/editor/ApprovalPanel';
import { CommentsPanel } from '@/components/editor/CommentsPanel';
import { FaceReviewPanel } from '@/components/review/FaceReviewPanel';
import { FrameByFrameViewer } from '@/components/review/FrameByFrameViewer';
import { HighlightReviewPanel } from '@/components/review/HighlightReviewPanel';
import { TranscriptReviewPanel } from '@/components/review/TranscriptReviewPanel';
import { Nav } from '@/components/Nav';
import { getVideo, getVideoTranscript, type VideoWithClipsDto } from '@/lib/api';
import { useTimelineStore } from '@/lib/timelineStore';
import { useAuth } from '@/lib/useAuth';

const MODES = [
  { id: 'frame', label: 'Frame-by-Frame' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'face', label: 'Face' },
  { id: 'highlight', label: 'Highlight' },
] as const;

type Mode = (typeof MODES)[number]['id'];

// Sprint 5G (Review Mode) - a unified reviewer shell, distinct from the
// Timeline Editor (which is edit-focused: trim, caption, re-render). This
// page is entirely new UI wrapped around data every sub-panel already had
// access to (getVideo/getVideoTranscript, no new backend routes) - Frame-
// by-Frame is the one genuinely new capability; Face/Highlight Review are
// read-only presentations of already-computed, frozen AI pipeline output
// (see docs/ai/vision.md, docs/ai/fusion.md); OCR Review reuses the
// existing /videos/[id]/ocr-review page (linked, not re-embedded, since it
// already has its own substantial annotation-correction state). Embeds the
// existing CommentsPanel/ApprovalPanel (Sprint 5C/5D) so a reviewer can act
// without leaving - the "wraps 5C/5D's comments/approval" the roadmap
// called for.
export default function ReviewModePage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('frame');
  const load = useTimelineStore((s) => s.load);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchData() {
      try {
        const [v, transcript] = await Promise.all([
          getVideo(params.id),
          getVideoTranscript(params.id),
        ]);
        if (cancelled) return;
        setVideo(v);
        // Feeds Frame-by-Frame/Transcript/Comments' shared playhead + reply
        // context - same load() the Timeline Editor calls, so this page and
        // the editor stay consistent if a reviewer opens both.
        load(params.id, v.clips, transcript);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat video');
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [user, params.id, load]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">
          Review Mode
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          {video?.title ?? 'Memuat...'}
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk membuka Review Mode.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!error && video && (
              <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
                <div>
                  <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMode(m.id)}
                        className={`rounded-md px-3 py-1.5 font-body text-sm ${
                          mode === m.id
                            ? 'bg-slate-panel font-medium text-signal-pink'
                            : 'text-muted-foreground hover:bg-slate-panel/60'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                    <Link
                      href={`/videos/${params.id}/ocr-review`}
                      className="ml-auto rounded-md px-3 py-1.5 font-body text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      OCR Review →
                    </Link>
                  </div>

                  <div className="mt-4">
                    {mode === 'frame' && <FrameByFrameViewer videoId={params.id} />}
                    {mode === 'transcript' && <TranscriptReviewPanel />}
                    {mode === 'face' && <FaceReviewPanel clips={video.clips} />}
                    {mode === 'highlight' && (
                      <HighlightReviewPanel videoId={params.id} clips={video.clips} />
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <ApprovalPanel videoId={params.id} />
                  <CommentsPanel videoId={params.id} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
