'use client';

import type { LeaderboardMetric } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { AnalyticsCard } from '@/components/analytics/AnalyticsCard';
import { LeaderboardBarPanel } from '@/components/analytics/LeaderboardBarPanel';
import { Nav } from '@/components/Nav';
import { cn } from '@/lib/utils';
import { getWorkspaceLeaderboard, getWorkspacePredictionModel } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const METRIC_OPTIONS: Array<{ value: LeaderboardMetric; label: string }> = [
  { value: 'engagementScore', label: 'Engagement' },
  { value: 'views', label: 'Views' },
  { value: 'likes', label: 'Likes' },
  { value: 'comments', label: 'Comments' },
  { value: 'shares', label: 'Shares' },
];

const DAYS_OPTIONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: '7 Hari' },
  { value: 30, label: '30 Hari' },
  { value: 90, label: '90 Hari' },
];

const LIMIT_OPTIONS: Array<{ value: 10 | 20; label: string }> = [
  { value: 10, label: 'Top 10' },
  { value: 20, label: 'Top 20' },
];

function ToggleGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-current={value === option.value ? 'true' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
            value === option.value
              ? 'bg-slate-panel font-medium text-signal-pink'
              : 'text-muted-foreground hover:bg-slate-panel/60 hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Sprint 6D (Leaderboard) - flat /leaderboard route reading the active
// workspace from useWorkspaceStore, same convention as /campaigns and
// /social (not the /workspaces/[id]/... URL-embedded pattern audit-log
// uses), since this sits in the same top-level nav tier. First real
// consumer of Sprint 6C.5's AnalyticsBarChart - no raw Recharts on this
// page. metric/days/limit are all user-adjustable; the API enforces its
// own limit ceiling (20) regardless of what's requested here.
export default function LeaderboardPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [metric, setMetric] = useState<LeaderboardMetric>('engagementScore');
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [limit, setLimit] = useState<10 | 20>(10);

  const { data: leaderboard, error } = useSWR(
    user && activeWorkspaceId ? ['leaderboard', activeWorkspaceId, metric, days, limit] : null,
    () => getWorkspaceLeaderboard(activeWorkspaceId as string, { metric, days, limit }),
  );

  // Sprint 6J (Predicted performance) - workspace-level transparency into
  // whether per-clip predictions (AiInsightPanel, on /videos/:id/performance)
  // are actually viable for this workspace yet, and how strong the
  // underlying correlation is.
  const { data: predictionModel } = useSWR(
    user && activeWorkspaceId ? ['prediction-model', activeWorkspaceId] : null,
    () => getWorkspacePredictionModel(activeWorkspaceId as string),
  );

  const metricLabel = METRIC_OPTIONS.find((m) => m.value === metric)!.label;

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
          Leaderboard
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Peringkat klip, creator, campaign, dan platform terbaik di workspace kamu.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat leaderboard.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {!activeWorkspaceId && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Pilih workspace terlebih dahulu (lihat pemilih workspace di navigasi).
              </p>
            )}
            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat leaderboard'}
              </p>
            )}

            {activeWorkspaceId && (
              <>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
                  <div className="flex items-center gap-3">
                    <ToggleGroup options={DAYS_OPTIONS} value={days} onChange={setDays} />
                    <ToggleGroup options={LIMIT_OPTIONS} value={limit} onChange={setLimit} />
                  </div>
                </div>

                {leaderboard && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <LeaderboardBarPanel
                      title="Top Clip"
                      rows={leaderboard.topClips}
                      valueLabel={metricLabel}
                      emptyMessage="Belum ada klip yang dipublikasikan pada rentang waktu ini."
                    />
                    <LeaderboardBarPanel
                      title="Top Creator"
                      rows={leaderboard.topCreators}
                      valueLabel={metricLabel}
                      emptyMessage="Belum ada creator dengan publikasi pada rentang waktu ini."
                    />
                    <LeaderboardBarPanel
                      title="Top Campaign"
                      rows={leaderboard.topCampaigns}
                      valueLabel={metricLabel}
                      emptyMessage="Belum ada campaign dengan publikasi pada rentang waktu ini."
                    />
                    <LeaderboardBarPanel
                      title="Top Platform"
                      rows={leaderboard.topPlatforms}
                      valueLabel={metricLabel}
                      emptyMessage="Belum ada publikasi pada rentang waktu ini."
                    />
                  </div>
                )}

                {predictionModel && (
                  <div className="mt-4">
                    <AnalyticsCard title="Prediction Model">
                      {predictionModel.hasEnoughSamples ? (
                        <p className="font-body text-sm text-foreground">
                          Prediksi performa per-klip aktif untuk workspace ini - korelasi{' '}
                          <span className="text-signal-cyan">
                            {predictionModel.correlation !== null
                              ? predictionModel.correlation.toFixed(2)
                              : '—'}
                          </span>{' '}
                          dari {predictionModel.sampleCount} klip yang sudah dipublikasikan.
                        </p>
                      ) : (
                        <p className="font-body text-sm text-muted-foreground">
                          Belum cukup klip yang dipublikasikan ({predictionModel.sampleCount}/
                          {predictionModel.minSamplesRequired}) untuk mengaktifkan prediksi performa
                          per-klip di workspace ini.
                        </p>
                      )}
                    </AnalyticsCard>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
