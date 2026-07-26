// Quality Validation roadmap (Fase 0 design, Phase 3) - the browser tier of
// the hybrid validation split: instant, free, no network round trip. Reads
// only what the File/HTMLVideoElement APIs can answer synchronously/without
// a server - duration, pixel dimensions, container size, and the browser's
// own (weak, not content-sniffed) mimetype guess. Real codec/bitrate/audio
// details still require the server tier (probe-video.worker.ts's ffprobe
// pass) - this is a provisional preview shown before that completes, never
// a replacement for it.
export interface BrowserVideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

// Only meaningful for a local File (direct upload) - a YouTube import has
// no local file to read at all, so callers on that path simply never call
// this (see QualityValidation's own comment on the import-vs-upload
// asymmetry).
export function readBrowserVideoMetadata(file: File): Promise<BrowserVideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      const { duration, videoWidth, videoHeight } = video;
      cleanup();
      resolve({
        durationSeconds: duration,
        width: videoWidth,
        height: videoHeight,
        sizeBytes: file.size,
        mimeType: file.type,
      });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Browser tidak dapat membaca metadata video ini.'));
    };

    video.src = url;
  });
}
