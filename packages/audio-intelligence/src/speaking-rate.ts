import {
  speakingRateInputSchema,
  speakingRateOutputSchema,
  type SpeakingRateInput,
  type SpeakingRateOutput,
} from '@speedora/contracts';

// Pure math, no ffmpeg/subprocess/audio file at all - words per second
// within a segment, computed straight from Whisper's own segment
// boundaries and word count (already in Postgres via
// TranscriptSegment.words). Zero dependency, unlike analyzeAudioLoudness -
// fully verifiable with fixtures alone, same "small pure function" shape
// as @speedora/cutlist/@speedora/reframe's crop-path math.
export function computeSpeakingRate(input: SpeakingRateInput): SpeakingRateOutput {
  const { segmentStart, segmentEnd, wordCount } = speakingRateInputSchema.parse(input);
  const duration = segmentEnd - segmentStart;
  const wordsPerSecond = duration > 0 ? wordCount / duration : 0;
  return speakingRateOutputSchema.parse({ wordsPerSecond });
}
