import { CaptionStyle, TranscriptionProvider } from '@speedora/shared';
import { toSharedCaptionStyle, toSharedTranscriptionProvider } from './transcript-segment.util';

// Contract Governance audit (2026-08-01) - proves toSharedCaptionStyle/
// toSharedTranscriptionProvider (the replacement for the old
// `as unknown as` casts) round-trip every real Prisma enum member. If a
// future schema.prisma addition isn't wired into these mappers, the build
// fails before this test can even run (assertNever) - this test guards the
// mapping's runtime correctness, not its exhaustiveness, which is a
// compile-time guarantee.
describe('toSharedCaptionStyle', () => {
  it('maps every known Prisma CaptionStyle to its shared counterpart', () => {
    expect(toSharedCaptionStyle('DEFAULT')).toBe(CaptionStyle.DEFAULT);
    expect(toSharedCaptionStyle('KARAOKE')).toBe(CaptionStyle.KARAOKE);
    expect(toSharedCaptionStyle('BOLD_HIGHLIGHT')).toBe(CaptionStyle.BOLD_HIGHLIGHT);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => toSharedCaptionStyle('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});

describe('toSharedTranscriptionProvider', () => {
  it('maps every known Prisma TranscriptionProvider to its shared counterpart', () => {
    expect(toSharedTranscriptionProvider('GROQ')).toBe(TranscriptionProvider.GROQ);
    expect(toSharedTranscriptionProvider('OPENAI')).toBe(TranscriptionProvider.OPENAI);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => toSharedTranscriptionProvider('SOMETHING_NEW' as never)).toThrow(
      /Unhandled enum value/,
    );
  });
});
