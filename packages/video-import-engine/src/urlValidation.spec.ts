import { VideoImportError } from './errors';
import { assertAllowedDomain } from './urlValidation';

const ALLOWED = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];

describe('assertAllowedDomain', () => {
  it('allows an exact-match hostname', () => {
    expect(() =>
      assertAllowedDomain('https://www.youtube.com/watch?v=abc', ALLOWED, 'yt-dlp'),
    ).not.toThrow();
  });

  it('is case-insensitive', () => {
    expect(() =>
      assertAllowedDomain('https://WWW.YOUTUBE.COM/watch?v=abc', ALLOWED, 'yt-dlp'),
    ).not.toThrow();
  });

  it('rejects a non-allowlisted domain', () => {
    expect(() => assertAllowedDomain('https://vimeo.com/12345', ALLOWED, 'yt-dlp')).toThrow(
      VideoImportError,
    );
  });

  it('rejects a lookalike domain rather than matching by substring', () => {
    expect(() =>
      assertAllowedDomain('https://youtube.com.evil.example/watch?v=abc', ALLOWED, 'yt-dlp'),
    ).toThrow(VideoImportError);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertAllowedDomain('not-a-url', ALLOWED, 'yt-dlp')).toThrow(VideoImportError);
  });

  it('sets category "unsupported" and retryable false', () => {
    expect.assertions(2);
    try {
      assertAllowedDomain('https://vimeo.com/1', ALLOWED, 'yt-dlp');
    } catch (error) {
      expect((error as VideoImportError).category).toBe('unsupported');
      expect((error as VideoImportError).retryable).toBe(false);
    }
  });
});
