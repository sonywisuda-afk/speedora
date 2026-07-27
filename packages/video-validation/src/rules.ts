import type { ValidationFinding, VideoQualityMetadata } from '@speedora/contracts';

// Below 720p (height) - AI signals (face/scene/OCR detection, Smart Crop)
// were tuned against typical social-video source resolutions and degrade
// on anything smaller.
export const MIN_RESOLUTION_HEIGHT = 720;

// 1 Mbps - comfortably below what even a conservative 720p H.264 encode
// needs; below this, blocking/macroblocking artifacts are common enough to
// visibly affect rendered clips.
export const MIN_VIDEO_BITRATE_BPS = 1_000_000;

// Outside [15, 120] fps - below 15 reads as visibly choppy; above 120 is
// unusual enough for a social-video source that it's worth flagging (not
// blocking) in case it's a slow-motion capture the user didn't intend to
// upload as-is.
export const MIN_FPS = 15;
export const MAX_FPS = 120;

// 4 hours - matches the Fase 0 design's own example ("4-hour duration
// estimate warning"). Past this, transcription/detection/render time and
// storage cost become substantial enough to warn about before the AI
// pipeline starts, not blocking (a legitimately long source, e.g. a
// full-day livestream VOD, is still valid input).
export const LONG_DURATION_SECONDS = 4 * 60 * 60;

interface WarningRule {
  id: string;
  triggered: (metadata: VideoQualityMetadata) => boolean;
  message: (metadata: VideoQualityMetadata) => string;
}

// Declarative, deliberately - Phase 3's UI only ever renders the evaluated
// ValidationReport (id + message per finding), never any of this rule
// logic itself, so adding a new Warning-tier check here is the only change
// needed end to end. Error-tier checks (no video/audio stream, corrupted
// file, zero/unreadable duration) are NOT rules here - they're hard
// failures in apps/worker/src/workers/probe-video.worker.ts itself, since a
// video that fails one of those never reaches PENDING_SETTINGS to have a
// report evaluated against at all. Info-tier is intentionally absent (see
// ValidationReport's own comment in @speedora/contracts).
export const WARNING_RULES: WarningRule[] = [
  {
    id: 'low-resolution',
    triggered: (m) => m.height != null && m.height < MIN_RESOLUTION_HEIGHT,
    message: (m) =>
      `Resolusi rendah (${m.width ?? '?'}x${m.height}px) - di bawah 720p, hasil deteksi AI mungkin kurang optimal.`,
  },
  {
    id: 'low-bitrate',
    triggered: (m) => m.videoBitrate != null && m.videoBitrate < MIN_VIDEO_BITRATE_BPS,
    message: (m) =>
      `Bitrate video rendah (~${Math.round((m.videoBitrate ?? 0) / 1000)} kbps) - kualitas gambar berisiko terlihat pecah.`,
  },
  {
    id: 'unstable-fps',
    triggered: (m) => m.fps != null && (m.fps < MIN_FPS || m.fps > MAX_FPS),
    message: (m) => `Frame rate tidak biasa (${m.fps} fps).`,
  },
  {
    id: 'long-duration',
    triggered: (m) => m.durationSeconds != null && m.durationSeconds > LONG_DURATION_SECONDS,
    message: (m) =>
      `Durasi video sangat panjang (~${Math.round((m.durationSeconds ?? 0) / 3600)} jam) - proses AI akan memakan waktu lebih lama.`,
  },
  {
    id: 'mono-audio',
    triggered: (m) => m.audioChannels === 1,
    message: () => 'Audio mono (bukan stereo).',
  },
];

export function evaluateWarnings(metadata: VideoQualityMetadata): ValidationFinding[] {
  return WARNING_RULES.filter((rule) => rule.triggered(metadata)).map((rule) => ({
    id: rule.id,
    message: rule.message(metadata),
  }));
}
