import { PublishStatus, SocialPlatform } from '@speedora/shared';
import {
  mapPublishStatus,
  mapSharedSocialPlatformToPrisma,
  mapSocialPlatform,
} from './publish-record.util';

// Contract Governance audit (2026-08-01) - proves these mappers (the
// replacement for blind `as unknown as` casts) round-trip every real Prisma
// enum member and reject anything else at runtime. If a future
// schema.prisma addition isn't wired into the mapper, the build fails
// before this test can even run (assertNever) - this test guards the
// mapping's runtime correctness, not its exhaustiveness, which is a
// compile-time guarantee.
describe('mapPublishStatus', () => {
  it('maps every known Prisma PublishStatus to its shared counterpart', () => {
    expect(mapPublishStatus('SCHEDULED')).toBe(PublishStatus.SCHEDULED);
    expect(mapPublishStatus('QUEUED')).toBe(PublishStatus.QUEUED);
    expect(mapPublishStatus('PUBLISHING')).toBe(PublishStatus.PUBLISHING);
    expect(mapPublishStatus('PUBLISHED')).toBe(PublishStatus.PUBLISHED);
    expect(mapPublishStatus('FAILED')).toBe(PublishStatus.FAILED);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapPublishStatus('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});

describe('mapSocialPlatform', () => {
  it('maps every known Prisma SocialPlatform to its shared counterpart', () => {
    expect(mapSocialPlatform('YOUTUBE')).toBe(SocialPlatform.YOUTUBE);
    expect(mapSocialPlatform('TIKTOK')).toBe(SocialPlatform.TIKTOK);
    expect(mapSocialPlatform('INSTAGRAM')).toBe(SocialPlatform.INSTAGRAM);
    expect(mapSocialPlatform('FACEBOOK')).toBe(SocialPlatform.FACEBOOK);
    expect(mapSocialPlatform('THREADS')).toBe(SocialPlatform.THREADS);
    expect(mapSocialPlatform('LINKEDIN')).toBe(SocialPlatform.LINKEDIN);
    expect(mapSocialPlatform('PINTEREST')).toBe(SocialPlatform.PINTEREST);
    expect(mapSocialPlatform('X')).toBe(SocialPlatform.X);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapSocialPlatform('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});

describe('mapSharedSocialPlatformToPrisma', () => {
  it('is the exact inverse of mapSocialPlatform for every member', () => {
    for (const platform of Object.values(SocialPlatform)) {
      expect(mapSocialPlatform(mapSharedSocialPlatformToPrisma(platform))).toBe(platform);
    }
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapSharedSocialPlatformToPrisma('SOMETHING_NEW' as never)).toThrow(
      /Unhandled enum value/,
    );
  });
});
