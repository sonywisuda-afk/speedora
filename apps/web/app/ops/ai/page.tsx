'use client';

import type {
  OpsAiCalibrationSnapshot,
  OpsAiCorrelationSnapshot,
  OpsAiDistributionSnapshot,
  OpsAiDriftSnapshot,
  OpsAiHealthSnapshot,
  OpsAiReadinessSnapshot,
  OpsAiSignalsSnapshot,
} from '@speedora/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AiHealthPanel } from '@/components/ops-ai/AiHealthPanel';
import { CalibrationTable } from '@/components/ops-ai/CalibrationTable';
import { CorrelationPanel } from '@/components/ops-ai/CorrelationPanel';
import { DriftTable } from '@/components/ops-ai/DriftTable';
import { ExplainabilityReasonsList } from '@/components/ops-ai/ExplainabilityReasonsList';
import { FeatureCompletenessTable } from '@/components/ops-ai/FeatureCompletenessTable';
import { FeatureDistributionTable } from '@/components/ops-ai/FeatureDistributionTable';
import { HistogramBars } from '@/components/ops-ai/HistogramBars';
import { ReadinessPanel } from '@/components/ops-ai/ReadinessPanel';
import { SignalContributionChart } from '@/components/ops-ai/SignalContributionChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Nav } from '@/components/Nav';
import {
  ApiError,
  getOpsAiCalibration,
  getOpsAiCorrelation,
  getOpsAiDistribution,
  getOpsAiDrift,
  getOpsAiHealth,
  getOpsAiReadiness,
  getOpsAiSignals,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Milestone 5C-B - AI Operations Dashboard. System-wide (pools every user's
// clips, no ownerId filter - see docs/backend.md), restricted server-side
// to ADMIN/AI_ENGINEER/OPERATOR (RolesGuard). A distinct page from
// /analytics on purpose - this answers "is the AI model healthy?" (an
// engineering question), not "how did my content perform?" (a creator
// question). Merges Milestone 1.5's Dataset Health/Drift/Correlation/
// Calibration (previously only reachable via a CLI script) with Milestone
// 5C's AI Health/Signal Analytics/Distribution/Readiness - one page an
// engineer can open instead of running scripts and reading raw JSON.
export default function OpsAiPage() {
  const { user, checkingAuth, logout } = useAuth();
  const [health, setHealth] = useState<OpsAiHealthSnapshot | null>(null);
  const [signals, setSignals] = useState<OpsAiSignalsSnapshot | null>(null);
  const [distribution, setDistribution] = useState<OpsAiDistributionSnapshot | null>(null);
  const [correlation, setCorrelation] = useState<OpsAiCorrelationSnapshot | null>(null);
  const [calibration, setCalibration] = useState<OpsAiCalibrationSnapshot | null>(null);
  const [drift, setDrift] = useState<OpsAiDriftSnapshot | null>(null);
  const [readiness, setReadiness] = useState<OpsAiReadinessSnapshot | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([
      getOpsAiHealth(),
      getOpsAiSignals(),
      getOpsAiDistribution(),
      getOpsAiCorrelation(),
      getOpsAiCalibration(),
      getOpsAiDrift(),
      getOpsAiReadiness(),
    ])
      .then(([h, s, d, c, cal, dr, r]) => {
        if (cancelled) return;
        setHealth(h.results[0]);
        setSignals(s.results[0]);
        setDistribution(d.results[0]);
        setCorrelation(c.results[0]);
        setCalibration(cal.results[0]);
        setDrift(dr.results[0]);
        setReadiness(r.results[0]);
      })
      .catch((err) => {
        if (cancelled) return;
        // Phase F (RBAC hardening) - checks the real HTTP status now
        // (RolesGuard always responds 403 for this page, see
        // roles.guard.ts), not a string match against the exact backend
        // error message, which would silently break if that wording ever
        // changed.
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(err instanceof Error ? err.message : 'Gagal memuat AI Diagnostics');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          AI Ops — kesehatan dan kualitas model AI, mencakup seluruh platform (bukan data satu
          user).
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat AI Ops.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {forbidden ? (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Halaman ini dibatasi untuk role ADMIN/AI_ENGINEER/OPERATOR. Akun kamu saat ini tidak
                memiliki akses.
              </p>
            ) : error ? (
              <p className="mt-4 font-body text-sm text-destructive">{error}</p>
            ) : (
              <div className="mt-4 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">AI Health</CardTitle>
                  </CardHeader>
                  <CardContent>{health ? <AiHealthPanel health={health} /> : null}</CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Signal Analytics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {signals ? (
                      <>
                        <SignalContributionChart signals={signals.signalContributions} />
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            Explainability Analytics
                          </p>
                          <div className="mt-2">
                            <ExplainabilityReasonsList reasons={signals.explainabilityReasons} />
                          </div>
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Score Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {distribution ? (
                        <HistogramBars bars={distribution.scoreDistribution} />
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Confidence Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {distribution ? (
                        <HistogramBars bars={distribution.confidenceDistribution} />
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Feature Completeness</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {distribution ? (
                      <FeatureCompletenessTable rows={distribution.featureCompleteness} />
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Feature Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {distribution ? (
                      <FeatureDistributionTable rows={distribution.featureDistribution} />
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Correlation Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {correlation ? <CorrelationPanel {...correlation} /> : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Weight Calibration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {calibration ? <CalibrationTable {...calibration} /> : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Feature Drift</CardTitle>
                  </CardHeader>
                  <CardContent>{drift ? <DriftTable {...drift} /> : null}</CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Training Readiness</CardTitle>
                  </CardHeader>
                  <CardContent>{readiness ? <ReadinessPanel {...readiness} /> : null}</CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
