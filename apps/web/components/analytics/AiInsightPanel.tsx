import type { ClipInsightSection, ClipPerformanceClassification } from '@speedora/shared';
import { Badge } from '@/components/ui/badge';
import { UnavailableMetric } from './UnavailableMetric';

export interface AiInsightPanelProps {
  insight: ClipInsightSection;
}

interface ClassificationBadge {
  label: string;
  tone: 'good' | 'neutral' | 'bad';
}

const CLASSIFICATION_BADGES: Record<ClipPerformanceClassification, ClassificationBadge> = {
  over_performed: { label: 'Melebihi Ekspektasi', tone: 'good' },
  under_performed: { label: 'Di Bawah Ekspektasi', tone: 'bad' },
  as_expected: { label: 'Sesuai Ekspektasi', tone: 'neutral' },
  not_enough_data: { label: 'Data Belum Cukup', tone: 'neutral' },
};

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-rose-500/40 text-rose-400',
};

// Sprint 6I (AI Insight) - a rules-based narrative, reusing
// AiPerformanceSummary.tsx's own explainability rendering conventions
// (font-mono uppercase section labels, outline Badges, signal-cyan for
// highlighted numbers). topSignals/lowSignals are already frozen AI output
// (FusionFactor/FusionContribution) - this component only presents them,
// same "no new inference happens in the UI either" posture as the backend.
export function AiInsightPanel({ insight }: AiInsightPanelProps) {
  const badge = CLASSIFICATION_BADGES[insight.classification];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
          {badge.label}
        </Badge>
        {insight.comparedAgainst > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            dibandingkan dengan {insight.comparedAgainst} klip lain dari creator ini
          </span>
        )}
      </div>

      <p className="font-body text-sm text-foreground">{insight.summary}</p>

      {insight.topSignals.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Kenapa Berpotensi Viral
          </p>
          <ul className="mt-2 space-y-1.5">
            {insight.topSignals.map((factor) => (
              <li key={`${factor.signal}-${factor.feature}`} className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">
                  {factor.signal}
                </Badge>
                <span className="font-body text-sm text-muted-foreground">{factor.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight.lowSignals.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Sinyal Terlemah
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {insight.lowSignals.map((contribution) => (
              <li key={`${contribution.signal}-${contribution.feature}`}>
                <Badge variant="outline">
                  {contribution.signal} · {contribution.feature}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Prediksi Engagement
        </p>
        <div className="mt-2">
          {insight.prediction.available ? (
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-2xl text-signal-cyan">
                {insight.prediction.predictedEngagementScore?.toFixed(2)}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                korelasi{' '}
                {insight.prediction.correlation !== null
                  ? insight.prediction.correlation.toFixed(2)
                  : '—'}{' '}
                · berdasarkan {insight.prediction.sampleCount} klip lain dari creator ini
              </span>
            </div>
          ) : (
            <UnavailableMetric
              label="Prediksi Engagement"
              reason={insight.prediction.reason ?? 'Tidak tersedia.'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
