import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

// Editorial Director Phase A - Gate A1 (decision validation, docs/ai/editorial-director.md).
// Read-only against the live DB (a single TranscriptSegment.findMany), and writes NOTHING back to
// Postgres/MinIO - the one real side effect is the OpenAI clip-scoring call this script issues
// itself. Generates ONE real candidate pool (one clip-scoring LLM call) so both flag states are
// compared against IDENTICAL candidates, not confounded by LLM non-determinism across two separate
// generations, then runs selectShortlist() twice - EDITORIAL_DIRECTOR_ENABLED unset vs 'true' -
// against that same pool, and reports the diff Gate A1 asked for: rank changes, negative-signal
// penalties, boundary nudges, redundancy eliminations, and a diversity/topic read on both
// shortlists.

const VIDEO_ID = process.argv[2] ?? 'cmsq31emh004d44u89ko3dvd2'; // McDonald's Marketing Mix, 18min/395 segments
const POOL_SIZE = 20; // requested ceiling - the model's own real candidate count for a given
// video/transcript is what actually comes back (observed: 1 (whole-video fallback) to 4 across
// two real runs against this video - not guaranteed to reach 20).

interface CandidateReport {
  index: number;
  startTime: number;
  endTime: number;
  hookText: string;
  topics: string[];
  keywords: string[];
  viralityScore: number;
}

interface ShortlistedReport {
  index: number;
  preRankScore: number;
  editorialScore: number | null;
  negativeSignals: { type: string; penalty: number; reason: string }[];
  boundaryNudge: {
    applied: boolean;
    suggestedStartTime: number;
    suggestedEndTime: number;
    reason: string;
  } | null;
}

async function runShortlist(
  selectShortlist: typeof import('@speedora/candidate-shortlist').selectShortlist,
  input: Parameters<typeof import('@speedora/candidate-shortlist').selectShortlist>[0],
  deps: Parameters<typeof import('@speedora/candidate-shortlist').selectShortlist>[1],
  flagOn: boolean,
): Promise<ShortlistedReport[]> {
  if (flagOn) {
    process.env.EDITORIAL_DIRECTOR_ENABLED = 'true';
  } else {
    delete process.env.EDITORIAL_DIRECTOR_ENABLED;
  }
  const { shortlisted } = await selectShortlist(input, deps);
  return shortlisted.map((entry) => ({
    index: entry.index,
    preRankScore: Math.round(entry.preRankScore * 10) / 10,
    editorialScore: entry.editorialDecision
      ? Math.round(entry.editorialDecision.editorialScore * 10) / 10
      : null,
    negativeSignals: (entry.editorialDecision?.negativeSignals ?? []).filter((s) => s.penalty > 0),
    boundaryNudge:
      entry.boundaryNudge && entry.boundaryNudge.applied
        ? {
            applied: true,
            suggestedStartTime: Math.round(entry.boundaryNudge.suggestedStartTime * 10) / 10,
            suggestedEndTime: Math.round(entry.boundaryNudge.suggestedEndTime * 10) / 10,
            reason: entry.boundaryNudge.reason,
          }
        : null,
  }));
}

function printShortlist(
  label: string,
  shortlist: ShortlistedReport[],
  candidates: CandidateReport[],
) {
  console.log(`\n### ${label} (${shortlist.length} survivors)\n`);
  for (const entry of shortlist) {
    const c = candidates[entry.index];
    console.log(
      `[#${entry.index}] preRank=${entry.preRankScore}` +
        (entry.editorialScore !== null ? ` editorial=${entry.editorialScore}` : '') +
        ` (${c.startTime.toFixed(0)}s-${c.endTime.toFixed(0)}s) "${c.hookText}"`,
    );
    console.log(
      `      topics: ${c.topics.join(', ') || '(none)'} | keywords: ${c.keywords.join(', ') || '(none)'}`,
    );
    if (entry.negativeSignals.length > 0) {
      for (const signal of entry.negativeSignals) {
        console.log(
          `      PENALTY ${signal.type} (-${signal.penalty.toFixed(1)}): ${signal.reason}`,
        );
      }
    }
    if (entry.boundaryNudge) {
      console.log(
        `      NUDGED: ${c.startTime.toFixed(1)}-${c.endTime.toFixed(1)} -> ` +
          `${entry.boundaryNudge.suggestedStartTime}-${entry.boundaryNudge.suggestedEndTime} ` +
          `(${entry.boundaryNudge.reason})`,
      );
    }
  }
}

async function main() {
  const { prisma } = await import('../prisma');
  const { openai } = await import('../openai');
  const { scoreClipCandidates } = await import('@speedora/clip-scoring');
  const { selectShortlist } = await import('@speedora/candidate-shortlist');
  const { filterSegmentsForClip } = await import('@speedora/shared');

  console.log(`Gate A1 - Editorial Director Phase A decision validation`);
  console.log(`Video: ${VIDEO_ID}\n`);

  const video = await prisma.video.findUnique({ where: { id: VIDEO_ID }, select: { title: true } });
  if (!video) {
    console.error(`No video found with id ${VIDEO_ID}`);
    process.exit(1);
  }
  console.log(`Title: ${video.title}`);

  const segments = await prisma.transcriptSegment.findMany({
    where: { videoId: VIDEO_ID },
    orderBy: { start: 'asc' },
  });
  console.log(`Transcript segments: ${segments.length}`);

  // Step 1: ONE real clip-scoring LLM call - the shared candidate pool both
  // flag states compare against.
  console.log(`\nCalling scoreClipCandidates (maxCandidates=${POOL_SIZE})...`);
  const { candidates: rawCandidates } = await scoreClipCandidates(
    {
      segments: segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        words: (s.words as { word: string; start: number; end: number }[] | null) ?? undefined,
      })),
      maxCandidates: POOL_SIZE,
    },
    { openai },
  );
  console.log(`Generated ${rawCandidates.length} raw candidates.`);

  // TARGET_SIZE is computed AFTER seeing the real pool size, deliberately
  // BELOW it (pool.length > targetSize is selectShortlist()'s own
  // activation condition - see docs/ai/editorial-director.md's "Editorial
  // Director cost scope" decision) - a fixed target risked the no-op path
  // firing whenever the model's real candidate count came in low (observed
  // across two real runs against this same video: 1 then 4).
  const TARGET_SIZE = Math.max(1, Math.ceil(rawCandidates.length / 2));
  console.log(`targetSize = ${TARGET_SIZE} (half of the real pool, rounded up)`);

  if (rawCandidates.length <= 1) {
    console.warn(
      `\nWARNING: pool has only ${rawCandidates.length} candidate(s) - no meaningful shortlisting ` +
        `is possible regardless of targetSize. Re-run (LLM variance) or try a different video.`,
    );
  }

  const candidateReports: CandidateReport[] = rawCandidates.map((c, index) => ({
    index,
    startTime: c.startTime,
    endTime: c.endTime,
    hookText: c.hookText,
    topics: c.topics,
    keywords: c.keywords,
    viralityScore: c.viralityScore,
  }));

  const shortlistInput = {
    candidates: rawCandidates.map((candidate) => ({
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      scores: candidate.scores,
      viralityScore: candidate.viralityScore,
      segments: filterSegmentsForClip(segments, candidate.startTime, candidate.endTime).map(
        (s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        }),
      ),
    })),
    targetSize: TARGET_SIZE,
  };

  console.log(`\nRunning selectShortlist() with EDITORIAL_DIRECTOR_ENABLED unset (baseline)...`);
  const baseline = await runShortlist(selectShortlist, shortlistInput, { openai }, false);

  console.log(`Running selectShortlist() with EDITORIAL_DIRECTOR_ENABLED=true (treatment)...`);
  const treatment = await runShortlist(selectShortlist, shortlistInput, { openai }, true);

  printShortlist('BASELINE (flag off)', baseline, candidateReports);
  printShortlist('TREATMENT (flag on)', treatment, candidateReports);

  const baselineIndices = new Set(baseline.map((e) => e.index));
  const treatmentIndices = new Set(treatment.map((e) => e.index));
  const dropped = [...baselineIndices].filter((i) => !treatmentIndices.has(i));
  const promoted = [...treatmentIndices].filter((i) => !baselineIndices.has(i));

  console.log(`\n### Diff summary\n`);
  console.log(
    `Dropped by Editorial Director (was shortlisted baseline, not in treatment): ${
      dropped.length === 0 ? '(none)' : dropped.map((i) => `#${i}`).join(', ')
    }`,
  );
  for (const i of dropped) {
    const c = candidateReports[i];
    console.log(`  #${i} "${c.hookText}" (${c.startTime.toFixed(0)}s-${c.endTime.toFixed(0)}s)`);
  }
  console.log(
    `Promoted by Editorial Director (not in baseline, shortlisted in treatment): ${
      promoted.length === 0 ? '(none)' : promoted.map((i) => `#${i}`).join(', ')
    }`,
  );
  for (const i of promoted) {
    const c = candidateReports[i];
    console.log(`  #${i} "${c.hookText}" (${c.startTime.toFixed(0)}s-${c.endTime.toFixed(0)}s)`);
  }

  const treatmentTopics = new Set(treatment.flatMap((e) => candidateReports[e.index].topics));
  const baselineTopics = new Set(baseline.flatMap((e) => candidateReports[e.index].topics));
  console.log(
    `\nDistinct topics - baseline: ${baselineTopics.size} (${[...baselineTopics].join(', ')})` +
      `\nDistinct topics - treatment: ${treatmentTopics.size} (${[...treatmentTopics].join(', ')})`,
  );

  const totalNudged = treatment.filter((e) => e.boundaryNudge).length;
  const totalPenalized = treatment.filter((e) => e.negativeSignals.length > 0).length;
  console.log(
    `\nTreatment: ${totalNudged}/${treatment.length} boundary-nudged, ${totalPenalized}/${treatment.length} carry at least one negative-signal penalty.`,
  );

  const outputPath = path.resolve(__dirname, '../../gate-a1-report.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        videoId: VIDEO_ID,
        title: video.title,
        candidateReports,
        baseline,
        treatment,
        dropped,
        promoted,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull JSON report written to ${outputPath}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
