import { generateSlug } from './slug.util';

describe('generateSlug', () => {
  it('generates an 8-character URL-safe slug (base64url of 6 random bytes)', () => {
    const slug = generateSlug();

    expect(slug).toHaveLength(8);
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different slug on each call', () => {
    const slugs = new Set(Array.from({ length: 50 }, () => generateSlug()));

    expect(slugs.size).toBe(50);
  });
});
