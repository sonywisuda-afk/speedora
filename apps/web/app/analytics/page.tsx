'use client';

import type {
  AnalyticsOverviewDto,
  AnalyticsPerformanceDto,
  TopClipRow,
  TopVideoRow,
} from '@speedora/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AiPerformanceSummary } from '../../components/analytics/AiPerformanceSummary';
import { AnalyticsReportExport } from '../../components/analytics/AnalyticsReportExport';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { EngagementTrendChart } from '../../components/analytics/EngagementTrendChart';
import { GrowthSummary } from '../../components/analytics/GrowthSummary';
import { PlatformBreakdown } from '../../components/analytics/PlatformBreakdown';
import { PlatformComparisonTable } from '../../components/analytics/PlatformComparisonTable';
import { ProcessingStatusBreakdown } from '../../components/analytics/ProcessingStatusBreakdown';
import { StatTile } from '../../components/analytics/StatTile';
import { TopClipsTable } from '../../components/analytics/TopClipsTable';
import { TopVideosTable } from '../../components/analytics/TopVideosTable';
import { UploadTrendChart } from '../../components/analytics/UploadTrendChart';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Nav } from '../../components/Nav';
import {
  getAnalyticsOverview,
  getAnalyticsPerformance,
  getAnalyticsPerformanceClips,
  getAnalyticsPerformanceVideos,
} from '../../lib/api';
import { formatEngagementScore } from '../../lib/analytics';
import { useAuth } from '../../lib/useAuth';

// Milestones 5A (Overview) + 5B (Performance) - user-wide, not per-video
// (unlike Milestone 4's per-clip explainability page). Overview loads once;
// the performance section re-fetches all three /analytics/performance*
// endpoints whenever the date-range filter changes.
export default function AnalyticsPage() {
  const { user, checkingAuth, logout } = useAuth();
  const [overview, setOverview] = useState<AnalyticsOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [performance, setPerformance] = useState<AnalyticsPerformanceDto | null>(null);
  const [topClips, setTopClips] = useState<TopClipRow[] | null>(null);
  const [topVideos, setTopVideos] = useState<TopVideoRow[] | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getAnalyticsOverview()
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat analytics');
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([
      getAnalyticsPerformance({ days }),
      getAnalyticsPerformanceClips({ days }),
      getAnalyticsPerformanceVideos({ days }),
    ])
      .then(([performanceData, clipsData, videosData]) => {
        if (cancelled) return;
        setPerformance(performanceData);
        setTopClips(clipsData.clips);
        setTopVideos(videosData.videos);
      })
      .catch((err) => {
        if (!cancelled) {
          setPerformanceError(err instanceof Error ? err.message : 'Gagal memuat data performa');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, days]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Analytics — ringkasan performa video, klip, dan publikasi kamu.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat analytics kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            <div className="mt-4 flex justify-end">
              <AnalyticsReportExport />
            </div>

            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!error && overview ? (
              <div className="mt-4 space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile label="Total Video" value={String(overview.totalVideos)} />
                  <StatTile label="Total Klip" value={String(overview.totalClips)} />
                  <StatTile label="Klip Dipublikasikan" value={String(overview.publishedClips)} />
                  <StatTile
                    label="Rata-rata Engagement"
                    value={formatEngagementScore(overview.averageEngagementScore)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Distribusi Platform</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PlatformBreakdown breakdown={overview.platformBreakdown} />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Status Pemrosesan Video</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ProcessingStatusBreakdown processingStatus={overview.processingStatus} />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Tren Upload (30 Hari Terakhir)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <UploadTrendChart uploadTrend={overview.uploadTrend} />
                  </CardContent>
                </Card>
              </div>
            ) : null}

            <div className="mt-8 flex items-center justify-between">
              <h2 className="font-display text-lg uppercase tracking-wide text-foreground">
                Performance
              </h2>
              <DateRangeFilter value={days} onChange={setDays} />
            </div>

            {performanceError && (
              <p className="mt-4 font-body text-sm text-destructive">{performanceError}</p>
            )}

            {!performanceError && performance && topClips && topVideos ? (
              <div className="mt-4 space-y-6">
                <GrowthSummary growthSummary={performance.growthSummary} />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Tren Engagement</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EngagementTrendChart engagementTrend={performance.engagementTrend} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Perbandingan Platform</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PlatformComparisonTable platformComparison={performance.platformComparison} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Ringkasan Performa AI</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AiPerformanceSummary summary={performance.aiSummary} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Klip Berperforma Terbaik</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TopClipsTable clips={topClips} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Video Berperforma Terbaik</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TopVideosTable videos={topVideos} />
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
