'use client';

import type { ClipPerformanceDto } from '@speedora/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ExplainabilityTimeline } from '../../../../components/explainability/ExplainabilityTimeline';
import { ExplainabilityDetailPanel } from '../../../../components/explainability/ExplainabilityDetailPanel';
import { ClipPerformanceHistoryTable } from '../../../../components/clip-performance/ClipPerformanceHistoryTable';
import { ClipTrafficTable } from '../../../../components/clip-performance/ClipTrafficTable';
import { AiInsightPanel } from '../../../../components/analytics/AiInsightPanel';
import { UnavailableMetric } from '../../../../components/analytics/UnavailableMetric';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Nav } from '../../../../components/Nav';
import { getClipPerformance, getVideo, type VideoWithClipsDto } from '../../../../lib/api';
import { useAuth } from '../../../../lib/useAuth';

// Sprint 6C (Analytics Dashboard Expansion - Per-Clip Performance).
// Standalone page (parallel to /videos/:id/explainability), read-only.
// Fetches getVideo() once for the clip list (same pattern as the
// explainability page - already includes every highlight* field for the
// timeline overview/initial selection), then lazily calls
// getClipPerformance() for only the currently-selected clip - a real
// per-clip round trip is worth it for a page most users won't select every
// clip on. Deliberately single-clip-oriented: nothing here shows an
// aggregate across other clips - that's /analytics's job.
export default function ClipPerformancePage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const [video, setVideo] = useState<VideoWithClipsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [performance, setPerformance] = useState<ClipPerformanceDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Same `?clip=` convention as /videos/:id/explainability - opening this
  // page from a particular clip's own link lands on that clip.
  const requestedClipId = useSearchParams().get('clip');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getVideo(params.id)
      .then((v) => {
        if (cancelled) return;
        setVideo(v);
        if (requestedClipId && v.clips.some((c) => c.id === requestedClipId)) {
          setSelectedClipId(requestedClipId);
          return;
        }
        const scored = v.clips.find((c) => c.highlightScore !== null);
        setSelectedClipId((scored ?? v.clips[0])?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat video');
      });

    return () => {
      cancelled = true;
    };
  }, [user, params.id, requestedClipId]);

  useEffect(() => {
    if (!selectedClipId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    getClipPerformance(selectedClipId)
      .then((dto) => {
        if (!cancelled) setPerformance(dto);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : 'Gagal memuat performa klip');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClipId]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Performa Klip — riwayat engagement, skor AI, dan distribusi untuk satu klip.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat performa klip kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!error && video ? (
              <div className="mt-4 space-y-6">
                <ExplainabilityTimeline
                  clips={video.clips}
                  duration={video.durationSeconds}
                  selectedClipId={selectedClipId}
                  onSelectClip={setSelectedClipId}
                />

                {detailLoading ? (
                  <p className="font-body text-sm text-muted-foreground">Memuat performa klip...</p>
                ) : detailError ? (
                  <p className="font-body text-sm text-destructive">{detailError}</p>
                ) : performance ? (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Performance</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ClipPerformanceHistoryTable performance={performance.performance} />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Score</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ExplainabilityDetailPanel
                          results={performance.score}
                          loading={false}
                          error={null}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">AI Insight</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <AiInsightPanel insight={performance.insight} />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Traffic</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ClipTrafficTable traffic={performance.traffic} workspaceId={video.workspaceId} />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Audience</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <UnavailableMetric
                          label="Audience"
                          reason={performance.audience.reason}
                        />
                      </CardContent>
                    </Card>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
