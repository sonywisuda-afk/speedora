import { Injectable } from '@nestjs/common';
import {
  computeFeatureDistribution,
  computeMissingDataReport,
  computeWeightCalibrationSuggestions,
  detectFeatureDrift,
  flattenClipFeatures,
  pearsonCorrelation,
  MIN_SAMPLES_FOR_CORRELATION,
  type DatasetRecord,
  type TimestampedRecord,
} from '@speedora/dataset-quality';
import { DEFAULT_FUSION_WEIGHTS } from '@speedora/fusion-engine';
import type {
  OpsAiCalibrationDto,
  OpsAiCorrelationDto,
  OpsAiDistributionDto,
  OpsAiDriftDto,
  OpsAiHealthDto,
  OpsAiReadinessDto,
  OpsAiSignalsDto,
} from '@speedora/shared';
import {
  computeConfidenceDistribution,
  computeExplainabilityReasonFrequency,
  computeScoreDistribution,
  computeSignalContributions,
} from '@speedora/analytics-report';
import { PrismaService } from '../prisma/prisma.service';
import {
  toSharedHighlightBreakdown,
  toSharedHighlightExplainability,
} from '../videos/transcript-segment.util';
import { computeAiHealth, computeReadinessVerdict } from './ops-ai.util';

const CLIP_SELECT = {
  id: true,
  viralityScore: true,
  highlightScore: true,
  highlightConfidence: true,
  highlightBreakdown: true,
} as const;

// Milestone 5C-B - AI Operations Dashboard. Every query here is system-wide
// (no ownerId filter) - unlike AnalyticsModule, which is strictly
// owner-scoped. Mirrors apps/worker/src/scripts/dataset-lib.ts's
// loadClipsWithFeatures/loadUsableSamples query shape (that file can't be
// imported here - apps only talk over HTTP/queue - so this is its own
// adapter over the same shared @speedora/dataset-quality pure functions).
// Each public method does its own independent fetch, no shared
// request-scoped cache - same precedent as MonitoringModule's
// /metrics//queues//workers/etc.
@Injectable()
export class OpsAiService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchFeatureDataset(): Promise<TimestampedRecord[]> {
    const clips = await this.prisma.clip.findMany({
      where: { highlightBreakdown: { not: null as never } },
      select: { ...CLIP_SELECT, createdAt: true },
    });
    return clips.map((c) => ({ record: flattenClipFeatures(c), createdAt: c.createdAt }));
  }

  private async fetchUsableSamples(): Promise<DatasetRecord[]> {
    const clips = await this.prisma.clip.findMany({
      where: { publishRecords: { some: { statsSnapshots: { some: {} } } } },
      select: {
        ...CLIP_SELECT,
        publishRecords: {
          select: { statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } },
        },
      },
    });

    const dataset: DatasetRecord[] = [];
    for (const clip of clips) {
      const latestSnapshot = clip.publishRecords
        .flatMap((r) => r.statsSnapshots)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
      if (!latestSnapshot) continue;
      dataset.push({
        ...flattenClipFeatures(clip),
        engagementScore: latestSnapshot.engagementScore,
      });
    }
    return dataset;
  }

  // Shared by getCorrelation/getCalibration/getReadiness - each still does
  // its own fetchUsableSamples() call, this just avoids repeating the
  // Pearson-correlation loop three times.
  private computeCorrelations(usableWithEngagement: DatasetRecord[]) {
    const featureKeys = new Set<string>();
    for (const record of usableWithEngagement) {
      for (const key of Object.keys(record)) {
        if (key === 'clipId' || key === 'engagementScore') continue;
        if (typeof record[key] === 'number') featureKeys.add(key);
      }
    }
    const engagementScores = usableWithEngagement.map((r) => r.engagementScore as number);
    return Array.from(featureKeys)
      .map((feature) => ({
        feature,
        correlation: pearsonCorrelation(
          usableWithEngagement.map((r) =>
            typeof r[feature] === 'number' ? (r[feature] as number) : null,
          ),
          engagementScores,
        ),
      }))
      .filter((c): c is { feature: string; correlation: number } => c.correlation !== null)
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  async getHealth(): Promise<OpsAiHealthDto> {
    const clips = await this.prisma.clip.findMany({
      where: { highlightScore: { not: null } },
      select: { highlightScore: true, highlightConfidence: true, highlightExplainability: true },
    });

    const health = computeAiHealth(
      clips.map((c) => ({
        highlightScore: c.highlightScore,
        highlightConfidence: c.highlightConfidence,
        hasExplainability:
          toSharedHighlightExplainability(c.highlightExplainability).topFactors.length > 0,
      })),
    );

    return { results: [{ engine: 'v2', ...health }] };
  }

  async getSignals(): Promise<OpsAiSignalsDto> {
    const clips = await this.prisma.clip.findMany({
      where: { highlightBreakdown: { not: null as never } },
      select: { highlightBreakdown: true, highlightExplainability: true },
    });

    const breakdowns = clips.map((c) => toSharedHighlightBreakdown(c.highlightBreakdown));
    const explainabilities = clips.map((c) =>
      toSharedHighlightExplainability(c.highlightExplainability),
    );

    return {
      results: [
        {
          engine: 'v2',
          signalContributions: computeSignalContributions(breakdowns),
          explainabilityReasons: computeExplainabilityReasonFrequency(explainabilities),
        },
      ],
    };
  }

  async getDistribution(): Promise<OpsAiDistributionDto> {
    const timestamped = await this.fetchFeatureDataset();
    const featureRecords = timestamped.map((t) => t.record);
    const scores = featureRecords
      .map((r) => r.highlightScore)
      .filter((v): v is number => typeof v === 'number');
    const confidences = featureRecords
      .map((r) => r.highlightConfidence)
      .filter((v): v is number => typeof v === 'number');

    return {
      results: [
        {
          engine: 'v2',
          scoreDistribution: computeScoreDistribution(scores),
          confidenceDistribution: computeConfidenceDistribution(confidences),
          featureDistribution: computeFeatureDistribution(featureRecords),
          featureCompleteness: computeMissingDataReport(featureRecords, featureRecords.length),
        },
      ],
    };
  }

  async getCorrelation(): Promise<OpsAiCorrelationDto> {
    const samples = await this.fetchUsableSamples();
    const usableWithEngagement = samples.filter((r) => typeof r.engagementScore === 'number');
    const hasEnoughSamples = usableWithEngagement.length >= MIN_SAMPLES_FOR_CORRELATION;

    return {
      results: [
        {
          engine: 'v2',
          hasEnoughSamples,
          sampleCount: usableWithEngagement.length,
          minSamplesRequired: MIN_SAMPLES_FOR_CORRELATION,
          correlations: hasEnoughSamples ? this.computeCorrelations(usableWithEngagement) : [],
        },
      ],
    };
  }

  async getCalibration(): Promise<OpsAiCalibrationDto> {
    const samples = await this.fetchUsableSamples();
    const usableWithEngagement = samples.filter((r) => typeof r.engagementScore === 'number');
    const hasEnoughSamples = usableWithEngagement.length >= MIN_SAMPLES_FOR_CORRELATION;
    const correlations = hasEnoughSamples ? this.computeCorrelations(usableWithEngagement) : [];

    return {
      results: [
        {
          engine: 'v2',
          hasEnoughSamples,
          sampleCount: usableWithEngagement.length,
          minSamplesRequired: MIN_SAMPLES_FOR_CORRELATION,
          suggestions: hasEnoughSamples
            ? computeWeightCalibrationSuggestions(correlations, DEFAULT_FUSION_WEIGHTS)
            : [],
        },
      ],
    };
  }

  async getDrift(): Promise<OpsAiDriftDto> {
    const timestamped = await this.fetchFeatureDataset();
    const drift = detectFeatureDrift(timestamped);
    // `in` narrowing (not the `insufficientData` literal-discriminant kind)
    // - apps/api's tsconfig has strictNullChecks: false, under which
    // boolean-literal discriminated-union narrowing doesn't reliably narrow;
    // `in` checks property existence directly and isn't affected by that.
    const entries = 'entries' in drift ? drift.entries : [];

    return {
      results: [{ engine: 'v2', insufficientData: drift.insufficientData, entries }],
    };
  }

  async getReadiness(): Promise<OpsAiReadinessDto> {
    const [timestamped, samples] = await Promise.all([
      this.fetchFeatureDataset(),
      this.fetchUsableSamples(),
    ]);
    const featureRecords = timestamped.map((t) => t.record);
    const usableWithEngagement = samples.filter((r) => typeof r.engagementScore === 'number');

    const verdict = computeReadinessVerdict({
      usableSamples: usableWithEngagement.length,
      drift: detectFeatureDrift(timestamped),
      featureCompleteness: computeMissingDataReport(featureRecords, featureRecords.length),
    });

    return { results: [{ engine: 'v2', ...verdict }] };
  }
}
