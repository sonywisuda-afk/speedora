'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Nav } from '../../../../components/Nav';
import { TimelineEditor } from '../../../../components/TimelineEditor';
import { VideoAnalysisDashboard } from '../../../../components/editor/VideoAnalysisDashboard';
import { getVideo, getVideoTranscript } from '../../../../lib/api';
import { useTimelineStore } from '../../../../lib/timelineStore';
import { useAuth } from '../../../../lib/useAuth';

export default function EditVideoPage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useTimelineStore((s) => s.load);
  const selectClip = useTimelineStore((s) => s.selectClip);
  // Set by the gallery grid (Fase 4) so clicking a specific clip's card
  // opens the editor on that clip, not always the first one - load()
  // itself defaults selectedClipId to clips[0].
  const requestedClipId = useSearchParams().get('clip');

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function fetchData() {
      try {
        const [video, transcript] = await Promise.all([
          getVideo(params.id),
          getVideoTranscript(params.id),
        ]);
        if (cancelled) return;
        if (video.clips.length === 0) {
          setError(
            'Video ini belum punya klip terdeteksi - kembali lagi setelah pemrosesan selesai.',
          );
          return;
        }
        load(params.id, video.clips, transcript);
        if (requestedClipId && video.clips.some((c) => c.id === requestedClipId)) {
          selectClip(requestedClipId);
        }
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat video');
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [user, params.id, load, selectClip, requestedClipId]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Timeline editor — trim dan render ulang klip.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk mengedit video kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!error && loaded && (
              <div className="mt-3">
                <VideoAnalysisDashboard />
                <TimelineEditor videoId={params.id} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
