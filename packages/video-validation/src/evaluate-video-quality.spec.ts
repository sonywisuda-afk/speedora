import type { VideoQualityMetadata } from '@speedora/contracts';
import { evaluateVideoQuality } from './evaluate-video-quality';

const CLEAN: VideoQualityMetadata = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrate: 4_000_000,
  audioChannels: 2,
  durationSeconds: 300,
};

describe('evaluateVideoQuality', () => {
  it('returns no findings for clean 1080p/30fps/stereo metadata', () => {
    expect(evaluateVideoQuality(CLEAN)).toEqual({ errors: [], warnings: [], info: [] });
  });

  it('always returns empty errors/info - Error-tier is a hard fail upstream, Info-tier is a separate feature', () => {
    const report = evaluateVideoQuality({ ...CLEAN, height: 240 });
    expect(report.errors).toEqual([]);
    expect(report.info).toEqual([]);
  });

  it('flags low resolution below 720p', () => {
    const report = evaluateVideoQuality({ ...CLEAN, width: 640, height: 480 });
    expect(report.warnings.map((w) => w.id)).toContain('low-resolution');
  });

  it('does not flag resolution at exactly 720p', () => {
    const report = evaluateVideoQuality({ ...CLEAN, width: 1280, height: 720 });
    expect(report.warnings.map((w) => w.id)).not.toContain('low-resolution');
  });

  it('flags low bitrate below 1 Mbps', () => {
    const report = evaluateVideoQuality({ ...CLEAN, videoBitrate: 500_000 });
    expect(report.warnings.map((w) => w.id)).toContain('low-bitrate');
  });

  it('flags fps below 15', () => {
    const report = evaluateVideoQuality({ ...CLEAN, fps: 10 });
    expect(report.warnings.map((w) => w.id)).toContain('unstable-fps');
  });

  it('flags fps above 120', () => {
    const report = evaluateVideoQuality({ ...CLEAN, fps: 240 });
    expect(report.warnings.map((w) => w.id)).toContain('unstable-fps');
  });

  it('flags a duration over 4 hours', () => {
    const report = evaluateVideoQuality({ ...CLEAN, durationSeconds: 5 * 60 * 60 });
    expect(report.warnings.map((w) => w.id)).toContain('long-duration');
  });

  it('does not flag a duration at exactly 4 hours', () => {
    const report = evaluateVideoQuality({ ...CLEAN, durationSeconds: 4 * 60 * 60 });
    expect(report.warnings.map((w) => w.id)).not.toContain('long-duration');
  });

  it('flags mono audio', () => {
    const report = evaluateVideoQuality({ ...CLEAN, audioChannels: 1 });
    expect(report.warnings.map((w) => w.id)).toContain('mono-audio');
  });

  it('does not flag any rule whose underlying metadata is null (unknown, not violated)', () => {
    const report = evaluateVideoQuality({
      width: null,
      height: null,
      fps: null,
      videoBitrate: null,
      audioChannels: null,
      durationSeconds: null,
    });
    expect(report).toEqual({ errors: [], warnings: [], info: [] });
  });

  it('combines multiple simultaneous findings', () => {
    const report = evaluateVideoQuality({
      width: 640,
      height: 360,
      fps: 240,
      videoBitrate: 300_000,
      audioChannels: 1,
      durationSeconds: 6 * 60 * 60,
    });
    expect(report.warnings.map((w) => w.id).sort()).toEqual(
      ['long-duration', 'low-bitrate', 'low-resolution', 'mono-audio', 'unstable-fps'].sort(),
    );
  });
});
