// Phase D ("Real-video benchmark, blind human evaluation" - see docs/ai/phase-d-benchmark.md) of
// the "Speedora Editorial Operating System" mission. This file is deliberately separate from the
// harness that produces its input (render-clip.worker.phase-d-benchmark.ts) - same "pure function,
// testable without Jest's mock machinery" discipline generate-dataset-report.ts's own
// Report/renderMarkdown() split already established, so the markdown itself is unit-testable
// against a plain fixture with no real DB/ffmpeg/Jest-mock dependency.
//
// This report is deliberately OBSERVATIONAL, mirroring docs/ai/visual-emphasis-integration-audit.md's
// Gate B4/B5 "observation, not verdict" framing - it never scores or judges a clip itself. The
// blank Rubric section exists for a HUMAN to fill in; nothing here fabricates that judgment.

import type {
  EditorialDecision,
  EditPlanResult,
  FinalClipQualityAssessment,
} from '@speedora/contracts';

export type PhaseDFlagState = 'off' | 'on';

export interface PhaseDRunSummary {
  flagState: PhaseDFlagState;
  // null only when this clip's own ClipScores were unavailable (same null-semantics as
  // Clip.editorialDecision itself) - never fabricated.
  editorialDecision: EditorialDecision | null;
  editPlan: EditPlanResult;
  qualityAssessment: FinalClipQualityAssessment;
  renderedDurationSeconds: number | null;
  checksumMd5: string | null;
  // A short-lived presigned URL to the actual rendered mp4 for this run, or null if upload/
  // presign failed (best-effort, same "unverifiable -> warn, continue" posture as every other
  // optional signal in render-clip.worker.ts). Never committed anywhere - this report is
  // generated to a gitignored local file, not checked into version control.
  reviewUrl: string | null;
}

export interface PhaseDReport {
  generatedAt: string;
  videoId: string;
  videoTitle: string;
  clipId: string;
  requestedDurationSeconds: number;
  off: PhaseDRunSummary;
  on: PhaseDRunSummary;
  // A soft signal, not a hard invariant: editorialDecision/qualityAssessment don't depend on
  // EDIT_BUDGET_ENABLED/EFFECT_CONFLICT_RESOLUTION_ENABLED, but each run makes its own independent
  // real LLM call (this harness does NOT cache/replay graphResult across runs - a deliberate
  // simplification over the original design, since capturing+replaying it would need jest.spyOn
  // module-interception for a marginal cost saving on a single-clip first pass; see
  // docs/ai/phase-d-benchmark.md). A SMALL editorialScore delta between runs is expected LLM-
  // sampling noise, not a bug - only a large, unexplained delta is worth investigating.
  editorialDecisionIdentical: boolean;
  // The one dimension these two flags actually govern - see docs/ai/edit-plan-director.md.
  editPlanSuggestionsIdentical: boolean;
  // Checksum comparison of the two rendered files - "identical" is a real, valid, honestly-
  // reported outcome when this clip's own editingSuggestions never gave the resolver/budget
  // anything to act on (mirrors Editorial Director's own Gate A1 "didn't get a rank-flip
  // example, documented not fabricated" precedent), not a harness bug.
  physicalOutputIdentical: boolean;
}

function fmtBasis(basis: 'measured' | 'proxy' | 'unavailable'): string {
  return basis === 'measured' ? '**measured**' : basis === 'proxy' ? '_proxy_' : '_unavailable_';
}

function renderQualityDimensions(qa: FinalClipQualityAssessment): string {
  const rows = Object.entries(qa.dimensions)
    .map(
      ([name, dim]) =>
        `| ${name} | ${dim.score === null ? 'n/a' : dim.score.toFixed(1)} | ${fmtBasis(dim.basis)} | ${dim.notes} |`,
    )
    .join('\n');
  return (
    `| Dimension | Score | Basis | Notes |\n|---|---|---|---|\n${rows}\n\n` +
    `**Composite**: ${qa.compositeScore.toFixed(1)} / 100 (confidence: ${(qa.confidence * 100).toFixed(0)}%)`
  );
}

function renderEditPlanDecisions(editPlan: EditPlanResult): string {
  if (editPlan.decisions.length === 0) {
    return '_No conflict-resolution or budget-enforcement decisions fired for this run - every suggestion survived unchanged._';
  }
  const rows = editPlan.decisions
    .map(
      (d) =>
        `| ${d.action} | ${d.reasonCode} | ${d.technique} | ${d.start.toFixed(2)}-${d.end.toFixed(2)}s | ${d.relatedTechnique ?? 'n/a'} | ${d.reason} |`,
    )
    .join('\n');
  return `| Action | Reason code | Technique | Window | Related technique | Reason |\n|---|---|---|---|---|---|\n${rows}`;
}

function renderRun(label: string, run: PhaseDRunSummary): string {
  const ed = run.editorialDecision;
  return `### ${label} (\`EDIT_BUDGET_ENABLED\`/\`EFFECT_CONFLICT_RESOLUTION_ENABLED\` = ${run.flagState})

**EditorialDecision**: ${
    ed === null
      ? '_unavailable (no ClipScores for this clip)_'
      : `editorialScore ${ed.editorialScore.toFixed(1)} / 100, confidence ${(ed.confidence * 100).toFixed(0)}%, ${ed.negativeSignals.length} negative signal(s)${ed.negativeSignals.length > 0 ? `: ${ed.negativeSignals.map((s) => `${s.type} (-${s.penalty})`).join(', ')}` : ''}`
  }

**EditPlan decisions**:

${renderEditPlanDecisions(run.editPlan)}

**FinalClipQualityAssessment**:

${renderQualityDimensions(run.qualityAssessment)}

**Rendered output**: ${run.renderedDurationSeconds?.toFixed(2) ?? 'n/a'}s, checksum \`${run.checksumMd5 ?? 'n/a'}\`
**Review link** (short-lived, watch this before it expires): ${run.reviewUrl ?? '_upload/presign failed - see console warnings above_'}
`;
}

function renderRubric(): string {
  const editorialQuestions = [
    'Does this clip open with a real hook, or does it take too long to get going?',
    'Is the content valuable (educational/practical/novel/trustworthy) on its own merits?',
    'Does the clip feel narratively complete - a real beginning/middle/end, not an abrupt cut?',
    'Does it make sense without the full source video for context?',
    'Does it land an emotional payoff, or fall flat?',
  ];
  const visualQuestions = [
    'Do the crop/zoom/highlight effects feel purposeful, or distracting/excessive?',
    'Is the framing stable, or does it feel jittery/jarring?',
  ];
  const audioQuestions = [
    'Is the audio clear and well-paced?',
    'If multiple speakers: is turn-taking easy to follow?',
  ];
  const overall = [
    'Which of the two versions (flag off / flag on) do you prefer, if they differ at all?',
    'Would you publish this clip as-is?',
  ];
  const section = (title: string, questions: string[]) =>
    `**${title}**\n\n${questions.map((q) => `- [ ] ${q}`).join('\n')}`;
  return (
    '_The following is NOT scored by the agent - it is a blank rubric for a human reviewer to ' +
    'fill in while watching both review links above. Mirrors ' +
    'docs/ai/visual-emphasis-integration-audit.md\'s own "observation, not verdict" framing: ' +
    'nothing above this point is a judgment call, only this section is._\n\n' +
    [
      section('Editorial', editorialQuestions),
      section('Visual', visualQuestions),
      section('Audio', audioQuestions),
      section('Overall', overall),
    ].join('\n\n')
  );
}

export function renderMarkdown(r: PhaseDReport): string {
  return `# Phase D Benchmark Report

Generated: ${r.generatedAt}

Video: **${r.videoTitle}** (\`${r.videoId}\`)
Clip: \`${r.clipId}\` (requested duration ${r.requestedDurationSeconds.toFixed(2)}s)

## Invariant checks

_Each run makes its own independent real LLM call (graphResult is not cached/replayed across
runs - see docs/ai/phase-d-benchmark.md's own note on this simplification), so EditorialDecision
is expected to be CLOSE, not necessarily byte-identical, between the two runs._

- EditorialDecision exactly identical between flag-off/flag-on runs: ${r.editorialDecisionIdentical ? '**yes**' : `no (editorialScore ${r.off.editorialDecision?.editorialScore.toFixed(1) ?? 'n/a'} vs ${r.on.editorialDecision?.editorialScore.toFixed(1) ?? 'n/a'} - a small delta here is expected LLM-sampling noise, not necessarily a bug; investigate only if this looks large or systematic)`}
- editPlan.suggestions identical between runs: ${r.editPlanSuggestionsIdentical ? 'yes (no conflict/budget action fired for this clip - a real, valid outcome)' : '**no - the flags changed the arbitrated suggestion timeline for this clip**'}
- Physical rendered output identical (checksum): ${r.physicalOutputIdentical ? 'yes' : '**no - the two mp4 files differ**'}

## Flag-off run

${renderRun('Flag off (baseline)', r.off)}

## Flag-on run

${renderRun('Flag on (Edit Plan Director active)', r.on)}

## Human Review Rubric

${renderRubric()}
`;
}
