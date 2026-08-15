import {
  finalClipQualityAssessmentSchema,
  type EditorialCategoryScores,
  type FinalClipQualityAssessment,
} from '@speedora/contracts';
import { composeQualityAssessment } from './compose-quality-assessment';
import { deriveAudioQuality } from './derive-audio-quality';
import { deriveCaptionQuality } from './derive-caption-quality';
import { deriveEditorialQuality } from './derive-editorial-quality';
import { deriveNarrativeQuality } from './derive-narrative-quality';
import {
  deriveTechnicalQuality,
  type DeriveTechnicalQualityInput,
} from './derive-technical-quality';
import { deriveVisualQuality } from './derive-visual-quality';

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is already-computed elsewhere;
// this module derives nothing raw of its own. `categories`/`editorialScore` are Editorial
// Director Phase A's own EditorialDecision fields (render mode) - this package has no dependency
// on @speedora/editorial-director itself, only on the plain values it already produced (same
// "package boundary via primitive value, not shared type" precedent @speedora/edit-plan-director
// already established for its own hasVisualInstabilityOrOverEditingRisk input).
export interface AssessClipQualityInput {
  editorialScore: number | null;
  categories: EditorialCategoryScores | null;
  hasVisualInstabilitySignal: boolean;
  technical: DeriveTechnicalQualityInput;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module checklist) - pure and
// synchronous, no `deps` parameter, no LLM call, no new I/O. ALWAYS computed (ADR D8: compute
// always, flag gates future API exposure only, same posture as Phase A's editorialDecision/Phase
// B's editPlan) - every input is already-computed elsewhere in the render pipeline, so this costs
// nothing extra to run unconditionally.
export function assessClipQuality(input: AssessClipQualityInput): FinalClipQualityAssessment {
  const dimensions = {
    editorialQuality: deriveEditorialQuality({ editorialScore: input.editorialScore }),
    narrativeQuality: deriveNarrativeQuality({ categories: input.categories }),
    technicalQuality: deriveTechnicalQuality(input.technical),
    visualQuality: deriveVisualQuality({
      visualEngagement: input.categories?.visualEngagement ?? null,
      hasVisualInstabilitySignal: input.hasVisualInstabilitySignal,
    }),
    audioQuality: deriveAudioQuality({ speakerClarity: input.categories?.speakerClarity ?? null }),
    captionQuality: deriveCaptionQuality(),
  };

  return finalClipQualityAssessmentSchema.parse(composeQualityAssessment(dimensions));
}
