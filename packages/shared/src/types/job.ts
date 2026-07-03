import type { CaptionStyle, ClipCandidate, TranscriptSegment } from './video';

export enum QueueName {
  TRANSCRIBE = 'transcribe',
  DETECT_CLIPS = 'detect-clips',
  RENDER_CLIP = 'render-clip',
  PUBLISH_CLIP = 'publish-clip',
}

export interface TranscribeJobData {
  videoId: string;
  sourceUrl: string;
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
