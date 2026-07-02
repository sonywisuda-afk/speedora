'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Nav } from '../../../../components/Nav';
import { TimelineEditor } from '../../../../components/TimelineEditor';
import { getVideo, getVideoTranscript } from '../../../../lib/api';
import { useTimelineStore } from '../../../../lib/timelineStore';
import { useAuth } from '../../../../lib/useAuth';

export default function EditVideoPage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useTimelineStore((s) => s.load);

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
          setError('This video has no detected clips yet - come back once processing finishes.');
          return;
        }
        load(params.id, video.clips, transcript);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load video');
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [user, params.id, load]);

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">viral-clip-app</h1>
        <p className="mt-1 text-sm text-neutral-600">Timeline editor - trim and re-render clips.</p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 text-sm text-neutral-600">
            <Link href="/" className="underline">
              Log in
            </Link>{' '}
            to edit your videos.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {!error && loaded && (
              <div className="mt-4">
                <TimelineEditor videoId={params.id} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
