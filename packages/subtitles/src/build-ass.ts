import { buildAssInputSchema, type BuildAssInput, type SubtitleSegment } from '@speedora/contracts';

// ASS colours are &HAABBGGRR (alpha, then blue/green/red), 00 alpha = opaque.
const BASE_COLOR = '&H00FFFFFF'; // opaque white - unhighlighted text
const HIGHLIGHT_COLOR = '&H0000FFFF'; // opaque yellow - karaoke "spoken" fill / bold-highlight
const OUTLINE_COLOR = '&H00000000'; // opaque black

// No LLM/user keyword input yet (that's Fase 5's hook-generator scope) - just
// patterns that tend to carry emphasis on their own: numbers/percentages,
// ALL-CAPS words, and quoted phrases. Exported (Subtitle Studio roadmap,
// P2e) so TimelineEditor.tsx's live caption preview can bold/highlight the
// exact same keywords this module actually burns in, rather than
// maintaining a second, driftable copy of the pattern client-side.
export const KEYWORD_PATTERN = /\d|^[A-Z]{2,}$|^["“'].+["”']$/;

// Subtitle Studio roadmap (P2c) - the SAME deterministic, letter-indexed
// palette as apps/web/components/TimelineEditor.tsx's own SPEAKER_COLORS
// (Tailwind signal-cyan/signal-pink/amber-400/violet-400/emerald-400),
// converted to ASS's &HBBGGRR& override-tag form, so the editor's preview
// and the actual burned-in captions always agree. assignSpeakerLabels()
// (@speedora/diarization) always names speakers "Speaker A", "Speaker B",
// ... in order of first appearance, so the letter itself is a stable index
// - no hashing needed, same reasoning TimelineEditor.tsx's own comment
// documents.
const SPEAKER_ASS_COLORS = [
  '&HD6E622&', // signal-cyan   #22E6D6
  '&H7F3BFF&', // signal-pink   #FF3B7F
  '&H24BFFB&', // amber-400     #FBBF24
  '&HFA8BA7&', // violet-400    #A78BFA
  '&H99D334&', // emerald-400   #34D399
];

export function getSpeakerAssColor(speaker: string): string {
  const letter = speaker.replace('Speaker ', '').charCodeAt(0) - 'A'.charCodeAt(0);
  const index = Number.isNaN(letter) ? 0 : letter;
  return SPEAKER_ASS_COLORS[((index % SPEAKER_ASS_COLORS.length) + SPEAKER_ASS_COLORS.length) % SPEAKER_ASS_COLORS.length];
}

// Speaker color is applied to the OUTLINE (\3c), not the fill (\c) - karaoke
// already uses \k's Secondary->Primary fill-colour switch as its own
// "spoken word" signal, and bold-highlight's own {\r} resets (see
// highlightKeywords below) only reset bold/fill, deliberately leaving \3c
// untouched - so an outline-colour override composes with either style
// without a conflict, unlike a second \c override would.
function applySpeakerColor(text: string, speaker: string | undefined, enabled: boolean): string {
  if (!enabled || !speaker) return text;
  return `{\\3c${getSpeakerAssColor(speaker)}}${text}`;
}

function toAssTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const centiseconds = Math.round((clamped % 1) * 100);
  const totalSeconds = Math.floor(clamped);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(centiseconds)}`;
}

// ASS has no escape sequence for a literal '{'/'}' (they always delimit an
// override block) - transcribed speech essentially never contains them, so
// stripping is simpler than rejecting the whole line.
function sanitizeAssText(text: string): string {
  return text
    .replace(/[{}]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function highlightKeywords(text: string): string {
  return sanitizeAssText(text)
    .split(/(\s+)/)
    .map((token) => {
      if (token.length === 0 || /^\s+$/.test(token)) return token;
      const stripped = token.replace(/^[.,!?;:"'“”]+|[.,!?;:"'“”]+$/g, '');
      // Explicit {\b0\c...} reset (not {\r}, a full style-default reset) -
      // {\r} would also wipe out applySpeakerColor's own \3c override on
      // this same line (Subtitle Studio roadmap, P2c), since \3c is a
      // separate channel {\b0\c...} deliberately leaves alone.
      return KEYWORD_PATTERN.test(stripped)
        ? `{\\b1\\c${HIGHLIGHT_COLOR}}${token}{\\b0\\c${BASE_COLOR}}`
        : token;
    })
    .join('');
}

// ASS's native \k karaoke tag: each tag's centisecond value is how long the
// preceding text takes to fill from SecondaryColour to PrimaryColour,
// cumulative from the Dialogue line's own Start time - not absolute video
// time. A gap between two words (a pause) becomes its own zero-text \k tag
// so the fill timing doesn't drift ahead of the audio.
function karaokeLine(words: NonNullable<SubtitleSegment['words']>, lineStart: number): string {
  let line = '';
  let cursor = lineStart;
  for (const word of words) {
    const gapCs = Math.round((word.start - cursor) * 100);
    if (gapCs > 0) line += `{\\k${gapCs}}`;
    const durationCs = Math.max(1, Math.round((word.end - word.start) * 100));
    line += `{\\k${durationCs}}${sanitizeAssText(word.word)} `;
    cursor = word.end;
  }
  return line.trim();
}

// \k's colour switch (Secondary -> Primary as each syllable's timer elapses)
// applies to whichever ASS Style a line references, and a line with no \k
// tags at all is simply always shown in that Style's PrimaryColour. Those
// two facts can't both point at the same Style: DEFAULT/BOLD_HIGHLIGHT need
// PrimaryColour to be the plain white "default" look, while KARAOKE needs
// PrimaryColour to be the accent colour so already-spoken words visibly pop.
// Hence two Style lines (below) instead of one shared "Default" - identical
// font/position, different colour roles. A KARAOKE segment that lacks
// word-level data (falls back to plain text, no \k tags) uses 'Default' too
// - referencing 'Karaoke' with no \k tags would just paint it solid accent
// colour, not the intended neutral fallback look.
function buildDialogueEvent(
  segment: SubtitleSegment,
  style: BuildAssInput['style'],
  speakerColorCaptions: boolean,
): { text: string; styleName: 'Default' | 'Karaoke' } {
  const withSpeakerColor = (text: string) =>
    applySpeakerColor(text, segment.speaker, speakerColorCaptions);

  if (style === 'KARAOKE' && segment.words && segment.words.length > 0) {
    return {
      text: withSpeakerColor(karaokeLine(segment.words, segment.start)),
      styleName: 'Karaoke',
    };
  }
  if (style === 'BOLD_HIGHLIGHT') {
    return { text: withSpeakerColor(highlightKeywords(segment.text)), styleName: 'Default' };
  }
  return { text: withSpeakerColor(sanitizeAssText(segment.text)), styleName: 'Default' };
}

// Builds a full .ass subtitle file for one clip, styled per the given
// caption preset. Replaces the plain SRT burn-in used before Fase 3 - SRT
// has no per-word styling, which both KARAOKE (word-synced fill) and
// BOLD_HIGHLIGHT (per-keyword bold/colour) need. Returns '' (same contract
// buildSrt used to have) when the clip has no overlapping transcript text,
// so the caller can skip writing a file and omit the subtitles filter
// entirely - libass chokes on a subtitle file with zero events.
//
// Input is validated against @speedora/contracts's buildAssInputSchema on
// entry - defense in depth on top of TypeScript, same reasoning as
// clip-scoring's output validation, even though (unlike clip-scoring) there
// is no untrusted LLM JSON here - the adapter's caption-style cast is the
// one place a mismatch could slip through unnoticed otherwise.
export function buildAss(options: BuildAssInput): string {
  const {
    segments,
    clipStart,
    clipEnd,
    style,
    videoWidth,
    videoHeight,
    speakerColorCaptions,
    fontFamily,
  } = buildAssInputSchema.parse(options);
  const duration = clipEnd - clipStart;

  const fontSize = Math.max(12, Math.round(videoHeight * 0.06));
  const outline = Math.max(1, Math.round(fontSize / 12));
  const shadow = Math.max(0, Math.round(fontSize / 20));
  const marginV = Math.max(10, Math.round(videoHeight * 0.06));

  const events = segments
    .map((segment) => {
      const shifted: SubtitleSegment = {
        ...segment,
        start: segment.start - clipStart,
        end: segment.end - clipStart,
        words: segment.words?.map((word) => ({
          ...word,
          start: word.start - clipStart,
          end: word.end - clipStart,
        })),
      };
      const dialogue = buildDialogueEvent(shifted, style, speakerColorCaptions);
      return {
        start: Math.max(0, shifted.start),
        end: Math.min(duration, shifted.end),
        ...dialogue,
      };
    })
    .filter((event) => event.end > event.start && event.text.length > 0)
    .map(
      (event) =>
        `Dialogue: 0,${toAssTimestamp(event.start)},${toAssTimestamp(event.end)},${event.styleName},,0,0,0,,${event.text}`,
    );

  if (events.length === 0) {
    return '';
  }

  const baseStyleCols = [fontSize, outline, shadow, marginV] as const;
  // Brand Kit roadmap (P3a) - fontFamily must exactly match a font actually
  // bundled into apps/worker's Docker image (see that Dockerfile's own
  // comment) - libass silently falls back to a generic default when
  // fontconfig can't resolve the requested Fontname, rather than erroring.
  const styleLine = (name: string, primary: string, secondary: string) =>
    `Style: ${name},${fontFamily},${baseStyleCols[0]},${primary},${secondary},${OUTLINE_COLOR},&H00000000,0,0,0,0,100,100,0,0,1,${baseStyleCols[1]},${baseStyleCols[2]},2,10,10,${baseStyleCols[3]},1`;

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine('Default', BASE_COLOR, BASE_COLOR)}
${styleLine('Karaoke', HIGHLIGHT_COLOR, BASE_COLOR)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}
