# Render Fidelity & Composition Execution Engine — Phase 0 Audit

Status: **audit complete, no implementation code written yet.** This document is the required
Phase 0 deliverable (repository audit + Feature-to-Render Fidelity Matrix) for the Render
Fidelity & Composition Execution Engine initiative — a proposal to unify every existing
video-processing/AI/composition/caption/branding/B-roll/audio capability behind one deterministic
`EffectiveRenderConfig → RenderPlan → FFmpeg Compiler → Render Manifest → ffprobe verification`
pipeline. Phases 1+ (the actual `RenderPlan`/`EffectiveRenderConfig`/compiler code) have **not**
started — see "Recommendation" at the end of this doc for why, and what's proposed next.

Audited by four parallel read-only passes over the real, current source (not doc summaries taken
at face value — several existing docs turned out to be stale, noted inline):

1. UI → API → Persistence → Queue payload (every setting's front-half)
2. Worker core pipeline (`render-clip.worker.ts`, render graph, `ffmpeg.ts`) — the back-half
3. Captions / Visual Emphasis / B-roll / Branding / Transitions — dimension + composition fidelity
4. Clip count & duration funnel — candidate generation → shortlist → ranking → final selection

## Headline finding: no unified config object exists, and it shows in 6 concrete, fixable bugs

There is **no `RenderPlan`/`EffectiveRenderConfig` struct anywhere in this codebase today.** Each
setting group is resolved by its own independent `resolveX()` helper in
`apps/worker/src/workers/render-clip.worker.ts` (`resolveRenderQuality`, `resolveTargetAspectRatio`,
`resolveResolutionTier`, `resolveZoomInFraction`, `resolveBRollOptions`, `resolveSceneAnalysisFlags`,
`resolveThumbnailWeights`, ...) and threaded as a loose function parameter into whichever
`apps/worker/src/ffmpeg.ts` call needs it — never as one object every pass consumes uniformly.

Most of the time this scattered-but-independently-correct pattern still works, because most
individual passes DO correctly reuse the resolved value they're given. But it has produced real,
concrete divergences where a later pass silently uses a different constant than the one the user
configured. These are the 6 confirmed bugs this audit found (not hypothetical — each has an exact
file:line citation):

| # | Bug | Where | Impact |
|---|---|---|---|
| 1 | `concatBrandSegment()` (intro/outro concat — the LAST encode pass before upload) has no `quality` parameter at all | `apps/worker/src/ffmpeg.ts:1330-1421` | Any clip with an intro or outro silently loses the user's chosen quality preset (e.g. `maximum_quality` CRF 18/slow) and falls back to ffmpeg's own default (CRF 23/medium) on the segment that's actually delivered |
| 2 | `trimAndFadeInBRoll()`/`concatBrandSegment()` hardcode `BROLL_TARGET_FPS = 30` unconditionally, applied even to the main clip's own video branch during intro/outro concat | `ffmpeg.ts:885`, `1378`, `1384` | A 60fps source that survives every earlier pass at its native rate gets silently forced to 30fps the moment an intro/outro is attached — no user-facing control, unrelated to the real probed `sourceFrameRate` |
| 3 | `applyReactionHolds()`/`concatBrandSegment()` hardcode `BRAND_SEGMENT_AUDIO_SAMPLE_RATE`/`CHANNEL_LAYOUT` (44100/stereo) instead of calling `resolveAudioEncodeArgs()` like `renderClip()`/`trimCutRanges()` do | `ffmpeg.ts:1280-1281`, `1414-1415`, `1579-1580` | A genuinely mono source that stays mono through the first two passes is silently upmixed to stereo the moment it passes through a reaction hold or an intro/outro — diverges from the codebase's own documented "never upmix mono" policy (`ffmpeg.ts:1046-1047`) |
| 4 | `selectShortlist()` is called without a `targetSize`, so it always falls back to the hardcoded `DEFAULT_SHORTLIST_TARGET_SIZE = 15` | `apps/worker/src/workers/detect-clips.worker.ts:115-134` calling `packages/candidate-shortlist/src/select-shortlist.ts:105-141` | A user who explicitly requests `clipCount: 20` or `'unlimited'` gets silently capped at 15 clips by the shortlist stage — test-confirmed (`detect-clips.worker.spec.ts:386-406`: 20 in → 15 out) |
| 5 | No production code ever re-probes a rendered clip's actual final duration (post cuts/holds/transitions/intro/outro) and reconciles it against `Clip.durationSeconds` | confirmed absent from `render-clip.worker.ts`; ffprobe duration checks exist only in isolated, `describeIfFfmpeg`-gated integration test specs (`ffmpeg.duration.integration.spec.ts` etc.) | `Clip.durationSeconds` is a denormalized `endTime - startTime` set once at candidate-creation time and never corrected — the stored duration can silently diverge from the delivered file's real duration once any duration-changing pass runs |
| 6 | No dedup/diversity check exists between candidates in the same generation batch on the initial upload flow | `packages/clip-scoring/src/score-clip-candidates.ts:277` only asks the LLM via prompt text ("pick non-overlapping clips") — no code-level check; `packages/candidate-shortlist`/`packages/clip-ranking` both score candidates independently with zero pairwise comparison | Near-duplicate clips (same hook, 1-2s shifted) can both survive into the final set; Generate-More's `filterOverlappingCandidates()` only guards against *pre-existing* clips, not its own new batch |

None of these are architectural rewrites — each is a small, targeted fix (thread an existing
`quality`/audio-config value into one more function call, pass an existing `targetSize`, add one
ffprobe-and-reconcile step, add one O(n²) overlap filter). They're listed separately from the
"build `RenderPlan`" recommendation below because they're independently shippable this week,
regardless of what happens with the larger initiative.

## What's already good news (don't rebuild these)

Several things the mission brief worried about turned out to already be correctly built:

- **Aspect ratio is not hardcoded.** `resolveTargetAspectRatio()` → `computeCropDimensions()` →
  `resolveOutputResolution()` produces one `outputSize` (`reframe.outputWidth`/`outputHeight`) that
  every downstream consumer (captions, B-roll, watermark, OCR highlight, composition features) is
  required to read — enforced by an explicit in-code comment
  (`render-clip.worker.ts:737-739`: *"Every consumer of the FINAL coordinate system... must read
  outputSize/reframe.outputWidth/outputHeight, never crop"*). 9:16/1:1/16:9 are all real, already
  work end to end.
- **Captions already use FINAL output dimensions, not source dimensions** — `buildAss()` receives
  `reframe.outputWidth/outputHeight` explicitly, with an in-code comment stating exactly why
  (`render-clip.worker.ts:1477-1480`).
- **Visual Emphasis crop/zoom techniques already funnel into ONE composition plan.** Auto Zoom,
  Auto Crop, Face/Object Priority (via Composition Intelligence's `selectPrimarySubject()`), Focus
  Shift, Speaker-aware Focus Shift, and Digital Push all merge into a single `buildCropPath()` call
  and a single `crop@reframe` sendcmd filter — not competing passes. Pause Hold and Reaction Hold
  are deliberately separate (temporal, not spatial, operations) but strictly sequential, and
  Reaction Hold operates on already-final-dimension pixels by design, so it needs no width/height
  parameters at all.
- **B-roll and watermark already scale/position relative to real output dimensions**, not
  hardcoded constants — confirmed via explicit in-code comments citing why (e.g.
  `ffmpeg.ts:862-864`: *"always the CLIP's own output size, not a hardcoded constant"*).
- **The candidate-expansion → LLM `maxCandidates` prompt wiring is already fixed.** The existing
  `docs/ai/clip-ranking-engine.md` describes a "Pick 1-3, hardcoded" tech debt as a *historical*
  finding already resolved by Phase 13.1 — current code genuinely threads a real `maxCandidates`
  ceiling into the prompt. The doc reads as still-open; it isn't. (Corrected here so nobody re-fixes
  an already-fixed bug.)
- **`rankClipCandidates()`/Phase 14.2's ranking pass never drops or truncates clips** — pure
  scoring, input length always equals output length. The clip-count shortfall in bug #4 above
  happens upstream at the shortlist stage, not at ranking.
- **Transitions (xfade/acrossfade) correctly propagate the quality preset** — unlike
  `concatBrandSegment()`, `trimCutRanges()` does receive and apply `quality`.

## Two queue-payload shapes — an architectural fact worth designing around, not a bug

`RenderClipJobData` (the render job payload) embeds only a handful of fields directly:
`captionStyle`, `speakerColorCaptions`, `smartSegmentation`, `dynamicCaptions`, `captionLanguage`,
`fontFamily`, `watermark`, `intro`, `outro`, `keywords`, `scores`. Everything else — export/quality,
aspect ratio, resolution tier, clip count, min/max duration, smart-crop zoom, B-roll
enable/maxCutaways, scene analysis, highlight focus, thumbnail, SEO, publishing — is **not** in the
payload. Instead, the worker re-fetches `Video.processingOptions` from Postgres at consume time
using the `videoId`/`clipId` that IS in the payload, and resolves each group independently via its
own `resolveX()` helper.

This means "the queue payload" is not today's single source of truth for most settings — the
Postgres row is, read fresh at render time. That's a defensible design (a preset edited after
enqueue takes effect; no payload schema migration needed to add a setting) but it means an
`EffectiveRenderConfig` builder has to assemble from **two sources** (payload + DB re-read), not
one, and do it once, early, rather than letting each pass do its own ad hoc read — which is exactly
where bugs #1-3 above come from (each `resolveX()` call is independently correct, but nothing
forces every ffmpeg pass to consume the *same instance* of the resolved result).

## Full matrix

Status legend: **FULLY_WIRED** (setting demonstrably reaches final media, verified in code),
**PARTIALLY_WIRED** (reaches some but not all consuming passes), **PERSISTED_NOT_QUEUED**
(reaches DB, worker re-reads it rather than receiving it in the queue payload — not a defect per
se, see above, but means it's DB-rehydrated rather than payload-carried), **REACHES_QUEUE**
(embedded directly in the BullMQ payload), **NOT_A_SETTING** (hardcoded constant or ops-only
env-var flag, by design — no UI/API/DB/queue path exists), **NOT_IMPLEMENTED** (no path exists at
any layer), **HARDCODED** (a real value exists in config but a downstream stage silently
overrides/ignores it with its own constant — this is where bugs live).

### Output

| Feature | UI | API | Persistence | Queue | Worker resolve | FFmpeg | Status |
|---|---|---|---|---|---|---|---|
| Quality preset (CRF/preset) | `ProcessingSettings.tsx:769-793` | `ExportOptionsDto.qualityPreset` | `Video.processingOptions.export` | not in payload | `resolveRenderQuality()` | `renderClip`/`trimCutRanges`/`applyReactionHolds` ✅, `concatBrandSegment` ❌ (bug #1) | PARTIALLY_WIRED |
| Aspect ratio | `ProcessingSettings.tsx:795-818` | `ExportOptionsDto.aspectRatio` | `Video.processingOptions.export` | not in payload | `resolveTargetAspectRatio()` | all passes via `reframe.outputWidth/Height` | FULLY_WIRED |
| Resolution tier | `ProcessingSettings.tsx:820-843` | `ExportOptionsDto.resolutionTier` | `Video.processingOptions.export` | not in payload | `resolveResolutionTier()` → `resolveOutputResolution()` | all passes | FULLY_WIRED |
| FPS | none | none | none (not a setting) | — | none | main pass: passthrough; B-roll/intro-outro: hardcoded 30fps (bug #2) | HARDCODED |
| Codec (h264/aac) | none | none | none | — | none | hardcoded everywhere, deliberately (product never offered a choice) | NOT_A_SETTING |
| Pixel format | none | none | none | — | none | `yuv420p` hardcoded everywhere, consistently | NOT_A_SETTING |
| Bitrate | none (indirect via quality preset only) | — | — | — | — | — | NOT_A_SETTING |
| Audio sample rate/channels | none (auto-derived from source) | — | — | — | `resolveAudioEncodeArgs()` | `renderClip`/`trimCutRanges` ✅, `applyReactionHolds`/`concatBrandSegment` ❌ (bug #3) | PARTIALLY_WIRED |

### Clip generation (count & duration)

| Feature | UI | API | Persistence | Queue | Worker resolve | Status |
|---|---|---|---|---|---|---|
| Clip count | `ProcessingSettings.tsx:366-393` | `ClipGenerationOptionsDto.clipCount` | `Video.processingOptions.clipGeneration` | not in `DetectClipsJobData` | `toScoringInput()` DB re-read → `maxCandidates` | PERSISTED_NOT_QUEUED, and reaches the LLM prompt correctly, BUT capped at 15 by the shortlist stage regardless of a larger request (bug #4) |
| Min/max clip duration | `ProcessingSettings.tsx:395-428` | `ClipGenerationOptionsDto` | `Video.processingOptions.clipGeneration` | not in payload | DB re-read | PERSISTED_NOT_QUEUED; min is code-enforced, max is prompt-guidance only |
| Duration tolerance | — | — | — | — | — | NOT_IMPLEMENTED |
| Generate More (count/min/max/confidence/avoidOverlap) | `GenerateMoreClipsDialog.tsx` | `GenerateMoreDto` | ephemeral, not persisted | `GenerateMoreClipsJobData` (direct) | direct payload read | REACHES_QUEUE (this alternate flow embeds params directly, unlike initial Processing Settings) |
| Semantic-boundary-aware duration | — | — | — | — | word-boundary snap only (`snapToWordBoundaries()`) | PARTIALLY_WIRED — no narrative/semantic-event boundary feedback into chosen start/end |
| Final-duration ffprobe verification | — | — | — | — | absent from production path (bug #5) | NOT_IMPLEMENTED in production; exists only in isolated integration test specs |
| Within-batch dedup/diversity | — | — | — | — | absent (bug #6) | NOT_IMPLEMENTED (initial flow); PARTIALLY_WIRED (Generate More, vs. pre-existing clips only) |

### Captions

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| Enable/disable | — | — | — | — | NOT_IMPLEMENTED (no "none" caption style exists) |
| Preset (default/karaoke/bold) | `ProcessingSettings.tsx:481-497`, `TimelineEditor.tsx:761-778` | `SubtitleOptionsDto`/`UpdateClipDto.captionStyle` | `Clip.captionStyle` | `RenderClipJobData.captionStyle` | FULLY_WIRED (reaches queue, `buildAss()` branches on it, verified against real ffmpeg+libass render per subtitle-intelligence.md) |
| Speaker colors | `ProcessingSettings.tsx:523-537`, `TimelineEditor.tsx:783-792` | `.speakerColorCaptions` | `Clip.speakerColorCaptions` | `RenderClipJobData.speakerColorCaptions` | FULLY_WIRED |
| Font family | `ProcessingSettings.tsx:499-522`, `TimelineEditor.tsx:824-839` | `.fontFamily` | `Clip.fontFamily` | `RenderClipJobData.fontFamily` | FULLY_WIRED |
| Font size/animation/position/margins/safe area | — | — | derived from `videoHeight` in `build-ass.ts` | — | NOT_IMPLEMENTED as a user setting (algorithm-derived, not user-configurable — arguably fine, but worth an explicit product decision, see below) |
| Smart segmentation / dynamic captions | UI exposure **unconfirmed** — store actions exist (`timelineStore.ts:201-231`) but no confirmed rendered checkbox found in the excerpts read | `UpdateClipDto.smartSegmentation`/`dynamicCaptions` | `Clip.smartSegmentation`/`dynamicCaptions` | `RenderClipJobData` fields | REACHES_QUEUE at API/DB/queue layers; **UI_ONLY gap suspected, needs a targeted follow-up check of the full `TimelineEditor.tsx`** before concluding UI_ONLY or FULLY_WIRED |
| Caption language (translation) | `TimelineEditor.tsx:842-849` | `.captionLanguage` | `Clip.captionLanguage` | `RenderClipJobData.captionLanguage` | FULLY_WIRED |

### Visual emphasis

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| Auto zoom intensity | `ProcessingSettings.tsx:714-737` | `SmartCropOptionsDto.zoomInFraction` | `Video.processingOptions.smartCrop` | not in payload | PERSISTED_NOT_QUEUED, DB-rehydrated, reaches `buildCropPath()` correctly |
| Auto crop (strategy toggle) | — | — | — | — | NOT_IMPLEMENTED — only one algorithm exists, always on (by design, not a gap) |
| Face priority / Object priority (as separate strategies) | — | — | — | — | NOT_IMPLEMENTED — smart crop only ever tracks faces via Composition Intelligence's primary-subject selection; no alternate "object priority" mode exists to toggle |
| OCR highlight, Focus Shift, Digital Push, Reaction Hold, Pause Hold, Speaker-aware Focus Shift | — | — | — | ops-only env-var flags (`VISUAL_EMPHASIS_*_ENABLED`), read directly by the worker | NOT_A_SETTING by explicit design (documented "no per-clip toggle" in `visual-emphasis-engine.md`) — but ALL of them, once flag-enabled, correctly funnel into the one unified crop/composition path (see "good news" above) |

### Branding

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| Watermark enable (per clip) | `TimelineEditor.tsx:794-802` | `UpdateClipDto.watermarkEnabled` | `Clip.watermarkEnabled` | `RenderClipJobData.watermark` | FULLY_WIRED |
| Watermark position/scale/opacity/margin (Brand Kit) | `brand-kit/page.tsx` | `UpdateBrandKitDto` | `User`/`Workspace`/`BrandKitTemplate` brand fields | `RenderClipJobData.watermark.*` | FULLY_WIRED, geometry uses ffmpeg's own `main_w`/`main_h` expressions (output-relative by construction) |
| Intro/Outro enable + asset | `TimelineEditor.tsx:804-822` + Brand Kit page | `UpdateClipDto`/brand-kit upload endpoints | `Clip.introEnabled/outroEnabled` + `User.brandIntro/Outro*` | `RenderClipJobData.intro/outro` | FULLY_WIRED for geometry (uses `outputWidth/outputHeight` params); **quality preset not honored** (bug #1); FPS silently forced to 30 (bug #2); audio silently forced to stereo/44.1kHz (bug #3) |
| Brand Kit apply toggle + template selection | `ProcessingSettings.tsx:544-577` | `BrandKitOptionsDto` | `Video.processingOptions.brandKit` + `Clip.applyBrandKit` | not directly in payload, but its resolved consequences (fontFamily/watermark/intro/outro) are | REACHES_QUEUE (indirect) |

### B-roll

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| Enable | `ProcessingSettings.tsx:846-860` | `BRollOptionsDto.enabled` | `Video.processingOptions.broll` | not in payload | PERSISTED_NOT_QUEUED, DB-rehydrated correctly |
| Max cutaways | `ProcessingSettings.tsx:861-883` | `BRollOptionsDto.maxCutaways` | `Video.processingOptions.broll` | not in payload | PERSISTED_NOT_QUEUED, correctly resolved |
| Placement, duration, scale | — | — | — | — | NOT_IMPLEMENTED as settings — `BROLL_DURATION_SECONDS`/`BROLL_FADE_SECONDS` hardcoded constants, placement keyword-triggered not user-positioned. Scale IS output-relative (good news above) but not independently user-tunable. |

### Audio

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| Volume/normalization, ducking, fades | — | — | — | — | NOT_IMPLEMENTED — `ProcessingSettings.tsx` explicitly lists this under `COMING_SOON_SECTIONS`; zero `loudnorm`/`afade`/`sidechaincompress` filters exist anywhere |
| Silence/filler-word removal | — (always-on) | — | — | — | Always-on pipeline behavior (`packages/cutlist`), no UI toggle, no settings surface at all — not a wiring gap, a scope decision already made elsewhere |

### Transitions

| Feature | UI | API | Persistence | Queue | Status |
|---|---|---|---|---|---|
| xfade/acrossfade + duration | — | — | — | — | NOT_A_SETTING — `CROSSFADE_SECONDS`/`MIN_CROSSFADE_SECONDS` hardcoded in `ffmpeg.ts:1013-1014`, no UI/API/DB/queue path exists by design (this is an editorial/quality decision the product hasn't chosen to expose, not a broken feature) |

## Recommendation: don't start Phase 1 (`EffectiveRenderConfig`) yet — fix the 6 confirmed bugs first, then decide scope with the user

The mission brief's own change-safety rules (§0, "Critical Change-Safety Rule") say: identify the
exact integration gap, add the smallest abstraction necessary to close it, prefer adapters over
rewrites. Given what this audit found, that points at two very different sizes of work bundled
into one ask:

1. **Six small, independent, high-value bug fixes** (above) — each is a one-function-signature
   change, each has an existing test suite to extend, each is shippable and verifiable this week
   without touching the RenderPlan/EffectiveRenderConfig architecture at all.
2. **A genuinely large architectural initiative** — a real `EffectiveRenderConfig`/`RenderPlan`/
   `FFmpeg Compiler`/`Render Manifest` layer, a Clip Count & Duration Precision Engine, a real-FFmpeg
   verification harness, and a UI fidelity pass — which is realistically multiple weeks of
   phased work across nearly every package in this repo, matching the scale of past initiatives
   like Visual Emphasis Engine (10 sub-phases) or AI Intelligence v4 (17 phases), each of which was
   phase-gated with a user checkpoint between phases rather than run end-to-end unattended.

This audit does not, on its own, decide which of these (or what mix) to build next — that's a
product/priority call. See the chat response for the concrete options being put to the user.
