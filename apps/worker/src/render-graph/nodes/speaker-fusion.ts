import type {
  EditingSuggestionTimeline,
  FinalSpeakerIntelligence,
  SpeakerFusionFeatures,
} from '@speedora/contracts';
import { composeFinalSpeakerIntelligence } from '@speedora/speaker-fusion';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';
import type { ConversationIntelligenceResult } from './conversation-intelligence';

// Speaker Intelligence Phase F ("Cross-module Fusion" - see docs/ai/
// speaker-intelligence.md). Thin orchestration only - reads 3 already-
// resolved node outputs and hands them to @speedora/speaker-fusion's own
// pure composeFinalSpeakerIntelligence(); no logic lives in this file.
// optional: false, same as every other pure-derive composition node in
// this graph (Phase 4/5/6/7/10, editingSuggestions itself) - no LLM/
// subprocess call that can fail.
//
// speakerFocusShiftScores is filtered to technique === 'speaker_focus_shift'
// ONLY, right here at this orchestration seam - deliberately excludes plain
// 'focus_shift' (Phase C3's visual-track-sourced suggestions), same
// "decoupled from the full EditingSuggestion vocabulary" precedent
// render-clip.worker.ts's own focusShifts/speakerFocusShifts split already
// established. This is the concrete mechanism that keeps scenario 6/7 of
// the Phase F brief (a co-occurring visual-track focus_shift, or a plain
// face change) from ever reaching @speedora/speaker-fusion at all - it
// simply never sees those suggestions' scores.
export const finalSpeakerIntelligenceNode: GraphNode<RenderGraphContext, FinalSpeakerIntelligence> =
  {
    id: 'finalSpeakerIntelligence',
    deps: ['conversationIntelligence', 'speakerFusionFeatures', 'editingSuggestions'],
    optional: false,
    run: (get, ctx) => {
      const conversationIntelligence = get<ConversationIntelligenceResult>(
        'conversationIntelligence',
      );
      const speakerFusionFeatures = get<SpeakerFusionFeatures | null>('speakerFusionFeatures');
      const editingSuggestions = get<EditingSuggestionTimeline>('editingSuggestions');

      return composeFinalSpeakerIntelligence({
        clipId: ctx.clipId,
        conversationDynamics: conversationIntelligence.dynamics,
        conversationType: conversationIntelligence.classification,
        speakerFusionFeatures,
        speakerFocusShiftScores: editingSuggestions
          .filter((suggestion) => suggestion.technique === 'speaker_focus_shift')
          .map((suggestion) => suggestion.score),
      });
    },
  };

export const speakerFusionNodes = [finalSpeakerIntelligenceNode];
