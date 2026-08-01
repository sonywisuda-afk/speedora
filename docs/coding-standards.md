# Coding Standards

## Language & shared types

TypeScript everywhere (`apps/web`, `apps/api`, `apps/worker`, `packages/*`). Any contract shared
across apps — job payloads, status enums, DTOs — is defined once in `packages/shared` and
imported, never duplicated. BullMQ jobs are named verb-noun (`transcribe`, `detect-clips`,
`render-clip`, `publish-clip`); their payload/result types live in `packages/shared`.

## JSON-contract module checklist

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the full checklist when adding a new stateless
analysis module. Summary:

1. Define the input/output Zod schema in `packages/contracts/src/<name>.ts`.
2. Build the module in its own `packages/<name>` package — pure function(s), `deps` parameter for
   anything external (subprocess, API client, file paths derived from `__dirname`/`process.env`).
3. Write an adapter inside the relevant `apps/worker` job handler that narrows the DB row to the
   module's input, calls it, persists the result.
4. If the module is a Fusion Engine signal, extend `fusionInputSchema` (`packages/contracts/src/
   fusion.ts`) and `packages/fusion-engine`'s feature extraction/normalization — extend the
   existing pipeline, never rebuild it from scratch (this has been an explicit user directive
   since the Fusion Engine v1→v2 transition).
5. Test the module with plain fixtures, zero DB/queue mocks. Test the adapter separately, mocking
   the module itself, asserting orchestration only (persist shape, status transitions, enqueue
   calls, Sentry tags).

`deps` injection is not just "external API clients" — anything environment/deployment-specific
(subprocess executable names, model file paths, env var reads) belongs in `deps`, not inside the
module. A module reading `process.env` or building a path from `__dirname` internally is a sign it
needs refactoring.

## Extraction discipline

Extract shared logic to a common util/package **at the third duplication**, not the second — e.g.
`filterSegmentsForClip` (`packages/shared/src/utils/transcript.ts`), `sanitizeHashtags`,
`GRAPH_API_VERSION`/`GRAPH_BASE_URL` (`packages/social`'s `instagram-graph.ts`). Two duplicates is
tolerated; a third is the signal to extract. Exception: OAuth/token-encryption code was shared
starting at the *second* duplication (Fase 6b) — that class of bug (a subtle drift = a security
hole or a silently broken publish job) is expensive enough to justify sharing early.

Don't add abstractions, error handling, or validation for scenarios that can't happen. Trust
internal code/framework guarantees; validate only at system boundaries (user input, external
APIs, LLM output).

## "Scale honesty" — don't overclaim what a heuristic is

Every heuristic/model output in this codebase is documented as exactly what it is, not oversold:

- LLM-derived scores (`ClipScores`, `highlightScore`'s weights) are explicitly **not** trained/
  calibrated against real engagement data — they're a reasonable starting point, documented as
  such in code comments, not presented as a trained prediction.
- Proxy metrics are labeled as proxies (e.g. `mouthContrastRatio` for "occlusion", `sharpness` for
  both "blur detection" and "sharpness score", `landmarkJitterScore`'s reliance on a proxy
  "landmark confidence" since MediaPipe FaceLandmarker doesn't expose real per-landmark
  confidence).
- Emotion classifiers trained on acted/scripted data (IEMOCAP for vocal emotion, FER+ for facial
  expression) are flagged as distribution-shifted relative to this app's real talking-head/
  interview footage — useful if right, safe to ignore if wrong, never the sole basis for a
  decision.
- New signals in the Fusion Engine are wired in at **weight 0** (collected, visible in
  `contributions`, not moving `highlightScore`) until there's real calibration data — see
  `ai/fusion.md`.
- Where a safety-relevant vocabulary constraint was given explicitly by the user (e.g. facial
  affect labels restricted to `positive_affect`/`high_energy`/`low_energy`/`expressive`/`neutral`,
  never a discrete emotion name), it's enforced in the type system (`AFFECT_LABELS` union), not
  just a comment.

## Data shape conventions

- **Always an array, never null** — for fields where "analysis ran and found nothing" is a valid
  outcome (`sceneCuts`, `topics`, `keywords`, `emojiSuggestions`, `motionEnergy`): default `[]`,
  the detector itself swallows its own failures internally.
- **Null distinct from empty array** — for fields where "analysis never ran / failed entirely"
  needs to be distinguishable from "ran and found nothing" (`facialEmotions`, `gestures`,
  `cameraMotion`, `sceneCutEvents`, `ocrText` is the array-always exception — see `ai/ocr.md`):
  `null` on total failure, `[]`/populated array otherwise. The corresponding `*Features` derived
  summary is `null` exactly when its raw column is `null`.
- **`Prisma.JsonNull`, not plain `null`** — writing an explicit SQL `NULL` to a `Json?` column
  requires Prisma's `Prisma.JsonNull` sentinel; a bare `null` is ambiguous with "field not
  provided" to Prisma's client. Every adapter that clears a Json column on detector failure uses
  this (`facialEmotions: facialEmotions ?? Prisma.JsonNull`).
- **"Module throws, adapter catches"** — subprocess-backed modules (`detectFaces`,
  `detectFacialEmotion`, `detectGestures`, `detectFaceLandmarks`, `detectCameraMotion`) propagate
  errors up; the *adapter* in `render-clip.worker.ts` wraps each call in its own try/catch so one
  failing detector never fails the whole render job. ffmpeg-based modules
  (`detectSceneCuts`, `classifySceneCutTypes`, `analyzeMotionEnergy`) instead swallow their own
  failures internally and return an empty result — a deliberate split, not an inconsistency: pure
  ffmpeg calls have a much narrower failure surface than a full Python/model subprocess.

## The TS2742 Prisma pitfall

Adding a new `Json?` column to `Clip`/`Video` in `schema.prisma` reliably breaks `apps/api`'s
`nest build` with `error TS2742` ("inferred type ... cannot be named without a reference to
.../prisma/client/runtime") wherever that field leaks through an unnarrowed `...clip` /
`...video` spread. Recurred well over a dozen times across the AI Fusion roadmap. The fix is
always the same: destructure the new field out of the spread, and write a small
`toShared<FieldName>()` narrowing function in `apps/api/src/videos/transcript-segment.util.ts`,
used by both `VideosService.mapVideoWithClips` and `ClipsService.toDto`. **New fields added to an
already-`Json?` column** (e.g. adding `eyeContactRate` to the existing `faceLandmarkFeatures` blob)
do *not* trigger this — only a brand-new Json *column* does. Run `apps/api`'s `nest build`
(declaration emit), not just `tsc --noEmit`, to catch this — a plain typecheck can miss it.

## Enum mapping rules (Contract Governance)

Every enum shared across a Prisma ↔ `packages/shared` ↔ frontend boundary follows the same
"Mirrors X" convention: Prisma generates one enum, `packages/shared` declares a second, nominally
distinct TS enum with identical string members (never imports Prisma's directly — `apps/web` has
no dependency on `@speedora/database`/`@speedora/contracts`). This split is deliberate, but it is
also exactly the shape of the bug that crashed `ActivityTimeline` on `WORKSPACE_DELETED`
(`47a3b97`) and that the 2026-08-01 Contract Governance audit (Sprint 1-3) found live instances of
in `AuditAction` (4 missing members) and `FaceReviewPanel.tsx`'s emotion labels (wrong taxonomy).
The rules below are what closes that bug class for good — not a one-off fix, a standing convention:

1. **Never cast across the boundary with `as unknown as` or `as never`.** Both are the same escape
   hatch spelled differently — a value of type `never`/`unknown` is assignable to anything, so
   either bypasses all type checking at exactly the point where a real mismatch would need to be
   caught. Write an explicit mapper instead (see `dashboard.service.ts`'s `mapActivityEventType` as
   the reference implementation, or `notifications-v2.service.ts`'s cluster of `mapNotification*`
   functions for the multi-enum version): a `switch` over the Prisma-typed input with **no
   `default` case**, each branch returning the matching `packages/shared` member, ending in
   `default: return assertNever(value)`. Adding a new `schema.prisma` member then fails
   `nest build`/`tsc --noEmit` at the mapper's own `assertNever` call — before it ever reaches a
   consumer — instead of surfacing as a runtime `undefined`.
2. **Every enum-keyed display registry (icon/label/color/tone/badge) is `Record<Enum, ...>`, never
   `Record<string, ...>` or `Partial<Record<Enum, ...>>`.** A plain `Record<string, ...>` compiles
   even when new members are missing; a `Partial` compiles even when *no* members are covered.
   Neither forces the compiler to reject an incomplete registry the way a full `Record<Enum, ...>`
   does. If the closed type lives in a package `apps/web` can't depend on (`@speedora/contracts`,
   or an internal `apps/api` type like `AuthMethod`), mirror it as a local string-literal union in
   the same file rather than loosening the Record — see `lib/clip-library.ts`'s `FacialEmotion` or
   `app/accounts/page.tsx`'s `AuthMethod`.
3. **Treat every value read off an API response as untrusted, even though its DTO type claims
   otherwise.** A `NotificationDto['type']` typed as `NotificationType` is still just a `string` on
   the wire — a live frontend/backend version skew (the API ships a new enum member before this
   frontend bundle rebuilds) can put a value through that TypeScript's static type never accounted
   for. Every consumer of a `Record<Enum, ...>` fed by API data needs a paired runtime-safe getter
   (`isKnownX(value): value is Enum` + `getX(value)` that checks membership, falls back to a
   default, and `console.warn`s) rather than indexing the Record directly — see
   `lib/notification-definitions.ts`'s `isKnownNotificationType`/`getNotificationIcon`/
   `getNotificationLabel` or `lib/activity-events.ts`'s `isKnownActivityEventType`. This matters
   most where the lookup result is rendered as a JSX component (`const Icon = MAP[x]; return
   <Icon />`) — an `undefined` there throws "Element type is invalid," not a blank label. A
   registry driven by the frontend's own enum iteration (`Object.values(SomeEnum).map(...)`, as
   `NotificationFilterBar.tsx`/`NotificationPreferencesTab.tsx` do) never needs this — the risk is
   specific to indexing with a value that *came from* an API response.
4. **Compile-time exhaustiveness and the runtime getter are both required, neither replaces the
   other.** The mapper/`Record<Enum, ...>` pair (rules 1-2) is what makes the *next* enum addition
   fail loudly at build time; the runtime getter (rule 3) is what keeps a live deploy from crashing
   during the window where an already-built frontend is still serving traffic against a newer
   backend. Skipping either one reopens exactly the gap this section exists to close.

## `apps/web` exhaustive-map gotcha

Components with a `Record<keyof SomeSharedType, ...>` map (e.g. `TimelineEditor.tsx`'s and
`VideoAnalysisDashboard.tsx`'s `SCORE_LABELS: Record<keyof ClipScores, string>`) will fail
`next build`'s type-check the moment a new key is added to that shared type in `packages/shared`,
even if nothing in `apps/web` was touched. Always run the full monorepo build
(`pnpm -r build`), not just the app you meant to change, whenever a `packages/shared` type
changes.
