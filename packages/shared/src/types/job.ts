import type { CaptionStyle, ClipCandidate, TranscriptSegment, TranscriptionProvider } from './video';

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
  // Fase 15 (Auto B-roll) - the clip's own Fase 8 keywords, used to search
  // for matching stock footage moments (see broll.ts's findBRollMoments).
  // Empty for a clip whose Content Intelligence LLM call never ran/found
  // none - B-roll is simply skipped for it, not an error.
  keywords: string[];
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
