import { VideoStatus } from '@speedora/shared';
import {
  formatBytes,
  formatDuration,
  formatMillis,
  formatRelativeTime,
  videoProcessingStage,
} from './dashboard';

describe('formatBytes', () => {
  it('formats 0 (and negative) bytes as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('formats bytes without a decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats KB/MB/GB with one decimal place', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('formatDuration', () => {
  it('returns an em dash for null (unknown), not a fabricated "0:00"', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('formats under an hour as m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('rounds fractional seconds', () => {
    expect(formatDuration(59.6)).toBe('1:00');
  });
});

describe('formatMillis', () => {
  it('returns an em dash for null (no completed-job sample yet)', () => {
    expect(formatMillis(null)).toBe('—');
  });

  it('formats sub-second durations in whole milliseconds', () => {
    expect(formatMillis(165)).toBe('165ms');
    expect(formatMillis(999)).toBe('999ms');
  });

  it('formats under a minute in seconds with one decimal', () => {
    expect(formatMillis(1234)).toBe('1.2s');
    expect(formatMillis(45_600)).toBe('45.6s');
  });

  it('formats under an hour as minutes and seconds', () => {
    expect(formatMillis(93_915)).toBe('1m 34s');
  });

  it('formats an hour or more as hours and minutes', () => {
    expect(formatMillis(3_725_000)).toBe('1h 2m');
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-01-10T12:00:00Z').getTime();

  it('returns "baru saja" for anything under a minute ago', () => {
    expect(formatRelativeTime('2026-01-10T11:59:30Z', NOW)).toBe('baru saja');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeTime('2026-01-10T11:45:00Z', NOW)).toBe('15 menit lalu');
  });

  it('formats hours ago', () => {
    expect(formatRelativeTime('2026-01-10T09:00:00Z', NOW)).toBe('3 jam lalu');
  });

  it('formats days ago', () => {
    expect(formatRelativeTime('2026-01-07T12:00:00Z', NOW)).toBe('3 hari lalu');
  });

  it('formats months ago', () => {
    expect(formatRelativeTime('2025-11-01T12:00:00Z', NOW)).toBe('2 bulan lalu');
  });
});

describe('videoProcessingStage', () => {
  it('reports the real importProgress for IMPORTING, defaulting to 0 when null', () => {
    expect(
      videoProcessingStage({
        status: VideoStatus.IMPORTING,
        importProgress: 42,
        transcribeProgress: null,
        clips: [],
      }),
    ).toEqual({ id: 'importing', label: 'Mengunduh dari YouTube', percent: 42 });

    expect(
      videoProcessingStage({
        status: VideoStatus.IMPORTING,
        importProgress: null,
        transcribeProgress: null,
        clips: [],
      }).percent,
    ).toBe(0);
  });

  it('reports the real transcribeProgress for UPLOADED', () => {
    expect(
      videoProcessingStage({
        status: VideoStatus.UPLOADED,
        importProgress: null,
        transcribeProgress: 60,
        clips: [],
      }),
    ).toEqual({ id: 'transcribing', label: 'Transkripsi (Whisper)', percent: 60 });
  });

  it('reports 0 (not fabricated) for TRANSCRIBED, which has no incremental progress signal', () => {
    expect(
      videoProcessingStage({
        status: VideoStatus.TRANSCRIBED,
        importProgress: null,
        transcribeProgress: null,
        clips: [],
      }),
    ).toEqual({ id: 'detecting', label: 'Mendeteksi Klip (Fusion Engine)', percent: 0 });
  });

  it('computes rendering percent from rendered/total clips for CLIPS_DETECTED', () => {
    const result = videoProcessingStage({
      status: VideoStatus.CLIPS_DETECTED,
      importProgress: null,
      transcribeProgress: null,
      clips: [{ downloadUrl: 'renders/a.mp4' }, { downloadUrl: null }, { downloadUrl: null }],
    });

    expect(result).toEqual({ id: 'rendering', label: 'Merender Klip', percent: 33 });
  });

  it('reports 0 (not NaN) for CLIPS_DETECTED with zero clips', () => {
    expect(
      videoProcessingStage({
        status: VideoStatus.CLIPS_DETECTED,
        importProgress: null,
        transcribeProgress: null,
        clips: [],
      }).percent,
    ).toBe(0);
  });

  it('reports 100% for RENDERED and 0% for FAILED', () => {
    expect(
      videoProcessingStage({
        status: VideoStatus.RENDERED,
        importProgress: null,
        transcribeProgress: null,
        clips: [],
      }),
    ).toEqual({ id: 'completed', label: 'Selesai', percent: 100 });

    expect(
      videoProcessingStage({
        status: VideoStatus.FAILED,
        importProgress: null,
        transcribeProgress: null,
        clips: [],
      }),
    ).toEqual({ id: 'failed', label: 'Gagal', percent: 0 });
  });
});
