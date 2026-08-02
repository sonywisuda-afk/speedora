import type { IntroType, WatermarkPosition } from './brand-kit';
import type {
  CaptionStyle,
  ClipCandidate,
  ClipScores,
  TranscriptSegment,
  TranscriptionProvider,
} from './video';

export enum QueueName {
  // Only enqueued by apps/api's POST /videos/import-youtube - self-chains
  // into TRANSCRIBE on success, same as every other stage in this pipeline.
  IMPORT_YOUTUBE = 'import-youtube',
  // Quality Validation roadmap (Fase 0 design, Phase 1) - enqueued by
  // apps/api's upload()/importFromYoutube() (replacing what used to be a
  // direct TRANSCRIBE enqueue) and self-chained into by IMPORT_YOUTUBE on
  // success, same producers TRANSCRIBE itself used to have. Does NOT
  // self-chain into TRANSCRIBE on success - the one deliberate break from
  // this enum's otherwise-universal "self-chain to the next stage
  // automatically" convention, since this is the one stage that must stop
  // and wait for a human decision (Processing Settings' POST
  // /videos/:id/start-processing enqueues TRANSCRIBE instead).
  PROBE_VIDEO = 'probe-video',
  TRANSCRIBE = 'transcribe',
  DETECT_CLIPS = 'detect-clips',
  RENDER_CLIP = 'render-clip',
  PUBLISH_CLIP = 'publish-clip',
  // Fase 6c - a repeatable trigger (no per-firing payload) that polls
  // Postgres for due SCHEDULED PublishRecords; see
  // apps/worker/src/workers/schedule-publish-clip.worker.ts.
  SCHEDULE_PUBLISH_CLIP = 'schedule-publish-clip',
  // Fase 6e - a repeatable trigger (no per-firing payload) that refreshes
  // view/like/comment counts for PUBLISHED PublishRecords; see
  // apps/worker/src/workers/sync-publish-stats.worker.ts.
  SYNC_PUBLISH_STATS = 'sync-publish-stats',
  // Sprint 03c (Export Center roadmap) - produced exclusively by apps/api's
  // POST /export (never self-enqueued by apps/worker, unlike every queue
  // above), consumed by apps/worker/src/export-generate/export-generate.worker.ts.
  EXPORT_GENERATE = 'export-generate',
  // Sprint 4C (Alert Engine) - a repeatable trigger (no per-firing payload),
  // same shape as SCHEDULE_PUBLISH_CLIP/SYNC_PUBLISH_STATS above, that
  // evaluates every registered AlertRule; see
  // apps/worker/src/workers/alert-engine.worker.ts.
  ALERT_ENGINE = 'alert-engine',
  // Milestone 04d - produced by recordNotification()'s deps.enqueueDelivery
  // (apps/api's 2 direct call sites, apps/worker's 4), consumed by
  // apps/worker/src/workers/notification-delivery.worker.ts. Same "apps/api
  // is sole producer, apps/worker sole consumer" shape as EXPORT_GENERATE.
  NOTIFICATION_DELIVERY = 'notification-delivery',
  // Milestone 04e (Telegram) - a repeatable trigger (no per-firing payload),
  // same shape as ALERT_ENGINE above, that polls Telegram's getUpdates for
  // every NotificationWebhook row still awaiting chat_id discovery; see
  // apps/worker/src/workers/telegram-chat-discovery.worker.ts.
  TELEGRAM_CHAT_DISCOVERY = 'telegram-chat-discovery',
  // Publishing Expansion Phase 7B (AI SEO) - produced exclusively by
  // apps/api's POST /clips/:id/platform-copy, same "apps/api sole producer,
  // apps/worker sole consumer" shape as EXPORT_GENERATE/NOTIFICATION_DELIVERY.
  // A brand-new, standalone LLM call - never touches Clip.scores/
  // viralityScore/highlightScore or the frozen detect-clips prompt.
  GENERATE_PLATFORM_COPY = 'generate-platform-copy',
  // Sprint 6F (Analytics Dashboard Expansion - Followers) - a repeatable
  // trigger (no per-firing payload), same shape as SYNC_PUBLISH_STATS above
  // but daily (not every 6h - follower counts don't need that freshness)
  // and keyed on SocialAccount, not PublishRecord; see
  // apps/worker/src/workers/sync-follower-count.worker.ts.
  SYNC_FOLLOWER_COUNT = 'sync-follower-count',
  // Subtitle Studio roadmap (P2f) - one LLM call translating a video's
  // whole transcript into one language, enqueued by
  // VideosService.translateTranscript (never self-chained). No dedicated
  // status row (unlike GENERATE_PLATFORM_COPY's ClipPlatformCopy) - the
  // client polls GET /videos/:id/transcript and treats "every segment has
  // translations[languageCode]" as done, same "poll the resource itself"
  // convention as IMPORT_YOUTUBE.
  TRANSLATE_TRANSCRIPT = 'translate-transcript',
  // Generate More Clips roadmap (Phase C) - enqueued by
  // VideosService.generateMore (apps/api) only after synchronously
  // validating the video is RENDERED and not already mid-render; never
  // self-chained by any other queue. Deliberately NOT the same queue as
  // DETECT_CLIPS - that worker's idempotency guard (skip unless
  // Video.status === TRANSCRIBED) exists specifically to stop a duplicate
  // LLM call on a BullMQ stalled-job re-run, and reusing it for a video
  // that's already RENDERED would either silently no-op or require
  // weakening that guard for an unrelated purpose. On success, self-chains
  // one RENDER_CLIP per new candidate only - same "one job per candidate,
  // independent failure domains" shape as DETECT_CLIPS's own self-chain.
  GENERATE_MORE_CLIPS = 'generate-more-clips',
  // PR #45 (Production Metrics Collection, post-Oracle-hybrid-Fase-3
  // roadmap) - a repeatable trigger (no per-firing payload), same shape as
  // ALERT_ENGINE/SYNC_FOLLOWER_COUNT above, that periodically snapshots
  // every queue's counts/metrics and every live worker heartbeat into
  // Postgres (QueueSnapshot/WorkerHeartbeatSnapshot); see
  // apps/worker/src/workers/metrics-snapshot.worker.ts. Deliberately
  // read-only data collection - no analysis, alerting, or scaling
  // decisions happen here (see that file's own comment).
  METRICS_SNAPSHOT = 'metrics-snapshot',
}

// videoId is created (status IMPORTING, placeholder sourceUrl) by
// VideosService.importFromYoutube() before this is enqueued, same pattern
// as every other job in this pipeline - the job re-fetches/updates that
// row rather than carrying a snapshot of it.
export interface ImportYoutubeJobData {
  videoId: string;
  url: string;
  // Set once at video creation (see Video.transcriptionProvider) - kept on
  // this job's data for symmetry with every other job in this pipeline,
  // even though import-youtube.worker.ts no longer forwards it anywhere:
  // since the Quality Validation roadmap (Fase 0, Phase 1), this job
  // self-chains into PROBE_VIDEO (which doesn't call Whisper) instead of
  // TRANSCRIBE directly. Whichever job eventually enqueues TRANSCRIBE
  // (apps/api's start-processing endpoint) re-reads Video.transcriptionProvider
  // fresh rather than threading it through this payload.
  provider: TranscriptionProvider;
}

export interface ImportYoutubeJobResult {
  videoId: string;
  sourceUrl: string;
}

// Download Reliability Framework - the outer, job-level retry layer. This is
// deliberately separate from @speedora/video-import-engine's own in-process
// withRetry (packages/video-import-engine/src/retry.ts, ~2 quick retries
// within one job execution for a transient blip): this one survives a
// worker crash/restart mid-job, which would otherwise silently lose all
// in-process retry state and permanently fail the import (the actual gap
// this framework closes). Coordination: import-youtube.worker.ts throws
// bullmq's own UnrecoverableError for any VideoImportError.retryable ===
// false, which skips these attempts entirely regardless of how many remain
// - so this attempts/backoff pair only ever actually retries the categories
// already listed in errors.ts's RETRYABLE_CATEGORIES (network/rate_limited/
// timeout/internal). Same delay-type/shape as PUBLISH_RETRY_OPTIONS below,
// just a longer base delay (60s, not 30s) - a stalled/crashed worker or a
// rate-limit/AV-scan condition needs more real time to clear than a
// transient social-platform API blip does.
export const IMPORT_YOUTUBE_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
};

// Quality Validation roadmap - PROBE_VIDEO's own job-level retry layer, same
// "outer retry survives a worker crash/restart mid-job" reasoning as
// IMPORT_YOUTUBE_RETRY_OPTIONS above. Without this, every one of this
// queue's 3 enqueue sites (VideosService.upload/importFromYoutube,
// import-youtube.worker.ts's own self-chain) passed no options at all,
// which BullMQ defaults to attempts: 0 - a single transient ffprobe crash
// (e.g. AV-scan interference on Windows, the same
// empty-stderr/no-explanation crash shape as yt-dlp's own 'internal'
// category) permanently failed the video on the very first hiccup, with no
// automatic recovery. Genuinely deterministic failures (no video/audio
// stream, unreadable duration) are thrown as bullmq's own
// UnrecoverableError directly by probe-video.worker.ts and skip these
// attempts entirely, same coordination IMPORT_YOUTUBE_RETRY_OPTIONS
// documents for VideoImportError.retryable === false. Shorter base delay
// than IMPORT_YOUTUBE_RETRY_OPTIONS (30s, not 60s) - this is a local
// subprocess crash, not a network/rate-limit condition, so it needs less
// real time to clear.
export const PROBE_VIDEO_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Reliability hardening pass - TRANSCRIBE's own job-level retry layer, same
// gap/fix shape as PROBE_VIDEO_RETRY_OPTIONS above (this queue's 2 enqueue
// sites, VideosService.startProcessing/retry, both passed no options -
// BullMQ default attempts: 0). This job runs several ffmpeg subprocess
// calls (thumbnail/storyboard/animated/hover-preview extraction) plus the
// Whisper API upload, so it carries the same local-subprocess-crash risk
// class as PROBE_VIDEO, hence the same 30s base delay (not
// IMPORT_YOUTUBE_RETRY_OPTIONS's 60s, which is sized for a crashed/
// restarted worker or platform rate-limiting, not applicable here). The one
// deterministic failure this worker already throws (a missing
// OPENAI_API_KEY when premium transcription is requested) is thrown as
// UnrecoverableError directly by transcribe.worker.ts and skips these
// attempts entirely, same coordination as PROBE_VIDEO_RETRY_OPTIONS.
export const TRANSCRIBE_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Reliability hardening pass - RENDER_CLIP's own job-level retry layer, same
// gap/fix shape as PROBE_VIDEO_RETRY_OPTIONS above. This queue invokes
// ffmpeg directly (the main crop/caption/B-roll encode, plus up to 3 more
// passes for Smart Trim/intro/outro) - the exact same local-subprocess-
// crash risk class PROBE_VIDEO_RETRY_OPTIONS exists for, hence the same
// profile. render-clip.worker.ts has no deterministic (UnrecoverableError)
// failure mode today - every error defaults retryable, same "unknown error
// defaults retryable" convention import-youtube.worker.ts already uses.
export const RENDER_CLIP_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Reliability hardening pass - DETECT_CLIPS's own job-level retry layer,
// same gap/fix shape as PROBE_VIDEO_RETRY_OPTIONS above. This queue's risk
// is a single LLM network call (packages/clip-scoring), not a local
// subprocess crash - the same transient-failure shape PUBLISH_RETRY_OPTIONS
// already covers for social-platform API calls, hence the matching 30s
// profile rather than IMPORT_YOUTUBE_RETRY_OPTIONS's longer 60s.
export const DETECT_CLIPS_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Reliability hardening pass - GENERATE_MORE_CLIPS's own job-level retry
// layer. Same single-LLM-call risk class as DETECT_CLIPS_RETRY_OPTIONS
// (reuses its profile), but unlike EXPORT_GENERATE/GENERATE_PLATFORM_COPY/
// TRANSLATE_TRANSCRIPT's deliberate "no retry, user re-triggers via a new
// POST" convention, this worker never writes a visible FAILED status on
// error at all (a failed top-up must not regress Video.status - see
// generate-more-clips.worker.ts's own comment) - so without an automatic
// retry, a transient failure here is invisible to the user entirely, not
// just requiring a manual re-trigger. Automatic retry is the better default
// given that visibility gap.
export const GENERATE_MORE_CLIPS_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Quality Validation roadmap (Fase 0 design, Phase 1) - videoId is created
// (status UPLOADED, sourceUrl already a real object-storage key) by
// VideosService.upload()/importFromYoutube() before this is enqueued, same
// "job re-fetches/updates the row rather than carrying a snapshot"
// convention as ImportYoutubeJobData above.
export interface ProbeVideoJobData {
  videoId: string;
  sourceUrl: string;
}

export interface ProbeVideoJobResult {
  videoId: string;
}

export interface TranscribeJobData {
  videoId: string;
  sourceUrl: string;
  // Set once at video creation (see Video.transcriptionProvider) and passed
  // straight through here, same as sourceUrl above - fixed for the video's
  // whole lifetime, so there's no risk of it drifting from a fresh re-fetch.
  provider: TranscriptionProvider;
}

export interface TranscribeJobResult {
  videoId: string;
  segments: TranscriptSegment[];
}

export interface DetectClipsJobData {
  videoId: string;
  segments: TranscriptSegment[];
}

export interface DetectClipsJobResult {
  videoId: string;
  candidates: ClipCandidate[];
}

export interface RenderClipJobData {
  clipId: string;
  videoId: string;
  sourceUrl: string;
  startTime: number;
  endTime: number;
  transcript: TranscriptSegment[];
  captionStyle: CaptionStyle;
  // Subtitle Studio roadmap (P2c) - burns speaker-colored captions in when
  // true, orthogonal to captionStyle (see Clip.speakerColorCaptions).
  speakerColorCaptions: boolean;
  // Subtitle Studio roadmap (P2f) - which TranscriptSegment.translations key
  // to burn in; undefined/null means the original (untranslated) text.
  captionLanguage: string | null;
  // Brand Kit roadmap (P3a) - resolved once at enqueue time from the video
  // owner's User.brandFontFamily when Clip.applyBrandKit is true, else null
  // - same "resolve once, worker never re-fetches" shape as captionStyle/
  // speakerColorCaptions above. null means "use build-ass.ts's own default"
  // (Inter), not "no font" - buildAssInputSchema's fontFamily field defaults
  // to Inter itself, this is just the caller-facing optional-ness of that.
  fontFamily: string | null;
  // Watermark roadmap (P3c) - resolved once at enqueue time from the owner's
  // Brand Kit when Clip.watermarkEnabled is true and a watermark is
  // configured (see ClipsService.resolveWatermark's precedence) - null
  // means "no watermark for this render" (opted out, or nothing configured).
  watermark: {
    key: string;
    opacity: number;
    scale: number;
    margin: number;
    position: WatermarkPosition;
  } | null;
  // Intro roadmap (P3d) - resolved once at enqueue time from the owner's
  // Brand Kit when Clip.introEnabled is true and an intro is configured
  // (see ClipsService.resolveIntro's precedence) - null means "no intro for
  // this render". imageDurationSeconds only matters when type is 'image'
  // (see BrandKitDto's own comment); a video intro's duration is re-derived
  // (and capped) fresh by apps/worker at render time, never carried here.
  intro: {
    key: string;
    type: IntroType;
    imageDurationSeconds: number | null;
  } | null;
  // Outro roadmap (P3e) - same shape/reasoning as intro above, applied at
  // the end of the render instead of the start.
  outro: {
    key: string;
    type: IntroType;
    imageDurationSeconds: number | null;
  } | null;
  // Fase 15 (Auto B-roll) - the clip's own Fase 8 keywords, used to search
  // for matching stock footage moments (see broll.ts's findBRollMoments).
  // Empty for a clip whose Content Intelligence LLM call never ran/found
  // none - B-roll is simply skipped for it, not an error.
  keywords: string[];
  // Fase 32 (Mini Fusion Engine v2's 'llm' signal) - the clip's own Fase 8
  // Content Intelligence scores, threaded through so render-clip can feed
  // them into computeHighlightScore alongside the audio/scene/facial/
  // gesture signals it already computes itself. Null for a clip whose
  // detect-clips LLM call never ran/produced no scores - the llm signal is
  // simply skipped for it, not an error, same convention as keywords above.
  scores: ClipScores | null;
}

export interface RenderClipJobResult {
  clipId: string;
  outputUrl: string;
}

// publish-clip enqueues by publishRecordId only, not clip/account details -
// the PublishRecord row (created synchronously by ClipsService.publish()
// before enqueueing, so it exists immediately for the UI to poll) is the
// single source of truth for everything the job needs to look up.
export interface PublishClipJobData {
  publishRecordId: string;
}

export interface PublishClipJobResult {
  publishRecordId: string;
  platformPostId: string;
}

// export-generate enqueues by exportJobId only, not video/type details - the
// ExportJob row (created synchronously by ExportService.create() before
// enqueueing, so it exists immediately for the client to poll) is the single
// source of truth, same "id-only, DB row is truth" convention as
// PublishClipJobData above. Deliberately no equivalent to
// PUBLISH_RETRY_OPTIONS - a failed export just marks the row FAILED; the
// user re-triggers via a new POST /export, matching every pipeline job
// except publish-clip.
export interface ExportGenerateJobData {
  exportJobId: string;
}

export interface ExportGenerateJobResult {
  exportJobId: string;
  resultUrl: string;
}

// Shared by every enqueuer of publish-clip - apps/api's ClipsService.publish()
// (immediate "publish now") and apps/worker's schedule-publish-clip poller
// (a scheduled publish whose time has arrived) both need the exact same
// automatic-retry config, so it lives here rather than being duplicated (or
// worse, drifting) between the two apps. A transient failure calling a
// social platform's API (rate limit, a temporary 5xx) shouldn't need a human
// to notice and manually retry, unlike every other job in this codebase.
export const PUBLISH_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

// Milestone 04d - notification-delivery enqueues by notificationId only, not
// channel/payload details - the Notification row (already written by
// recordNotification() before enqueueing) is the single source of truth,
// same "id-only, DB row is truth" convention as PublishClipJobData/
// ExportGenerateJobData above. Lighter/faster backoff than
// PUBLISH_RETRY_OPTIONS - this is a best-effort nudge to a third-party chat
// webhook, not a user-visible publish action.
export interface NotificationDeliveryJobData {
  notificationId: string;
}

export const NOTIFICATION_DELIVERY_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
};

// Publishing Expansion Phase 7B (AI SEO) - generate-platform-copy enqueues
// by clipPlatformCopyId only, not clip/platform details - the
// ClipPlatformCopy row (created synchronously by
// ClipsService.generatePlatformCopy() before enqueueing, so it exists
// immediately for the client to poll) is the single source of truth, same
// "id-only, DB row is truth" convention as ExportGenerateJobData/
// PublishClipJobData. No retry options - a failed generation just marks the
// row FAILED; the user re-triggers via a new POST, same as
// ExportGenerateJobData's own "no automatic retry" convention.
//
// Pre-Processing Settings roadmap (Phase 3) - no longer apps/api's sole
// producer: render-clip.worker.ts also enqueues this (via its own
// generatePlatformCopyQueue) when Video.processingOptions.seo
// .autoGeneratePlatformCopy is set, creating the ClipPlatformCopy row
// itself the same way ClipsService.generatePlatformCopy() does - the "DB
// row is truth" contract above is what makes a second producer safe, since
// this job data shape never had to change to support it.
export interface GeneratePlatformCopyJobData {
  clipPlatformCopyId: string;
}

// Subtitle Studio roadmap (P2f) - id-only, the worker re-fetches every
// TranscriptSegment for videoId fresh rather than trusting a payload
// snapshot (same reasoning as PublishClipJobData's own re-fetch).
export interface TranslateTranscriptJobData {
  videoId: string;
  languageCode: string;
}

// Generate More Clips roadmap (Phase C) - id-plus-params, not id-only: unlike
// ExportGenerateJobData/GeneratePlatformCopyJobData (which point at an
// already-created tracking row), there's no new tracking row for this
// request (see the roadmap's own "no new table" decision) - the request's
// own parameters have nowhere else to live, so they travel on the job data.
// The worker still re-fetches TranscriptSegment/Clip fresh rather than
// trusting any snapshot of them, same as every other job in this pipeline.
export interface GenerateMoreClipsJobData {
  videoId: string;
  requestedCount: number;
  minClipDurationSeconds?: number;
  maxClipDurationSeconds?: number;
  // "Prioritas kualitas" dialog field - reuses ClipScoringInput's existing
  // minConfidence, not a new scoring concept.
  minConfidence?: number;
  avoidOverlap: boolean;
}

export interface GenerateMoreClipsJobResult {
  videoId: string;
  candidateCount: number;
}
