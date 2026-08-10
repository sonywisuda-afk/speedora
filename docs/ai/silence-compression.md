# Silence Compression AI (item 9)

> **Status: shipped.** Item 9 of the user's own gap-analysis list vs. reference platforms: "bukan
> cuma menghapus silence, tapi me-reflow ritme secara natural" - the example given was
> `"…..I think…..Apple….will lose."` → `"I think Apple will lose."` mengalir natural. Like items 8
> and 10, this is a from-scratch mini-initiative prompted by a re-raised gap list, not part of any
> existing AI Intelligence v4 phase or Visual Emphasis Engine roadmap - documented here on its own
> since it doesn't fit either of those docs' scope.

## Audit before building

`packages/cutlist` (Fase 8/9) already detects and removes what makes an "unnatural" clip in the
first place: `computeSilenceCuts()` (gaps longer than `MIN_SILENCE_GAP_SECONDS` = 0.7s, kept
padded by `SILENCE_EDGE_PADDING_SECONDS` = 0.15s at each edge rather than a hard zero-gap splice)
and `computeFillerCuts()` (the narrow um/uh word family only, deliberately not "like"/"so"/
"actually" etc. which are frequently real words). `apps/worker/src/ffmpeg.ts`'s `trimCutRanges()`
applies those cuts to an already-rendered clip.

**The actual, confirmed gap**: Fase 14 (Smart Transitions) already gave VIDEO a smooth
brightness-dip transition at every cut junction, but its own comment explicitly documents that the
audio-side equivalent (a conditional `volume=eval=frame` dip) was tried, tested directly against a
real ffmpeg 8.1.2-full_build, and found unreliable at sub-second windows (measured via
`volumedetect`, the targeted window showed only a few dB of change instead of the expected large
reduction). Audio was left a plain hard cut, with the same comment naming the real fix and
explicitly deferring it: "trimCutRanges' whole select-based single-pass removal replaced with a
segment-trim + xfade concatenation chain - a much larger, riskier rewrite... than \[Fase 14's]
scope justifies." This is exactly the choppiness the user's own example describes - the words
themselves get tightened, but the join between them still reads as cut, not spoken.

No existing crossfade precedent exists anywhere in this codebase to reuse - `concatBrandSegment()`
and `applyReactionHolds()` both already do segment-trim + concat for their own unrelated needs
(intro/outro splicing, reaction-hold freeze insertion), but both use a plain `concat` (hard join),
never `xfade`/`acrossfade`. This would be genuinely new ffmpeg filter territory for this codebase.

## Scope decisions (resolved via `AskUserQuestion` before writing code)

Two rounds of genuinely open questions:

1. **Scale of the fix.** Three options presented: (a) the real audio+video crossfade Fase 14's own
   comment named as the deferred fix, (b) a smaller/safer tweak (lower `MIN_SILENCE_GAP_SECONDS` to
   cut more aggressively), (c) a pacing-density guard (cap how many cuts can land in a short span).
   **User chose (a), the real crossfade** - matches the user's own "flow naturally" ask most
   directly; (b)/(c) tighten pacing further but don't address the actual choppiness complaint.
2. **The sync consequence, found mid-design.** A real audio crossfade of duration `d` *shortens*
   the combined stream by `d` (two segments overlap, not just join) - but Fase 14's video dip never
   changes duration at all. Crossfading only audio while leaving video's total length untouched
   would progressively desync the two streams by the sum of every junction's fade duration. This
   was surfaced back to the user immediately (a genuinely new finding, not something to silently
   work around) with three options: (a) replace video's dip with a real dissolve too (`xfade`),
   shrinking both streams by the identical amount at every junction so sync holds by construction,
   (b) keep video untouched and pad the audio crossfade's shrink back with a bit of compensating
   silence, (c) abandon the real crossfade, fall back to option (b)/(c) from the first question.
   **User chose (a)** - the only option that produces a genuinely natural result without
   reintroducing any artificial silence, at the cost of replacing Fase 14's already-shipped video
   dip effect (not purely additive).

## What shipped

`apps/worker/src/ffmpeg.ts`'s `trimCutRanges()` was rewritten from a single-pass
`select`/`aselect` + `eq`-dip filter graph to a segment-trim + `xfade`/`acrossfade` concatenation
chain - the same "segment and re-concatenate" idiom `concatBrandSegment()`/`applyReactionHolds()`
already use elsewhere in this file, generalized across an arbitrary number of cut junctions instead
of those functions' own fixed 2- or (2N+1)-segment shapes.

- **`computeKeptSegments(cuts, totalInputDuration)`** - the complement of `cuts` (already
  sorted/non-overlapping per every caller's own `mergeCutRanges()` step) within
  `[0, totalInputDuration]`. `totalInputDuration` itself is solved back from the existing
  `totalOutputDuration` parameter plus `totalCutSeconds(cuts)` (both already computed by the
  caller's own definition) rather than adding a second ffprobe call.
- Each kept segment is extracted via `trim`/`atrim` + `setpts`/`asetpts=PTS-STARTPTS`, then folded
  together pairwise, left to right. At each junction, a fade duration is computed as
  `min(CROSSFADE_SECONDS, leftSegmentDuration / 2, rightSegmentDuration / 2)` - capped at half of
  either adjacent kept segment's own length so a fade can never consume more than a segment's full
  duration even in the worst case of two short segments back to back (`CROSSFADE_SECONDS = 0.15`,
  the same value Fase 14's dip used, kept for continuity).
  - When the clamped fade is `>= MIN_CROSSFADE_SECONDS` (0.02s): video folds via
    `xfade=transition=fade:duration=<fade>:offset=<cumulative - fade>` (a real cross-dissolve, not
    a fade-through-black), audio folds via `acrossfade=d=<fade>:c1=tri:c2=tri` - **the identical
    `<fade>` value drives both**, which is what keeps video and audio shortened by exactly the same
    amount at every junction (the sync invariant), rather than two independently-computed numbers
    that could drift apart.
  - When the clamped fade would round below `MIN_CROSSFADE_SECONDS` (both adjacent segments too
    short for a meaningful dissolve - e.g. a filler word sitting right next to a silence cut),
    the junction falls back to a plain `concat=n=2` (zero shrink) instead of passing an
    effectively-zero duration into `xfade`/`acrossfade`, which is invalid ffmpeg syntax.
  - `xfade` needs no scale/format/SAR normalization the way `concatBrandSegment()` does for its two
    *different* source files - every segment here trims the same `[0:v]`/`[0:a]`, so dimensions/
    pixel format/frame rate/SAR already match exactly.
- No signature change: `trimCutRanges(inputPath, outputPath, cuts, totalOutputDuration)` is
  unchanged, so `render-clip.worker.ts`'s call site needed no edits at all.

## A known, accepted interaction (documented, not fixed)

Visual Emphasis Engine Phase C6R.3's Reaction Hold pass runs *after* this one and remaps its own
instants onto the post-cut timeline via `@speedora/cutlist`'s `remapTimestamp()`, which - like this
function's own `totalOutputDuration` parameter - assumes cuts close to a zero-width join with no
further shrink. Every crossfade junction this feature introduces shortens the real output by its
own fade duration on top of that, so a reaction-hold instant occurring after N crossfade junctions
lands up to `N * CROSSFADE_SECONDS` seconds early relative to where `remapTimestamp()` calculated
it. This is bounded (well under a second for any clip with a realistic cut count) and a freeze-frame
landing within a few hundred ms of its ideal instant is not visually distinguishable from landing
exactly on it. Not fixed in this pass - the same "accept and document rather than block" posture
the Visual Emphasis Integration Audit's Gate B (B2, OCR Highlight's own static-snapshot drift)
already established for a structurally identical situation. Worth revisiting only if Gate C
real-footage calibration ever surfaces this as an actual perceptible problem.

## Explicitly deferred / out of scope

- **Lowering `MIN_SILENCE_GAP_SECONDS` for more aggressive cutting** - a separate, independent
  lever from this feature; not attempted here since the user's chosen option addresses the join
  quality, not the cut aggressiveness.
- **A pacing-density guard** (capping cuts per unit time) - the third option from the first
  `AskUserQuestion` round, not chosen; would complement rather than replace this feature if ever
  revisited.
- **Making `remapTimestamp()`/Reaction Hold crossfade-aware** - see the accepted-interaction note
  above; a real fix would touch Phase C6R's own contract, judged not worth it for a bounded,
  imperceptible drift.

## Verification

`apps/worker` - `ffmpeg.spec.ts`'s `trimCutRanges` suite was rewritten for the new filter graph (8
tests: single-cut exact filter-graph string, multi-junction cumulative-offset chaining, the
fallback-to-concat path for a too-short kept segment, plus the pre-existing atomic-rename/format-
flag/error-propagation/timeout tests carried over unchanged). A new
**`ffmpeg.crossfade.integration.spec.ts`** (following `ffmpeg.reaction-hold.integration.spec.ts`'s
own `describeIfFfmpeg`-skip / real-lavfi-test-clip template verbatim) is this feature's own
real-render acceptance gate, run against a real ffmpeg 8.1.2-full_build in this environment - 5
tests, all passing: single-cut duration shrinks by exactly the predicted crossfade overlap (proving
a real dissolve ran, not a no-op), multi-junction shrinkage sums correctly, audio stays audible
(never drops to silence) across every crossfade window, the fallback-to-concat path shows *zero*
shrinkage as expected, and a cut very close to clip start/end doesn't crash. Full `apps/worker`
suite: 55 suites / 663 tests passing. `typecheck`/`lint`/`format` all green.
