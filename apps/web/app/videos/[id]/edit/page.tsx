'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Nav } from '../../../../components/Nav';
import { TimelineEditor } from '../../../../components/TimelineEditor';
import { ApprovalPanel } from '../../../../components/editor/ApprovalPanel';
import { CommentsPanel } from '../../../../components/editor/CommentsPanel';
import { VideoAnalysisDashboard } from '../../../../components/editor/VideoAnalysisDashboard';
import { getVideo, getVideoTranscript } from '../../../../lib/api';
import { useTimelineStore } from '../../../../lib/timelineStore';
import { useAuth } from '../../../../lib/useAuth';

// Code-split (same reasoning as QuickActions.tsx's InviteMemberDialog) -
// the Export Center's Dialog/Tabs/SWR-polling machinery is only needed
// once a user actually clicks "Export", not on every editor page load.
const ExportCenterDialog = dynamic(
  () => import('../../../../components/export/ExportCenterDialog').then((mod) => mod.ExportCenterDialog),
  {
    ssr: false,
    loading: () => (
      <Button variant="outline" disabled>
        Export
      </Button>
    ),
  },
);

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
                <div className="mb-3 flex justify-end">
                  <ExportCenterDialog videoId={params.id} />
                </div>
                <VideoAnalysisDashboard />
                <TimelineEditor videoId={params.id} />
                <ApprovalPanel videoId={params.id} />
                <CommentsPanel videoId={params.id} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
