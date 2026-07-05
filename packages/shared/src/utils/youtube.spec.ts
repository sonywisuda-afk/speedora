import { isYoutubeUrl } from './youtube';

describe('isYoutubeUrl', () => {
  it('accepts a standard watch URL', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts a youtu.be short link', () => {
    expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts a Shorts URL', () => {
    expect(isYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts without www. and with extra query params', () => {
    expect(isYoutubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe(true);
  });

  it('rejects a non-YouTube URL', () => {
    expect(isYoutubeUrl('https://vimeo.com/12345')).toBe(false);
  });

  it('rejects a bare YouTube homepage link', () => {
    expect(isYoutubeUrl('https://www.youtube.com/')).toBe(false);
  });

  it('rejects empty/garbage input', () => {
    expect(isYoutubeUrl('')).toBe(false);
    expect(isYoutubeUrl('not a url')).toBe(false);
  });
});
