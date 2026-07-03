import { sanitizeHashtags } from './hashtags';

describe('sanitizeHashtags', () => {
  it('strips a leading "#" from each tag', () => {
    expect(sanitizeHashtags(['#viral', '##fyp'])).toEqual(['viral', 'fyp']);
  });

  it('trims whitespace around each tag', () => {
    expect(sanitizeHashtags([' viral ', '  fyp'])).toEqual(['viral', 'fyp']);
  });

  it('drops blank/whitespace-only entries', () => {
    expect(sanitizeHashtags(['viral', '', '   ', 'fyp'])).toEqual(['viral', 'fyp']);
  });

  it('returns an empty array unchanged', () => {
    expect(sanitizeHashtags([])).toEqual([]);
  });
});
