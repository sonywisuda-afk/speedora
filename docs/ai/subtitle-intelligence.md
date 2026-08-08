# Subtitle & Dynamic Caption Intelligence (spec Parts 7-8, Track B Phase A)

> **Status: Phase A1 + A2 + B1 shipped, all flag-off by default (`SUBTITLE_REWRITE_ENABLED=false`,
> `Clip.smartSegmentation` defaults `false`, `DYNAMIC_CAPTION_ENABLED=false`). B2 remains design
> only.** This doc is the audit + ADR + dependency graph + phased roadmap written before any
> implementation started. Implementation proceeds phase-by-phase from this doc, each phase
> requiring its own explicit go-ahead (same convention as every Track A phase in
> [`intelligence-v4.md`](./intelligence-v4.md)) and, per explicit user instruction, a test run +
> regression check + doc update + production build check before moving to the next phase — see
> "Phase A1 architecture (as shipped)", "Phase A2 architecture (as shipped)", and "Phase B1
> architecture (as shipped)" below for what that verification actually covered.

## Why this exists

Today's caption pipeline is one straight line:

```
ASR transcript segments (Whisper's own boundaries) → buildAss() → burned-in captions
```

`buildAss()` (`@speedora/subtitles`) is a **pure renderer** — it turns whatever segments it's given
into styled `.ass` text. It has zero opinion about whether those segment boundaries are good caption
breaks, and zero visibility into any AI Intelligence v4 signal (emotion, momentum, pauses, semantic
events) — none of that data reaches the caption pipeline today. Two spec parts ask for two different
capabilities on top of this:

- **Part 7 (Subtitle Intelligence / "Subtitle Rewriter")** — re-chunk transcript text into
  short, breathing/rhythm/emotion/speed-aware lines with emphasis, instead of Whisper's raw segment
  boundaries.
- **Part 8 (Dynamic Caption Engine)** — vary a caption's visual treatment (size, punch/attention
  animation) moment-to-moment based on emotional intensity and content type, instead of one static
  look for the whole clip.

**Resolved product-shape decision (user, this session):** "rewrite" means **structural
re-segmentation only** — every ASR word, word order, and word-level timestamp stays exactly as
transcribed. Line breaks, chunk boundaries, and emphasis/uppercase selection may change; the words
themselves never do. This keeps karaoke word-sync valid and captions verifiably matching the spoken
audio, and needs no LLM call. True lexical paraphrase (rewording, not just re-chunking — e.g. "lihat
angka ini" → "Look at this massive number") is explicitly **out of scope for this phase** and is
deferred to its own future, separately-gated sub-phase with its own contract/tests/cost
analysis/flag, never silently bundled into structural rewriting.

## Audit — reusable modules (reuse first, per `ARCHITECTURE.md` and this codebase's own recurring instruction)

| Part 7/8 rule | Existing signal to reuse | New work needed |
|---|---|---|
| Short phrases / smart line breaking | `TranscriptSegment.words[]` (word-level timestamps, already flow through `toSubtitleSegments()` in `render-clip.worker.ts`) | New re-chunking algorithm (word-count/duration budget) — the one genuinely new piece |
| Natural breathing | `@speedora/cutlist`'s `computeSilenceCuts()` — already reused once by `@speedora/hook-prediction`'s `derivePauseFeatures()` for exactly this "gap between words" math | none — direct reuse, same call shape as `derivePauseFeatures` |
| Punch emphasis / uppercase emphasis | `@speedora/subtitles`' existing `KEYWORD_PATTERN` regex (numbers, ALL-CAPS-as-typed, quoted phrases) — already burns in bold+color today for `BOLD_HIGHLIGHT` style | Hoist `KEYWORD_PATTERN` to a shared location so both the existing renderer and the new rewriter use the *same* pattern, not a drifting duplicate (see Tech Debt below) |
| Rhythm aware | `@speedora/contextual-momentum`'s `MomentumCurve` (Phase 4, already computed at render time, currently unconsumed by anything except Virality Engine) | none — read as optional context, same "degrades gracefully when absent" pattern Phase 4-7 already use |
| Emotion aware | `@speedora/emotional-arc`'s `EmotionalArc` (Phase 5, per-segment `{t, emotion, intensity}` 0-1, currently unconsumed by anything except Virality Engine) | none — same reuse |
| Speaking speed aware | `@speedora/audio-intelligence`'s `AudioFeatures.averageSpeakingRateWordsPerSecond` (already computed, already flows through the render graph) | none |
| "Which moments are worth punching" (Part 8's shock/question detection) | `@speedora/semantic-events`' `SemanticEvent[]` (Phase 2, 22-value taxonomy — `breaking_news`/`controversy`/`urgency`/`warning` read naturally as "shock"-flavored) for shock; a line's own text ending in `?` for question — zero new detection | A new exhaustive switch tiering `SemanticEventType` into a caption-emphasis weight, same governance pattern `isCuriositySemanticEventType()` (Phase 10) and `isPayoffSegmentType()` (Phase 7) already established for "reuse an existing taxonomy for a new purpose" |

**The only genuinely new piece of logic in Part 7 is the re-chunking algorithm itself** — everything
that decides *how much* to lean on rhythm/emotion/speed is composition over signals that already
exist. This is consistent with every other Track A phase since Phase 4: no new detector, no new
subprocess, no new model.

## Audit — technical debt / risks found

1. **No re-chunking stage exists at all today.** `toSubtitleSegments()` in `render-clip.worker.ts`
   passes Whisper's own segment boundaries straight through to `buildAss()`. Any new segmentation
   has to be inserted as a genuinely new stage between transcript and renderer, not a tweak to
   existing code.
2. **`SubtitleSegment` (contract) has no field for pre-computed emphasis/line-break decisions.**
   `buildAss()`'s only emphasis mechanism today is `highlightKeywords()` running its regex live,
   per-render, over whatever segment text it's given. Extending this to accept *pre-computed*
   emphasis (from Part 7) means widening `buildAssInputSchema`/`SubtitleSegment` and
   `buildDialogueEvent()` — extend, don't replace, so `BOLD_HIGHLIGHT`'s existing live-regex path
   keeps working unchanged for clips that never opt into the rewriter.
3. **`KEYWORD_PATTERN` currently lives inside `@speedora/subtitles`, the renderer.** The new
   rewriter package is logically *upstream* of the renderer (produces what the renderer consumes),
   so it must not depend on it for something as small as a regex. Fix: hoist `KEYWORD_PATTERN` (and
   its doc comment) to `packages/contracts/src/subtitles.ts` as a shared exported constant; both
   `@speedora/subtitles` and the new rewriter import it from there. Avoids a duplicate, driftable
   copy — this codebase's own "extract at 2nd/3rd duplication" convention.
4. **`captionStyle` is a single, per-clip, static Prisma enum** (`DEFAULT`/`KARAOKE`/
   `BOLD_HIGHLIGHT`), chosen once. Part 8 wants treatment that varies *within* one clip, moment to
   moment — categorically different from a per-clip preset. This is the single biggest
   architectural gap Part 8 has to close: it needs a **timeline** of per-line treatment, not a new
   enum value. (Confirmed: `speakerColorCaptions` already established the precedent of an
   orthogonal-to-`style` boolean on `BuildAssInput` — the right shape to extend, not a 4th
   `CaptionStyle` value.)
5. **Zero AI Intelligence v4 signal currently reaches the caption pipeline.** `EmotionalArc`,
   `MomentumCurve`, and `SemanticEvent[]` are computed independently in the render graph and never
   threaded into `buildAss()`'s inputs. Wiring this is the core of both phases below.
6. **New ASS tag territory for Part 8.** `\fscx`/`\fscy` (size), `\t` (animated transform), `\alpha`
   (fade) have never been emitted by `build-ass.ts` — only static per-line style/color/karaoke tags
   have. This needs to be prototyped and verified against a real `ffmpeg`+`libass` combination before
   being trusted in production, the same "unverified sandbox" honesty this codebase already applies
   to Audio/Scene/Facial Intelligence's Python subprocesses (`ARCHITECTURE.md`'s worked examples) —
   whether this dev sandbox even has `ffmpeg` on `PATH` needs to be checked before that phase starts,
   not assumed.
7. **`TimelineEditor.tsx`'s caption preview is already documented as "approximate, not pixel-perfect
   vs. libass burn-in"** (`docs/frontend.md`). Any new dynamic sizing/animation widens that gap
   further. Explicitly **out of scope** for this roadmap — flagged as a follow-up, not silently
   ignored, per this codebase's "spin off pre-existing/unrelated findings" convention.
8. **Word-level timestamps aren't always present.** `buildDialogueEvent()` already has a documented
   fallback (no `segment.words` → plain text, `'Default'` style, no karaoke). The rewriter must
   apply the identical fallback: a segment with no word-level timing is passed through unrewritten,
   never given synthesized/guessed timestamps.
9. **Non-Latin scripts have no uppercase concept.** `KEYWORD_PATTERN`'s ALL-CAPS emphasis rule (and
   any new "uppercase for punch" rule from Part 7) is meaningless for e.g. Thai/Japanese/Chinese
   caption text (`@speedora/subtitle-translate` already produces non-Latin output). Flagged as an
   open governance question for Phase A1 below, not silently shipped broken for those languages.

## ADR — key decisions

**DB1. Structural re-chunking only, no lexical paraphrase (this session's resolved decision, see
above).** Zero new LLM call for Phase A. A future paraphrase capability is explicitly out of scope
here and would need its own ADR entry, contract, flag, and cost analysis.

**DB2. Same JSON-contract module pattern as every Track A phase** (`ARCHITECTURE.md`): a new
`packages/contracts/src/subtitle-rewriter.ts`, a new stateless `packages/subtitle-rewriter` package
(pure, synchronous, no `deps` — same "cross-module fusion over already-computed signals" shape as
Phases 4/5/6/7, since DB1 means no external call exists to inject), and a render-graph adapter node.
No exception for this being an editorial/rendering feature rather than a scoring one.

**DB3. Reuse over new detection**, per the audit table above — `computeSilenceCuts`,
`MomentumCurve`, `EmotionalArc`, `AudioFeatures.averageSpeakingRateWordsPerSecond`, and
`SemanticEvent[]` are all read as **optional context** (degrades gracefully when a signal's own flag
is off or its node returned null), the same pattern Phase 3 onward established for
`narrativeGraph`/`semanticEvents`. The rewriter never hard-requires any v4 phase to be enabled.

**DB4. Data first, render pipeline second, same as Phase 10's "timeline visualization deferred"
precedent.** Phase A1 computes and persists the rewritten timeline; it does **not** touch
`buildAss()` or the actual burned-in output. Phase A2 is a separate, explicitly flagged step that
wires the computed timeline into rendering. This means A1 carries zero production-render risk no
matter how the heuristics turn out, and can be iterated on/inspected via
`GET /clips/:id/intelligence` before anything touches a real video file.

**DB5. New treatment axis is orthogonal to `captionStyle`, not a new enum value** — same precedent
`speakerColorCaptions` already set (Subtitle Studio, P2c). A clip can combine any existing
`captionStyle` preset with smart segmentation on/off, same as it already combines any preset with
speaker-color on/off.

**DB6. `KEYWORD_PATTERN` moves to `packages/contracts/src/subtitles.ts`** as a shared constant (Tech
Debt #3) — both the existing renderer and the new rewriter consume the identical pattern. This is a
small, mechanical, behavior-preserving move (same value, same regex), not a rewrite of either
module.

**DB7. Part 8 (Dynamic Caption Engine) is split into a data phase (B1) and a render phase (B2)**,
mirroring DB4's data-first logic — B1 decides *what* treatment each line deserves (pure derive, no
ASS knowledge at all); B2 is the only phase that touches `build-ass.ts`'s ASS emission and is where
the new-tag-territory risk (Tech Debt #6) is actually taken on.

**DB8. Feature flags follow the existing bespoke-function convention** (`isHookPredictionEnabled()`
etc.) — `isSubtitleRewriteEnabled()` (A1/A2), `isDynamicCaptionEnabled()` (B1/B2). Flags gate API/
render-pipeline exposure; the pure-derive nodes (A1, B1) still compute and persist regardless, same
"collected but inert" posture as weight-0 Fusion signals and every Track A phase's flag.

**DB9. Uppercase/keyword emphasis stays Latin-script-only for Phase A1** (Tech Debt #9) — a new
`scriptSupportsUppercase(language)` check (mirroring how `fontFamilySchema`/brand-kit already treat
font/language as a real constraint, not an afterthought) suppresses the uppercase transform for
non-Latin caption languages while leaving line-breaking/rhythm/emphasis-via-bold-color untouched
(bold/color have no script dependency). Documented explicitly rather than silently producing
nonsensical output.

**DB10. Phase A2's render-path gate is double-gated AND disabled under translation** (decided
during A2 implementation, not pre-specified in DB5) — three independent conditions must all hold
before a render actually uses the rewritten timeline: (1) `Clip.smartSegmentation` (a new per-clip
Boolean column, same orthogonal-to-`captionStyle` shape `speakerColorCaptions` already
established, user-settable via `PATCH /clips/:id`), AND (2) the global `SUBTITLE_REWRITE_ENABLED`
flag (a kill switch — the first v4 flag whose scope had to grow beyond "gates API exposure only,"
since A2 is the first v4 phase that changes actual render output, not just a read-only endpoint),
AND (3) no translation requested (`captionLanguage` unset) — `Clip.subtitleIntelligence` is always
computed against the ORIGINAL-language transcript (the render-graph node has no
`captionLanguage`-awareness, by design, since Phase A1 was read-only and never needed it), so
applying it under a translation would silently show the wrong language rather than degrade
gracefully. No new frontend UI ships in this phase (no Subtitle Studio panel checkbox yet) — the
mechanism is real and settable via the API, same "ship the mechanism, UI can follow" posture
several other per-clip toggles in this codebase's history already took; deliberately not
propagated into `SubtitlePreset`/`ProcessingOptions.subtitle` either (separate feature surfaces,
out of scope for this phase).

## Dependency graph (planned)

```
TranscriptSegment.words[] (existing, clip-relative)
        │
        ├──▶ computeSilenceCuts() [@speedora/cutlist, REUSED] ──▶ pause/gap timeline
        │
contextualMomentum (existing, Phase 4, optional) ─────────────────┐
emotionalArc (existing, Phase 5, optional) ────────────────────────┤
audioFeatures.averageSpeakingRateWordsPerSecond (existing, optional)┼──▶ rewriteSubtitles()
semanticEvents (existing, Phase 2, optional) ──────────────────────┤    (@speedora/subtitle-
KEYWORD_PATTERN [hoisted to contracts, REUSED] ────────────────────┘     rewriter, PURE, no
                                                                           LLM call, no `deps`)
                                                                    │
                                                                    ▼
                                                       SubtitleTimeline
                                        SubtitleLine[] { start, end, words (verbatim,
                                        unmodified), text, emphasisWordIndices[] }
                                                                    │
                                                                    ▼
                                                      HighlightTimeline
                                        HighlightMoment[] { start, end, level } - the
                                        "punchiest" moments, reused by Phase B1 below
                                        without recomputation
                                                                    │
                                                                    ▼
                                    Clip.subtitleIntelligence (new Json? column, Phase A1)
                                                                    │
                                                    ┌───────────────┴───────────────┐
                                                    ▼                               ▼
                                   GET /clips/:id/intelligence          Phase A2: toSubtitleSegments()
                                   (flag-gated exposure, 9th field         reads this timeline instead of
                                   on ClipIntelligenceDto)                 raw transcript segments when
                                                                            smartSegmentation is on →
                                                                            buildAss() (extended to honor
                                                                            precomputed emphasisWordIndices)

HighlightTimeline (Phase A1, above) ───────────────────────────────┐
emotionalArc (existing, Phase 5) ────────────────────────────────────┼──▶ computeCaptionTreatment()
line text ends in "?" (new, trivial) ────────────────────────────────┘    (@speedora/dynamic-caption,
                                                                             Phase B1, PURE)
                                                                    │
                                                                    ▼
                                                        CaptionTreatmentTimeline
                                    TreatmentMoment[] { start, end, sizeTier,
                                    animation: 'punch'|'attention'|'none' } - rate-limited,
                                    "don't overuse animation" enforced here as a documented
                                    cooldown constant
                                                                    │
                                                                    ▼
                              Clip.captionTreatment (new Json? column, Phase B1)
                                                                    │
                                                                    ▼
                        Phase B2: build-ass.ts extended to emit \fscx/\fscy/\t/\alpha
                        per TreatmentMoment - gated, prototyped against real ffmpeg/libass first
```

## Phased roadmap

| Phase | Deliverable | Depends on | Complexity | Primary risk |
|---|---|---|---|---|
| A1 | Subtitle Rewriter (data only) — `SubtitleTimeline` + `HighlightTimeline`, persisted, exposed read-only via `/intelligence` — **shipped, flag-off** | `KEYWORD_PATTERN` hoist (DB6); Phases 2/4/5 optional | M | Re-chunking heuristic quality is unvalidated (no engagement data, same caveat every heuristic in this codebase carries) — mitigated by being 100% non-destructive (DB4) |
| A2 | Wire A1's timeline into `buildAss()`/`toSubtitleSegments()` behind `smartSegmentation` — **shipped, flag-off** | A1 | M | First phase to touch the production render path — karaoke per-word timestamps must survive re-grouping into different lines unchanged; needs a real render regression test, not just unit tests on the data stage |
| B1 | Dynamic Caption Engine (data only) — `CaptionTreatmentTimeline`, persisted, exposed read-only — **shipped, flag-off** | A1 (`HighlightTimeline`), Phase 5 (`emotionalArc`) | S-M | "Don't overuse animation" is a real design constraint, not a formula — needs an explicit, documented cooldown/threshold heuristic, flagged as unvalidated like every other threshold constant here |
| B2 | Wire B1's treatment timeline into `build-ass.ts`'s ASS emission (`\fscx`/`\fscy`/`\t`/`\alpha`) | B1, A2 | L | Genuinely new ASS tag territory for this codebase — must be prototyped and verified against a real `ffmpeg`+`libass` render before trusting it in production (Tech Debt #6); highest-risk phase in this roadmap |

Each phase, per explicit instruction: implement → run the full test suite → confirm no regression in
existing subtitle/render-graph tests → update this doc's Status line and `intelligence-v4.md` →
confirm `apps/worker`'s (and, for A2/B2, `apps/api`'s) production build still passes — before
starting the next phase. No phase is auto-continued without a fresh go-ahead, matching every Track A
phase's rollout so far.

## Phase A1 architecture (as shipped)

```
packages/contracts/src/subtitles.ts          KEYWORD_PATTERN (DB6) - hoisted here from
                                              @speedora/subtitles' build-ass.ts, which now
                                              imports-and-re-exports it for backward compatibility
                                              (TimelineEditor.tsx's existing import path unchanged)

packages/contracts/src/subtitle-rewriter.ts  subtitleLineSchema (SubtitleLine), highlightMomentSchema
                                              (HighlightMoment), subtitleIntelligenceSchema
                                              (SubtitleIntelligence), computeSubtitleTimelineInputSchema
                                              - reuses @speedora/subtitles' own subtitleSegmentSchema
                                              directly (not a near-duplicate copy) for its `segments`
                                              input, and contextual-momentum.ts/emotional-arc.ts/
                                              semantic-events.ts's existing schemas for optional context,
                                              same cross-contract-file-import precedent every Track A
                                              phase since contextual-momentum.ts already set

packages/subtitle-rewriter/src/
  chunk-segment.ts                           chunkSegmentIntoLines() - the one genuinely new piece of
                                              logic (DB2): a greedy word-budget walk over a segment's
                                              own words, preferring to break at a real pause
                                              (@speedora/cutlist's computeSilenceCuts(), REUSED - same
                                              call shape @speedora/hook-prediction's
                                              derivePauseFeatures() already established) or a sentence
                                              boundary before hitting the budget. The budget itself is
                                              modulated by speaking rate ("speaking speed aware") and
                                              the nearest MomentumCurve sample ("rhythm aware", DB3).
                                              Every word/timestamp is carried through byte-for-byte
                                              unchanged (ADR DB1) - this function only decides GROUPING.
  select-emphasis-words.ts                   selectEmphasisWordIndices() - reuses the hoisted
                                              KEYWORD_PATTERN (DB6) to flag emphasis-worthy word
                                              indices per line; deliberately does NOT decide casing
                                              (DB9 - a Phase A2 rendering concern, not this phase's)
  compute-highlights.ts                      computeHighlightTimeline() - the HighlightTimeline half:
                                              averages whichever of (nearest EmotionalArc intensity,
                                              max isPunchSemanticEventType() importance in the line's
                                              own window, nearest MomentumCurve score) are available,
                                              keeping only lines clearing a documented PUNCH_THRESHOLD
  is-punch-semantic-event-type.ts            isPunchSemanticEventType() - exhaustive switch/
                                              assertNever over all 22 SEMANTIC_EVENT_TYPES (Contract
                                              Governance rule 1), same pattern as Phase 6/7/10's own
                                              taxonomy-reuse governance functions - a DIFFERENT axis
                                              from Phase 10's isCuriositySemanticEventType() (impact/
                                              shock vs. information-gap)
  nearest-by-time.ts                         nearestByTime() - local temporal-nearest-neighbor
                                              helper, same shape as
                                              @speedora/retention-curve-insights' own local copy
  compute-subtitle-timeline.ts                computeSubtitleTimeline() - the module's single entry
                                              point, PURE and synchronous (no `deps` param, no
                                              runtime schema validation - matches every other no-LLM
                                              v4 module's own convention of trusting the TS input type
                                              rather than @speedora/subtitles' buildAss()-style
                                              defense-in-depth parse, since a strict `.nullable()`
                                              check rejected a legitimately-`undefined` optional
                                              upstream value in testing - see the regression note
                                              below). A segment with no word-level timestamps falls
                                              back to one unrewritten line (Tech Debt #8).
  feature-flags.ts                           isSubtitleRewriteEnabled()

apps/worker/src/render-graph/nodes/subtitle-rewriter.ts
                                              subtitleIntelligenceNode, id: 'subtitleIntelligence'
                                              (optional: false, no fallback - same reasoning as every
                                              other pure-derive v4 node; deps: contextualMomentum,
                                              emotionalArc, semanticEvents, audioFeatures, all
                                              already-existing node ids, none touched by this phase)

apps/worker/src/render-graph/index.ts        renderClipGraph grows subtitleRewriterNodes;
                                              RenderGraphResult.subtitleIntelligence: SubtitleIntelligence

apps/worker/src/render-graph/sinks.ts        CLIP_UPDATE_MAP['subtitleIntelligence'] entry -
                                              deliberately NOT added to FUSION_INPUT_MAP (DB1/DB2 -
                                              v4 sits beside the Fusion Engine); same "always-computed
                                              non-nullable object" convention as viralityPrediction/
                                              retentionCurveInsights - plain passthrough, no
                                              Prisma.JsonNull, no InputJsonValue cast

apps/api/src/videos/transcript-segment.util.ts
                                              toSharedSubtitleIntelligence() - the TS2742 fix, same
                                              null-semantics as toSharedContextualMomentum/
                                              toSharedRetentionCurveInsights (null means ONLY "predates
                                              this migration")

apps/api/src/videos/videos.service.ts        mapVideoWithClips destructures + narrows
                                              subtitleIntelligence out of the Prisma spread, same
                                              pattern as every prior Json? column

apps/api/src/clips/{clips.service.ts}        GET /clips/:id/intelligence extended with
                                              `subtitleIntelligence` (the 9th field on
                                              ClipIntelligenceDto), gated by isSubtitleRewriteEnabled();
                                              toDto()'s input type/return object extended the same way

packages/database/prisma/schema.prisma       Clip.subtitleIntelligence Json? (migration
                                              20260808105215_add_clip_subtitle_intelligence, applied
                                              against the real dev Postgres)

packages/shared/src/types/
  video.ts                                   SubtitleLine/SubtitleTimeline/HighlightMoment/
                                              HighlightTimeline/SubtitleIntelligence mirrored (not
                                              imported), same duplication precedent as every other
                                              v4 type in this file; Clip.subtitleIntelligence field
  intelligence-v4.ts                          ClipIntelligenceDto.subtitleIntelligence
```

**A real bug found and fixed during verification, not by a failing unit test**: the module's first
draft runtime-validated its own input via `computeSubtitleTimelineInputSchema.parse(input)` (matching
`@speedora/subtitles`' own defense-in-depth precedent) — but unlike every other no-LLM v4 module
(Phase 4/5/6/7/10, none of which call `.parse()` on their own input), this broke a real render-graph
execution path: `apps/worker`'s full test suite (`render-clip.worker.spec.ts`) surfaced a case where
the `semanticEvents` node id resolved to `undefined` rather than `null` (a test double settling
without throwing, so the optional node's `fallback: null` never engaged) — `.nullable()` rejects
`undefined`, throwing a `ZodError` that aborted the whole render. Every other consumer of
`semanticEvents` (e.g. `computeRetentionCurveInsights`) tolerates this fine because they use a falsy
check (`if (!semanticEvents) ...`), not strict validation. Fixed by removing the `.parse()` call
entirely, matching the established no-LLM-module convention — caught by running the real
`apps/worker` test suite, not by this package's own (passing) unit tests, which only ever construct
well-typed fixtures and would never have exercised this path.

**Verified**: `@speedora/subtitle-rewriter` (58 tests), `@speedora/subtitles` (18, unchanged),
`@speedora/contracts` (183, unchanged), `@speedora/shared` (82, unchanged), `apps/worker`'s full
suite (580 tests, including `render-graph/sinks.spec.ts`'s extended regression guard that
`subtitleIntelligence` never leaks into `FusionInput`), and `apps/api`'s full suite (1268 tests) all
pass. Real production builds (`nest build` for `apps/api`, `next build` for `apps/web`, `tsc` for
`apps/worker`) all pass — `nest build`'s declaration emit is what actually catches the TS2742 trap
(plain `tsc --noEmit` alone does not, per this repo's own documented lesson). A real migration
(`20260808105215_add_clip_subtitle_intelligence`) was applied against the actual dev Postgres, not
deferred. **Not yet verified**: the re-chunking heuristics have not been exercised against a real
transcript end-to-end (only unit-test fixtures) — flagged honestly, same posture as every other
unvalidated threshold in this codebase, not glossed over.

## Phase A2 architecture (as shipped)

```
packages/database/prisma/schema.prisma      Clip.smartSegmentation Boolean @default(false) (new
                                              column, migration
                                              20260808114435_add_clip_smart_segmentation, applied
                                              against the real dev Postgres) - orthogonal to
                                              captionStyle, same shape as speakerColorCaptions
                                              (DB5/DB10)

apps/api/src/clips/dto/update-clip.dto.ts    UpdateClipDto.smartSegmentation - user-settable via
                                              PATCH /clips/:id, same @IsOptional/@IsBoolean shape
                                              as speakerColorCaptions

apps/api/src/clips/clips.service.ts          update() reads/writes it the same way as
                                              speakerColorCaptions; render() copies
                                              clip.smartSegmentation into RenderClipJobData; toDto()
                                              exposes it (plain Boolean column, no TS2742 narrowing
                                              needed - that trap is Json-column-specific)

apps/api/src/videos/videos.service.ts        retry() copies clip.smartSegmentation into
                                              RenderClipJobData the same way

apps/worker/src/workers/clip-persistence.ts  enqueueRendersForCandidates() copies
                                              clips[index].smartSegmentation (schema default false
                                              for every newly-detected clip) into RenderClipJobData

packages/shared/src/types/{job.ts,video.ts}  RenderClipJobData.smartSegmentation,
                                              Clip.smartSegmentation, UpdateClipInput.smartSegmentation
                                              mirrored the same way every other per-clip toggle is

apps/worker/src/workers/render-clip.worker.ts
                                              isSubtitleRewriteEnabled() imported from
                                              @speedora/subtitle-rewriter; a new useSmartSegmentation
                                              local (DB10's 3-way AND: per-clip flag, global flag,
                                              !captionLanguage) computed right before the buildAss()
                                              call; toSubtitleSegments() gains a 4th parameter
                                              (subtitleTimeline: SubtitleLine[] | null) - when
                                              present, maps SubtitleLine[] 1:1 onto SubtitleSegment[]
                                              instead of the raw transcript; when null (the default,
                                              and every existing render), behavior is byte-for-byte
                                              unchanged from before this phase. buildAss() itself
                                              needed ZERO changes (Tech Debt #2's original "widen
                                              buildAssInputSchema" plan turned out unnecessary - a
                                              rewritten line's BOLD_HIGHLIGHT emphasis is naturally
                                              reproduced by its own live KEYWORD_PATTERN regex over
                                              the identical words already in place before this phase).
```

**A real bug caught while writing this phase's own tests, before it ever ran**: the first draft of
`toSubtitleSegments()`'s smart-segmentation branch passed `Clip.subtitleIntelligence.timeline`
straight through unmodified. But that timeline is **clip-relative** (0 = this clip's own start -
see Phase A1's `render-graph/nodes/subtitle-rewriter.ts`, which shifts by `-startTime` before
computing it), while `buildAss()` always expects **absolute source-video time** in `segments` and
does its own `- clipStart` shift internally (exactly what the raw-transcript branch already relies
on). Feeding it clip-relative input would have double-shifted every timestamp, burning in captions
at the wrong (negative-offset) position whenever smart segmentation was on. Fixed by re-adding
`startTime` to every line's/word's timestamp in `toSubtitleSegments()` before handing them to
`buildAss()` - caught by working through the coordinate math while writing
`render-clip.worker.spec.ts`'s new Phase A2 tests, not by a failing assertion (the bug would have
silently corrupted output rather than throwing). A dedicated code comment now documents the
coordinate-frame contract explicitly at both the function and the render-graph node, so the next
consumer of `Clip.subtitleIntelligence` doesn't have to re-derive it.

**Verified**: 4 new integration tests in `render-clip.worker.spec.ts` (`apps/worker`'s real,
un-mocked render-graph, only `buildAss()` itself mocked) proving all three DB10 gate conditions
independently - smart segmentation re-chunks and preserves every word/order when all three
conditions hold; falls back to the exact raw pass-through when the per-clip flag is off, when the
global flag is off, and when a translation is requested. Full suites: `apps/worker` (584 tests, up
from 580), `apps/api` (1268 tests, unchanged - no existing fixture needed updating since
`smartSegmentation` defaults `false`/`undefined` everywhere old fixtures didn't set it), `apps/web`
(313 tests, unchanged). Real production builds (`tsc` for `apps/worker`, `nest build` for
`apps/api`, `next build` for `apps/web`) all pass. Migration applied against the real dev Postgres,
not deferred. **Not yet verified**: no frontend UI exists yet to actually toggle
`smartSegmentation` for a real user (DB10) - the mechanism is real and API-settable, but exercising
it end-to-end still requires a manual `PATCH` call, not a real browser click-through.

## Phase B1 architecture (as shipped)

```
packages/contracts/src/dynamic-caption.ts    captionSizeTierSchema (CaptionSizeTier: small/
                                              normal/large), captionAnimationSchema
                                              (CaptionAnimation: none/punch/attention),
                                              treatmentMomentSchema (TreatmentMoment),
                                              captionTreatmentTimelineSchema
                                              (CaptionTreatmentTimeline - bare array, no clipId
                                              wrapper, same shape as MomentumCurve/EmotionalArc),
                                              computeCaptionTreatmentInputSchema - reuses
                                              @speedora/subtitle-rewriter's own
                                              subtitleTimelineSchema/highlightTimelineSchema
                                              directly (not near-duplicate copies)

packages/dynamic-caption/src/
  compute-caption-treatment.ts               computeCaptionTreatment() - the module's single
                                              entry point, PURE and synchronous (no `deps` param,
                                              no LLM call) - same zero-LLM shape as every other
                                              Track A/B v4 pure-derive module. Walks Phase A1's
                                              SubtitleTimeline in order, producing exactly one
                                              TreatmentMoment per line (dense, not filtered):
                                              sizeTier from the nearest EmotionalArc sample's
                                              intensity (HIGH_INTENSITY_THRESHOLD -> 'large',
                                              LOW_INTENSITY_THRESHOLD -> 'small', else 'normal');
                                              animation is 'punch' when the line overlaps a Phase
                                              A1 HighlightTimeline moment (reused directly, no
                                              re-derivation), else 'attention' when the line's own
                                              text ends in '?', else 'none' - punch wins when both
                                              apply. A running MIN_ANIMATION_GAP_SECONDS cooldown
                                              (spec Part 8's own "Do NOT overuse animation"
                                              constraint) downgrades any animated candidate landing
                                              too close to the previous animated line back to
                                              'none' - "none" lines never consume cooldown budget.
  nearest-by-time.ts                         nearestByTime() - local temporal-nearest-neighbor
                                              helper, same shape as @speedora/retention-curve-
                                              insights' and @speedora/subtitle-rewriter's own
                                              local copies
  feature-flags.ts                           isDynamicCaptionEnabled()

apps/worker/src/render-graph/nodes/dynamic-caption.ts
                                              captionTreatmentNode, id: 'captionTreatment'
                                              (optional: false, no fallback - same reasoning as
                                              every other pure-derive v4 node; deps:
                                              subtitleIntelligence, emotionalArc, both
                                              already-existing node ids, neither touched by this
                                              phase)

apps/worker/src/render-graph/index.ts        renderClipGraph grows dynamicCaptionNodes (after
                                              subtitleRewriterNodes, its own dependency);
                                              RenderGraphResult.captionTreatment:
                                              CaptionTreatmentTimeline

apps/worker/src/render-graph/sinks.ts        CLIP_UPDATE_MAP['captionTreatment'] entry -
                                              deliberately NOT added to FUSION_INPUT_MAP; same
                                              "always a real array, never JsonNull" convention as
                                              contextualMomentum/emotionalArc, cast through as
                                              InputJsonValue

packages/database/prisma/schema.prisma       Clip.captionTreatment Json? (new column, migration
                                              20260808191423_add_clip_caption_treatment, applied
                                              against the real dev Postgres)

apps/api/src/videos/transcript-segment.util.ts
                                              toSharedCaptionTreatment() - the TS2742 fix, same
                                              null-semantics as toSharedContextualMomentum/
                                              toSharedSubtitleIntelligence (null means ONLY
                                              "predates this migration")

apps/api/src/videos/videos.service.ts        mapVideoWithClips destructures + narrows
                                              captionTreatment the same way as every other Json?
                                              column

apps/api/src/clips/clips.service.ts          GET /clips/:id/intelligence extended with
                                              `captionTreatment` (the 10th field on
                                              ClipIntelligenceDto), gated by
                                              isDynamicCaptionEnabled(); toDto()'s input type/
                                              return object extended the same way

packages/shared/src/types/
  video.ts                                   CaptionSizeTier/CaptionAnimation/TreatmentMoment/
                                              CaptionTreatmentTimeline mirrored (not imported),
                                              same duplication precedent as every other v4 type in
                                              this file; Clip.captionTreatment field
  intelligence-v4.ts                         ClipIntelligenceDto.captionTreatment
```

**Does NOT touch `buildAss()`/the actual burned-in output** - `captionTreatment` is computed and
persisted, but nothing in the render pipeline reads it yet. That is Phase B2's job, and where the
genuinely new ASS tag territory (`\fscx`/`\fscy`/`\t`/`\alpha`, Tech Debt #6) is actually taken on.

**Verified**: 15 new unit tests in `@speedora/dynamic-caption` covering every branch (sizeTier
thresholds, punch/attention/none, the punch-over-attention priority rule, and 3 dedicated cooldown
tests including one confirming a "none" line doesn't reset the cooldown window). Full suites:
`apps/worker` (586 tests, up from 584 - after extending 5 existing exact-payload assertions and
`sinks.spec.ts`'s FusionInput-leak regression guard the same way every prior phase did),
`apps/api` (1268 tests, after extending 4 existing exact-DTO assertions the same way), `apps/web`
(313 tests, unchanged). Real production builds (`tsc` for `apps/worker`, `nest build` for
`apps/api`, `next build` for `apps/web`) all pass. Migration applied against the real dev Postgres,
not deferred. **Not yet verified**: the size/animation thresholds have not been exercised against
real caption content end-to-end (only unit-test fixtures) - flagged honestly, same posture as every
other unvalidated threshold in this codebase.

## Explicitly deferred (not part of this roadmap)

- **LLM paraphrase mode** (DB1) — a real future capability, needs its own ADR/contract/flag/cost
  analysis before any design work starts on it.
- **`TimelineEditor.tsx` preview parity** for smart segmentation / dynamic treatment (Tech Debt #7) —
  tracked as a follow-up, not blocking A1/A2/B1/B2.
- **Non-Latin uppercase emphasis** (Tech Debt #9 / DB9) — suppressed, not solved; a real per-script
  emphasis convention (e.g. different glyph weight/color cues) is future work if this becomes a real
  product need.
- **Frontend toggle for `smartSegmentation`** (DB10) — no Subtitle Studio panel checkbox yet;
  `PATCH /clips/:id` is the only way to set it today. Also deliberately not propagated into
  `SubtitlePreset`/`ProcessingOptions.subtitle` (separate feature surfaces).
