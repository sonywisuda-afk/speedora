import type { Clip, PrismaClient, Video, VideoStatusEvent } from './generated/prisma/client';

// Notification Center v2 - the Smart Timeline. Deliberately derived at read
// time from data that already exists (VideoStatusEvent - this codebase's
// existing durable per-transition audit trail - plus Video's own progress
// columns and Clip.outputUrl) rather than a second, duplicated event log -
// see schema.prisma's own comment on why Notification.groupKey addresses a
// thread instead of a dedicated NotificationThread table.
//
// Only 5 stages have genuine, already-observable signal today, per this
// codebase's frozen-AI-pipeline constraint: nothing here reads inside
// transcribe/detect-clips/render-clip's actual AI logic (audio analysis,
// OCR, face detection, fusion scoring) - AI_CLIP_ANALYSIS is one honest
// aggregate stage over the real CLIPS_DETECTED transition (the job that
// already runs LLM-based clip/highlight scoring), not a fabricated
// "Audio Analysis"/"OCR Detection"/"Face Detection"/"Fusion Engine" row.
//
// Extensibility: `stage` is a plain string, not a closed union enforced by
// the DB/API contract, and both this function's return shape and every
// frontend renderer iterate `stages` generically. Once the AI pipeline is
// unfrozen and starts durably recording a real sub-event (e.g. an OCR/face-
// detection timestamp), adding it is exactly one more entry pushed into the
// array below, sourced from whatever new column/log that future work adds -
// zero change needed to this DTO shape, the SSE payload, the API contract,
// or any component. Nothing speculative (e.g. a generic "AI event" table) is
// built now; only the contract is kept loose enough to not need a refactor.
export type TimelineStageStatus = 'done' | 'active' | 'pending' | 'failed';

export interface TimelineStageDto {
  stage: string;
  label: string;
  status: TimelineStageStatus;
  startedAt: string | null;
  completedAt: string | null;
  progressPercent: number | null;
  detail: string | null;
}

// Notification Center v2 Phase 2 (Notification Engine) - one entry per
// FAILED VideoStatusEvent this video's real audit trail has ever recorded,
// oldest first - not just the most recent one findFailure() below resolves
// for the CURRENT overallStatus. A video that failed, was retried, and later
// succeeded has overallStatus: 'completed' and every `stages` entry 'done',
// but failureHistory still remembers it wasn't a clean run - retry history
// is never silently lost. "Real data only" here means exposing more of what
// VideoStatusEvent already durably owns, never inventing a new column to
// duplicate it.
export interface PipelineFailureHistoryEntry {
  stage: string;
  reason: string | null;
  occurredAt: string;
}

export interface PipelineTimelineDto {
  videoId: string;
  overallStatus: 'in_progress' | 'completed' | 'failed';
  failureReason: string | null;
  failureHistory: PipelineFailureHistoryEntry[];
  stages: TimelineStageDto[];
}

// Known stage ids today - exported so callers (API/frontend) can reference
// them by name without hardcoding string literals, without this being a
// closed type the DTO itself is constrained to.
export const PIPELINE_STAGE = {
  UPLOAD_STARTED: 'UPLOAD_STARTED',
  UPLOAD_COMPLETED: 'UPLOAD_COMPLETED',
  TRANSCRIBING: 'TRANSCRIBING',
  AI_CLIP_ANALYSIS: 'AI_CLIP_ANALYSIS',
  RENDERING: 'RENDERING',
} as const;

// Ranks the 6 non-terminal, non-FAILED VideoStatus values in real pipeline
// order (see packages/database/prisma/schema.prisma's VideoStatus enum and
// the real updateVideoStatus() call graph across apps/worker's stage
// workers). FAILED is handled separately (see findFailure below) since it
// can be reached from any rank.
const STATUS_RANK: Record<string, number> = {
  IMPORTING: 0,
  UPLOADED: 1,
  PENDING_SETTINGS: 2,
  TRANSCRIBED: 3,
  CLIPS_DETECTED: 4,
  RENDERED: 5,
};

// Which timeline stage was "in flight" (and therefore the one that failed)
// when a FAILED event immediately follows the given prior status. UPLOADED
// and PENDING_SETTINGS both map to TRANSCRIBING since probe-video's
// PENDING_SETTINGS transition is an internal sub-step of "getting to a real
// transcript", not its own exposed timeline row.
const FAILURE_STAGE_MAP: Record<string, string> = {
  IMPORTING: PIPELINE_STAGE.UPLOAD_COMPLETED,
  UPLOADED: PIPELINE_STAGE.TRANSCRIBING,
  PENDING_SETTINGS: PIPELINE_STAGE.TRANSCRIBING,
  TRANSCRIBED: PIPELINE_STAGE.AI_CLIP_ANALYSIS,
  CLIPS_DETECTED: PIPELINE_STAGE.RENDERING,
};

type StatusEventInput = Pick<VideoStatusEvent, 'toStatus' | 'errorMessage' | 'createdAt'>;

function latestEventFor(events: StatusEventInput[], status: string): StatusEventInput | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].toStatus === status) return events[i];
  }
  return null;
}

// Walking backwards for the most recent FAILED event (a retried job can fail
// more than once) and the status it immediately followed - "the latest
// occurrence of each status wins," same convention the rank lookups below
// use, so a retry's current attempt is always what's reflected.
function findFailure(
  events: StatusEventInput[],
): { reason: string | null; afterStatus: string | null } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].toStatus === 'FAILED') {
      return {
        reason: events[i].errorMessage ?? null,
        afterStatus: i > 0 ? events[i - 1].toStatus : null,
      };
    }
  }
  return null;
}

// Every FAILED event in this video's real audit trail, oldest first - not
// just the latest one findFailure() resolves. Reuses the exact same
// FAILURE_STAGE_MAP lookup so "which stage was in flight" is derived
// identically for the current failure and every past one.
function deriveFailureHistory(events: StatusEventInput[]): PipelineFailureHistoryEntry[] {
  const history: PipelineFailureHistoryEntry[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].toStatus !== 'FAILED') continue;
    const afterStatus = i > 0 ? events[i - 1].toStatus : null;
    history.push({
      stage: FAILURE_STAGE_MAP[afterStatus ?? ''] ?? PIPELINE_STAGE.UPLOAD_COMPLETED,
      reason: events[i].errorMessage ?? null,
      occurredAt: events[i].createdAt.toISOString(),
    });
  }
  return history;
}

export function computePipelineTimeline(input: {
  video: Pick<Video, 'id' | 'status' | 'createdAt' | 'importProgress' | 'transcribeProgress'>;
  statusEvents: StatusEventInput[];
  clips: Pick<Clip, 'outputUrl'>[];
}): PipelineTimelineDto {
  const { video, statusEvents, clips } = input;
  const isFailed = video.status === 'FAILED';
  const failure = isFailed ? findFailure(statusEvents) : null;
  const failedStage = failure
    ? (FAILURE_STAGE_MAP[failure.afterStatus ?? ''] ?? PIPELINE_STAGE.UPLOAD_COMPLETED)
    : null;

  // The current rank while healthy is just the video's own status (the
  // single source of truth updateVideoStatus() maintains); while failed, use
  // the rank of the last status successfully reached before the failure.
  const currentRank = isFailed
    ? failure?.afterStatus
      ? (STATUS_RANK[failure.afterStatus] ?? -1)
      : -1
    : (STATUS_RANK[video.status] ?? -1);

  function statusFor(targetRank: number, stage: string): TimelineStageStatus {
    if (failedStage === stage) return 'failed';
    if (currentRank >= targetRank) return 'done';
    if (currentRank === targetRank - 1) return 'active';
    return 'pending';
  }

  const uploadStarted: TimelineStageDto = {
    stage: PIPELINE_STAGE.UPLOAD_STARTED,
    label: 'Upload Started',
    status: 'done',
    startedAt: video.createdAt.toISOString(),
    completedAt: video.createdAt.toISOString(),
    progressPercent: null,
    detail: null,
  };

  const importingEvent = latestEventFor(statusEvents, 'IMPORTING');
  const uploadedEvent = latestEventFor(statusEvents, 'UPLOADED');
  const uploadCompletedStatus = statusFor(STATUS_RANK.UPLOADED, PIPELINE_STAGE.UPLOAD_COMPLETED);
  const uploadCompleted: TimelineStageDto = {
    stage: PIPELINE_STAGE.UPLOAD_COMPLETED,
    label: 'Upload Completed',
    status: uploadCompletedStatus,
    startedAt:
      (importingEvent ?? uploadedEvent)?.createdAt.toISOString() ?? video.createdAt.toISOString(),
    completedAt:
      uploadCompletedStatus === 'done' ? (uploadedEvent?.createdAt.toISOString() ?? null) : null,
    progressPercent: uploadCompletedStatus === 'active' ? (video.importProgress ?? null) : null,
    detail: uploadCompletedStatus === 'failed' ? (failure?.reason ?? null) : null,
  };

  const pendingSettingsEvent = latestEventFor(statusEvents, 'PENDING_SETTINGS');
  const transcribedEvent = latestEventFor(statusEvents, 'TRANSCRIBED');
  const transcribingStatus = statusFor(STATUS_RANK.TRANSCRIBED, PIPELINE_STAGE.TRANSCRIBING);
  // PENDING_SETTINGS specifically means "waiting for the user to submit
  // Processing Settings" (probe-video.worker.ts) - the transcribe job hasn't
  // started yet, so this isn't really "active" work in progress even though
  // it's the next stage in line.
  const awaitingSettings =
    !isFailed && video.status === 'PENDING_SETTINGS' && video.transcribeProgress == null;
  const transcribing: TimelineStageDto = {
    stage: PIPELINE_STAGE.TRANSCRIBING,
    label: 'Transcribing',
    status: awaitingSettings ? 'pending' : transcribingStatus,
    startedAt: (uploadedEvent ?? pendingSettingsEvent)?.createdAt.toISOString() ?? null,
    completedAt:
      transcribingStatus === 'done' ? (transcribedEvent?.createdAt.toISOString() ?? null) : null,
    progressPercent:
      transcribingStatus === 'active' && !awaitingSettings
        ? (video.transcribeProgress ?? null)
        : null,
    detail: awaitingSettings
      ? 'Waiting for processing settings'
      : transcribingStatus === 'failed'
        ? (failure?.reason ?? null)
        : null,
  };

  const clipsDetectedEvent = latestEventFor(statusEvents, 'CLIPS_DETECTED');
  const aiClipAnalysisStatus = statusFor(
    STATUS_RANK.CLIPS_DETECTED,
    PIPELINE_STAGE.AI_CLIP_ANALYSIS,
  );
  const aiClipAnalysis: TimelineStageDto = {
    stage: PIPELINE_STAGE.AI_CLIP_ANALYSIS,
    label: 'AI Clip Analysis',
    status: aiClipAnalysisStatus,
    startedAt: transcribedEvent?.createdAt.toISOString() ?? null,
    completedAt:
      aiClipAnalysisStatus === 'done'
        ? (clipsDetectedEvent?.createdAt.toISOString() ?? null)
        : null,
    // No per-unit signal exists for this stage today (the LLM clip/highlight
    // scoring job reports no progress) - always null, never fabricated. The
    // UI renders an indeterminate spinner here while active.
    progressPercent: null,
    detail: aiClipAnalysisStatus === 'failed' ? (failure?.reason ?? null) : null,
  };

  const renderedEvent = latestEventFor(statusEvents, 'RENDERED');
  const renderingStatus = statusFor(STATUS_RANK.RENDERED, PIPELINE_STAGE.RENDERING);
  const renderedClips = clips.filter((clip) => clip.outputUrl != null).length;
  const rendering: TimelineStageDto = {
    stage: PIPELINE_STAGE.RENDERING,
    label: 'Rendering',
    status: renderingStatus,
    startedAt: clipsDetectedEvent?.createdAt.toISOString() ?? null,
    completedAt:
      renderingStatus === 'done' ? (renderedEvent?.createdAt.toISOString() ?? null) : null,
    progressPercent:
      renderingStatus === 'active' && clips.length > 0
        ? Math.round((100 * renderedClips) / clips.length)
        : null,
    detail:
      renderingStatus === 'failed'
        ? (failure?.reason ?? null)
        : clips.length > 0
          ? `${renderedClips} of ${clips.length} clips rendered`
          : null,
  };

  const overallStatus: PipelineTimelineDto['overallStatus'] = isFailed
    ? 'failed'
    : video.status === 'RENDERED'
      ? 'completed'
      : 'in_progress';

  return {
    videoId: video.id,
    overallStatus,
    failureReason: failure?.reason ?? null,
    failureHistory: deriveFailureHistory(statusEvents),
    stages: [uploadStarted, uploadCompleted, transcribing, aiClipAnalysis, rendering],
  };
}

export async function fetchPipelineTimeline(
  prisma: Pick<PrismaClient, 'video' | 'videoStatusEvent' | 'clip'>,
  videoId: string,
): Promise<PipelineTimelineDto> {
  const [video, statusEvents, clips] = await Promise.all([
    prisma.video.findUniqueOrThrow({
      where: { id: videoId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        importProgress: true,
        transcribeProgress: true,
      },
    }),
    prisma.videoStatusEvent.findMany({
      where: { videoId },
      orderBy: { createdAt: 'asc' },
      select: { toStatus: true, errorMessage: true, createdAt: true },
    }),
    prisma.clip.findMany({ where: { videoId }, select: { outputUrl: true } }),
  ]);

  return computePipelineTimeline({ video, statusEvents, clips });
}
