import type { FaceSample } from './faceDetection';

export const TARGET_ASPECT_RATIO = 9 / 16;

// Finer than FACE_SAMPLE_INTERVAL_SECONDS (1s) so the crop position steps
// smoothly between detected face positions instead of jumping once per
// second. Sent to ffmpeg as a `sendcmd` command file (see ffmpeg.ts) rather
// than a single continuous ffmpeg filter expression, so the interpolation
// math here stays plain, testable TypeScript instead of a hand-built
// expression string.
export const CROP_PATH_STEP_SECONDS = 0.2;

export interface CropDimensions {
  width: number;
  height: number;
}

export interface CropOffset {
  t: number;
  x: number;
  y: number;
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
// width or height.
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

// Builds a fine-grained (CROP_PATH_STEP_SECONDS) crop-offset path from
// sparse (FACE_SAMPLE_INTERVAL_SECONDS) face samples, linearly interpolating
// between known face positions and holding the nearest known position flat
// before the first / after the last sample. Only moves along whichever axis
// computeCropDimensions() actually crops (x for a landscape source, y for a
// portrait one) - the other axis stays at 0 the whole clip.
//
// Returns null when no sample in the whole clip had a detected face - the
// caller (render-clip.worker.ts) falls back to a plain static center-crop
// in that case rather than rendering a pointless "moving" path that's
// actually constant, per CLAUDE.md's Fase 2 fallback decision.
export function buildCropPath(
  samples: FaceSample[],
  crop: CropDimensions,
  sourceWidth: number,
  sourceHeight: number,
): CropOffset[] | null {
  if (samples.length === 0 || samples.every((s) => s.box === null)) {
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

  const lastSampleT = samples[samples.length - 1].t;
  const path: CropOffset[] = [];
  for (let t = 0; t <= lastSampleT + 1e-9; t += CROP_PATH_STEP_SECONDS) {
    const { x, y } = interpolateAt(known, t);
    path.push({ t: round3(Math.min(t, lastSampleT)), x: Math.round(x), y: Math.round(y) });
  }
  return path;
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

// One `sendcmd` line per path point, setting both x and y (even on the axis
// that never moves - harmless, keeps the format uniform). ffmpeg's sendcmd
// syntax: "TIME target@id command arg[, target@id command arg...];".
export function buildSendCmdScript(path: CropOffset[], filterTag: string): string {
  return path.map((p) => `${p.t} ${filterTag} x ${p.x}, ${filterTag} y ${p.y};`).join('\n');
}
