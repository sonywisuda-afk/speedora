import { YtDlpEngine } from './engines/ytDlpEngine';
import { VideoImportError } from './errors';
import { resolveEngine } from './registry';
import type { VideoImportEngineConfig } from './types';

const allowedDomains = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];

function configWith(domains: string[]): VideoImportEngineConfig {
  return { allowedDomains: domains } as VideoImportEngineConfig;
}

describe('resolveEngine', () => {
  it('resolves the yt-dlp engine for an allowlisted YouTube URL', () => {
    expect(resolveEngine('https://www.youtube.com/watch?v=abc', configWith(allowedDomains))).toBe(
      YtDlpEngine,
    );
  });

  it('rejects a non-allowlisted domain before selecting any engine', () => {
    expect(() => resolveEngine('https://vimeo.com/12345', configWith(allowedDomains))).toThrow(
      VideoImportError,
    );
  });
});
