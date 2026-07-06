import type { AudioFeatures, AudioSegmentSample } from '@speedora/contracts';

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Pure, synchronous summary derivation over the audio-intelligence fields
// already persisted per TranscriptSegment (Fase 25) - unlike scene/facial,
// there's no subprocess call this function wraps, since the raw readings
// already exist on rows written at transcribe time. The caller (render-clip
// worker adapter) is responsible for narrowing the clip's overlapping
// transcript segments down to this input shape (same "adapter narrows DB
// row to module input" convention as everywhere else). See
// packages/contracts/src/intelligence-signal.ts for the raw/features split
// this feeds into.
export function deriveAudioFeatures(segments: AudioSegmentSample[]): AudioFeatures {
  const rmsValues = segments
    .map((segment) => segment.rmsDb)
    .filter((value): value is number => value !== null);
  const peakValues = segments
    .map((segment) => segment.peakDb)
    .filter((value): value is number => value !== null);
  const rateValues = segments
    .map((segment) => segment.speakingRateWordsPerSecond)
    .filter((value): value is number => value !== null);

  const averageRmsDb = average(rmsValues);
  const peakDb = peakValues.length === 0 ? null : Math.max(...peakValues);
  const averageSpeakingRateWordsPerSecond = average(rateValues);

  let speakingRateStdDev: number | null = null;
  if (rateValues.length >= 2 && averageSpeakingRateWordsPerSecond !== null) {
    const mean = averageSpeakingRateWordsPerSecond;
    const variance =
      rateValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rateValues.length;
    speakingRateStdDev = Math.sqrt(variance);
  }

  return { averageRmsDb, peakDb, averageSpeakingRateWordsPerSecond, speakingRateStdDev };
}
