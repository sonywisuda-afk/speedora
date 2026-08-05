'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Nav } from '../../../../components/Nav';
import { OcrReviewer } from '../../../../components/OcrReviewer';
import { getVideo, type VideoWithClipsDto } from '../../../../lib/api';
import { useAuth } from '../../../../lib/useAuth';

// Standalone page for the OCR dataset-annotation tool - deliberately NOT a
// tab/mode inside /videos/:id/edit (Timeline Editor). Same auth-gate/Nav
// shell as the edit page, but its own route, its own data fetch (only
// needs the clips' ocrTracks, not the transcript Timeline Editor loads),
// and its own component (OcrReviewer.tsx) with no shared state.
export default function OcrReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, checkingAuth, logout } = useAuth();
  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getVideo(id)
      .then((v) => {
        if (!cancelled) setVideo(v);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat video');
      });

    return () => {
      cancelled = true;
    };
  }, [user, id]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          OCR Review — validasi kategori teks hasil deteksi otomatis untuk membangun dataset
          evaluasi.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk mereview OCR video kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!error && video && <OcrReviewer videoId={video.id} clips={video.clips} />}
          </>
        )}
      </div>
    </main>
  );
}
