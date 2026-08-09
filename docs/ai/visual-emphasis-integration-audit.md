# Visual Emphasis Integration Audit (Gate A)

> **Status: Gate A audit document — no code changes.** Written after PR #68-#77 (all 9 spec Part 9
> techniques implemented, all flag-off) per the user's explicit direction (2026-08-09): before any
> flag goes live, audit the 9 techniques as ONE system, test cross-technique interactions (Gate B),
> then run systematic real-footage calibration (Gate C). This document is Gate A's deliverable — a
> single audit matrix answering "do these 9 rendering behaviors form one coherent editing system?"
> instead of 9 separate per-phase audits. See [`ai/visual-emphasis-engine.md`](./visual-emphasis-engine.md)
> for each phase's own "architecture (as shipped)" section — this doc doesn't repeat that detail,
> it cross-references and synthesizes it.

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

### B2 — OCR Highlight × moving crop

Test at multiple movement magnitudes, not just "does it move at all":

- **Low movement** (a small pan, no zoom)
- **Medium movement** (a Focus Shift snap OR a Digital Push punch, not both)
- **Large movement** (both, i.e. whatever B1 finds actually happens)

Goal: determine whether the static-snapshot design (`ocr-highlight.ts`'s own documented limitation)
is still acceptable at each level, or only acceptable below some movement threshold — an evidence-
based answer, not the current assumption.

### B3 — Pause Hold × Reaction Hold

Explicitly verify both states side by side, using the SAME coincident-instant fixture (a
`reaction_hold` suggestion landing inside a `pause_hold`-eligible silence gap):

- **Pause Hold OFF** → the gap is cut → the Reaction Hold instant resolves to `null` → **skipped**
- **Pause Hold ON** → the gap survives → `remapTimestamp()` returns the same position → **hold
  applies**

Confirm this is the *intentional*, documented C6R.3 behavior (`remapTimestamp()`'s own "protect/
apply rarely, don't guess" conservatism) — not an accidental side effect nobody decided on. All 4
`{pauseHold, reactionHold} × {on, off}` combinations should be asserted, not just the 2 states above.

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

### B5 — Visual chaos stress test (most important gate before Gate C)

The user's own framing, verbatim: **a system can be 100% technically correct, 100% tests green,
and still be terrible editing** — Gate A's clean architecture and Gate B1-B4's passing assertions
do not, by themselves, prove the RESULT is good editing. B5 is the check that catches what
unit/integration tests structurally cannot: render the timing-density stress case (the user's own
diagram — `zoom → focus → OCR → hold` within ~3 seconds) and judge, on a real or realistic sample,
whether the combined result reads as intentional emphasis or as noise. This is a qualitative gate,
not a numeric one — B4's measurements inform it, but don't replace human judgment here.

## Gate sequence (approved 2026-08-09)

```
GATE A — Architecture            ✅ COMPLETE (this document)
        │
        ▼
GATE B — Interaction + visual coherence      ◄── NEXT, start with B1
        │  (B1 Focus Shift×Digital Push → B2 OCR×moving crop →
        │   B3 Pause Hold×Reaction Hold → B4 all-flags-on → B5 chaos stress test)
        ▼
GATE C — Real-footage calibration            ONLY AFTER GATE B
```

**No production flag goes live while Gate B is incomplete.** This restates, not replaces, the
Gate C section below - Gate B is now the explicit, ordered blocker between "architecture is sound"
and "footage says it looks good."

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
