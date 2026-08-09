import {
  buildAssInputSchema,
  KEYWORD_PATTERN,
  type BuildAssInput,
  type CaptionAnimation,
  type CaptionSizeTier,
  type OcrHighlightBox,
  type SubtitleSegment,
} from '@speedora/contracts';

// Re-exported for backward compatibility - was previously defined locally
// here; moved to @speedora/contracts (ADR DB6, docs/ai/
// subtitle-intelligence.md) so @speedora/subtitle-rewriter can reuse the
// exact same pattern without depending on this renderer package. Existing
// consumers (TimelineEditor.tsx's live caption preview, Subtitle Studio
// roadmap P2e) keep importing it from '@speedora/subtitles' unchanged.
export { KEYWORD_PATTERN };

// ASS colours are &HAABBGGRR (alpha, then blue/green/red), 00 alpha = opaque.
const BASE_COLOR = '&H00FFFFFF'; // opaque white - unhighlighted text
const HIGHLIGHT_COLOR = '&H0000FFFF'; // opaque yellow - karaoke "spoken" fill / bold-highlight
const OUTLINE_COLOR = '&H00000000'; // opaque black

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
  return SPEAKER_ASS_COLORS[
    ((index % SPEAKER_ASS_COLORS.length) + SPEAKER_ASS_COLORS.length) % SPEAKER_ASS_COLORS.length
  ];
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

// AI Intelligence v4 Track B, Phase B2 (Dynamic Caption Engine render
// wiring, spec Part 8 - see docs/ai/subtitle-intelligence.md). The first
// \fscx/\fscy (scale)/\t (animated transform) tags this module has ever
// emitted - genuinely new ASS tag territory for this codebase (Tech Debt
// #6), verified against a real ffmpeg+libass render before being trusted
// here (see build-ass.spec.ts's own comment and this phase's PR
// description for how). Every numeric value below is a documented
// HEURISTIC (ADR D4) - no readability/engagement data exists to calibrate
// against.
//
// Resting (non-animated) scale per size tier, as ASS \fscx/\fscy PERCENT
// values (100 = the Style's own declared Fontsize, unchanged - so
// 'normal' emits no override at all, byte-identical to a segment with no
// treatment).
const SIZE_TIER_SCALE: Record<CaptionSizeTier, number> = {
  small: 80,
  normal: 100,
  large: 125,
};

// "Do NOT overuse animation" (spec Part 8's own explicit constraint) is
// already enforced upstream by @speedora/dynamic-caption's cooldown -
// these two pairs only define what a punch/attention pop actually LOOKS
// like once one is allowed to play. Punch (shock) is bigger/faster than
// attention (a question) - a deliberate, documented distinction, not an
// arbitrary pair of numbers.
const PUNCH_PEAK_MULTIPLIER = 1.15;
const PUNCH_POP_MS = 200;
const ATTENTION_PEAK_MULTIPLIER = 1.08;
const ATTENTION_POP_MS = 300;

// Builds the ASS override block that opens a Dialogue line's text -
// \fscx/\fscy alone for a static size change, plus a two-stage \t()
// transform (rest -> peak -> rest) for punch/attention. Returns '' for
// the majority case (sizeTier undefined/'normal' AND animation
// undefined/'none') so a segment with no treatment produces EXACTLY the
// same output as before this phase existed - the regression this
// function must never cause. \fscx/\fscy is its own independent ASS
// channel from \c/\3c/\k (already established by applySpeakerColor's own
// \3c-vs-\c reasoning above), so this composes with every existing style/
// speaker-color/emphasis tag without needing to touch any of them.
function buildTreatmentPrefix(
  sizeTier: CaptionSizeTier | undefined,
  animation: CaptionAnimation | undefined,
): string {
  const resting = SIZE_TIER_SCALE[sizeTier ?? 'normal'];
  const restingTag = resting !== 100 ? `\\fscx${resting}\\fscy${resting}` : '';

  if (animation === 'punch' || animation === 'attention') {
    const multiplier = animation === 'punch' ? PUNCH_PEAK_MULTIPLIER : ATTENTION_PEAK_MULTIPLIER;
    const popMs = animation === 'punch' ? PUNCH_POP_MS : ATTENTION_POP_MS;
    const peak = Math.round(resting * multiplier);
    return (
      `{${restingTag}\\t(0,${popMs},\\fscx${peak}\\fscy${peak})` +
      `\\t(${popMs},${popMs * 2},\\fscx${resting}\\fscy${resting})}`
    );
  }

  return restingTag ? `{${restingTag}}` : '';
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
  // Phase B2 - prepended first, so it composes with (never replaces)
  // whichever style-specific body follows; '' for the majority
  // no-treatment case, so behavior is unchanged unless a caller actually
  // opts in (see buildTreatmentPrefix's own comment).
  const treatmentPrefix = buildTreatmentPrefix(segment.sizeTier, segment.animation);

  if (style === 'KARAOKE' && segment.words && segment.words.length > 0) {
    return {
      text: treatmentPrefix + withSpeakerColor(karaokeLine(segment.words, segment.start)),
      styleName: 'Karaoke',
    };
  }
  if (style === 'BOLD_HIGHLIGHT') {
    return {
      text: treatmentPrefix + withSpeakerColor(highlightKeywords(segment.text)),
      styleName: 'Default',
    };
  }
  return {
    text: treatmentPrefix + withSpeakerColor(sanitizeAssText(segment.text)),
    styleName: 'Default',
  };
}

// Visual Emphasis Engine Phase C5 ("OCR Highlight", docs/ai/
// visual-emphasis-engine.md) - the first ASS \p (vector drawing) tags this
// module has ever emitted, genuinely new ASS tag territory (same
// "genuinely new, verify against real ffmpeg+libass" discipline Phase B2's
// \fscx/\fscy/\t already established) - reuses the existing subtitles=
// filter pipeline rather than introducing a second ffmpeg drawing
// mechanism (ADR resolved via AskUserQuestion before implementation, see
// docs/ai/visual-emphasis-engine.md's "C5 mechanism" decision).
//
// \1a&HFF&: fully transparent PRIMARY (fill) colour - the rectangle's
// interior is invisible, only its outline renders, same "00 alpha =
// opaque, FF = fully transparent" convention BASE_COLOR's own comment
// documents.
const OCR_HIGHLIGHT_FILL_ALPHA = '&HFF&';
// Reuses HIGHLIGHT_COLOR (the same yellow already used for karaoke/
// bold-highlight emphasis) as the outline colour - "yellow = emphasis" is
// already this module's own established visual language, not a new one.
const OCR_HIGHLIGHT_OUTLINE_COLOR = HIGHLIGHT_COLOR;

// Border (outline) thickness in pixels, scaled to the output frame the
// same way fontSize/marginV already are in buildAss() below - a
// documented HEURISTIC (ADR D4), not calibrated against any real
// footage/readability data. Deliberately thicker than caption text's own
// outline (buildAss()'s `outline` local) so the highlight frame reads as
// a deliberate annotation, not confusable with text stroke.
function ocrHighlightBorderWidth(videoHeight: number): number {
  return Math.max(2, Math.round(videoHeight * 0.008));
}

// One Dialogue event per highlight box, drawing a rectangle OUTLINE (not
// filled - see OCR_HIGHLIGHT_FILL_ALPHA above) at its own absolute
// output-frame position via \an7\pos() (top-left-anchored, so the vector
// path's own `m 0 0` origin lands exactly at (x, y)) and \p1...\p0 vector
// drawing. `box.start`/`box.end` are ALREADY clip-relative - see
// buildAssInputSchema's own ocrHighlights field comment for why this
// function must NOT apply the same `- clipStart` shift buildAss() applies
// to `segments`. Layer 1 (captions stay Layer 0, the Format's default) so
// a highlight box that happens to visually overlap a caption still shows
// on top of it, since a highlight annotates something the viewer should
// be able to see regardless.
function buildOcrHighlightEvent(box: OcrHighlightBox, videoHeight: number): string {
  const border = ocrHighlightBorderWidth(videoHeight);
  const path = `m 0 0 l ${box.width} 0 l ${box.width} ${box.height} l 0 ${box.height} l 0 0`;
  const text =
    `{\\an7\\pos(${box.x},${box.y})\\1a${OCR_HIGHLIGHT_FILL_ALPHA}` +
    `\\3c${OCR_HIGHLIGHT_OUTLINE_COLOR}\\bord${border}\\p1}${path}{\\p0}`;
  return `Dialogue: 1,${toAssTimestamp(box.start)},${toAssTimestamp(box.end)},Default,,0,0,0,,${text}`;
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
    ocrHighlights,
  } = buildAssInputSchema.parse(options);
  const duration = clipEnd - clipStart;

  const fontSize = Math.max(12, Math.round(videoHeight * 0.06));
  const outline = Math.max(1, Math.round(fontSize / 12));
  const shadow = Math.max(0, Math.round(fontSize / 20));
  const marginV = Math.max(10, Math.round(videoHeight * 0.06));

  const captionEvents = segments
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

  // Visual Emphasis Engine Phase C5 - ocrHighlights are already
  // clip-relative (unlike `segments` above), so they're only clamped to
  // [0, duration] here, never shifted by clipStart - see
  // buildAssInputSchema's own field comment. Merged into the SAME events
  // array (not a separate return path) so a clip with zero overlapping
  // captions but a real highlight-worthy OCR moment (e.g. a music-only
  // clip with an on-screen price tag) still gets a real .ass file written
  // instead of being skipped entirely.
  const ocrHighlightEvents = ocrHighlights
    .map((box) => ({
      ...box,
      start: Math.max(0, box.start),
      end: Math.min(duration, box.end),
    }))
    .filter((box) => box.end > box.start)
    .map((box) => buildOcrHighlightEvent(box, videoHeight));

  const events = [...captionEvents, ...ocrHighlightEvents];

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
