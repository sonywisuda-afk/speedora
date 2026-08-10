# AI B-roll Recommendation (item 8)

> **Status: shipped.** Item 8 of the user's own gap-analysis list vs. reference platforms: "kalau
> pembicara mengatakan OpenAI, [sisipkan] logo... otomatis. Speedora sekarang B-roll masih terbatas."
> This is a from-scratch mini-initiative, not part of any existing AI Intelligence v4 phase or Visual
> Emphasis Engine roadmap - documented here on its own since it doesn't fit either of those docs'
> scope.

## Audit before building

`apps/worker/src/broll.ts` + `apps/worker/src/assets/` (Fase 15/16) already had a working, clean
Adapter-pattern pipeline: `findBRollMoments()` matches `detect-clips.worker.ts`'s LLM-extracted
`keywords` against the transcript to decide WHERE to cut away, `StockAssetService` searches three
tiered stock-footage/photo providers (Pexels/Pixabay video, Unsplash photo fallback) for WHAT to show
- every keyword treated identically, always searched as generic stock footage.

Two things were genuinely missing, confirmed by grep before writing any code:

- **No logo/brand-asset provider anywhere** - only stock footage/photo APIs existed.
- **No AI image generation anywhere** in the codebase (no DALL-E or similar call site), even though
  `openai` is already a dependency via `packages/llm-client`.

## Scope decision (resolved via `AskUserQuestion` before writing code)

Two open questions, both genuinely undecided:

1. **How much to build**: logo only, logo + AI illustration, or just fix classification with the
   existing 3 providers. **User chose logo only** - matches the user's own example exactly, is free
   (no per-call cost, unlike AI image generation), and doesn't require designing a
   cost-control/caching story for a paid per-image API. AI illustration is an explicit, documented
   future phase, not attempted here.
2. **Classification signal** (how to know a keyword is a brand name worth a logo, vs. a generic
   concept worth stock footage): reuse `HookPredictionOutput.linguisticFeatures.namedEntities`
   (already computed, Phase 1) vs. a new LLM call. **User chose reuse namedEntities** - free, no new
   LLM call.

## A real pipeline-ordering constraint found mid-implementation

`namedEntities` turned out not to be free in practice: `buildBRollOverlays()` (the function that
searches/downloads/prepares B-roll assets) runs **before** `runInstrumentedRenderGraph()` in
`render-clip.worker.ts` - B-roll's own downloaded/prepared overlay files need to exist before the
main ffmpeg composition pass, and `namedEntities` is an output of the render-graph's `hookPrediction`
node. Reusing it as originally chosen would have meant either a second, duplicate LLM call (defeating
the "free" premise) or reordering the render pipeline (bigger, riskier than this feature warrants).

**Surfaced back to the user immediately rather than silently working around it.** Three options
presented (a cheap heuristic / reordering the pipeline / a new standalone LLM call). **User chose the
cheap heuristic**: `keywords` already comes from an LLM (`clip-scoring`), so a real proper noun is
very likely already properly capitalized by that model - `looksLikeBrandName()` checks whether every
word in a keyword starts with an uppercase letter. False positives are cheap (one extra Clearbit
lookup that finds nothing useful, falling through to the exact same stock-footage tiers as before);
false negatives just mean that keyword gets the pre-existing baseline behavior. Accepted, documented
quirk: an all-caps acronym (`"NASA"`) also matches - arguably correct, not a bug.

## What shipped

- **`apps/worker/src/assets/logoAdapter.ts`** (new) - `LogoAdapter implements AssetProvider`, adapting
  Clearbit's free Company Autocomplete API (no API key required, unlike Pexels/Pixabay/Unsplash which
  each need their own). Maps the first suggestion's `logo` URL to the same `StockAsset` shape every
  other provider uses (`type: 'image'` - `ffmpeg.ts`'s `trimAndFadeInBRoll` already knows how to loop
  a still image, no new rendering path needed).
- **`apps/worker/src/assets/types.ts`** - `StockAsset.sourceName`/`AssetProvider.name` grew a 4th
  value (`'clearbit'`).
- **`apps/worker/src/assets/stockAssetService.ts`** - a new `TIER_0` (the logo adapter alone),
  conditionally prepended via a new `isBrandCandidate` parameter on `searchAssets()` (default
  `false`, fully backward compatible - every existing call site keeps its exact prior behavior).
  Deliberately NOT merged into the existing `TIER_1`/`TIER_2` list: logo search is a fundamentally
  different matching semantic (exact brand-name lookup, not fuzzy content search) that would return
  a wrong/misleading result if blindly tried for every keyword the way stock-footage tiers already
  are - only tried when the caller has already decided a keyword looks like a brand name.
- **`apps/worker/src/broll.ts`** - `looksLikeBrandName()` (the heuristic above) and a new
  `BRollMoment.isBrandCandidate` field, threaded through `render-clip.worker.ts`'s
  `stockAssetService.searchAssets(moment.keyword, moment.isBrandCandidate)` call.
- No migration (nothing in this feature touches the database), no new feature flag (logo search is
  free and best-effort like every other provider - falls through to the existing tiers on any
  failure, same posture as a Pexels/Pixabay/Unsplash outage already has).

## Explicitly deferred / out of scope

- **AI illustration** (the third asset type from the original ask) - a real per-image cost, a new
  external dependency (image generation), and its own caching/rate-limit design - a separate future
  phase, not started here.
- **Reusing Hook Prediction's real `namedEntities`** - would need either a duplicate early LLM call
  or a render-pipeline reordering; neither was judged worth it for this feature's scope. Worth
  revisiting if the capitalization heuristic's false-negative rate turns out to matter in practice.
- **Company-name → domain resolution refinement** - Clearbit's Autocomplete API already does fuzzy
  name matching internally; no additional heuristic needed on this side for v1.
- **Live network calls to Pexels/Pixabay/Unsplash/Clearbit in CI** - deliberately out of scope for
  the real-ffmpeg gate below too (would make the suite flaky/secret-dependent); everything
  downstream of "an asset file already sits on local disk" is covered by real ffmpeg instead.

## Verification

`apps/worker` - `logoAdapter.spec.ts` (new, 6 tests: name, no-API-key-required, successful mapping,
empty results, missing `logo` field, error propagation), `stockAssetService.spec.ts` (+4 new tests:
logo tier skipped when not a brand candidate, tried first and short-circuiting when it is, falling
through to stock tiers when the logo tier finds nothing, and that the brand/non-brand cache entries
for the same literal keyword stay independent), `broll.spec.ts` (+6 new tests for
`looksLikeBrandName()`, existing `findBRollMoments()` tests updated for the new field),
`render-clip.worker.spec.ts` (+1 new test proving the `isBrandCandidate` flag actually threads through
to `searchAssets()`, existing B-roll tests updated for the new call signature) - full suite
125/125. `typecheck`/`lint`/`format` all green.

**Follow-up (real-ffmpeg acceptance gate).** The above was all mocked - this feature originally
shipped with no real-render proof, a standing gap explicitly named in this doc. Closed by a new
`ffmpeg.broll.integration.spec.ts`, following the same `describeIfFfmpeg`-skip / real-lavfi-test-
media template `ffmpeg.reaction-hold.integration.spec.ts`/`ffmpeg.crossfade.integration.spec.ts`
already established, run against a real ffmpeg 8.1.2-full_build - 5 tests: `trimAndFadeInBRoll()`
genuinely normalizes a mismatched-size/fps stock asset to the target dimensions and produces an
alpha-capable frame, alpha measurably fades in from near-transparent to fully opaque by
`BROLL_FADE_SECONDS`, a still-image asset (`-loop 1`) produces a real video stream of the requested
duration despite the source having no inherent duration, `fadeOutBRoll()`'s alpha measurably fades
back out without changing duration, and `renderClip()`'s overlay compositing places the cutaway's
own color only within its own `enable=between(...)` window (verified via real per-instant pixel
sampling, not just filter-args assertions) while leaving the clip's own total duration unchanged.
One real finding from running against actual ffmpeg (not assumed): the qtrle encoder's own output
`pix_fmt` is `argb`, not a pass-through of the filter chain's `format=yuva420p` - still genuinely
alpha-capable, just a different exact tag, corrected in the test rather than forcing reality to
match the original assumption. Full `apps/worker` suite: 56 suites / 668 tests passing.
`typecheck`/`lint`/`format` all green.

## Follow-up: Pre-Processing Settings UI control

The other standing gap this doc named ("no user-facing UI control at all") is closed. B-roll joins
the existing Pre-Processing Settings system (`ProcessingOptions`, see
`packages/shared/src/types/processing-options.ts` and
`apps/web/components/processing-settings/ProcessingSettings.tsx`) as a new `broll` group - the same
versioned/migrated, one-owner-per-group pattern every other settings-screen section already
follows, rather than a bespoke one-off control.

**Scope resolved via `AskUserQuestion`**: three options presented (a plain on/off toggle only; on/off
plus an asset-type picker logo/stock/both; on/off plus a max-cutaways-per-clip override). **User
chose on/off + max cutaways** - the asset-type picker was set aside as more complexity than
requested for a first pass.

**Shipped**:

- `packages/shared/src/types/processing-options.ts` - `ProcessingOptions.broll: { enabled: boolean;
  maxCutaways: number | null }`, owner `apps/worker/broll.ts`. `enabled` defaults to `true` (matches
  every pre-existing render - B-roll has always run unconditionally until this control existed).
  `maxCutaways: null` means "use broll.ts's own default", the same convention
  `clipGeneration.clipCount`/`smartCrop.zoomInFraction` already use. Explicitly documented as NOT
  part of the original 24-section spec every other group traces back to - this is item 8 of the
  separate, later gap-analysis list.
- `apps/api/src/processing-presets/dto/processing-options.dto.ts` - new `BRollOptionsDto`
  (`enabled?: boolean`, `maxCutaways?: number | null` bounded `1-5` via a new
  `MAX_BROLL_CUTAWAYS_LIMIT`), wired into `ProcessingOptionsDto`/`toProcessingOptions()` - reused
  automatically by every existing caller (upload, YouTube import, start-processing, processing
  presets) with no per-caller change needed.
- `apps/worker/src/broll.ts` - `findBRollMoments()` gained an optional `maxMoments` parameter
  (default `MAX_BROLL_MOMENTS`, now exported so the worker's own resolver can fall back to the exact
  same constant instead of a second, independently-chosen number).
- `apps/worker/src/workers/render-clip.worker.ts` - a new `resolveBRollOptions()`, matching the
  established `resolveRenderQuality()`/`resolveSceneAnalysisFlags()`/`resolveZoomInFraction()` shape
  exactly. When disabled, `buildBRollOverlays()` (and therefore `findBRollMoments()`/every
  stock-asset search) is skipped entirely rather than run and its results discarded.
- `apps/web/components/processing-settings/ProcessingSettings.tsx` - a new "B-roll Otomatis"
  `SectionCard` (checkbox + bounded number input), placed alongside every other functional section,
  using the exact same `update()`/`options.<group>` pattern as Scene Analysis/Smart Crop.
- No migration (the whole feature lives in the existing `Video.processingOptions` JSON column, no
  schema change needed).

**Explicitly deferred**: an asset-type picker (logo only / stock only / both) - set aside by the
user's own scope decision above, worth revisiting if a real need for finer-grained control surfaces.
**A pre-existing, unrelated gap noted but not fixed here**: `ProcessingSettings.tsx` (800+ lines, ~12
sections) has never had a dedicated component test file, unlike ~23 other `apps/web` components -
this addition follows that same pre-existing state rather than retroactively building test
infrastructure for the whole component as a side effect of one new section.

**Verification**: `packages/shared` (`processing-options.spec.ts` - the fully-populated-value
round-trip test, the partial-value fill-in test, and 1 new dedicated `broll` test, all updated/added);
`apps/api` (`videos.service.spec.ts`'s 3 literal `ProcessingOptions` fixtures updated); `apps/worker`
(`broll.spec.ts` +2 new `maxMoments` tests, `render-clip.worker.spec.ts` +3 new tests: disabled skips
the pipeline entirely, an explicit `maxCutaways` threads through, the unconfigured case passes
`undefined` rather than a duplicated constant). Full suites: `packages/shared` 83/83,
`apps/api` 1268/1268, `apps/worker` 673/673. `typecheck`/`lint`/`format` all green across all four
touched packages (`shared`/`api`/`worker`/`web`).
