import type { WatermarkPosition } from './brand-kit';
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
}

// videoId is created (status IMPORTING, placeholder sourceUrl) by
// VideosService.importFromYoutube() before this is enqueued, same pattern
// as every other job in this pipeline - the job re-fetches/updates that
// row rather than carrying a snapshot of it.
export interface ImportYoutubeJobData {
  videoId: string;
  url: string;
  // Set once at video creation (see Video.transcriptionProvider) and
  // forwarded to the transcribe job this one self-chains into on success -
  // this job never calls Whisper itself, but it's the thing that must carry
  // the choice across the handoff.
  provider: TranscriptionProvider;
}

export interface ImportYoutubeJobResult {
  videoId: string;
  sourceUrl: string;
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
