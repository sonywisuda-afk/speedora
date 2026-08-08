import type { SubtitleSegment } from '@speedora/contracts';
import { buildAss } from './build-ass';

const baseOptions = {
  clipStart: 10,
  clipEnd: 20,
  style: 'DEFAULT' as const,
  videoWidth: 136,
  videoHeight: 240,
  speakerColorCaptions: false,
  fontFamily: 'Inter' as const,
};

describe('buildAss', () => {
  it('returns an empty string when there are no overlapping segments', () => {
    expect(buildAss({ ...baseOptions, segments: [] })).toBe('');
  });

  it('drops segments that end at or before the clip start (zero/negative duration)', () => {
    const segments: SubtitleSegment[] = [{ start: 0, end: 10, text: 'before clip' }];
    expect(buildAss({ ...baseOptions, segments })).toBe('');
  });

  it('shifts segment timestamps relative to the clip start and clamps to its duration', () => {
    const segments: SubtitleSegment[] = [
      { start: 10, end: 12, text: 'hello' },
      { start: 18, end: 25, text: 'overflow' },
    ];
    const ass = buildAss({ ...baseOptions, segments });

    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,hello');
    expect(ass).toContain('Dialogue: 0,0:00:08.00,0:00:10.00,Default,,0,0,0,,overflow');
  });

  it('includes PlayResX/PlayResY sized to the (post-crop) output dimensions', () => {
    const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'hi' }];
    const ass = buildAss({ ...baseOptions, segments, videoWidth: 136, videoHeight: 240 });

    expect(ass).toContain('PlayResX: 136');
    expect(ass).toContain('PlayResY: 240');
  });

  it('strips stray braces from segment text (they would otherwise open an override block)', () => {
    const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'a {weird} line' }];
    const ass = buildAss({ ...baseOptions, segments });

    expect(ass).toContain(',,a weird line');
  });

  describe('KARAOKE style', () => {
    it("emits a \\k tag per word sized to that word's own duration", () => {
      const segments: SubtitleSegment[] = [
        {
          start: 10,
          end: 12,
          text: 'hi there',
          words: [
            { word: 'hi', start: 10, end: 10.5 },
            { word: 'there', start: 10.5, end: 11.3 },
          ],
        },
      ];
      const ass = buildAss({ ...baseOptions, segments, style: 'KARAOKE' });

      expect(ass).toContain('{\\k50}hi {\\k80}there');
      expect(ass).toContain(',Karaoke,');
    });

    it('inserts a gap \\k tag for a pause between words', () => {
      const segments: SubtitleSegment[] = [
        {
          start: 10,
          end: 12,
          text: 'hi there',
          words: [
            { word: 'hi', start: 10, end: 10.3 },
            // 0.4s silent gap before "there" starts.
            { word: 'there', start: 10.7, end: 11.2 },
          ],
        },
      ];
      const ass = buildAss({ ...baseOptions, segments, style: 'KARAOKE' });

      expect(ass).toContain('{\\k30}hi {\\k40}{\\k50}there');
    });

    it('falls back to plain text for a segment with no word-level data', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'no words here' }];
      const ass = buildAss({ ...baseOptions, segments, style: 'KARAOKE' });

      expect(ass).toContain(',Default,,0,0,0,,no words here');
      expect(ass).not.toContain('\\k');
    });

    it('defines both a Default and a Karaoke ASS style', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'hi' }];
      const ass = buildAss({ ...baseOptions, segments, style: 'KARAOKE' });

      expect(ass).toContain('Style: Default,');
      expect(ass).toContain('Style: Karaoke,');
    });
  });

  describe('BOLD_HIGHLIGHT style', () => {
    it('bolds and colours a token containing a digit', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'save 50 percent' }];
      const ass = buildAss({ ...baseOptions, segments, style: 'BOLD_HIGHLIGHT' });

      expect(ass).toContain('save {\\b1\\c&H0000FFFF}50{\\b0\\c&H00FFFFFF} percent');
    });

    it('bolds an ALL-CAPS word', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'this is HUGE news' }];
      const ass = buildAss({ ...baseOptions, segments, style: 'BOLD_HIGHLIGHT' });

      expect(ass).toContain('this is {\\b1\\c&H0000FFFF}HUGE{\\b0\\c&H00FFFFFF} news');
    });

    it('leaves an ordinary word unstyled', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'just talking' }];
      const ass = buildAss({ ...baseOptions, segments, style: 'BOLD_HIGHLIGHT' });

      expect(ass).toContain(',,just talking');
      expect(ass).not.toContain('\\b1');
    });
  });

  // Subtitle Studio roadmap (P2c).
  describe('speakerColorCaptions', () => {
    it('does nothing when false, even with a speaker on the segment', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', speaker: 'Speaker A' },
      ];
      const ass = buildAss({ ...baseOptions, segments, speakerColorCaptions: false });

      expect(ass).not.toContain('\\3c');
    });

    it('wraps the text in an outline-colour override when true and a speaker is present', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', speaker: 'Speaker A' },
      ];
      const ass = buildAss({ ...baseOptions, segments, speakerColorCaptions: true });

      expect(ass).toContain(',,{\\3c&HD6E622&}hi');
    });

    it('does nothing for a segment with no speaker, even when the flag is true', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'hi' }];
      const ass = buildAss({ ...baseOptions, segments, speakerColorCaptions: true });

      expect(ass).not.toContain('\\3c');
    });

    it('picks a different colour for Speaker B, deterministically by letter', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', speaker: 'Speaker B' },
      ];
      const ass = buildAss({ ...baseOptions, segments, speakerColorCaptions: true });

      expect(ass).toContain('{\\3c&H7F3BFF&}hi');
    });

    it('composes with BOLD_HIGHLIGHT without the keyword reset wiping the outline colour', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'save 50 percent', speaker: 'Speaker A' },
      ];
      const ass = buildAss({
        ...baseOptions,
        segments,
        style: 'BOLD_HIGHLIGHT',
        speakerColorCaptions: true,
      });

      expect(ass).toContain(
        ',,{\\3c&HD6E622&}save {\\b1\\c&H0000FFFF}50{\\b0\\c&H00FFFFFF} percent',
      );
    });
  });

  // AI Intelligence v4 Track B, Phase B2 (Dynamic Caption Engine render
  // wiring). Verified against a real ffmpeg+libass render separately (see
  // this phase's PR description) - these are the unit-level assertions on
  // the ASS text itself.
  describe('Dynamic Caption treatment (Phase B2)', () => {
    it('emits no override at all for an untreated segment (sizeTier/animation both undefined)', () => {
      const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'hi' }];
      const ass = buildAss({ ...baseOptions, segments });

      expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,hi');
      expect(ass).not.toContain('\\fscx');
      expect(ass).not.toContain('\\t(');
    });

    it('emits no override for sizeTier "normal" with animation "none" - same as untreated', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', sizeTier: 'normal', animation: 'none' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      expect(ass).not.toContain('\\fscx');
    });

    it('emits a static \\fscx/\\fscy override for sizeTier "large"', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', sizeTier: 'large', animation: 'none' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      expect(ass).toContain(',,{\\fscx125\\fscy125}hi');
      expect(ass).not.toContain('\\t(');
    });

    it('emits a static \\fscx/\\fscy override for sizeTier "small"', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', sizeTier: 'small', animation: 'none' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      expect(ass).toContain(',,{\\fscx80\\fscy80}hi');
    });

    it('emits a two-stage \\t() pop for animation "punch", resting/peaking at the "normal" scale', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', sizeTier: 'normal', animation: 'punch' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      // resting=100 (normal), peak=round(100*1.15)=115, pop=200ms.
      expect(ass).toContain(',,{\\t(0,200,\\fscx115\\fscy115)\\t(200,400,\\fscx100\\fscy100)}hi');
    });

    it('emits a smaller/slower \\t() pulse for animation "attention"', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'is this real?', sizeTier: 'normal', animation: 'attention' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      // resting=100 (normal), peak=round(100*1.08)=108, pop=300ms.
      expect(ass).toContain(
        ',,{\\t(0,300,\\fscx108\\fscy108)\\t(300,600,\\fscx100\\fscy100)}is this real?',
      );
    });

    it("animates around the sizeTier's own resting scale, not always 100, when both are set", () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'hi', sizeTier: 'large', animation: 'punch' },
      ];
      const ass = buildAss({ ...baseOptions, segments });

      // resting=125 (large), peak=round(125*1.15)=144.
      expect(ass).toContain(
        ',,{\\fscx125\\fscy125\\t(0,200,\\fscx144\\fscy144)\\t(200,400,\\fscx125\\fscy125)}hi',
      );
    });

    it('composes with BOLD_HIGHLIGHT - the treatment prefix comes first, the keyword body unchanged', () => {
      const segments: SubtitleSegment[] = [
        { start: 10, end: 12, text: 'save 50 percent', sizeTier: 'large', animation: 'none' },
      ];
      const ass = buildAss({ ...baseOptions, segments, style: 'BOLD_HIGHLIGHT' });

      expect(ass).toContain(
        ',,{\\fscx125\\fscy125}save {\\b1\\c&H0000FFFF}50{\\b0\\c&H00FFFFFF} percent',
      );
    });

    it('composes with speakerColorCaptions - the treatment prefix comes first', () => {
      const segments: SubtitleSegment[] = [
        {
          start: 10,
          end: 12,
          text: 'hi',
          speaker: 'Speaker A',
          sizeTier: 'large',
          animation: 'none',
        },
      ];
      const ass = buildAss({ ...baseOptions, segments, speakerColorCaptions: true });

      expect(ass).toContain(',,{\\fscx125\\fscy125}{\\3c&HD6E622&}hi');
    });
  });

  it('rejects an input that fails the buildAssInputSchema contract', () => {
    const segments: SubtitleSegment[] = [{ start: 10, end: 12, text: 'hi' }];
    expect(() => buildAss({ ...baseOptions, segments, style: 'COMIC_SANS' as never })).toThrow();
  });
});
