import { CaptionStyle } from '@speedora/database';
import type { TranscriptSegment } from '@speedora/shared';
import { buildAss } from './subtitles';

const baseOptions = {
  clipStart: 10,
  clipEnd: 20,
  style: CaptionStyle.DEFAULT,
  videoWidth: 136,
  videoHeight: 240,
};

describe('buildAss', () => {
  it('returns an empty string when there are no overlapping segments', () => {
    expect(buildAss({ ...baseOptions, segments: [] })).toBe('');
  });

  it('drops segments that end at or before the clip start (zero/negative duration)', () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 10, text: 'before clip' }];
    expect(buildAss({ ...baseOptions, segments })).toBe('');
  });

  it('shifts segment timestamps relative to the clip start and clamps to its duration', () => {
    const segments: TranscriptSegment[] = [
      { start: 10, end: 12, text: 'hello' },
      { start: 18, end: 25, text: 'overflow' },
    ];
    const ass = buildAss({ ...baseOptions, segments });

    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,hello');
    expect(ass).toContain('Dialogue: 0,0:00:08.00,0:00:10.00,Default,,0,0,0,,overflow');
  });

  it('includes PlayResX/PlayResY sized to the (post-crop) output dimensions', () => {
    const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'hi' }];
    const ass = buildAss({ ...baseOptions, segments, videoWidth: 136, videoHeight: 240 });

    expect(ass).toContain('PlayResX: 136');
    expect(ass).toContain('PlayResY: 240');
  });

  it('strips stray braces from segment text (they would otherwise open an override block)', () => {
    const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'a {weird} line' }];
    const ass = buildAss({ ...baseOptions, segments });

    expect(ass).toContain(',,a weird line');
  });

  describe('KARAOKE style', () => {
    it("emits a \\k tag per word sized to that word's own duration", () => {
      const segments: TranscriptSegment[] = [
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
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.KARAOKE });

      expect(ass).toContain('{\\k50}hi {\\k80}there');
      expect(ass).toContain(',Karaoke,');
    });

    it('inserts a gap \\k tag for a pause between words', () => {
      const segments: TranscriptSegment[] = [
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
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.KARAOKE });

      expect(ass).toContain('{\\k30}hi {\\k40}{\\k50}there');
    });

    it('falls back to plain text for a segment with no word-level data', () => {
      const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'no words here' }];
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.KARAOKE });

      expect(ass).toContain(',Default,,0,0,0,,no words here');
      expect(ass).not.toContain('\\k');
    });

    it('defines both a Default and a Karaoke ASS style', () => {
      const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'hi' }];
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.KARAOKE });

      expect(ass).toContain('Style: Default,');
      expect(ass).toContain('Style: Karaoke,');
    });
  });

  describe('BOLD_HIGHLIGHT style', () => {
    it('bolds and colours a token containing a digit', () => {
      const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'save 50 percent' }];
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.BOLD_HIGHLIGHT });

      expect(ass).toContain('save {\\b1\\c&H0000FFFF}50{\\r} percent');
    });

    it('bolds an ALL-CAPS word', () => {
      const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'this is HUGE news' }];
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.BOLD_HIGHLIGHT });

      expect(ass).toContain('this is {\\b1\\c&H0000FFFF}HUGE{\\r} news');
    });

    it('leaves an ordinary word unstyled', () => {
      const segments: TranscriptSegment[] = [{ start: 10, end: 12, text: 'just talking' }];
      const ass = buildAss({ ...baseOptions, segments, style: CaptionStyle.BOLD_HIGHLIGHT });

      expect(ass).toContain(',,just talking');
      expect(ass).not.toContain('\\b1');
    });
  });
});
