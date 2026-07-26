import { loadVideoImportEngineConfig } from './config';

describe('loadVideoImportEngineConfig', () => {
  it('applies every default when no env vars are set', () => {
    const config = loadVideoImportEngineConfig({});

    expect(config.binaryPath).toBe('yt-dlp');
    expect(config.ffmpegPath).toBeNull();
    expect(config.timeoutMs).toBe(60 * 60 * 1000);
    expect(config.retryPolicy).toEqual({
      maxAttempts: 3,
      baseDelayMs: 2000,
      factor: 2,
      maxDelayMs: 30 * 1000,
    });
    expect(config.cookiesFile).toBeNull();
    expect(config.proxyUrl).toBeNull();
    expect(config.extraArgs).toEqual([]);
    expect(config.allowedDomains).toEqual([
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
    ]);
    expect(config.minVersion).toBeNull();
    expect(config.maxFileSizeBytes).toBeNull();
    expect(config.killGraceMs).toBe(5000);
    expect(config.scratchDir).toContain('speedora');
  });

  it('overrides every value from env vars', () => {
    const config = loadVideoImportEngineConfig({
      YTDLP_PATH: '/opt/bin/yt-dlp',
      FFMPEG_PATH: '/opt/bin/ffmpeg',
      VIDEO_IMPORT_TIMEOUT_MS: '1000',
      VIDEO_IMPORT_MAX_RETRIES: '4',
      VIDEO_IMPORT_BACKOFF_BASE_MS: '100',
      VIDEO_IMPORT_BACKOFF_FACTOR: '3',
      VIDEO_IMPORT_BACKOFF_MAX_MS: '9000',
      YTDLP_COOKIES_FILE: '/cookies.txt',
      YTDLP_PROXY_URL: 'http://proxy:8080',
      YTDLP_EXTRA_ARGS: '--no-check-certificate --geo-bypass',
      YTDLP_ALLOWED_DOMAINS: 'example.com, sub.example.com',
      VIDEO_IMPORT_SCRATCH_DIR: '/scratch',
      YTDLP_MIN_VERSION: '2025.01.01',
      VIDEO_IMPORT_MAX_FILE_SIZE_BYTES: '1048576',
      VIDEO_IMPORT_KILL_GRACE_MS: '2500',
    });

    expect(config).toEqual({
      binaryPath: '/opt/bin/yt-dlp',
      ffmpegPath: '/opt/bin/ffmpeg',
      timeoutMs: 1000,
      retryPolicy: { maxAttempts: 5, baseDelayMs: 100, factor: 3, maxDelayMs: 9000 },
      cookiesFile: '/cookies.txt',
      proxyUrl: 'http://proxy:8080',
      extraArgs: ['--no-check-certificate', '--geo-bypass'],
      allowedDomains: ['example.com', 'sub.example.com'],
      scratchDir: '/scratch',
      minVersion: '2025.01.01',
      maxFileSizeBytes: 1048576,
      killGraceMs: 2500,
    });
  });
});
