'use client';

import type { ClipEngineExplainability, FusionEngineVersion } from '@speedora/shared';
import { ScoreGauge } from '@/components/ScoreGauge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatConfidence, predictionBadge, sortTopFactors } from '@/lib/explainability';
import { SignalBreakdownChart } from './SignalBreakdownChart';

// Record<FusionEngineVersion, string> instead of Record<string, string> so
// the compiler rejects a build that adds a real v3 output (see that type's
// own comment - `results` is an array specifically to allow this) without a
// matching label here.
const ENGINE_LABELS: Record<FusionEngineVersion, string> = {
  v2: 'Fusion Engine v2',
  v3: 'Fusion Engine v3',
};

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40 text-success',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-destructive/40 text-destructive',
};

export interface ExplainabilityDetailPanelProps {
  results: ClipEngineExplainability[];
  loading: boolean;
  error: string | null;
}

// Iterates `results` (today: always exactly one `engine: 'v2'` entry) so a
// future milestone that wires a real v3 Predictor can add a second entry
// and have it render as its own card, side by side, without this component
// needing a redesign - see packages/shared/src/types/explainability.ts's
// ClipExplainabilityDto comment.
export function ExplainabilityDetailPanel({
  results,
  loading,
  error,
}: ExplainabilityDetailPanelProps) {
  if (loading) {
    return <p className="font-body text-sm text-muted-foreground">Memuat penjelasan AI...</p>;
  }
  if (error) {
    return <p className="font-body text-sm text-destructive">{error}</p>;
  }
  if (results.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Pilih klip untuk melihat penjelasan AI.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {results.map((result) => {
        const badge = predictionBadge(result.highlightPrediction?.bucket);
        return (
          <Card key={result.engine}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {ENGINE_LABELS[result.engine]}
              </CardTitle>
              <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
                {badge.label}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-6">
                <ScoreGauge score={result.highlightScore ?? 0} size={56} label="Highlight score" />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Highlight Score
                  </p>
                  <p className="font-display text-2xl text-foreground">
                    {result.highlightScore !== null ? Math.round(result.highlightScore) : '—'}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Confidence
                  </p>
                  <p className="font-display text-2xl text-foreground">
                    {formatConfidence(result.highlightConfidence)}
                  </p>
                  <p className="max-w-[16rem] font-body text-[10px] text-muted-foreground">
                    Estimasi heuristik cakupan &amp; kualitas sinyal, bukan probabilitas
                    terkalibrasi.
                  </p>
                </div>
              </div>

              {result.highlightReason ? (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Kenapa klip ini dipilih
                  </p>
                  <p className="mt-1 font-body text-sm text-foreground">{result.highlightReason}</p>
                </div>
              ) : null}

              {result.highlightPrediction ? (
                <p className="font-body text-xs text-muted-foreground">
                  {result.highlightPrediction.rationale}
                </p>
              ) : null}

              {result.highlightRecommendation ? (
                <div className="rounded-md border border-ai/30 bg-muted p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-ai">
                    Rekomendasi
                  </p>
                  <p className="mt-1 font-body text-sm text-foreground">
                    {result.highlightRecommendation.message}
                  </p>
                </div>
              ) : null}

              {result.highlightExplainability.topFactors.length > 0 ? (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Faktor Utama
                  </p>
                  <ul className="mt-1 space-y-1">
                    {sortTopFactors(result.highlightExplainability.topFactors).map((factor) => (
                      <li
                        key={`${factor.signal}.${factor.feature}`}
                        className="font-body text-xs text-foreground"
                      >
                        {factor.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  Rincian Sinyal
                </p>
                <div className="mt-2">
                  <SignalBreakdownChart breakdown={result.highlightBreakdown} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
