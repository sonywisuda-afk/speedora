import type {
  CaptionAnimation,
  CaptionSizeTier,
  ComputeCaptionTreatmentInput,
  HighlightMoment,
  SubtitleLine,
  TreatmentMoment,
} from '@speedora/contracts';
import { nearestByTime } from './nearest-by-time';

// "High emotion -> large text; whisper -> small text" (spec Part 8). Every
// threshold below is a documented HEURISTIC (ADR D4) - no readability data
// exists to calibrate against. EmotionalArc's own BASE_INTENSITY gives
// plain 'neu' speech a mild ~0.1 baseline (never fully flat), so
// LOW_INTENSITY_THRESHOLD sits just above that (catches genuinely
// near-silent/uneventful moments, not every neutral sentence);
// HIGH_INTENSITY_THRESHOLD sits low enough to catch a hap/sad/ang-boosted
// segment without requiring the maximum possible intensity.
const HIGH_INTENSITY_THRESHOLD = 0.6;
const LOW_INTENSITY_THRESHOLD = 0.15;

// A punch/attention animation closer than this to the previous one reads
// as constant flicker rather than a real highlight - "Do NOT overuse
// animation" (spec Part 8's own explicit constraint), enforced here as a
// documented, unvalidated cooldown.
const MIN_ANIMATION_GAP_SECONDS = 3;

function sizeTierFor(intensity: number | null): CaptionSizeTier {
  if (intensity === null) return 'normal';
  if (intensity >= HIGH_INTENSITY_THRESHOLD) return 'large';
  if (intensity <= LOW_INTENSITY_THRESHOLD) return 'small';
  return 'normal';
}

// Reuses Phase A1's own HighlightTimeline directly (never re-derives
// emotion/momentum/semantic-event signals itself) - any overlap with the
// line's own [start, end] window counts, since HighlightTimeline is
// already the filtered, punch-worthy subset (Phase A1's own
// PUNCH_THRESHOLD already did the "is this actually shock-worthy"
// filtering).
function overlapsHighlight(line: SubtitleLine, highlights: HighlightMoment[]): boolean {
  return highlights.some((highlight) => highlight.start < line.end && highlight.end > line.start);
}

function endsInQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim());
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter, same zero-LLM
// shape as every other Track A/B v4 pure-derive module. Walks
// `timeline` in order (its own natural chronological order), so the
// cooldown below only ever looks backward at moments already decided.
//
// Priority when a line qualifies for both punch and attention: punch wins
// - it is backed by Phase A1's own multi-signal HighlightTimeline (emotion
// + semantic events + momentum), a stronger composite signal than a bare
// "ends with a question mark" text check.
export function computeCaptionTreatment(input: ComputeCaptionTreatmentInput): TreatmentMoment[] {
  const { timeline, highlights, emotionalArc } = input;

  let lastAnimationEnd: number | null = null;

  return timeline.map((line) => {
    const nearestEmotion = nearestByTime(emotionalArc, line.start);
    const sizeTier = sizeTierFor(nearestEmotion?.intensity ?? null);

    let animation: CaptionAnimation = 'none';
    if (overlapsHighlight(line, highlights)) {
      animation = 'punch';
    } else if (endsInQuestion(line.text)) {
      animation = 'attention';
    }

    if (animation !== 'none') {
      if (lastAnimationEnd !== null && line.start - lastAnimationEnd < MIN_ANIMATION_GAP_SECONDS) {
        animation = 'none';
      } else {
        lastAnimationEnd = line.end;
      }
    }

    return { start: line.start, end: line.end, sizeTier, animation };
  });
}
