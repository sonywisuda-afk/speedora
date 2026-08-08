import type {
  CaptionTreatmentTimeline,
  EmotionalArc,
  SubtitleIntelligence,
} from '@speedora/contracts';
import { computeCaptionTreatment } from '@speedora/dynamic-caption';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine, spec Part 8
// - data only, see docs/ai/subtitle-intelligence.md). Same optional: false
// shape as every other v4 pure-derive node - a post-hoc composition over
// already-resolved upstream data (the subtitleIntelligence/emotionalArc
// nodes' own outputs, both already-existing node ids), no LLM/subprocess
// call that can fail. Runs on every render regardless of
// isDynamicCaptionEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation). Does NOT touch
// buildAss()/the actual burned-in output - that's Phase B2's job.
export const captionTreatmentNode: GraphNode<RenderGraphContext, CaptionTreatmentTimeline> = {
  id: 'captionTreatment',
  deps: ['subtitleIntelligence', 'emotionalArc'],
  optional: false,
  run: (get) => {
    const subtitleIntelligence = get<SubtitleIntelligence>('subtitleIntelligence');
    const emotionalArc = get<EmotionalArc>('emotionalArc');

    return computeCaptionTreatment({
      timeline: subtitleIntelligence.timeline,
      highlights: subtitleIntelligence.highlights,
      emotionalArc,
    });
  },
};

export const dynamicCaptionNodes = [captionTreatmentNode];
