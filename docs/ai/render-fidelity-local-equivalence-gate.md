# Render Fidelity & Composition Execution Engine — Local Real-Output Equivalence Gate

Pre-production validation for the compiled executor (Phase 5, `RENDER_EXECUTION_COMPILER_ENABLED`),
built because Speedora has no live production deployment yet (2026-08-14) — the rollout runbook's
own instance-based canary (`docs/ai/render-fidelity-rollout.md`'s Strategy A) presupposes a live
deployment with multiple `render-clip` instances to split traffic across, which doesn't exist. This
doc is the record of that harness and of one real finding it surfaced along the way.

## What the harness does

`apps/worker/src/workers/render-clip.worker.local-comparison.ts` — test/verification infrastructure
only, no production code changed by its existence. Invokes the literal production processor closure
twice per scenario (once with the compiler flag off, once on) against the identical `job.data`
object, using the same mocked-`bullmq`-`Worker`-capture technique `render-clip.worker.spec.ts`
already established to get at that closure. `renderClip`/`trimCutRanges`/`applyReactionHolds`/
`concatBrandSegment`/`probeVideoMetadata` and every other `ffmpeg.ts` probe function stay real (real
ffmpeg/ffprobe subprocess calls), as does `@speedora/render-config`'s
`buildEffectiveRenderConfig`/`buildOutputProfile`/`buildRenderManifest`/`buildRenderPlan`/
`compareRenderManifestToProbe` and `render-plan-compiler.ts`'s `compileRenderPlan` — Phase 7/8's own
real computation is captured via a mocked logger, never re-derived by the harness itself. Every
other seam (prisma, object storage transport, AI/vision detectors, B-roll search) is mocked
deterministic/inert.

5 scenarios, each a real dual-run against real ffmpeg/ffprobe: Minimal (`renderClip` only), Cuts
(`renderClip` + `trimCutRanges`), Reaction hold (`renderClip` + `applyReactionHolds`), Intro + outro
(`renderClip` + `concatBrandSegment:start` + `concatBrandSegment:end`), and Full pipeline (all 5
passes together). Per scenario: ffprobe both real outputs directly, diff each run's captured
`RENDER_MANIFEST_RESOLVED`/`RENDER_VERIFICATION_RESOLVED` payload, diff the execution pass sequence.
Checksum is captured/printed as a diagnostic only, never a pass/fail gate (container-level encoding
details can differ even when media semantics are identical).

Deliberately manual-only — the file does not end in `.spec.ts` (`apps/worker`'s jest `testRegex` is
`.*\.spec\.ts$`), so `pnpm test`/`pnpm verify` never discover it, and `tsconfig.build.json` has one
extra exclude entry for this same file so `pnpm build` doesn't compile it into `dist/` as dead code
(it references the `jest` global, which doesn't exist outside a test run). 10 full real-ffmpeg
renders per invocation is too slow/contention-prone for a per-commit suite, and this is a deliberate
pre-production gate, not a regression test:

```
cd apps/worker && npx jest --testRegex "local-comparison\.ts$" --runInBand
```

## Result (2026-08-15)

**5/5 scenarios PASS, 10/10 real renders**, every ffprobed field (resolution, fps, video codec,
audio codec, audio sample rate, audio channels, duration within tolerance) identical between the
legacy and compiled branches on every scenario, and the full 5-pass sequence
(`renderClip → trimCutRanges → applyReactionHolds → concatBrandSegment:start →
concatBrandSegment:end`) confirmed for the Full pipeline scenario specifically. This is sufficient
local evidence for the compiled executor to be a real candidate for a first deployment, and this
harness is the reusable mechanism for a live smoke test/canary once that deployment exists — no
need to rebuild the comparison mechanism itself at that point, only to point it at real traffic.

## A known, accepted finding (documented, not fixed): `concatBrandSegment()`'s fps drift

Two of the five scenarios (Intro + outro, Full pipeline — the two that call `concatBrandSegment()`)
show Phase 8's own `compareRenderManifestToProbe()` failing on `fps` (`packages/render-config/src/
compare-render-manifest.ts`, `FPS_COMPARISON_EPSILON = 0.001` — deliberately tight, "float-precision
only, not a real tolerance"): expected 25, actual ~24.77–24.86 depending on scenario. Graded PASS by
the equivalence gate itself, since the acceptance criterion is legacy-vs-compiled *consistency*
(both branches fail identically), not "both individually pass" — this is not a legacy/compiled
divergence.

### Root cause (isolated reproduction, not from the equivalence gate's own logs)

Reproduced the Intro + outro chain (`renderClip → concatBrandSegment:start → concatBrandSegment:end`)
in isolation, calling the real functions directly and ffprobing every intermediate output with full
diagnostics (declared frame rate, real decode-based frame count, per-stream vs container duration,
per-frame PTS).

| Stage | real decoded frames | stream duration | container (format) duration | `avg_frame_rate` |
|---|---|---|---|---|
| source fixture | 300 | 12.000000 | 12.000000 | 25/1 (exact) |
| after `renderClip` | 125 | 5.000000 | 5.000000 | 25/1 (exact) |
| after `concatBrandSegment:start` | 150 (= 125+25, exactly right) | 6.000000 | 6.015011 ← drift starts | 25/1 (still exact) |
| after `concatBrandSegment:end` | 175 (= 150+25, exactly right) | 7.040000 | 7.040000 | 4375/176 = 24.858 ← now measurably wrong |

**No frames are ever dropped or duplicated** — real decoded frame count matches correct content at
every stage. This is not a video-content bug. The drift is a duration-metadata effect: probing the
intro fixture's own AAC audio stream in isolation (before any `concatBrandSegment` involvement)
already shows `nb_frames: 45` against a reported 1.000000s duration — a classic AAC encoder-delay/
priming-sample artifact. `concatBrandSegment()` (`apps/worker/src/ffmpeg.ts`) uses filter-graph-level
`concat=n=2:v=1:a=1` (operating on decoded samples), which has no encoder-delay/edit-list awareness
the way the `concat` *demuxer* would. Each `-c:a aac` re-encode (one per `concatBrandSegment` call)
adds its own small encoder delay the filter graph doesn't reconcile against the video's exact frame
timing — the video branch is `fps=$targetFps`-converted then `trim=duration=$segmentDuration`'d,
while the audio branch is independently `atrim=duration=$segmentDuration`'d, and these two
independent trims of the nominally-same duration don't necessarily land on the same real-world
instant once an AAC-encoded segment is involved.

### A/V sync impact — measured, not assumed

Extended the reproduction to check real per-frame PTS on the final (2-concat) output, not just
container-level duration, specifically to answer "is this a growing/perceptible desync or a
metadata-only artifact":

- **Video**: 175 real decoded frames, perfectly evenly spaced — the last 5 consecutive frame-to-
  frame deltas are all exactly `0.04s` (1/25s). No held/frozen frame, no irregular gap. The last real
  frame's own end (`last PTS + 1/25s`) lands at `7.040000s`, arithmetically consistent with the real,
  evenly-spaced frame content actually reaching that point — not an inflated number divorced from
  content.
- **Audio**: last real AAC frame starts at `7.035646s` — within ~4ms of the video's own real end.

Conclusion: **not** a growing or unbounded desync, and **not** a purely cosmetic metadata artifact
either. The video's real, evenly-spaced frame content genuinely extends about one frame period
(40ms) beyond the naive `frameCount / 25 = 7.00s` expectation, and the audio tracks within a few ms
of that same real endpoint — both streams agree closely with each other; what's "wrong" is that the
*declared* fps=25 assumption (and Phase 8's `expectedOutput.fps` derived from it) doesn't account
for this per-segment shift.

### Why this is accepted, not fixed, here

Same "accept and document rather than block" posture `docs/ai/silence-compression.md`'s own
Reaction Hold × crossfade interaction and the Visual Emphasis Integration Audit's Gate B (B2, OCR
Highlight's static-snapshot drift) already established for structurally similar bounded, sub-frame-
scale drift:

- Bounded and **compounds per `concatBrandSegment` call**, not per clip duration — observed ~15ms
  after 1 call (intro only), ~40ms after 2 calls (intro + outro). This pipeline only ever attaches
  one intro and one outro per clip today, so 2 calls is the real-world ceiling for this specific
  mechanism as currently used.
- At 40ms for the worst case, this sits at the edge of commonly-cited professional A/V-sync
  tolerance (~20–40ms) but below what most viewers would consciously notice for a single concat
  boundary — not verified against real human perception, just against the commonly-cited numeric
  range.
- Phase 8's own comparator is working exactly as designed here — a real, if narrow and content-
  harmless (no dropped/duplicated frames), gap between "declared" and "as-muxed" fps, exactly what
  that phase's tight epsilon exists to catch.

## Explicitly not done here

- **No fix to `concatBrandSegment()`'s trim/duration reconciliation.** A real fix would mean giving
  the video and audio branches a shared duration constraint (e.g. via `-shortest`, or an explicit
  post-concat `trim=`/`atrim=` pass keyed off the SAME measured value) rather than two independent
  per-branch trims — real design work, not attempted in this investigation.
- **No check of whether B-roll (`trimAndFadeInBRoll`/`fadeOutBRoll`) or Reaction Hold
  (`applyReactionHolds`) share this same AAC-reencode-concat mechanism.** Only `concatBrandSegment`
  was reproduced and measured here.
- **No measurement beyond 2 chained `concatBrandSegment` calls.** Whether a hypothetical future
  passthrough of more brand segments would keep compounding linearly, sub-linearly, or plateau is
  unmeasured.

Worth revisiting if real-footage calibration (the Visual Emphasis Integration Audit's own deferred
Gate C, `docs/ai/visual-emphasis-integration-audit.md`) or a real production deployment ever surfaces
this as an actually perceptible problem — not before.
