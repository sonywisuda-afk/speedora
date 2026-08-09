# Worker (`apps/worker`)

BullMQ job consumer. No HTTP server. Reads/writes Postgres directly via `@speedora/database`,
reads/writes object storage via `@speedora/storage`, shells out to `ffmpeg`/Python subprocesses for
CV/audio work. See `queue.md` for job orchestration and `coding-standards.md` for the JSON-contract
adapter pattern every AI module here follows. See `worker-architecture.md` for the flow-level view
(Queue → Worker → Snapshot → Retry → Failure isolation) this doc's per-handler detail sits under.

## Job handlers (`src/workers/*.worker.ts`)

- **`import-youtube`** — downloads via a `VideoImportEngine` abstraction (`@speedora/video-import-engine`,
  today's only implementation is `YtDlpEngine` wrapping `yt-dlp`: `spawn` with `--progress-template`
  streamed line-by-line for real progress, prefers H.264/AAC over AV1 for browser compatibility),
  uploads to `videos/<videoId>.mp4`, self-chains `probe-video`. The interface (config-driven engine
  selection via `resolveEngine()`, typed `VideoImportError` with a retry/metrics `category`,
  exponential backoff, `AbortSignal`-based cancellation wired through the adapter's own `.catch()` on
  `withJobTimeout`'s returned promise, and a `checkVersion()` health check) means a future non-YouTube
  source needs only a new engine + registry entry, not a worker rewrite. Binary
  path/timeout/retry/backoff/cookies/proxy/allowed-domains/scratch-dir/min-version are all configurable
  via env (see `.env.example`); yt-dlp itself is updated via the manual `pnpm yt-dlp:version` /
  `yt-dlp:update` / `yt-dlp:rollback` scripts (`apps/worker/src/scripts/`) as part of a Docker image
  rebuild/redeploy, never at runtime by the worker process itself. **Download Reliability
  Framework**: this is now a second job with BullMQ's own automatic retry
  (`IMPORT_YOUTUBE_RETRY_OPTIONS`, coordinated with a health-check gate and `UnrecoverableError` for
  non-retryable categories) — see `video-import-reliability.md` for the full design, failure-category
  table, and troubleshooting notes.
- **`transcribe`** — downloads source straight from object storage into Whisper (no local disk for
  this stage), writes `TranscriptSegment` rows with word-level timestamps, runs Diarization +
  Vocal Emotion + Audio Intelligence on the full audio track (see `ai/audio.md`), self-chains
  `detect-clips`. Handles long videos via overlapping chunk extraction + nominal-ownership
  filtering at chunk boundaries so no word is ever split across a chunk seam. Right after the
  source is downloaded to scratch (before Whisper), also extracts a `Video.thumbnailUrl` frame
  (Product Experience roadmap) via `ffmpeg.ts`'s `extractThumbnail()` — best-effort, same
  "optional signal, never fails the job" idiom as diarization/vocal-emotion, so an extraction
  failure just leaves the dashboard showing its honest placeholder instead. Phase 2 (image
  optimization) switched the output format to WebP (`-c:v libwebp`, meaningfully smaller than the
  JPEG this replaced at equivalent quality) and added a second, much smaller extraction
  (`extractBlurPlaceholder()`, 16px wide) whose output is base64-inlined into
  `Video.thumbnailBlurDataUrl` for a blur-up loading effect — its own independent best-effort
  block, so a failed blur extraction never undoes an otherwise-successful thumbnail. Phase 3 adds
  three more independent best-effort blocks off the same source frame: a **Storyboard** (5 evenly-
  spaced `extractThumbnail()` calls, each its own try/catch, into `Video.storyboardFrameUrls` — a
  real, possibly-short array of the keys that actually succeeded, never a fabricated fixed-5), an
  **Animated Thumbnail** (`ffmpeg.ts`'s `extractAnimatedPreview()` — a short, muted, looping
  WebP, into `Video.animatedThumbnailUrl`), and a **Hover Preview** (same `extractAnimatedPreview()`
  primitive, a longer/smoother config since it's the main content of a deliberate hover interaction
  rather than background decoration, into `Video.hoverPreviewUrl` — fetched by the frontend
  on-demand only on hover/focus intent, see `frontend.md`'s `lib/useHoverPreview.ts`).
- **`detect-clips`** — one LLM call (`packages/clip-scoring`) over the full transcript selects 1–3
  candidate clips with `ClipScores`, `hookText`, `hashtags`, emoji suggestions (see `ai/llm.md`).
  Self-chains one `render-clip` per candidate.
- **`render-clip`** — the biggest handler; see below. Also the re-render target for the Timeline
  Editor's explicit "Render" button (same job, same code path, not a special case).
- **`publish-clip`** — uploads a rendered clip to the target platform (see `backend.md`'s Publish
  Center). One of two jobs with BullMQ's built-in retry (`attempts: 3`, exponential backoff) — the
  other is `import-youtube` (Download Reliability Framework, see `video-import-reliability.md`).
  Every other job fails once and waits for a manual retry, because a platform API's transient
  failures (and, for `import-youtube`, transient network/OS/antivirus interference or a worker
  crash) are the class of error this pipeline treats as not needing user judgment.
- **`schedule-publish-clip`** (repeatable, 60s poll) and **`sync-publish-stats`** (repeatable, 6h)
  — see `backend.md`.

## `render-clip` pipeline (in order)

1. **Face detection + reframe plan** (`@speedora/reframe`) — MediaPipe Face Detector via a Python
   subprocess, ~1 sample/sec. Builds a crop path (position from face tracking, size from an
   emphasis-word-triggered zoom envelope — "Auto Zoom") interpolated into an FFmpeg `sendcmd`
   script. Falls back to a static center-crop if no face is found anywhere in the clip, or if the
   subprocess fails for *any* reason — face detection failure never fails the render job.
2. **Scene cut detection + classification** (`@speedora/scene-intelligence`) — ffmpeg
   `select='gt(scene,threshold)'`/`showinfo` for cut timestamps, a second `blackdetect` pass to
   classify each cut as `hard_cut`/`fade`/`dissolve` (`dissolve` reserved in the enum, not yet
   produced). Plus `analyzeMotionEnergy()` (ffmpeg `signalstats`, magnitude only, no direction) and
   `detectCameraMotion()` (Python/OpenCV ECC image alignment → pan/tilt/zoom/shake).
3. **Facial + gesture + face-landmark intelligence** (`@speedora/facial-intelligence`,
   `@speedora/gesture-intelligence`) — three separate MediaPipe/transformers Python subprocesses:
   expression classification (`trpakov/vit-face-expression`), hand gesture recognition, and
   FaceLandmarker (blink/smile/mouth-open/head-rotation/eye-contact/lip-activity/face
   tracking+re-identification — see `ai/vision.md` for the full sub-feature breakdown). All three
   are wrapped independently in try/catch — one failing detector never blocks the others or the
   job.
4. **OCR text detection + tracking** (`@speedora/ocr-intelligence`) — Tesseract via `pytesseract`,
   greedy multi-object tracking across samples, rule-based category classification (subtitle/
   slide/caption/logo/price/name). See `ai/ocr.md`.
5. **Editing Rhythm** (`@speedora/editing-rhythm`) — pure/synchronous, combines the already-
   computed `sceneCuts`/`motionEnergy`/aggregate features from steps above into tempo/pacing/
   acceleration scores. Never throws, no try/catch needed.
6. **Fusion Engine** (`@speedora/fusion-engine`) — combines every signal above (plus the LLM's
   `ClipScores` passed through the job payload) into `highlightScore`/`confidence`/
   `explainability`/`prediction`/`recommendation`. See `ai/fusion.md`.
7. **Caption build** (`@speedora/subtitles`) — transcript → ASS/SSA (`buildAss()`), one code path
   for every `CaptionStyle` preset (`DEFAULT`/`KARAOKE`/`BOLD_HIGHLIGHT`).
8. **Silence/filler cut planning** (`@speedora/cutlist`) — word-gap-based silence detection (>0.7s
   gap, 0.15s padding) + a narrow um/uh filler-word list, merged into cut ranges.
9. **FFmpeg render** (`src/ffmpeg.ts`) — crop/zoom filter (from step 1's `sendcmd` script) → B-roll
   overlay (if any keyword moments matched, `-filter_complex` only when B-roll is present) →
   subtitle burn-in. A **second** FFmpeg pass then applies the cutlist from step 8
   (`select`/`aselect` + `setpts`/`asetpts`) over the *rendered* output — captions/crop are already
   burned in clip-relative coordinates, so trimming afterward automatically removes the right
   pixels without any separate time-remap logic. A dip-to-black micro-transition (`eq` filter,
   brightness dips at each cut junction — not `fade`, which has a real chaining bug in this
   project's ffmpeg build that blacks out the whole output) softens the resulting jump cuts.
10. **Thumbnail extraction** (Product Experience roadmap) — a single WebP frame from the midpoint
    of the just-uploaded RENDERED output (not the raw source, so the thumbnail matches exactly what
    the viewer sees), same best-effort/never-fails-the-job idiom as the silence/filler trim pass
    above. Sets `Clip.thumbnailUrl` alongside `outputUrl`/`outputSizeBytes` in the same update as
    step 11. A second, independent best-effort extraction (Phase 2) generates a tiny base64 blur
    placeholder into `Clip.thumbnailBlurDataUrl` the same way `transcribe.worker.ts` does for
    `Video`. Phase 3 adds the same Storyboard (`Clip.storyboardFrameUrls`), Animated Thumbnail
    (`Clip.animatedThumbnailUrl`), and Hover Preview (`Clip.hoverPreviewUrl`, "Clip Preview" on a
    clip card) extractions as `transcribe.worker.ts`, here from the RENDERED output instead of the
    raw source.
11. **Upload + persist** — one `prisma.clip.update()` writes every raw/derived field from every
    step above.
11. **Ranking** — once every sibling clip in the video has finished rendering (`allRendered`),
    `rankClips()` re-scores the whole set and writes `highlightRank` per clip, in its own try/catch
    so a ranking failure never undoes an otherwise-successful render.

## Smart Reframe / Auto Zoom

See `ai/vision.md` for the model/algorithm details. Architecturally: crop *position* (x/y) comes
from subject tracking, crop *size* (w/h) comes from an independent "emphasis word" zoom envelope
(attack/hold/release) — either signal alone is enough to produce a path; both null only when
neither a subject nor an emphasis word was found anywhere in the clip. `ReframeOptions` separates
the instant crop dimensions from the final encoded output dimensions (`outputWidth`/`outputHeight`)
— a `scale` filter after `crop` in the FFmpeg filtergraph keeps the encoded resolution constant even
while the crop window itself shrinks during a zoom.

**Visual Emphasis Engine Phase C2** (`docs/ai/visual-emphasis-engine.md`, ADR DC3) unified the
subject-tracking source: `render-clip.worker.ts`'s `buildReframePlan()` used to call
`@speedora/reframe`'s own standalone `detectFaces()` — a second, disconnected MediaPipe Face
Detector subprocess call, separate from the one `render-graph/nodes/face-speaker.ts`'s
`faceLandmarksNode` already runs (MediaPipe FaceLandmarker) to feed Composition Intelligence's
`selectPrimarySubject()` chain (active speaker → face → tracked person → highest
`objectAttentionScore` → tracked object). The two could disagree about who "the subject" is on the
same clip, and only the face-only opinion ever drove the actual crop. `buildReframePlan()` now runs
*after* the render graph and consumes `graphResult.primarySubjectSamples` directly (converted to
`FaceSample[]` — both share the identical `{xCenter, yCenter, width, height}` box shape) instead of
calling its own detector — one subject-selection answer for the whole pipeline, and a faceless clip
with a tracked (non-person) object now pans toward it, which `buildCropPath()` had no input for
before this phase. `computeCropDimensions()` (the clip's constant output frame size) still runs
*before* the graph, since it only needs the source video's own width/height and
`compositionFeaturesNode` needs it early for its own aspect-ratio-aware thresholds.

**Visual Emphasis Engine Phase C3** ("Focus Shift", flag-gated behind
`VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED`, off by default) adds a distinct transition at a detected
primary-subject change, instead of the plain continuous pan every subject change previously got.
`buildCropPath()` gained an 8th, optional `focusShifts: Array<{start, end}>` parameter — for each
window, it inserts synthetic waypoints that HOLD the pre-shift position until the window starts,
ramp (the function's own existing linear interpolation, unchanged) across the window, then HOLD the
post-shift position after — no new interpolation math, just reshaped input. The windows themselves
come from Phase C1's own `focus_shift` `EditingSuggestion` entries (`graphResult.editingSuggestions`,
always computed regardless of `VISUAL_EMPHASIS_ENABLED`); `isFocusShiftEnabled()` is the one place
this phase's own flag is actually checked, deciding whether `render-clip.worker.ts` passes those
windows through at all.

**Visual Emphasis Engine Phase C4** ("Digital Push", flag-gated behind
`VISUAL_EMPHASIS_DIGITAL_PUSH_ENABLED`, off by default, a separate flag from Focus Shift's) extends
Auto Zoom's existing emphasis-word trigger set with Phase C1's own `digital_push` suggestion
instants — real filmmaking terminology for the same push-in-zoom motion Fase 11 already does, so
this phase adds a second trigger SOURCE rather than a second zoom mechanism. `buildCropPath()`
gained a 9th, optional `digitalPushStarts: number[]` parameter; the existing `emphasisStarts` local
became `zoomTriggerStarts = [...emphasisWords.map(w => w.start), ...digitalPushStarts]`, one
combined array feeding the same `zoomEnvelopeAt()` max-reduce every overlapping-emphasis-word case
already used — two triggers landing near the same instant still only ever produce one envelope's
peak, never a stacked/doubled zoom. `buildReframePlan()` (`render-clip.worker.ts`) now receives
Phase C1's full, unfiltered `editingSuggestions` array and checks `isFocusShiftEnabled()`/
`isDigitalPushEnabled()` independently inside itself, one technique-specific flag per phase, never
a shared master flag.

## Caption styling

`Clip.captionStyle` (`DEFAULT`/`KARAOKE`/`BOLD_HIGHLIGHT`) drives `buildAss()`. `KARAOKE` uses
native ASS `\k` tags (needs `TranscriptSegment.words`, falls back to plain text for
pre-word-timestamp segments). `BOLD_HIGHLIGHT` uses a keyword heuristic (numbers/percentages,
ALL-CAPS, quoted phrases) inline via `{\b1\c...}` override tags — no word-timestamp dependency, so
it works on any transcript.

**Visual Emphasis Engine Phase C5** ("OCR Highlight", flag-gated behind
`VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED`, off by default) burns in a highlight box around a
qualifying on-screen `price`/`name` OCR track (`isOcrHighlightWorthy()`, the same filter Phase C1's
`ocr_highlight` suggestion timeline already uses) — the first thing this pipeline has ever drawn
from OCR Intelligence's output (every prior consumer was scoring/analytics-only). Reuses the
existing `subtitles=` filter pipeline rather than a new ffmpeg mechanism: `@speedora/reframe`'s new
`computeOcrHighlightBoxes()` transforms each qualifying track's source-frame-normalized
`boundingBox` into absolute output-frame pixel coordinates via the crop window nearest the
highlight's own `startTime` (a static snapshot, not continuous pan/zoom tracking — see
`ai/visual-emphasis-engine.md`'s "Phase C5 architecture" section for the documented drift
limitation), and `@speedora/subtitles`' new `buildOcrHighlightEvent()` draws it as an ASS `\p1`
vector-drawing rectangle (transparent fill, coloured outline via `\3c`/`\bord`) at
`\an7\pos(x,y)`, on its own Layer so it renders above any overlapping caption. Verified against a
real ffmpeg+libass render (frame extraction, visual inspection) before being trusted here, same
discipline Phase B2 established for its own new ASS tag territory.

## B-roll

`@speedora/broll` + an adapter-pattern provider layer (Pexels/Pixabay/Unsplash, tiered:
video providers first, photo fallback second) behind a single `StockAssetService`/`AssetProvider`
interface — `ffmpeg.ts` only ever sees a normalized `StockAsset {url, type: 'video'|'image', ...}`,
never a provider-specific shape. Cutaways are composited via two FFmpeg passes through a
`qtrle`/`.mov` intermediate (the only codec in this pipeline that carries an alpha channel for the
fade) because this project's ffmpeg build corrupts output when two `fade` filter instances are
chained in one pass. Normalized to a fixed FPS/color space (bt709/tv range) before compositing so
cutaways from different providers don't visibly jump in framerate or tint.

## Docker image (`apps/worker/Dockerfile`)

`node:22-slim` (Debian/glibc), not Alpine — MediaPipe's PyPI wheels have no musl build at all.
Installs: `ffmpeg`, `python3` + `mediapipe`/`opencv-python-headless`/`transformers`/`torch`/
`torchaudio`/`pyannote.audio`/`soundfile`/`scipy` (`--break-system-packages`, PEP 668), plus
`tesseract-ocr`/`tesseract-ocr-eng` + `pytesseract` for OCR. Model files (`.tflite`/`.task`,
gitignored, downloaded via `curl` — see `../README.md`) are baked into the image at build time,
not fetched at runtime. `HUGGINGFACE_TOKEN` is read directly from the environment by the Python
scripts, never passed as a CLI arg (keeps it out of process listings/argv logs).
