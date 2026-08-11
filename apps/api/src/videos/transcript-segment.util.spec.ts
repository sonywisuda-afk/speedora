import { CaptionStyle, TranscriptionProvider } from '@speedora/shared';
import {
  toSharedCaptionStyle,
  toSharedConversationDynamics,
  toSharedConversationType,
  toSharedTranscriptionProvider,
} from './transcript-segment.util';

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

// Speaker Intelligence Phase C validation gate - null-semantics backward
// compatibility at the mapper level: a pre-migration Clip row has this
// column as real SQL NULL, which Prisma surfaces as `null` (never
// `undefined` for a selected column - `undefined` is included defensively
// since these functions accept `unknown`, matching the codebase's own "Json
// column is opaque" cast pattern used by every other toShared* mapper of
// this shape).
describe('toSharedConversationDynamics', () => {
  const real = {
    speakerCount: 2,
    turnCount: 4,
    switchCount: 3,
    turnDensityPerMinute: 30,
    averageTurnDurationSeconds: 2,
    medianTurnDurationSeconds: 2,
    backAndForthScore: 1,
    responseLatencySeconds: 0,
    overlapRatio: 0,
    interactionIntensity: 0.5,
  };

  it('passes a real value through unchanged', () => {
    expect(toSharedConversationDynamics(real)).toEqual(real);
  });

  it('returns null for a pre-migration row (SQL NULL)', () => {
    expect(toSharedConversationDynamics(null)).toBeNull();
  });

  it('returns null for undefined (defensive - Prisma never actually returns this for a selected column)', () => {
    expect(toSharedConversationDynamics(undefined)).toBeNull();
  });
});

describe('toSharedConversationType', () => {
  it('passes a real value through unchanged', () => {
    expect(toSharedConversationType({ type: 'podcast', confidence: 0.6 })).toEqual({
      type: 'podcast',
      confidence: 0.6,
    });
  });

  it("passes a real 'not enough data' result through unchanged (type: null is itself a real result, not a failure)", () => {
    expect(toSharedConversationType({ type: null, confidence: null })).toEqual({
      type: null,
      confidence: null,
    });
  });

  it('returns null for a pre-migration row (SQL NULL)', () => {
    expect(toSharedConversationType(null)).toBeNull();
  });

  it('returns null for undefined (defensive)', () => {
    expect(toSharedConversationType(undefined)).toBeNull();
  });
});
