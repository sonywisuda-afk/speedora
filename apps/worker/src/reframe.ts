import type { TranscriptWord } from '@speedora/shared';
import type { FaceSample } from './faceDetection';

export const TARGET_ASPECT_RATIO = 9 / 16;

// Finer than FACE_SAMPLE_INTERVAL_SECONDS (1s) so the crop position steps
// smoothly between detected face positions instead of jumping once per
// second. Sent to ffmpeg as a `sendcmd` command file (see ffmpeg.ts) rather
// than a single continuous ffmpeg filter expression, so the interpolation
// math here stays plain, testable TypeScript instead of a hand-built
// expression string.
export const CROP_PATH_STEP_SECONDS = 0.2;

// Fase 11 (Auto Zoom) - how much tighter the crop window gets at peak zoom,
// as a fraction of the base (unzoomed) crop size. 0.3 = a 30% punch-in at
// the very peak of an emphasis word - noticeable without being disorienting
// on a 9:16 talking-head frame.
const MAX_ZOOM_IN_FRACTION = 0.3;
// Envelope shape for one emphasis word's punch-in, all in seconds: ramps up
// to full zoom just before the word starts (ATTACK), holds at full zoom
// through the word and a beat after (HOLD), then eases back out (RELEASE) -
// an attack/hold/release envelope, not an instant cut, so the zoom reads as
// an intentional push-in rather than a jarring jump.
const ZOOM_ATTACK_SECONDS = 0.15;
const ZOOM_HOLD_SECONDS = 0.4;
const ZOOM_RELEASE_SECONDS = 0.5;

// Same pattern BOLD_HIGHLIGHT captions already emphasize (see
// subtitles.ts's KEYWORD_PATTERN) - numbers/percentages, ALL-CAPS words, and
// quoted phrases tend to carry emphasis on their own, without needing an
// LLM call or a keyword list to curate. Reused rather than duplicated a
// 3rd time once this became the 2nd use - see findEmphasisWords below.
const EMPHASIS_PATTERN = /\d|^[A-Z]{2,}$|^["“'].+["”']$/;

export interface CropDimensions {
  width: number;
  height: number;
}

// One point in the final crop-window path sent to ffmpeg via sendcmd -
// width/height vary (Fase 11's zoom) alongside the x/y panning that already
// existed, all on the same clip-relative timeline.
export interface CropWindow {
  t: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function roundToEven(value: number): number {
  return Math.round(value / 2) * 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Keeps the source's full height and crops width for a typical landscape
// source (the overwhelmingly common case - sourceAspect > 9/16), or the
// mirror image (keeps full width, crops height) for an already-portrait
// source. Either way the result matches TARGET_ASPECT_RATIO exactly.
// Dimensions are rounded to even numbers - libx264/yuv420p rejects odd
// width or height. This is the clip's FINAL, constant output frame size -
// Fase 11's zoom crops tighter than this at times, then scales back up to
// it (see ffmpeg.ts's renderClip), but this number itself never changes.
export function computeCropDimensions(sourceWidth: number, sourceHeight: number): CropDimensions {
  const sourceAspect = sourceWidth / sourceHeight;

  if (sourceAspect > TARGET_ASPECT_RATIO) {
    const height = roundToEven(sourceHeight);
    const width = Math.min(roundToEven(sourceWidth), roundToEven(height * TARGET_ASPECT_RATIO));
    return { width, height };
  }

  const width = roundToEven(sourceWidth);
  const height = Math.min(roundToEven(sourceHeight), roundToEven(width / TARGET_ASPECT_RATIO));
  return { width, height };
}

// Words worth a brief zoom punch-in when they're spoken - see
// EMPHASIS_PATTERN above. words must carry clip-relative timestamps (same
// convention as everywhere else per-word timing is used - FaceSample.t,
// buildAss's internal shift, cutlist.ts).
export function findEmphasisWords(words: TranscriptWord[]): TranscriptWord[] {
  return words.filter((word) => {
    // Only strips sentence punctuation, NOT quote characters - unlike
    // subtitles.ts's highlightKeywords, which strips both and so never
    // actually reaches its own quoted-phrase branch (the quotes it's
    // checking for are gone by the time it checks). Preserved here so a
    // quoted word/phrase can actually trigger a zoom punch-in.
    const stripped = word.word.trim().replace(/^[.,!?;:]+|[.,!?;:]+$/g, '');
    return EMPHASIS_PATTERN.test(stripped);
  });
}

// The attack/hold/release envelope (0-1) for a single emphasis word starting
// at `start`, sampled at time t - see the constants' comments above for the
// shape. 0 outside the envelope's span entirely.
function zoomEnvelopeAt(t: number, start: number): number {
  const attackStart = start - ZOOM_ATTACK_SECONDS;
  const holdEnd = start + ZOOM_HOLD_SECONDS;
  const releaseEnd = holdEnd + ZOOM_RELEASE_SECONDS;

  if (t < attackStart || t > releaseEnd) return 0;
  if (t < start) return (t - attackStart) / ZOOM_ATTACK_SECONDS;
  if (t <= holdEnd) return 1;
  return 1 - (t - holdEnd) / ZOOM_RELEASE_SECONDS;
}

function interpolateAt(
  known: Array<{ t: number; x: number; y: number }>,
  t: number,
): { x: number; y: number } {
  const first = known[0];
  if (t <= first.t) return { x: first.x, y: first.y };

  const last = known[known.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };

  for (let i = 0; i < known.length - 1; i++) {
    const a = known[i];
    const b = known[i + 1];
    if (t >= a.t && t <= b.t) {
      const ratio = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
  }
  return { x: last.x, y: last.y };
}

// Builds a fine-grained (CROP_PATH_STEP_SECONDS) crop-window path spanning
// the whole clip, combining two independent signals: x/y panning
// interpolated from sparse (FACE_SAMPLE_INTERVAL_SECONDS) face samples
// (Fase 2, unchanged math), and width/height "zoom" punch-ins timed to
// emphasis words (Fase 11, new). Either signal alone is enough to produce a
// real path - a video with a tracked face but no emphasis words still pans;
// one with emphasis words but no detected face still zooms, centered on the
// frame. Only moves pan along whichever axis computeCropDimensions() axis
// actually crops (x for a landscape source, y for a portrait one) - the
// other axis stays centered the whole clip.
//
// Returns null when NEITHER signal has anything to contribute (no face
// detected anywhere in the clip AND no emphasis words) - the caller
// (render-clip.worker.ts) falls back to a plain static center-crop in that
// case rather than rendering a pointless "moving" path that's actually
// constant, per CLAUDE.md's Fase 2 fallback decision (now extended to
// cover zoom too).
export function buildCropPath(
  samples: FaceSample[],
  emphasisWords: TranscriptWord[],
  crop: CropDimensions,
  sourceWidth: number,
  sourceHeight: number,
  clipDurationSeconds: number,
): CropWindow[] | null {
  const hasFaceData = samples.some((sample) => sample.box !== null);
  if (!hasFaceData && emphasisWords.length === 0) {
    return null;
  }

  const movesHorizontally = crop.width < sourceWidth;
  const movesVertically = crop.height < sourceHeight;

  const known = samples
    .filter((s): s is { t: number; box: NonNullable<FaceSample['box']> } => s.box !== null)
    .map((s) => ({
      t: s.t,
      x: movesHorizontally
        ? clamp(s.box.xCenter * sourceWidth - crop.width / 2, 0, sourceWidth - crop.width)
        : 0,
      y: movesVertically
        ? clamp(s.box.yCenter * sourceHeight - crop.height / 2, 0, sourceHeight - crop.height)
        : 0,
    }));

  // No tracked face at all (zoom-only case) centers the pan on the frame -
  // fixed for the whole clip, zoom still moves independently around it.
  const defaultX = Math.round((sourceWidth - crop.width) / 2);
  const defaultY = Math.round((sourceHeight - crop.height) / 2);

  const emphasisStarts = emphasisWords.map((word) => word.start);

  const path: CropWindow[] = [];
  for (let t = 0; t <= clipDurationSeconds + 1e-9; t += CROP_PATH_STEP_SECONDS) {
    const clampedT = Math.min(t, clipDurationSeconds);
    const { x: baseX, y: baseY } =
      known.length > 0 ? interpolateAt(known, clampedT) : { x: defaultX, y: defaultY };

    const zoom = emphasisStarts.reduce(
      (max, start) => Math.max(max, zoomEnvelopeAt(clampedT, start)),
      0,
    );
    const scale = 1 - zoom * MAX_ZOOM_IN_FRACTION;
    const width = roundToEven(crop.width * scale);
    const height = roundToEven(crop.height * scale);

    // Re-centered on the same point the un-zoomed pan would have used, so
    // zooming in never appears to also shift the framing sideways.
    const centerX = baseX + crop.width / 2;
    const centerY = baseY + crop.height / 2;
    const x = Math.round(clamp(centerX - width / 2, 0, sourceWidth - width));
    const y = Math.round(clamp(centerY - height / 2, 0, sourceHeight - height));

    path.push({ t: round3(clampedT), x, y, width, height });
  }
  return path;
}

// One `sendcmd` line per path point, setting x/y/w/h together (even the
// axis/dimension that never moves for this clip - harmless, keeps the
// format uniform rather than needing to know in advance which of the two
// signals is actually active). ffmpeg's sendcmd syntax:
// "TIME target@id command arg[, target@id command arg...];".
export function buildSendCmdScript(path: CropWindow[], filterTag: string): string {
  return path
    .map(
      (p) =>
        `${p.t} ${filterTag} x ${p.x}, ${filterTag} y ${p.y}, ` +
        `${filterTag} w ${p.width}, ${filterTag} h ${p.height};`,
    )
    .join('\n');
}
