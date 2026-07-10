import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

// Fusion Engine weight calibration (docs/ai/fusion.md's "future weight
// optimization checkpoint") needs real engagement data to fit weights for the
// weight-0 signals (editingRhythm, sceneMotion, cameraMotion, gesture,
// faceGeometry) against. Before building the actual statistical pipeline
// (correlation/regression/confidence intervals), this script answers a
// cheaper prior question: is there even enough data to make that statistically
// meaningful? Rerun this as production data accumulates - the recommendation
// is expected to flip from "insufficient" to "proceed" over time.
//
// A `usableSample` here is a clip that has BOTH a computed editingRhythmFeatures
// value AND at least one PublishRecord with a non-null viewCount - the minimum
// needed to correlate a feature against an engagement outcome at all.
const MIN_SAMPLES_FOR_STATISTICAL_CALIBRATION = 500;

async function main() {
  const { prisma } = await import('../prisma');

  const [
    totalClips,
    clipsWithEditingRhythm,
    publishRecords,
    clipsWithAnyPublishRecord,
    recordsWithViewCount,
    recordsWithLikeCount,
    recordsWithCommentCount,
    platformBreakdown,
    duplicatePublishGroups,
  ] = await Promise.all([
    prisma.clip.count(),
    prisma.clip.count({ where: { editingRhythmFeatures: { not: null as never } } }),
    prisma.publishRecord.findMany({
      select: { clipId: true, viewCount: true, likeCount: true, commentCount: true },
    }),
    prisma.publishRecord.findMany({ select: { clipId: true }, distinct: ['clipId'] }),
    prisma.publishRecord.count({ where: { viewCount: { not: null } } }),
    prisma.publishRecord.count({ where: { likeCount: { not: null } } }),
    prisma.publishRecord.count({ where: { commentCount: { not: null } } }),
    prisma.publishRecord.groupBy({
      by: ['socialAccountId'],
      _count: true,
    }),
    prisma.publishRecord.groupBy({
      by: ['clipId', 'socialAccountId'],
      _count: true,
      having: { clipId: { _count: { gt: 1 } } },
    }),
  ]);

  // Platform requires a join - groupBy on socialAccountId alone doesn't carry
  // the platform enum, so resolve it in a second pass.
  const socialAccounts = await prisma.socialAccount.findMany({
    select: { id: true, platform: true },
  });
  const platformById = new Map(socialAccounts.map((a) => [a.id, a.platform]));
  const platformCounts = new Map<string, number>();
  for (const group of platformBreakdown) {
    const platform = platformById.get(group.socialAccountId) ?? 'UNKNOWN';
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + group._count);
  }

  const clipIdsWithEditingRhythm = new Set(
    (
      await prisma.clip.findMany({
        where: { editingRhythmFeatures: { not: null as never } },
        select: { id: true },
      })
    ).map((c) => c.id),
  );
  const clipIdsWithViewCount = new Set(
    publishRecords.filter((r) => r.viewCount !== null).map((r) => r.clipId),
  );
  const usableSampleClipIds = [...clipIdsWithEditingRhythm].filter((id) =>
    clipIdsWithViewCount.has(id),
  );

  const viewCounts = publishRecords.map((r) => r.viewCount).filter((v): v is number => v !== null);
  const outliers = detectOutliersIqr(viewCounts);

  const coverage = {
    totalClips,
    clipsWithEditingRhythmFeatures: clipsWithEditingRhythm,
    clipsWithAnyPublishRecord: clipsWithAnyPublishRecord.length,
    publishRecordsWithViewCount: recordsWithViewCount,
    publishRecordsWithLikeCount: recordsWithLikeCount,
    publishRecordsWithCommentCount: recordsWithCommentCount,
    platformBreakdown: Object.fromEntries(platformCounts),
    duplicatePublishGroups: duplicatePublishGroups.length,
    usableSamples: usableSampleClipIds.length,
    featureCoveragePct: pct(clipsWithEditingRhythm, totalClips),
    engagementCoveragePct: pct(clipsWithAnyPublishRecord.length, totalClips),
    usableSamplePct: pct(usableSampleClipIds.length, totalClips),
    outlierCountByIqr: outliers.length,
  };

  const recommendation =
    coverage.usableSamples >= MIN_SAMPLES_FOR_STATISTICAL_CALIBRATION
      ? ('A' as const)
      : coverage.usableSamples > 0
        ? ('B' as const)
        : ('C_OR_B' as const);

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: MIN_SAMPLES_FOR_STATISTICAL_CALIBRATION,
    coverage,
    recommendation,
  };

  console.log(renderMarkdown(report));
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(report, null, 2));

  await prisma.$disconnect();
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Standard 1.5*IQR rule. Guarded for small n (Prisma's docs.md rounding rules
// aside) since IQR is not meaningful below ~4 points.
function detectOutliersIqr(values: number[]): number[] {
  if (values.length < 4) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return sorted.filter((v) => v < lower || v > upper);
}

interface CoverageReport {
  generatedAt: string;
  threshold: number;
  coverage: {
    totalClips: number;
    clipsWithEditingRhythmFeatures: number;
    clipsWithAnyPublishRecord: number;
    publishRecordsWithViewCount: number;
    publishRecordsWithLikeCount: number;
    publishRecordsWithCommentCount: number;
    platformBreakdown: Record<string, number>;
    duplicatePublishGroups: number;
    usableSamples: number;
    featureCoveragePct: number;
    engagementCoveragePct: number;
    usableSamplePct: number;
    outlierCountByIqr: number;
  };
  recommendation: 'A' | 'B' | 'C_OR_B';
}

function renderMarkdown(report: CoverageReport): string {
  const c = report.coverage;
  const recommendationText: Record<typeof report.recommendation, string> = {
    A: `Proceed with statistical calibration (Option A) - ${c.usableSamples} usable samples >= threshold of ${report.threshold}.`,
    B: `Collect more production data first (Option B) - ${c.usableSamples} usable sample(s) exist but far below the ${report.threshold}-sample threshold for meaningful correlation/regression.`,
    C_OR_B: `No usable samples exist yet (0 clips have both editingRhythmFeatures AND a linked PublishRecord with viewCount). Statistical calibration is not possible. Choose Option B (wait, and re-run this script periodically) or Option C (assign a temporary heuristic weight, documented as unvalidated) - this is a product decision, not something this script can decide.`,
  };

  return `# Editing Rhythm Weight Calibration - Coverage Report

Generated: ${report.generatedAt}

## Coverage

| Metric | Value |
|---|---|
| Total clips | ${c.totalClips} |
| Clips with \`editingRhythmFeatures\` | ${c.clipsWithEditingRhythmFeatures} (${c.featureCoveragePct}%) |
| Clips with any \`PublishRecord\` | ${c.clipsWithAnyPublishRecord} (${c.engagementCoveragePct}%) |
| PublishRecords with viewCount | ${c.publishRecordsWithViewCount} |
| PublishRecords with likeCount | ${c.publishRecordsWithLikeCount} |
| PublishRecords with commentCount | ${c.publishRecordsWithCommentCount} |
| Duplicate (clip, socialAccount) publish groups | ${c.duplicatePublishGroups} |
| **Usable samples** (feature + viewCount both present) | **${c.usableSamples}** (${c.usableSamplePct}%) |
| Outliers (viewCount, 1.5*IQR) | ${c.outlierCountByIqr} |

## Platform breakdown (publish records)

${
  Object.keys(c.platformBreakdown).length === 0
    ? '_No publish records yet._'
    : Object.entries(c.platformBreakdown)
        .map(([platform, count]) => `- ${platform}: ${count}`)
        .join('\n')
}

## Recommendation

${recommendationText[report.recommendation]}
`;
}

main().catch((error) => {
  console.error('[check-calibration-coverage] failed:', error);
  process.exit(1);
});
