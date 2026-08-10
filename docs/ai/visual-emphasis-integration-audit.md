# Visual Emphasis Integration Audit (Gate A & B)

> **Status: Gate A and Gate B both CONFIRMED CLOSED — no production code changes across either
> gate.** Written after PR #68-#77 (all 9 spec Part 9 techniques implemented, all flag-off) per the
> user's explicit direction (2026-08-09): before any flag goes live, audit the 9 techniques as ONE
> system (Gate A), test cross-technique interactions (Gate B), then run systematic real-footage
> calibration (Gate C). Gate A is the single audit matrix answering "do these 9 rendering behaviors
> form one coherent editing system?" Gate B (sub-phases B1-B5, see their own findings/decision
> subsections below, plus the consolidated "Gate B review & closeout" section) is the
> evidence-gathering pass this matrix's own findings demanded — user-confirmed PASS for its
> evidence-gathering scope, with editorial calibration explicitly deferred to Gate C. **Gate C is
> next, blocked on real footage this sandbox doesn't have — needs its own planning session.** See
> [`ai/visual-emphasis-engine.md`](./visual-emphasis-engine.md) for each phase's own "architecture
> (as shipped)" section — this doc doesn't repeat that detail, it cross-references and synthesizes
> it.

Every fact below was re-verified against the real source in this pass (not recalled from memory) —
`packages/visual-emphasis/src/*.ts`, `packages/reframe/src/crop-path.ts` +`ocr-highlight.ts`,
`packages/primary-subject/src/select-primary-subject.ts`, `packages/cutlist/src/cutlist.ts`, and
`apps/worker/src/workers/render-clip.worker.ts`.

## System overview

Two independent producer chains feed the render pipeline — they never talk to each other directly,
only through what they each write into `buildReframePlan()`'s inputs:

```
Composition Intelligence's                  Phase C1's computeEditingSuggestions()
selectPrimarySubject() chain                 (5 technique-specific detectors, sorted
(active speaker -> face -> tracked           into ONE EditingSuggestionTimeline)
person -> attention object ->                        │
tracked object)                                       │
        │                                    digital_push · ocr_highlight · focus_shift
        │ primarySubjectSamples              · reaction_hold · pause_hold
        ▼                                             │
┌─────────────────────────────────────────────────────┴──────────────────────────────┐
│                          buildReframePlan() (render-clip.worker.ts)                 │
│  reads focus_shift + digital_push suggestions here, filtered by their OWN flags     │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                         │
                                         ▼
                              buildCropPath() (packages/reframe)
                       pan (face/object position) + zoom (emphasis words ∪ digital_push)
                       + focus_shift snap waypoints — ONE crop-window path, ALL 6 of
                       Auto Zoom/Auto Crop/Face Priority/Object Priority/Focus Shift/
                       Digital Push resolve into this single artifact
                                         │
                                         ▼
                      computeOcrHighlightBoxes() (packages/reframe)
                 anchors a STATIC box per OCR Highlight track to the crop path's
                 own window nearest that track's startTime — reads the crop path,
                 never writes back to it (one-directional)
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
   buildAss()                      renderClip()                    (watermark/B-roll
 (captions incl.                (crop + B-roll +                    already folded into
  OCR highlight box)              captions burned                    renderClip's own
                                  together)                           filter graph)
        └────────────────────────────────┴────────────────────────────────┘
                                         │
                       PASS 1 OUTPUT (composed, still on the clip's
                       ORIGINAL pre-cut clip-relative timeline)
                                         │
                                         ▼
                    computeClipCuts() + trimCutRanges()  ◄── Pause Hold
              (pause_hold suggestions, exact-match protected from
               computeSilenceCuts()'s own candidates, via protectPauseHolds())
                                         │
                       PASS 2 OUTPUT (POST-CUT timeline —
                       everything upstream of this point never
                       needed to know cuts exist; everything
                       downstream must)
                                         │
                                         ▼
              computeReactionHoldInstants() + applyReactionHolds()  ◄── Reaction Hold
        (reaction_hold suggestions, remapped from pre-cut to post-cut via
         remapTimestamp() against the SAME `cuts` Pause Hold just decided)
                                         │
                       PASS 3 OUTPUT (final Visual Emphasis
                       Engine output — intro/outro concat,
                       unrelated to this roadmap, follows)
```

**The one structural asymmetry worth naming up front**: 7 of the 9 techniques (Auto Zoom, Auto
Crop, Face Priority, Object Priority, Focus Shift, Digital Push, OCR Highlight) live entirely
inside **pass 1**, operating on the clip's original, pre-cut, clip-relative timeline — the same
timeline their own suggestions were computed against, so none of them ever needs remapping. Pause
Hold (pass 2) and Reaction Hold (pass 3) are different in kind, not degree: they run on
already-composed output, and Reaction Hold specifically is the only technique whose *suggestion*
lives on one timeline (pre-cut) while its *render action* lives on another (post-cut) — the exact
reason C6R needed its own dedicated redesign rather than following C3/C4/C5's "add a parameter to
an existing function" shape.

## Producer / consumer map

| Signal | Producer | Consumer(s) |
|---|---|---|
| `primarySubjectSamples` | `selectPrimarySubject()` (Composition Intelligence, pre-existing) | `buildReframePlan()` → `buildCropPath()` (Face Priority, Object Priority) |
| `EditingSuggestion[technique='digital_push']` | `fromHighlights()` (relabels Phase A1/B1 `HighlightTimeline`) | `buildReframePlan()` → `buildCropPath()`'s `zoomTriggerStarts` |
| `EditingSuggestion[technique='ocr_highlight']` | `fromOcrTracks()` (same `isOcrHighlightWorthy()` filter reused directly by `buildReframePlan()`) | Phase C1's own suggestion timeline (informational) — `buildReframePlan()` re-filters `ocrTracks` itself, does NOT read this array entry |
| `EditingSuggestion[technique='focus_shift']` | `fromPrimarySubjectSamples()` (trackId-change detector over the SAME `primarySubjectSamples`) | `buildReframePlan()` → `buildCropPath()`'s `focusShifts` |
| `EditingSuggestion[technique='reaction_hold']` | `fromEmotionalPeaks()` (Phase 10 `emotionalPeaks`) | `computeReactionHoldInstants()` (pass 3) |
| `EditingSuggestion[technique='pause_hold']` | `fromPauses()` (`computeSilenceCuts()` candidates near a Phase 10 curiosity/drop-off point) | `computeClipCuts()` (pass 2) |
| crop path (`CropWindow[]`) | `buildCropPath()` | `computeOcrHighlightBoxes()`, `renderClip()`'s sendcmd |
| `cuts: CutRange[]` | `computeClipCuts()` (pass 2) | `trimCutRanges()` (pass 2), `computeReactionHoldInstants()` (pass 3, via `remapTimestamp()`) |

**Note the one non-obvious coupling**: `ocr_highlight` suggestions exist in
`EditingSuggestionTimeline` but `buildReframePlan()` never reads that entry — it independently
re-derives qualifying tracks from `ocrTracks` using the same `isOcrHighlightWorthy()` filter. This
is intentional (`fromOcrTracks()`'s own comment: "one filter definition, not two independently
drifting copies") but means the *suggestion timeline* and the *actual rendered highlights* are
computed by two call sites sharing one filter function, not one call site read twice — worth
knowing if a future debugging session sees `Clip.editingSuggestions` disagree with what's actually
burned in (it shouldn't, but they are not literally the same array read twice).

## The 9-technique audit matrix

| # | Technique | Input signal | Output action | Time window / coordinate space | Renderer | Flag | Pass (priority) | Test status | Real-footage validation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Auto Zoom** | Transcript emphasis words (`EMPHASIS_PATTERN` regex) ∪ `digital_push` suggestions | Punch-in zoom envelope (attack/hold/release) on the crop window's width/height | Pre-cut, clip-relative; continuous `t` sampled every `CROP_PATH_STEP_SECONDS` (0.2s) | `buildCropPath()`'s `zoomEnvelopeAt()` → `sendcmd` (pass 1) | None (always on — pre-existing Fase 11 behavior) | 1 | Unit-tested (`crop-path.spec.ts`) | None |
| 2 | **Auto Crop** | Source video width/height only | Final constant output frame dimensions (9:16) | N/A (computed once, not time-varying) | `computeCropDimensions()` (pass 1, before the render graph) | None (always on — pre-existing Fase 2 behavior) | 1 | Unit-tested | None |
| 3 | **Face Priority** | `primarySubjectSamples` where `source ∈ {active_speaker, face}` | Crop-window x/y pan target | Pre-cut, clip-relative; sparse samples (face-landmark interval), interpolated | `buildCropPath()`'s `interpolateAt()` → `sendcmd` (pass 1) | None (always on — Phase C2 unified this with Object Priority, no flag) | 1 | Unit-tested + render-wiring test | None |
| 4 | **Object Priority** | `primarySubjectSamples` where `source ∈ {tracked_person, attention_object, tracked_object}` | Same crop-window x/y pan target, when no face is present | Same as Face Priority | Same as Face Priority | None (Phase C2, same as Face Priority) | 1 | Unit-tested + dedicated render-wiring test ("pans toward a tracked object when no face is detected") | None |
| 5 | **OCR Highlight** | `OcrTextTrack[]` filtered to `category ∈ {price, name}`, `categoryConfidence ≥ 0.5` | A static `\p1` vector-drawn rectangle around qualifying on-screen text | Pre-cut, clip-relative; ONE static snapshot per track, taken from the crop window nearest the track's own `startTime` — **does not track crop motion during its own visible window (documented limitation, see below)** | `computeOcrHighlightBoxes()` → `buildOcrHighlightEvent()` → ASS (pass 1) | `VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED` | 1 | Unit-tested + real ffmpeg+libass render verified (Phase C5) | None |
| 6 | **Focus Shift** | `primarySubjectSamples` trackId changes held ≥ `MIN_HOLD_SECONDS` (1.0s) | Synthetic hold/snap pan waypoints replacing the default linear drift across a subject change | Pre-cut, clip-relative; a `FOCUS_SHIFT_WINDOW_SECONDS` (0.3s) window centered on the shift instant | `applyFocusShifts()` inside `buildCropPath()` → `sendcmd` (pass 1) | `VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED` | 1 | Unit-tested + render-wiring test | None |
| 7 | **Digital Push** | `digital_push` suggestions (Phase A1/B1 `HighlightTimeline`, already thresholded) | A SECOND trigger source feeding Auto Zoom's SAME `zoomEnvelopeAt()` envelope (no new mechanism) | Pre-cut, clip-relative; only `start` is used, same envelope shape as an emphasis word | `buildCropPath()`'s combined max-reduce trigger set → `sendcmd` (pass 1) | `VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED` | 1 | Unit-tested + render-wiring test | None |
| 8 | **Reaction Hold** | `reaction_hold` suggestions (Phase 10 `emotionalPeaks`), merged via `mergeCutRanges()`, midpoint taken, remapped via `remapTimestamp()` | Freeze-frame (`trim`+`tpad` clone) + brief inserted silence (`anullsrc`), extending output duration | **Suggestion is pre-cut, clip-relative; RENDER ACTION is post-cut** — the one technique whose two coordinate spaces differ, bridged by `remapTimestamp()` (C6R.1) | `applyReactionHolds()` (C6R.2, real-ffmpeg verified) — pass 3, AFTER Pause Hold's cuts | `VISUAL_EMPHASIS_REACTION_HOLD_ENABLED` | 3 (last) | Unit-tested (merge/remap/dedup logic) + mocked exact-args ffmpeg suite + real ffmpeg 8.1.2 integration test + 7 render-wiring tests | None |
| 9 | **Pause Hold** | `pause_hold` suggestions (a `computeSilenceCuts()` candidate near a Phase 10 curiosity/drop-off point) | Removes that ONE silence range from the cut list via an EXACT `{start,end}` match (`protectPauseHolds()`) | Pre-cut, clip-relative — same timeline `computeSilenceCuts()` already operates in | `computeClipCuts()` → `trimCutRanges()` (pass 2) | `VISUAL_EMPHASIS_PAUSE_HOLD_ENABLED` | 2 | Unit-tested (`protectPauseHolds()`) + render-wiring test | None |

**Known limitation already documented in code** (not new to this audit, surfaced here because it's
exactly the class of cross-cutting risk Gate A exists to collect in one place): `ocr-highlight.ts`'s
own comment states a highlight box "can visibly drift out of alignment with the source video's own
on-screen text if the crop path pans/zooms substantially during a long highlight" — i.e. OCR
Highlight's correctness is silently coupled to how much Auto Zoom/Focus Shift/Digital Push move the
crop window during that highlight's own visible span. See Gate B below.

## System-level findings (the "one coherent system" questions)

**Coordinate space discipline**: verified consistent. Every technique's suggestion and every
technique's render action agree on clip-relative seconds, 0 = clip start, EXCEPT Reaction Hold's
render action (post-cut) — which is exactly why it's the only technique with its own remapping
primitive. No technique was found silently mixing absolute-source-time with clip-relative time (the
bug class this codebase has been bitten by before, per Phase A2's precedent).

**Priority / order**: a clean 3-tier structure, not 9 independently-ordered passes — pass 1 (7
techniques, all folded into ONE crop-path + ONE ASS render), pass 2 (Pause Hold), pass 3 (Reaction
Hold). Every pass-2/3 technique operates on the FULL COMPOSITE output of every earlier pass, never
on a partially-rendered intermediate — the same "already-composed, just pixels by now" property C7
and C6R's own design docs already rely on, confirmed still true with all 9 techniques considered
together.

**Feature-flag behavior**: confirmed "one flag per technique, never a shared master flag" holds for
all 5 flag-gated techniques (Focus Shift, Digital Push, OCR Highlight, Reaction Hold, Pause Hold).
Auto Zoom/Auto Crop/Face Priority/Object Priority have no flag (pre-existing or unified without one,
Phase C2) — an intentional asymmetry (a real behavior fix isn't optional the way a new effect is),
not an inconsistency.

**Failure isolation**: every pass-2/pass-3 technique (Pause Hold's trim, Reaction Hold's freeze) is
wrapped in its own try/catch, logs a warning, and falls back to the pre-pass render rather than
failing the job — verified identical posture across both. Pass-1 techniques have no equivalent
failure path of their own since `buildCropPath()`/`computeOcrHighlightBoxes()` are pure, synchronous
functions with no I/O to fail; `renderClip()` itself failing already fails the whole job (pre-existing
behavior, unrelated to this roadmap).

**Duplicate-effect risk (the max-reduce precedent)**: Auto Zoom and Digital Push already had this
exact risk (two trigger sources landing near the same instant, stacking into a double-zoom) and it
was closed by design — a single `Math.max()` reduce over a COMBINED trigger array means overlapping
triggers only ever produce one envelope peak. This is the pattern to check for wherever two
techniques could plausibly land on the same window (see Gate B).

## Gate B — Cross-technique interaction risk assessment

Every pairing the user listed, assessed against the real code (not guessed):

| Pairing | Risk found | Detail |
|---|---|---|
| **Focus Shift + Digital Push** | **HIGH — real, unmitigated** | Both write into the SAME `buildCropPath()` call in the SAME pass: Focus Shift inserts snap waypoints into the pan (`known` array), Digital Push adds a trigger to the zoom envelope. If a `focus_shift` window and a `digital_push`/emphasis-word trigger overlap in time, the crop simultaneously SNAPS position AND zoom-punches at the same instant — visually the exact "chaotic" stacking scenario the user's own diagram illustrates. No merge/priority rule exists between these two today (unlike Digital Push vs. Auto Zoom's own max-reduce, which only covers two zoom sources, not a zoom+pan combination). **Flagged for Gate B real-render testing, not fixed here** — Gate A's job is to find this, not resolve it. |
| **OCR Highlight + Auto Crop** | LOW | Auto Crop only sets the constant output frame size, computed once, not time-varying — nothing for OCR Highlight to drift against. |
| **OCR Highlight + Focus Shift / Digital Push / Auto Zoom** | **MEDIUM — documented, by-design limitation** | Already called out in `ocr-highlight.ts`'s own comment (static-snapshot anchoring). A `focus_shift` snap or a `digital_push`/Auto Zoom punch-in occurring DURING an OCR highlight's own visible window will visually desync the highlight box from the actual on-screen text, since the box never re-anchors after its own `startTime`. Real severity depends entirely on how often these actually co-occur on real footage — a Gate C question, but a Gate B test should at minimum confirm it doesn't look broken (vs. just imprecise). |
| **Reaction Hold + Pause Hold** | **MEDIUM — real, non-buggy coupling worth knowing about** | Whether Pause Hold is ON changes whether a coincident Reaction Hold survives. If a `reaction_hold` instant lands inside a silence gap that Pause Hold protects (flag on, exact match), that gap is NOT cut, `remapTimestamp()` returns the same position, and the hold applies normally. If Pause Hold is OFF (default) or the gap isn't an exact-match protected one, that same gap IS cut, and a `reaction_hold` instant landing inside it resolves to `null` and is silently skipped. This is by design (C6R.3's own "protect/apply rarely, don't guess" conservatism) and not a bug, but it means **toggling Pause Hold can silently change which Reaction Holds actually fire** — worth an explicit Gate B test case pairing the two flags in all 4 on/off combinations. |
| **Digital Push + Focus Shift** | Same finding as "Focus Shift + Digital Push" above (unordered pair) | — |
| **Face Priority + Object Priority** | LOW | Mutually exclusive by construction — `selectPrimarySubject()`'s own 5-step priority order guarantees exactly one `source` per sample instant, never both at once. No real conflict possible, only the documented step-order itself (already tested). |
| **OCR Highlight + Focus Shift** | Same finding as "OCR Highlight + Focus Shift/Digital Push/Auto Zoom" above | — |
| **Reaction Hold + Digital Push** | LOW | Different passes entirely (pass 1 vs. pass 3) and different mechanisms (crop-path zoom vs. freeze-frame) — a Digital Push zoom moment simply gets frozen mid-zoom if a Reaction Hold instant lands inside its envelope window, which is visually reasonable (freezing whatever was on screen, zoomed or not, is the whole point of pass 3 running on the fully-composed output). No conflict found. |
| **Pause Hold + Reaction Hold** | Same finding as "Reaction Hold + Pause Hold" above | — |

**Combinations not explicitly listed by the user but surfaced by this audit**: none beyond the two
flagged above (Focus Shift+Digital Push HIGH, OCR Highlight+any crop-mover MEDIUM, Pause
Hold+Reaction Hold MEDIUM). Every other pairing among the 9 was checked and found to have no
plausible interaction (different passes, mutually exclusive selection, or no shared state).

## Gate B test plan (approved 2026-08-09, prioritized B1-B5)

Build on the render-wiring test infrastructure already proven across C3-C7/C6R.3 (real signals
driven through the actual render graph, or a narrowly-scoped `computeEditingSuggestions` mock where
manufacturing a real signal is disproportionate effort) — this is testing infrastructure, not new
production code. Gate B's own success criterion, per the user's own framing: not "does it crash"
(Gate A/unit tests already cover that) but **does the editor look coherent, or does it look
aggressive/chaotic** — a system can be 100% technically correct, 100% tests green, and still be
terrible editing. B5 exists specifically to catch that, and is the reason Gate B must run before
Gate C, not alongside it.

### B1 — Focus Shift × Digital Push (HIGHEST PRIORITY — the one HIGH/unmitigated finding)

Must determine, from evidence, not from a rule chosen in advance:

- Are the two allowed to fire at the same instant at all?
- Does zoom win over snap?
- Does snap win over zoom?
- Can they coexist without visual chaos, unarbitrated?
- Is an explicit arbitration rule actually needed?

**Do not pick an arbitration rule before seeing the results** — construct the overlapping fixture
(a `focus_shift` window and a `digital_push`/emphasis-word trigger landing within each other's
envelope, both flags on), inspect what `buildCropPath()` actually produces (x/y AND width/height at
that instant, ideally a real rendered sample), and let that finding decide whether B1 needs a
follow-up fix at all.

#### B1 findings (evidence gathered 2026-08-09 — no arbitration decided)

**Fixture**: `crop = {width: 136, height: 240}` (a 320×240 source cropped to 9:16, the same
dimensions `crop-path.spec.ts` already uses throughout). Two known face samples at t=0 (x=12) and
t=1 (x=172) — an 80% pan across the frame. A `focus_shift` window `{start: 0.4, end: 0.8}`
overlapping a `digital_push` trigger at `0.4` — chosen so the zoom envelope's full-peak hold
(`[start, start+ZOOM_HOLD_SECONDS]` = `[0.4, 0.8]`) exactly matches the snap window, the worst-case
overlap (peak zoom for the entire snap, not just part of it).

**Numeric evidence** (`packages/reframe/src/crop-path.spec.ts`, "Gate B1 evidence" describe block,
2 new tests, both passing):

- **They ARE allowed to fire at the same instant — confirmed, not assumed.** At every sampled
  instant across the overlap (t=0.4, 0.6, 0.8), `width` sits at the exact same peak-zoom value
  (96, the standard 30% punch-in) a Digital Push moment produces firing completely alone — proving
  no damping/reduction is applied to the zoom just because a Focus Shift is also active.
- **Neither wins over the other — they are architecturally independent inputs to the SAME output,
  not competing for one slot.** Position (from `focusShifts`/`interpolateAt`) and size (from the
  zoom trigger set) are computed on entirely separate code paths inside `buildCropPath()`, then
  combined into one `CropWindow`. There is no priority check, no `if` that suppresses one when the
  other is active — "does zoom win over snap" and "does snap win over zoom" are both the wrong
  question; the honest answer is **both apply, unconditionally, always**.
- **An undocumented second coupling was found while building this fixture**: the crop's rendered
  `x`/`y` is not simply the raw pan target — `buildCropPath()` already re-centers position for
  whatever zoom level is active (`centerX - width/2`, the same mechanism the pre-existing
  "re-centers the zoomed crop" test covers for zoom alone). During this overlap that adds a
  constant +20px offset to the raw 12→92→172 pan trajectory (becoming 32→112→192) — the *relative*
  pan distance (160px) is unaffected, but this means Focus Shift's own rendered position during a
  simultaneous Digital Push is not what reading `applyFocusShifts()` in isolation would suggest.
  Worth carrying into whatever arbitration design comes next.
- **Quantified**: 160px of pan (**>100% of the crop's own 136px width**) compressed into the same
  0.4s window the frame is held at its tightest 30% zoom-in. This is the raw magnitude a viewer
  would need to visually process in under half a second, simultaneously with an aggressive punch-in.

**Real-ffmpeg visual evidence**: the exact same fixture's `CropWindow[]`/sendcmd output was rendered
through the real `sendcmd`+`crop@reframe`+`scale` filter chain `renderClip()` itself uses (this
sandbox's real ffmpeg), against a `testsrc2` synthetic source (fixed, highly-differentiated color
regions — chosen specifically so a pan/zoom is visually unambiguous in extracted frames, not
because it resembles real footage). Frames extracted at t=0.2 (baseline, before the overlap), 0.4,
0.6, and 0.8 (start/mid/end of the overlap) show **three visibly, dramatically different regions of
the source pattern in three consecutive ~0.2s frames** — the crop window moves far enough, fast
enough, while zoomed in tightly enough, that almost none of what's on screen at t=0.4 is still on
screen at t=0.6, and almost none of THAT is still on screen at t=0.8. This is a direct, rendered
confirmation of the numeric finding above (a pan exceeding the crop's own width, compressed into
a narrow zoomed-in window), not a separate claim.

**Honest limitation of this evidence**: `testsrc2` is an artificial, sharply-color-blocked pattern
— it makes a large crop displacement maximally obvious, which is exactly what this evidence needed
to prove ("can a large, fast displacement actually happen" — yes), but it cannot answer "does this
look chaotic on a real talking-head clip," since real footage doesn't have testsrc2's own sharp,
arbitrary color boundaries. That question stays exactly where the original plan put it — **B5** (or
Gate C, once real footage exists) — not answered here.

**What B1 does NOT conclude**: whether 160px/0.4s of combined pan+zoom is actually "too much" for
real content, and whether an arbitration rule (e.g. damping one signal when the other is active,
sequencing them instead of overlapping, or leaving both unconditional as today) is warranted. That
is the explicit next decision, deferred to whoever reviews this evidence — not decided here, per
the instruction this section opened with.

#### B1 decision (2026-08-09)

**No arbitration rule is introduced at B1. Focus Shift and Digital Push are permitted to coexist.**
The evidence above establishes technical interaction (they CAN and DO coexist, unconditionally,
with a real, quantified, real-ffmpeg-confirmed displacement) but not editorial undesirability — a
distinction worth stating precisely: **"can they coexist?" — yes. "should they always coexist?" —
not yet established.** Introducing a priority rule (e.g. "Digital Push wins," "Focus Shift wins")
now would be premature, since the two techniques carry different editorial semantics that can
legitimately co-occur on purpose:

```
Focus Shift   → "the subject changed"        → move attention spatially
Digital Push  → "this moment deserves emphasis" → increase visual intensity

new speaker appears + an emotional/important moment
        ↓
move toward the new subject + tighten framing
        ↓
potentially a GOOD edit, not chaos
```

The actual concern is the **velocity and amplitude** of the combined crop trajectory, not the mere
fact of coexistence — a question only real footage can answer. **B1's status is therefore
"technically valid, aesthetically uncalibrated,"** not "broken" and not "fixed." The quantified
160px/0.4s case is retained as a specific, high-priority stress condition for B5 and Gate C, and the
zoom-dependent recentering coupling found above is preserved as a documented implementation
constraint for whatever arbitration design (if any) eventually gets built. No code changes follow
from this decision — B1 remains evidence-only, per this whole gate's own scope.

### B2 — OCR Highlight × moving crop

Test at multiple movement magnitudes, not just "does it move at all":

- **Low movement** (a small pan, no zoom)
- **Medium movement** (a Focus Shift snap OR a Digital Push punch, not both)
- **Large movement** (both, i.e. whatever B1 finds actually happens)

Goal: determine whether the static-snapshot design (`ocr-highlight.ts`'s own documented limitation)
is still acceptable at each level, or only acceptable below some movement threshold — an evidence-
based answer, not the current assumption.

#### B2 findings (evidence gathered 2026-08-09 — no mechanism change)

**Fixture**: a representative on-screen price/name box (`xCenter: 0.5, yCenter: 0.5, width: 0.15,
height: 0.08`, source-normalized) with a 2-second visible window — long enough for real crop
movement to happen during it, matching Focus Shift/Digital Push's own real timescales. `output =
136×240`.

**Technique**: `computeOcrHighlightBoxes()` already picks whichever crop window is NEAREST a
track's own `startTime`. A second call with the SAME bounding box but `startTime` set to the
highlight's own `endTime` reuses that exact mechanism to compute "where would this box be if it
were anchored to the crop window at the highlight's END instead of its START" — a legitimate
stand-in for a continuously-tracked box, with no new production code. The delta between the two
calls IS the drift the static design leaves unaddressed.

**Numeric evidence** (`packages/reframe/src/ocr-highlight.spec.ts`, "Gate B2 evidence" describe
block, 4 new tests, all passing), 4 movement levels tested:

| Level | Crop movement over 2s | Drift (as % of output width) | Verdict |
|---|---|---|---|
| **Low** | 10px pan, no zoom | ~3.7% | Static box stays close to where a tracked box would be — acceptable. |
| **Medium** | 80px pan (Focus-Shift scale), no zoom | ~33% | Drift becomes a real third of the output frame — visually noticeable, likely no longer "close enough." |
| **Large** | 110px pan + 30% zoom | ~40%, and the tracked box CLAMPS to the frame's left edge | The static box is now substantially wrong — not just offset, but pointing at a materially different region than where the text actually sits. |
| **Extreme** | 160px pan + 30% zoom — **the exact same combined magnitude B1 found for Focus Shift × Digital Push** | N/A — the tracked box **doesn't exist at all** | **Qualitatively worse than drift**: the real on-screen text has been panned/zoomed entirely out of the crop's field of view by the highlight's own end, while `computeOcrHighlightBoxes()`'s static snapshot (anchored to `t=0`) is still a valid box that the pipeline would keep burning in for the FULL highlight duration regardless. |

**Real-ffmpeg visual evidence**: rendered the Extreme scenario through the real crop+scale
mechanism (a `testsrc2` source with a fixed magenta marker at the text's own true source position,
a green box burned in at the STATIC highlight position, same technique as B1's visual check). At
t=0 the two boxes coincide exactly, confirming the design is correct at the highlight's own start
by construction. By t=2.1 (just after the crop's large move), **the magenta marker (the real text)
has left the frame entirely — while the green box (the static highlight, what the real pipeline
would actually show) is still on screen**, now surrounded by unrelated background content with
nothing resembling the original text anywhere near it. This is a direct, rendered confirmation of
the numeric Extreme finding, not a separate claim.

**Answer to B2's own question**: the static-snapshot design is **acceptable at Low movement,
questionable at Medium, and NOT acceptable at Large/Extreme** — at the combined magnitude B1 itself
found technically possible (Focus Shift + Digital Push overlapping, unarbitrated), OCR Highlight's
own static box can end up highlighting nothing at all. This directly couples B1's own eventual
calibration outcome to B2's severity: if B1's real-footage calibration (Gate C) leaves Focus
Shift+Digital Push free to combine at full magnitude, OCR Highlight inherits a real, now-quantified
risk of showing a highlight box over content that isn't there anymore — not merely "slightly
imprecise" as the original documented limitation implied before this evidence existed.

**What B2 does NOT conclude**: whether to build continuous tracking, whether to add a distance/
movement THRESHOLD past which the box fades out or clamps to "no highlight," or whether to leave
the static design as-is and accept the Extreme case as rare on real footage. That decision, like
B1's, is deferred — this section only replaces "a documented limitation" with "a documented,
quantified, rendered-and-confirmed limitation."

#### B2 decision (2026-08-09)

**No threshold is introduced. B2's status is "conditional risk — no code change."** There isn't
enough real-footage data yet to pick a defensible cutoff value for a rule like "if crop movement
exceeds X, suppress OCR Highlight" — inventing one now would be exactly the kind of premature,
uncalibrated decision this whole gate exists to avoid. The 4 open questions this evidence raises are
carried forward to Gate C rather than answered here:

1. How often does OCR Highlight actually coincide with large crop movement on real footage?
2. At what movement magnitude does the mismatch start to read as visually disruptive, not just
   numerically large?
3. Should the eventual fix be suppression (skip the highlight when movement is too large),
   repositioning (re-anchor the box partway through), or real continuous tracking?
4. **Does Focus Shift + Digital Push combining (B1) measurably increase how often OCR Highlight's
   own failure mode fires?**

Question 4 is the one this evidence makes explicit and non-optional: **B1 and B2 are coupled risks,
not two independent findings.**

```
Focus Shift + Digital Push (B1, unarbitrated)
        ↓
crop moves larger/faster
        ↓
OCR Highlight's static snapshot
        ↓
increased risk of the highlight pointing at the wrong region (B2)
```

Both stay recorded as open, linked risks carried into the same Gate C real-footage pass — B1's own
eventual calibration outcome (does real footage show Focus Shift+Digital Push combining often, and
at what magnitude) directly determines how often B2's Extreme case actually happens in production.
Gate C's test plan should measure both together, not resolve them independently.

### B3 — Pause Hold × Reaction Hold

Explicitly verify both states side by side, using the SAME coincident-instant fixture (a
`reaction_hold` suggestion landing inside a `pause_hold`-eligible silence gap):

- **Pause Hold OFF** → the gap is cut → the Reaction Hold instant resolves to `null` → **skipped**
- **Pause Hold ON** → the gap survives → `remapTimestamp()` returns the same position → **hold
  applies**

Confirm this is the *intentional*, documented C6R.3 behavior (`remapTimestamp()`'s own "protect/
apply rarely, don't guess" conservatism) — not an accidental side effect nobody decided on. All 4
`{pauseHold, reactionHold} × {on, off}` combinations should be asserted, not just the 2 states above.

#### B3 findings (evidence gathered 2026-08-09 — no mechanism change)

**Fixture**: the same `[0.45, 9.35]` silence-gap fixture C7/C6R.3's own render-wiring tests already
use (`"hi"` ends at clip-relative 0.3s, `"there"` starts at 9.5s), a `reaction_hold` suggestion
whose midpoint (5.0) falls squarely inside that gap, and a `pause_hold` suggestion that EXACTLY
matches the gap's own `{start, end}` (the precision `protectPauseHolds()` requires).
`apps/worker/src/workers/render-clip.worker.spec.ts`, "Gate B3 evidence" describe block, 4 new
tests, all passing, driven through the real render pipeline (not a synthetic probe like B1/B2 —
this interaction is between two already-fully-implemented worker functions, so the existing
render-wiring test infrastructure was the correct, direct tool).

| pauseHold | reactionHold | `trimCutRangesMock` | `applyReactionHoldsMock` | Confirmed behavior |
|---|---|---|---|---|
| OFF | OFF | called, cuts=`[{0.45,9.35}]` | not called | Gap cut for real; reaction-hold pass never runs (flag off). |
| OFF | ON | called, cuts=`[{0.45,9.35}]` | **not called** | Gap cut for real → the coincident instant lands inside that cut → `remapTimestamp()` returns `null` → **silently skipped**. |
| ON | OFF | **not called at all** (`cuts.length === 0`) | not called | Gap fully protected, no candidate cut survives to trim; reaction-hold pass never runs (flag off). |
| ON | ON | **not called at all** | **called**, `[5]` | Gap fully protected → `remapTimestamp(5.0, [])` returns `5.0` unchanged → **the hold applies, exactly where the original suggestion said it should**. |

**Unlike B1 and B2, B3's evidence is a confirmation, not a new discovery.** All 4 combinations
behave exactly as C6R.3's own design intended — `remapTimestamp()`'s `null`-for-cut-away-instant
semantics (C6R.1) and `protectPauseHolds()`'s exact-match conservatism (C7) compose correctly with
no gap or surprise. The row that matters most (`ON`/`ON`) confirms the hold genuinely survives at
the ORIGINAL, un-remapped instant when nothing was cut — not a coincidence of the specific numbers
in this fixture, but the direct, provable consequence of `remapTimestamp()` returning `t` unchanged
whenever `cuts` is empty.

**What this means for calibration**: whoever eventually tunes Pause Hold and Reaction Hold
independently should know — not discover by surprise — that **toggling Pause Hold changes Reaction
Hold's own observable behavior** on any clip where the two coincide. This isn't a bug to fix, and
it isn't an implementation coupling either (each flag genuinely gates its own independent code
path, with no shared mutable state or hidden call). The precise term is **product dependency, not
implementation coupling**: at the IMPLEMENTATION level the two flags are completely independent;
at the PRODUCT/EDITORIAL level, what one flag protects mechanically changes what the other flag can
observe and act on. A naive "roll out each flag separately, they don't interact" rollout plan could
miss exactly this. No code changes follow from this section — B3 is confirmation-only.

### B4 — All flags ON

Mandatory. Not merely "the render doesn't crash" — measure, for a single representative clip with
all 5 flag-gated techniques triggering:

- Timing density (how close together do interventions land)
- Number of visual interventions in the clip's total duration
- Crop movement (cumulative pan/zoom distance, not just presence)
- Zoom frequency (how often Auto Zoom/Digital Push's combined trigger set fires)
- OCR box density (how many highlight boxes appear, and how close together)
- Reaction hold count and total added duration
- Pause preservation count (how many silences Pause Hold actually protected)

These are the concrete numbers B5's qualitative judgment gets checked against.

#### B4 findings (evidence gathered 2026-08-09 — no code changes)

**Fixture**: one deliberately adversarial 8.8s clip recreating every conflict B1-B3 already found,
together, on the SAME timeline — not a clean fixture, per the explicit instruction that a clean
fixture could pass "all flags on" without exercising any real interaction risk:

- A `focus_shift` window (`[0.85, 1.15]`) overlapping a `digital_push` trigger (`start: 1.0`) — the
  exact B1 worst-case shape, sitting inside a **protected** silence gap.
- Two silence gaps: `[0.45, 2.85]` protected by an exact-match `pause_hold` suggestion (survives),
  `[3.45, 7.85]` unprotected (cut for real) — the same B3 mechanism, both branches, on one clip.
- A `reaction_hold` instant (`start: 7.9, end: 8.3`, midpoint 8.1) positioned just past the real
  cut's own end — forcing `remapTimestamp()` to actually shift it, not leave it untouched.
- A qualifying OCR price track (same fixture C5's own tests use), positioned to co-occur with the
  Focus Shift/Digital Push zone.

**Category A: technical integration** — verified at two levels, exactly per the 5 items requested:

1. **No crash** — `apps/worker/src/workers/render-clip.worker.spec.ts`, "Gate B4 evidence" describe
   block (4 new tests, all passing): the job completes successfully with all 5 flags on and this
   fixture. Full worker suite (53 suites / 630 tests) passes unchanged.
2. **No timeline corruption, C7 cuts → Pause Hold → Reaction Hold** — verified at BOTH the mocked
   wiring level (`trimCutRangesMock` receives exactly `[{start: 3.45, end: 7.85}]` — the protected
   gap correctly excluded, the real one correctly present, no negative/inverted range) AND the real
   level (see below) — `applyReactionHoldsMock` receives `[3.7]`, the exact hand-computed
   post-cut position (`8.1 - (7.85 - 3.45) = 3.7`), proving the remap math holds even with 4 other
   techniques simultaneously active.
3. **A/V sync — MEASURED, not assumed.** A real, non-mocked run of the entire 3-pass chain (real
   `buildCropPath()`/`buildSendCmdScript()` → real ffmpeg crop+zoom render → real `trimCutRanges()`
   → real `applyReactionHolds()`, this sandbox's real ffmpeg 8.1.2) on this exact adversarial
   fixture produced a **final video/audio duration delta of 2 milliseconds** (4.840s vs. 4.838s) —
   effectively perfect sync, within ordinary real-encoder frame-boundary tolerance, holding all the
   way through the most conflict-dense scenario this audit has constructed.
4. **Crop path validity** — the same real run's `buildCropPath()` output was checked point-by-point
   (45 sampled points across the clip): **0 invalid points** — every x/y/width/height stayed within
   `[0, sourceWidth]`/`[0, sourceHeight]` bounds, no degenerate (zero/negative) dimension, no `NaN`,
   even through the B1-shaped Focus Shift+Digital Push overlap. A visual check of 6 extracted frames
   from the final rendered output found no black/corrupted frames.
5. **OCR Highlight still renders** — verified at the wiring level: `computeOcrHighlightBoxesMock`
   still receives the real, correctly-classified price track (not silently dropped once 4 other
   flags are also active), and `buildAss()` still receives that computed `ocrHighlights` value.
   The RENDERING mechanism itself (the ASS `\p1` rectangle) was already verified for real in Phase
   C5 and is architecturally unaffected by which other flags are on — B4 confirms the DATA still
   reaches it under load, not a second re-verification of C5's own already-proven mechanism.

**Category A verdict: all 5 items pass.** No crash, no timeline corruption, real-measured A/V sync
holds to the millisecond, crop-path geometry stays 100% valid, OCR Highlight data still flows
through — under the single densest, most adversarial combination this audit could construct from
every prior finding. This is real evidence the underlying mechanics are sound; it says nothing
about whether the RESULT looks good, which is Category B's job.

**Category B: editorial density (reported, not judged)** — raw measurements from this same fixture,
explicitly NOT a "too aggressive/fine" verdict, per the instruction that Category B stays with
B5/Gate C:

- **Visual interventions in this 8.8s clip**: 1 Focus Shift snap + 1 Digital Push zoom envelope
  (fully overlapping, per B1) + 1 OCR highlight box + 1 protected pause + 1 Reaction Hold freeze —
  5 distinct interventions across a clip under 9 seconds long.
- **Timing concentration**: 3 of those 5 (Focus Shift, Digital Push, and the OCR highlight's own
  start) cluster within roughly a 1-second window (`~0.85s-1.9s`) — the SAME clustering the B1/B2
  evidence already flagged individually, now confirmed to literally co-occur on one timeline, not
  just each be individually possible.
- **Reaction Hold's own contribution**: +0.5s of frozen, silent duration inserted at the clip's own
  post-cut `3.7s` mark — a duration extension of ~11% relative to the 4.4s post-cut runtime.
- **Pause preservation**: 1 of 2 candidate silence gaps preserved (50%), removing 4.4s of the
  original 8.8s (50% of runtime cut) around the one gap that wasn't protected.

**No conclusion is drawn from these numbers about whether this reads as intentional emphasis or as
noise** — that is explicitly B5's own job, using this same fixture (or one like it) as its primary
stress case.

### B5 — Visual chaos stress test (most important gate before Gate C)

The user's own framing, verbatim: **a system can be 100% technically correct, 100% tests green,
and still be terrible editing** — Gate A's clean architecture and Gate B1-B4's passing assertions
do not, by themselves, prove the RESULT is good editing. B5 is the check that catches what
unit/integration tests structurally cannot: render the timing-density stress case (the user's own
diagram — `zoom → focus → OCR → hold` within ~3 seconds) and judge, on a real or realistic sample,
whether the combined result reads as intentional emphasis or as noise. This is a qualitative gate,
not a numeric one — B4's measurements inform it, but don't replace human judgment here.

#### B5 findings (evidence gathered 2026-08-09 — no code changes, no editorial verdict)

**Method**: 4 metrics computed for TWO fixtures — **Fixture A**, the same worst-case adversarial
clip Gate B4 used, and **Fixture B**, a 27.75s clip with the same 5 techniques triggering
independently (a subject change, an emphasis moment, a price tag, a dead-air cut, a dramatic
protected pause, an emotional beat — each placed on its own, not deliberately co-located) — to test
whether A's density is representative or an artifact of adversarial construction, per the explicit
instruction. Every number below comes from the real `@speedora/reframe`/`@speedora/cutlist`
functions, not estimation.

**1. Intervention density (peak burst count in a sliding window)**

| Window | Fixture A (adversarial) | Fixture B (realistic) |
|---|---|---|
| 0.5s | **3 events** overlapping | 1 event (never more) |
| 1s | **3 events** overlapping | 1 event (never more) |
| 2s | **3 events** overlapping | 1 event (never more) |

Fixture A's peak (Focus Shift + Digital Push + OCR Highlight all active at once, around t≈1.0-1.15)
holds at 3 simultaneous events regardless of window size, because the events genuinely overlap in
time, not just land close together. Fixture B never exceeds 1 — its 4 events never overlap at all,
at any window size tested.

**2. Crop displacement velocity**

| | Fixture A | Fixture B |
|---|---|---|
| Max instantaneous velocity | **531 px/s** (at t≈1.0, inside the Focus Shift+Digital Push overlap) | 255 px/s (at the isolated Focus Shift snap) |

Both numbers come from the real, sampled `CropWindow[]` path (`CROP_PATH_STEP_SECONDS`=0.2s
resolution). 531px/s is noticeably higher than B1's own already-flagged baseline (160px over 0.4s =
400px/s average) — the OCR Highlight's own presence in the SAME window doesn't add pan velocity
directly, but the peak reported here captures the exact instant Focus Shift's snap ramp is
mid-motion. **Real-ffmpeg visual confirmation**: 8 frames extracted every 0.2s across `[0.7, 2.1]`
(the cluster window) show the on-screen content changing to an almost entirely different region of
the source pattern between EACH consecutive 0.2-0.4s frame pair — a direct, rendered look at what
"531px/s while zoomed to 70%" actually produces on screen, not just a number.

**3. Visual persistence (% of clip under some active intervention)**

| | Fixture A | Fixture B |
|---|---|---|
| Union of all event windows | 2.65s of 4.90s | 4.05s of 27.75s |
| Persistence | **54.1%** | **14.6%** |

Over half of Fixture A's entire (short) runtime has some technique actively changing the frame.
Fixture B, despite having the same 4 event TYPES, spends the large majority of its (longer) runtime
with nothing actively intervening.

**4. Recovery time (gap between one event's end and the next event's start)**

| | Fixture A | Fixture B |
|---|---|---|
| Gaps (sorted) | **-0.900s, -0.300s, 0.700s** | 2.850s, 3.500s, 4.350s |

Fixture A's two negative values are not "tight gaps" — they mean the events literally overlap (the
next one starts before the previous one ends), i.e. genuinely zero recovery time for two of the
three transitions. Its only positive gap (0.700s, between OCR Highlight ending and Reaction Hold
starting) is still under Reaction Hold's own 0.5s freeze duration. Fixture B's tightest gap (2.85s)
is, by contrast, several times longer than any single intervention in either fixture.

**Note on Pause Hold**: deliberately excluded from all 4 measurements above — protecting a pause
doesn't ADD a visible effect, it's the absence of a cut (a real methodological distinction, not an
oversight; the user's own event-persistence diagram likewise only named Focus Shift/Digital Push/
OCR Highlight/Reaction Hold as bars). The cut junction itself (`computeCutJunctionTimestamps()`'s
brief brightness dip, `TRANSITION_FADE_SECONDS`=0.15s) IS a real, distinct visual event and is
reported separately per fixture, but wasn't folded into the same "intervention" category since it's
architecturally a different kind of event (an edit transition, not an emphasis effect).

**What this evidence suggests (observation, not verdict)**: Fixture A's density is achievable, real,
and now precisely quantified — but it required deliberately co-locating triggers that, per Fixture
B, do NOT co-locate when placed independently. This doesn't establish that real footage behaves like
either fixture — whether real trigger timing naturally clusters (like A) or spreads out (like B) is
exactly the open question only real footage can answer, and is deferred to Gate C in full, per the
instruction that Category B/editorial judgment stays out of B5's own conclusion. What IS
established: the mechanism CAN produce a 54%-persistent, 3-way-overlapping, zero-recovery-time
result on some input shape, and the real-ffmpeg cluster render shows concretely what that looks
like frame-by-frame.

## Gate sequence (approved 2026-08-09)

```
GATE A — Architecture            ✅ COMPLETE (this document)
        │
        ▼
GATE B — Interaction + visual coherence      ✅ CONFIRMED CLOSED (B1-B5 + review, 2026-08-09)
        │  B1 Focus Shift×Digital Push  ✅ coexistence confirmed, no arbitration
        │  B2 OCR×moving crop           ✅ quantified, conditional risk, coupled to B1
        │  B3 Pause Hold×Reaction Hold  ✅ confirmed intentional (product dependency)
        │  B4 all-flags-on              ✅ technical integration PASS, density measured
        │  B5 chaos stress test         ✅ density/velocity/persistence/recovery measured,
        │                                  A vs. B comparison run - NO editorial verdict
        │                                  rendered, per instruction
        │  Gate B determination: PASS for its own evidence-gathering scope
        │  (Category A technical - solid; Category B editorial - open,
        │  carried to Gate C) - user-confirmed, not a unilateral call
        ▼
GATE C — Real-footage calibration            NEXT (blocked: needs real footage - none
                                              available in this sandbox; own planning
                                              session required)
```

**No production flag goes live while Gate B is incomplete.** This restates, not replaces, the
Gate C section below - Gate B is now the explicit, ordered blocker between "architecture is sound"
and "footage says it looks good."

## Gate B review & closeout (CONFIRMED 2026-08-09)

Per the explicit instruction to review the full B1-B5 evidence before deciding whether Gate B is a
genuine PASS and what carries to Gate C, this section consolidates all 5 sub-phases into one
determination. **The user reviewed this determination and explicitly confirmed it as written
(2026-08-09) — Gate B is officially closed.**

### Consolidated findings

| Sub-phase | What was found | Code changed? |
|---|---|---|
| B1 | Focus Shift × Digital Push coexist unconditionally, no arbitration exists; 160px/0.4s (>100% of crop width) combined pan+zoom is technically achievable; a second, undocumented zoom-recentering coupling was found | No |
| B2 | OCR Highlight's static-snapshot drift is quantified (3.7%→40%→"leaves frame entirely" across low/medium/large/extreme movement); directly coupled to B1's own eventual calibration outcome | No |
| B3 | Pause Hold × Reaction Hold is a confirmed, intentional **product dependency, not implementation coupling** — toggling one changes the other's observable behavior by design | No |
| B4 | All 5 flags on, adversarial fixture: 0 crashes, 0 timeline corruption, 2ms A/V sync delta, 0/45 invalid crop points, OCR data confirmed still flowing — **Category A (technical) is unconditionally solid** | No |
| B5 | Worst-case fixture reaches 3-way event overlap, 54% visual persistence, -0.9s (literal overlap) recovery, 531px/s peak velocity; an independently-timed fixture with the same techniques never overlaps at all (14.6% persistence, 2.85s min recovery) — **Category B (editorial) remains genuinely open** | No |

**Zero production code was changed across all of Gate B.** Every sub-phase added only tests/scripts
that exercise and measure the EXISTING, already-shipped C1-C7/C6R.1-C6R.3 implementation — this gate
was evidence-gathering exactly as scoped from the start.

### Proposed Gate B determination

**Gate B PASSES its own defined scope** — but that scope needs to be stated precisely, because
"Gate B passes" does NOT mean "the system is calibrated" or "safe to enable in production":

- **What Gate B was actually asked to do**: characterize every cross-technique interaction the
  architecture allows, verify the underlying mechanics hold up under the worst realistic
  combination, and produce the quantified evidence Gate C needs. **All of that is done.** No
  interaction was found to be broken, silently wrong, or architecturally unsound. Every risk found
  (B1, B2, B3) was already knowable from the architecture, now confirmed and quantified rather than
  theoretical.
- **What Gate B was explicitly NOT asked to do, and did not do**: decide whether the combined
  visual result is good editing. That determination requires real footage and human judgment
  (Category B, explicitly deferred at B4 and B5 both) — synthetic evidence, however rigorous, cannot
  answer "does this look chaotic" on its own, only "here is exactly what would happen if it did."
- **No blocking defects were found.** Nothing in B1-B5 suggests the C1-C7/C6R.1-C6R.3
  implementation itself needs to change before Gate C can proceed — every finding is a
  characterization of INTENDED (if uncalibrated) behavior, not a bug.

**Confirmed determination: Gate B PASSES its own evidence-gathering scope** — a full, evidence-
backed map of every interaction risk, with nothing broken, is met. This is explicitly NOT the same
as "ready to enable any flag in production" — Category B (editorial quality) remains open and
carries into Gate C in full, per the itemized list below.

### What carries forward to Gate C (concrete, not general)

1. **The B1 stress case** (Focus Shift × Digital Push, worst-case 531px/s / 160px-per-0.4s) needs
   real-footage validation: does this overlap actually occur on real content, how often, and does it
   read as intentional or chaotic when it does? No arbitration rule should be designed before this
   is answered (B1's own decision, restated).
2. **B2's 4 open questions**, carried verbatim from that decision — frequency of OCR Highlight ×
   large-crop-movement co-occurrence, the magnitude at which mismatch becomes visually disruptive,
   the eventual fix shape (suppress/reposition/track), and whether B1's own calibration outcome
   changes B2's failure frequency.
3. **B3's product dependency** must be documented in whatever rollout/calibration plan Gate C
   produces — Pause Hold and Reaction Hold cannot be evaluated as fully independent variables in an
   A/B-style rollout; their interaction is real and by design.
4. **The B4 adversarial fixture itself** is a reusable asset, not just one-time evidence — the same
   8.8s clip (or an equivalent) is a natural synthetic regression case for any future change to
   these 9 techniques, and a natural stand-in "does this break anything" smoke test before real
   footage is available.
5. **The B5 density/velocity/persistence/recovery baseline numbers** (3-way overlap / 531px/s /
   54.1% / -0.9s for the worst case; 1-event-max / 255px/s / 14.6% / 2.85s for the independently-
   timed case) give Gate C concrete synthetic bounds to compare real-footage measurements against —
   real content's own numbers, once measured, tell us where reality actually falls on that spectrum,
   which this synthetic evidence alone cannot.
6. **The A-vs-B contrast itself** is an open question for Gate C, not an answered one: does real
   editorial content's own trigger timing naturally cluster (like Fixture A) or spread out (like
   Fixture B)? This is arguably the single most important unresolved question this whole gate
   surfaces, and only real footage can answer it.

## Gate C — Real-footage calibration (deferred, not started)

Per the user's own explicit principle, restated here as the gate condition: **real data only,
explicit gaps — no success/retention-improvement numbers until real data exists.** The sequence,
once Gate B passes:

```
OFF
 ↓
single-technique validation (one flag on, real footage, qualitative review)
 ↓
small representative corpus (a handful of real clips covering each technique's trigger condition)
 ↓
combined-technique validation (the Gate B risk pairings, now on real footage)
 ↓
threshold tuning (MIN_HOLD_SECONDS, PAUSE_PROXIMITY_SECONDS, REACTION_HOLD_EXTENSION_SECONDS, etc.
                   — every constant in this roadmap is already documented as an unvalidated
                   heuristic, ADR D4 "scale honesty")
 ↓
engagement comparison (Milestone 1's PublishRecordStatsSnapshot pipeline, once enough
                        flag-on published clips exist)
 ↓
selective ON (per-technique, not all-at-once — the whole point of "one flag per technique")
```

Not started. No real footage was available in this sandbox for any phase in this roadmap (a
recurring, honestly-documented gap since Phase C3) — Gate C's first concrete action is acquiring
some, not writing more code.

## What this audit did NOT do

- No code changes. No flags flipped. No new mechanism designed.
- Did not attempt to resolve the Focus Shift+Digital Push interaction risk (a real design decision
  - priority order? magnitude damping? — that belongs to whoever picks up Gate B, informed by this
  finding, not decided unilaterally here).
- Did not run any of the Gate B test plan above — this document defines the plan, Gate B executes it.
- Did not touch calibration constants, weights, or thresholds.
