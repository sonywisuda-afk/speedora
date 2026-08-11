import type { ConversationDynamics, ConversationTypeResult } from '@speedora/contracts';
import {
  classifyConversationType,
  deriveConversationDynamics,
} from '@speedora/conversation-intelligence';
import { deriveDiarizationFeatures } from '@speedora/speaker-diarization';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Speaker Intelligence Phase C (Conversation Dynamics) - see docs/ai/
// speaker-intelligence.md. deps: [] and reads ctx.speakerTurns directly,
// same pattern as speakerTimelineFeaturesNode right above it in
// face-speaker.ts - it's a clip-relative primitive already resolved before
// the graph runs, not another node's output. optional: false: this is a
// pure, synchronous composition (deriveDiarizationFeatures is the SAME
// function @speedora/speaker-diarization already uses for the video-wide
// aggregate, just re-run against this clip's own turn list - zero new
// detectors, no subprocess/LLM call that can fail).
//
// Combines dynamics + classification into one node (not two) because
// classifyConversationType's own input (speakerCount/turnCount/switchCount/
// averageTurnDurationSeconds) is a strict subset of what
// deriveConversationDynamics already computes - splitting them would mean
// calling deriveDiarizationFeatures(ctx.speakerTurns) twice for no reason.
export interface ConversationIntelligenceResult {
  dynamics: ConversationDynamics;
  classification: ConversationTypeResult;
}

export const conversationDynamicsNode: GraphNode<
  RenderGraphContext,
  ConversationIntelligenceResult
> = {
  id: 'conversationIntelligence',
  deps: [],
  optional: false,
  run: (_get, ctx) => {
    const features = deriveDiarizationFeatures(ctx.speakerTurns);
    const dynamics = deriveConversationDynamics(features, ctx.endTime - ctx.startTime);
    const classification = classifyConversationType({
      speakerCount: features.speakerCount,
      turnCount: features.turnCount,
      switchCount: features.switchCount,
      averageTurnDurationSeconds: dynamics.averageTurnDurationSeconds,
    });
    return { dynamics, classification };
  },
};

export const conversationIntelligenceNodes = [conversationDynamicsNode];
