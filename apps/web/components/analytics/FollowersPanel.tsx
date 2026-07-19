'use client';

import type { FollowerAccountSeries } from '@speedora/shared';
import { getMetricCapability } from '@speedora/analytics-report';
import { formatShortDate, PLATFORM_LABELS } from '@/lib/analytics';
import { AnalyticsCard } from './AnalyticsCard';
import { AnalyticsEmptyState } from './AnalyticsEmptyState';
import { AnalyticsLineChart } from './AnalyticsLineChart';
import { UnavailableMetric } from './UnavailableMetric';

export interface FollowersPanelProps {
  accounts: FollowerAccountSeries[];
}

// Sprint 6F (Followers) - one card per connected account, not per platform
// (an account can have more than one on the same platform). Reads Sprint
// 6A's platform-capability.util.ts to decide the state per account:
// unavailable (LinkedIn/Threads, or TikTok before reconnecting) shows
// UnavailableMetric with the real reason; a supported platform with no
// snapshots yet (sync hasn't run, not "not available") shows a plain empty
// state instead - the two are honestly different situations, not
// collapsed into one generic "no data."
export function FollowersPanel({ accounts }: FollowersPanelProps) {
  if (accounts.length === 0) {
    return <AnalyticsEmptyState message="Belum ada akun media sosial yang terhubung." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {accounts.map((account) => {
        const capability = getMetricCapability(account.platform, 'followerCount');
        const chartData = account.history.map((point) => ({
          ...point,
          dateLabel: formatShortDate(point.capturedAt.slice(0, 10)),
        }));

        return (
          <AnalyticsCard
            key={account.socialAccountId}
            title={`${account.displayName} · ${PLATFORM_LABELS[account.platform]}`}
          >
            {capability.availability !== 'available' ? (
              <UnavailableMetric
                label="Followers"
                reason={capability.reason ?? 'Tidak tersedia di platform ini.'}
                action={
                  capability.availability === 'needs-reconnect'
                    ? { label: 'Hubungkan Ulang', href: '/social' }
                    : undefined
                }
              />
            ) : chartData.length === 0 ? (
              <AnalyticsEmptyState message="Belum ada data followers - sinkronisasi berjalan setiap hari." />
            ) : (
              <>
                <p className="font-display text-3xl text-foreground">
                  {account.latestFollowerCount?.toLocaleString() ?? '—'}
                </p>
                <div className="mt-2">
                  <AnalyticsLineChart
                    data={chartData}
                    xKey="dateLabel"
                    series={[{ key: 'followerCount', label: 'Followers' }]}
                    tooltipFormatter={(point) => [
                      { label: 'Followers', value: point.followerCount.toLocaleString() },
                    ]}
                    height={120}
                    isEmpty={false}
                    emptyMessage=""
                  />
                </div>
              </>
            )}
          </AnalyticsCard>
        );
      })}
    </div>
  );
}
