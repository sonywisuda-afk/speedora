import type {
  EditorialDecision,
  EditPlanResult,
  FinalClipQualityAssessment,
} from '@speedora/contracts';
import { renderMarkdown, type PhaseDReport, type PhaseDRunSummary } from './phase-d-report';

const editorialDecision: EditorialDecision = {
  mode: 'render',
  editorialScore: 72.4,
  categories: {
    contentValue: 70,
    hookStrength: 65,
    narrativeCompleteness: 80,
    contextCompleteness: 75,
    emotionalPayoff: 60,
    visualEngagement: 55,
    speakerClarity: 68,
    platformFit: 70,
  },
  negativeSignals: [{ type: 'deadAir', penalty: 5, reason: 'a brief pause mid-clip' }],
  boundaryNudge: null,
  confidence: 0.9,
};

const qualityAssessment: FinalClipQualityAssessment = {
  dimensions: {
    editorialQuality: { score: 72.4, basis: 'measured', notes: 'from editorialScore' },
    narrativeQuality: { score: 78, basis: 'measured', notes: 'from categories' },
    technicalQuality: { score: 100, basis: 'measured', notes: 'no issues detected' },
    visualQuality: { score: 55, basis: 'proxy', notes: 'PROXY ONLY - visualEngagement' },
    audioQuality: { score: 68, basis: 'proxy', notes: 'PROXY ONLY - speakerClarity' },
    captionQuality: { score: null, basis: 'unavailable', notes: 'no detector exists' },
  },
  compositeScore: 74.6,
  confidence: 0.75,
};

const emptyEditPlan: EditPlanResult = {
  suggestions: [],
  budget: {
    maxFocusShifts: 2,
    maxSpeakerFocusShifts: 0,
    maxDigitalPush: 2,
    maxOcrHighlights: 1,
    maxReactionHolds: 1,
  },
  decisions: [],
};

const editPlanWithDecisions: EditPlanResult = {
  ...emptyEditPlan,
  decisions: [
    {
      action: 'suppressed',
      reasonCode: 'focus_shift_digital_push_overlap',
      technique: 'digital_push',
      start: 12.3,
      end: 12.9,
      relatedTechnique: 'focus_shift',
      reason: 'overlaps a focus_shift window',
    },
  ],
};

function makeRun(overrides: Partial<PhaseDRunSummary> = {}): PhaseDRunSummary {
  return {
    flagState: 'off',
    editorialDecision,
    editPlan: emptyEditPlan,
    qualityAssessment,
    renderedDurationSeconds: 128.4,
    checksumMd5: 'abc123',
    reviewUrl: 'https://storage.example/presigned-off',
    ...overrides,
  };
}

function makeReport(overrides: Partial<PhaseDReport> = {}): PhaseDReport {
  return {
    generatedAt: '2026-08-16T00:00:00.000Z',
    videoId: 'video-1',
    videoTitle: "McDonald's Marketing Mix 7P",
    clipId: 'clip-1',
    requestedDurationSeconds: 128.6,
    off: makeRun({ flagState: 'off' }),
    on: makeRun({ flagState: 'on', reviewUrl: 'https://storage.example/presigned-on' }),
    editorialDecisionIdentical: true,
    editPlanSuggestionsIdentical: true,
    physicalOutputIdentical: true,
    ...overrides,
  };
}

describe('renderMarkdown (Phase D report)', () => {
  it('renders a title, video/clip identifiers, and the invariant checks', () => {
    const markdown = renderMarkdown(makeReport());
    expect(markdown).toContain('# Phase D Benchmark Report');
    expect(markdown).toContain("McDonald's Marketing Mix 7P");
    expect(markdown).toContain('`clip-1`');
    expect(markdown).toContain('## Invariant checks');
    expect(markdown).toContain('EditorialDecision exactly identical');
  });

  it('reports a mismatched EditorialDecision as expected LLM-sampling noise, not a hard failure', () => {
    const markdown = renderMarkdown(makeReport({ editorialDecisionIdentical: false }));
    expect(markdown).toContain('expected LLM-sampling noise');
    expect(markdown).toContain('72.4 vs 72.4');
  });

  it('reports "no conflict/budget action fired" honestly when editPlan.decisions is empty', () => {
    const markdown = renderMarkdown(makeReport());
    expect(markdown).toContain('No conflict-resolution or budget-enforcement decisions fired');
  });

  it('renders a real decisions table when editPlan.decisions is non-empty', () => {
    const report = makeReport({
      on: makeRun({ flagState: 'on', editPlan: editPlanWithDecisions }),
      editPlanSuggestionsIdentical: false,
    });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('suppressed');
    expect(markdown).toContain('focus_shift_digital_push_overlap');
    expect(markdown).toContain('digital_push');
    expect(markdown).toContain('the flags changed the arbitrated suggestion timeline');
  });

  it('renders every quality dimension with its score, basis, and notes', () => {
    const markdown = renderMarkdown(makeReport());
    expect(markdown).toContain('editorialQuality');
    expect(markdown).toContain('captionQuality');
    expect(markdown).toContain('_unavailable_');
    expect(markdown).toContain('**measured**');
    expect(markdown).toContain('_proxy_');
  });

  it('renders "unavailable" for editorialDecision without crashing when it is null', () => {
    const markdown = renderMarkdown(
      makeReport({ off: makeRun({ flagState: 'off', editorialDecision: null }) }),
    );
    expect(markdown).toContain('unavailable (no ClipScores for this clip)');
  });

  it('includes both review URLs and a blank human rubric, explicitly labeled not agent-scored', () => {
    const markdown = renderMarkdown(makeReport());
    expect(markdown).toContain('https://storage.example/presigned-off');
    expect(markdown).toContain('https://storage.example/presigned-on');
    expect(markdown).toContain('## Human Review Rubric');
    expect(markdown).toContain('NOT scored by the agent');
    expect(markdown).toContain('- [ ]');
  });

  it('reports a failed presign/upload honestly instead of a broken link', () => {
    const markdown = renderMarkdown(makeReport({ off: makeRun({ reviewUrl: null }) }));
    expect(markdown).toContain('upload/presign failed');
  });
});
