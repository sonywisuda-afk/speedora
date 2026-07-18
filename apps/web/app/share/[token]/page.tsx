'use client';

import type { SharedVideoDto } from '@speedora/shared';
import { useEffect, useState } from 'react';
import { getSharedVideo, sharedThumbnailUrl, sharedVideoStreamUrl } from '@/lib/api';

// Sprint 5B (Shared Clips) - deliberately unauthenticated: the raw token in
// the URL is the only credential a link holder needs, no Speedora account
// required. Every fetch below hits GET /share/:token or one of its
// sub-routes (all public, no JwtAuthGuard), never the authenticated
// /videos/:id family this app's other pages use.
export default function SharedVideoPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<SharedVideoDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedVideo(params.token)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Link ini tidak valid atau sudah tidak berlaku'),
      );
  }, [params.token]);

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>

        {error ? (
          <p className="mt-8 font-body text-sm text-destructive">{error}</p>
        ) : !data ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <div className="mt-6 space-y-8">
            <div>
              <p className="font-body text-sm text-muted-foreground">
                Dibagikan sebagai <span className="text-foreground">{data.role}</span>
              </p>
              <h2 className="mt-1 font-display text-lg text-foreground">
                {data.video.title ?? 'Video tanpa judul'}
              </h2>
              <video
                src={sharedVideoStreamUrl(data.video.sourceStreamUrl)}
                controls
                preload="metadata"
                poster={
                  data.video.thumbnailUrl ? sharedThumbnailUrl(data.video.thumbnailUrl) : undefined
                }
                className="mt-3 max-h-[70vh] w-full rounded-lg bg-bay-black"
              />
            </div>

            {data.clips.length > 0 && (
              <div>
                <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
                  Klip
                </h3>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {data.clips.map((clip) => (
                    <li
                      key={clip.id}
                      className="overflow-hidden rounded-md border border-border bg-slate-panel"
                    >
                      {clip.streamUrl ? (
                        <video
                          src={sharedVideoStreamUrl(clip.streamUrl)}
                          controls
                          preload="metadata"
                          poster={
                            clip.thumbnailUrl ? sharedThumbnailUrl(clip.thumbnailUrl) : undefined
                          }
                          className="aspect-[9/16] w-full bg-bay-black object-cover"
                        />
                      ) : (
                        <div className="flex aspect-[9/16] items-center justify-center">
                          <span className="font-body text-xs text-muted-foreground">
                            Merender...
                          </span>
                        </div>
                      )}
                      {clip.hookText && (
                        <p className="p-2 font-body text-xs italic text-foreground">
                          &quot;{clip.hookText}&quot;
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
