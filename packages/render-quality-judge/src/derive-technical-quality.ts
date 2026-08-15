import type { QualityDimensionScore } from '@speedora/contracts';
import {
  AUDIO_MISSING_PENALTY,
  FULL_DRIFT_PENALTY_FRACTION,
  MAX_DURATION_DRIFT_PENALTY,
  STREAM_MISSING_PENALTY,
  VERIFICATION_MISMATCH_PENALTY,
} from './weights';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// A narrow, structural subset of apps/worker's own ProbedVideoMetadata/RenderVerificationResult -
// defined fresh here (never imported) since packages/* can never depend on apps/worker/*, the same
// boundary render-verification.ts's own probedMediaForVerificationSchema already established. The
// real values at the call site satisfy this shape directly via structural typing, no cast needed.
export interface DeriveTechnicalQualityInput {
  // RenderVerificationResult.passed - null when verification itself never ran (probe failure or
  // the comparison itself throwing - see render-clip.worker.ts's own hoisted renderVerification).
  renderVerificationPassed: boolean | null;
  // ProbedVideoMetadata.hasVideoStream/hasAudioStream - null when the ffprobe call itself failed.
  hasVideoStream: boolean | null;
  hasAudioStream: boolean | null;
  // Clip.durationSeconds (the requested/target window, endTime - startTime) vs the real
  // ffprobe-measured value - renderedDurationSeconds is null when the probe failed.
  requestedDurationSeconds: number;
  renderedDurationSeconds: number | null;
}

// The one dimension composed entirely from REAL measurements already computed by the render
// pipeline (ffprobe's probeVideoMetadata(), Render Fidelity's RenderVerificationResult, and the
// durationSeconds/renderedDurationSeconds pair) - no new ffprobe call, no new detector.
export function deriveTechnicalQuality(input: DeriveTechnicalQualityInput): QualityDimensionScore {
  if (
    input.renderVerificationPassed == null &&
    input.hasVideoStream == null &&
    input.hasAudioStream == null &&
    input.renderedDurationSeconds == null
  ) {
    return {
      score: null,
      basis: 'unavailable',
      notes:
        'ffprobe of the rendered output failed entirely - no technical signal (resolution/codec/' +
        'stream presence/duration) could be measured for this clip.',
    };
  }

  let score = 100;
  const findings: string[] = [];

  if (input.hasVideoStream === false) {
    score -= STREAM_MISSING_PENALTY;
    findings.push('rendered output has no video stream');
  }
  if (input.hasAudioStream === false) {
    score -= AUDIO_MISSING_PENALTY;
    findings.push('rendered output has no audio stream');
  }
  if (input.renderVerificationPassed === false) {
    score -= VERIFICATION_MISMATCH_PENALTY;
    findings.push(
      'RenderVerificationResult reported a mismatch against the declared RenderManifest',
    );
  }
  if (input.renderedDurationSeconds != null && input.requestedDurationSeconds > 0) {
    const driftFraction =
      Math.abs(input.renderedDurationSeconds - input.requestedDurationSeconds) /
      input.requestedDurationSeconds;
    const durationPenalty =
      clamp(driftFraction / FULL_DRIFT_PENALTY_FRACTION, 0, 1) * MAX_DURATION_DRIFT_PENALTY;
    if (durationPenalty > 0) {
      score -= durationPenalty;
      findings.push(
        `rendered duration drifted ${(driftFraction * 100).toFixed(1)}% from the requested window`,
      );
    }
  }

  return {
    score: clamp(score, 0, 100),
    basis: 'measured',
    notes:
      findings.length > 0
        ? `Composed from ffprobe/RenderVerificationResult/duration comparison: ${findings.join('; ')}.`
        : 'Composed from ffprobe/RenderVerificationResult/duration comparison - no issues detected.',
  };
}
