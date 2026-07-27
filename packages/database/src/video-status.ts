import {
  NotificationCategory,
  VideoStatus,
  type NotificationThreadStatus,
  type NotificationType,
  type Prisma,
  type PrismaClient,
} from './generated/prisma/client';
import {
  recordNotification,
  recordThreadNotification,
  type EnqueueDeliveryFn,
  type PublishNotificationFn,
} from './notification';

export interface PipelineThreadPresentation {
  type: NotificationType;
  category: NotificationCategory;
  threadStatus: NotificationThreadStatus;
  title: string;
  body: string;
}

// Notification Center v2 Phase 2 (Notification Engine) - the ONE place that
// maps a real VideoStatus transition onto the Smart Timeline thread's
// presentation. Every entry here corresponds to a status this pipeline can
// actually reach today (see the VideoStatus enum above) - nothing here is a
// fabricated AI sub-stage ("OCR Detection"/"Face Detection"/"Fusion Engine"
// don't appear because this pipeline has no durable per-video event for any
// of those yet - see notification-timeline.ts's own comment on the same
// "real data only" constraint). Shared by updateVideoStatus() below (every
// transition that goes through it: every stage worker's FAILED branch, plus
// every success transition that ISN'T inlined into its own atomic
// transaction) and by the two call sites whose success transition IS inlined
// elsewhere for reasons unrelated to notifications - transcribe.worker.ts's
// TRANSCRIBED write and render-clip.worker.ts's RENDERED write both import
// this function directly and call recordThreadNotification() themselves, so
// presentation never drifts between the two call paths.
export function derivePipelineThreadPresentation(
  status: VideoStatus,
  video: { title: string | null },
): PipelineThreadPresentation {
  const name = video.title ? `"${video.title}"` : 'video Anda';
  switch (status) {
    case VideoStatus.IMPORTING:
      return {
        type: 'PIPELINE_PROGRESS',
        category: NotificationCategory.UPLOAD,
        threadStatus: 'IN_PROGRESS',
        title: `Mengimpor ${name}`,
        body: 'Mengunduh video dari YouTube...',
      };
    case VideoStatus.UPLOADED:
      return {
        type: 'PIPELINE_PROGRESS',
        category: NotificationCategory.UPLOAD,
        threadStatus: 'IN_PROGRESS',
        title: `Memproses ${name}`,
        body: 'Upload selesai, mempersiapkan pemrosesan...',
      };
    case VideoStatus.PENDING_SETTINGS:
      return {
        type: 'PIPELINE_PROGRESS',
        category: NotificationCategory.UPLOAD,
        threadStatus: 'IN_PROGRESS',
        title: `Memproses ${name}`,
        body: 'Video siap diproses - silakan pilih pengaturan pemrosesan.',
      };
    case VideoStatus.TRANSCRIBED:
      return {
        type: 'PIPELINE_PROGRESS',
        category: NotificationCategory.AI_PROCESSING,
        threadStatus: 'IN_PROGRESS',
        title: `Memproses ${name}`,
        body: 'Transkripsi selesai, mendeteksi klip...',
      };
    case VideoStatus.CLIPS_DETECTED:
      return {
        type: 'PIPELINE_PROGRESS',
        category: NotificationCategory.CLIP_GENERATION,
        threadStatus: 'IN_PROGRESS',
        title: `Memproses ${name}`,
        body: 'Klip terdeteksi, memulai rendering...',
      };
    case VideoStatus.RENDERED:
      return {
        type: 'CLIP_READY',
        category: NotificationCategory.CLIP_GENERATION,
        threadStatus: 'COMPLETED',
        title: `${video.title ? `"${video.title}"` : 'Video Anda'} selesai diproses`,
        body: 'Semua klip sudah siap ditonton.',
      };
    case VideoStatus.FAILED:
      return {
        type: 'RENDER_FAILED',
        category: NotificationCategory.ERRORS,
        threadStatus: 'FAILED',
        title: `Pemrosesan ${name} gagal`,
        body: 'Video gagal diproses. Silakan coba lagi.',
      };
    default:
      // Every real VideoStatus value is covered above (TypeScript's own
      // exhaustiveness check on the switch already enforces this at compile
      // time) - this only reachable via non-type-checked input (e.g. a test
      // mock). Throws a clear, specific error rather than silently returning
      // undefined and letting the caller crash on `.type` with a confusing
      // "Cannot read properties of undefined" - every call site wraps this
      // function in try/catch precisely so this stays a caught, logged,
      // non-fatal failure rather than breaking the primary action.
      throw new Error(`derivePipelineThreadPresentation: unrecognized VideoStatus "${status}"`);
  }
}

// Inserts one VideoStatusEvent row - the audit-trail write half of a status
// change. Takes any Prisma client-shaped object (a real PrismaClient, or the
// `tx` passed into $transaction(async (tx) => ...)) so callers can compose
// this into their own transaction when the status change isn't a plain
// update() - e.g. VideosService.upload()/.importFromYoutube(), where the
// Video row is being create()'d for the first time in the same transaction,
// so there's no existing row for updateVideoStatus() below to update().
export async function recordVideoStatusEvent(
  prisma: Pick<PrismaClient, 'videoStatusEvent'>,
  videoId: string,
  toStatus: VideoStatus,
  errorMessage?: string,
): Promise<void> {
  await prisma.videoStatusEvent.create({
    data: { videoId, toStatus, errorMessage: errorMessage ?? null },
  });
}

// The common case: update Video.status (plus any other fields the caller
// needs to set in the same write, e.g. transcribeProgress) AND record the
// audit-trail event, atomically. This is the only way Video.status should
// ever be changed after creation - see ARCHITECTURE.md's Fase 3 section and
// CLAUDE.md's Fase 3 entry. Never call prisma.video.update({ data: { status
// ... } }) directly outside this function.
export async function updateVideoStatus(
  prisma: PrismaClient,
  videoId: string,
  status: VideoStatus,
  options: { errorMessage?: string; data?: Omit<Prisma.VideoUpdateInput, 'status'> } = {},
  deps: { publish?: PublishNotificationFn; enqueueDelivery?: EnqueueDeliveryFn } = {},
): Promise<void> {
  const [video] = await prisma.$transaction([
    prisma.video.update({ where: { id: videoId }, data: { ...options.data, status } }),
    prisma.videoStatusEvent.create({
      data: { videoId, toStatus: status, errorMessage: options.errorMessage ?? null },
    }),
  ]);

  // Notification Center Sprint 4A - Render Failed's single hook point. Every
  // FAILED transition in the pipeline (4 stage workers, see their own
  // updateVideoStatus() call sites) goes through this function, so this is
  // the one place that can fire the notification without duplicating the
  // call 4 times - and the only place with a zero-extra-query path to
  // ownerId/title, since `video` above is already the full updated row.
  // Fired AFTER the atomic status write commits (not inside the
  // $transaction) and best-effort (never rethrown) - same "a secondary
  // write must never break the primary action" posture as every
  // recordActivityEvent call site. errorMessage goes into metadata only,
  // never into the user-facing body text, to avoid leaking internal error
  // details.
  if (status === VideoStatus.FAILED) {
    await recordNotification(
      prisma,
      {
        userId: video.ownerId,
        type: 'RENDER_FAILED',
        title: 'Proses video gagal',
        body: video.title
          ? `Video "${video.title}" gagal diproses. Silakan coba lagi.`
          : 'Video gagal diproses. Silakan coba lagi.',
        videoId,
        metadata: options.errorMessage ? { errorMessage: options.errorMessage } : undefined,
      },
      deps,
    ).catch((error) => {
      console.warn(
        '[updateVideoStatus] failed to record RENDER_FAILED notification',
        videoId,
        error,
      );
    });
  }

  // Notification Center v2 Phase 2 (Notification Engine) - the Smart
  // Timeline's central hook. Every transition that reaches this function
  // (every stage worker's FAILED branch, plus every success transition that
  // isn't inlined into its own atomic transaction - IMPORTING, UPLOADED,
  // PENDING_SETTINGS, CLIPS_DETECTED, and VideosService.retry()'s self-heal
  // re-entries into TRANSCRIBED/RENDERED) updates the SAME per-video thread
  // (threadKey `PIPELINE:<videoId>`, one thread per video for its entire
  // lifetime - see recordThreadNotification()'s own upsert-by-key
  // mechanics) rather than ever creating a new notification. This runs in
  // addition to, never instead of, the existing RENDER_FAILED block above -
  // that flat notification is unchanged so every pre-Phase-2 caller/consumer
  // keeps working exactly as before.
  //
  // TRANSCRIBED and RENDERED's own NORMAL (non-retry) success transitions
  // are inlined into transcribe.worker.ts's/render-clip.worker.ts's own
  // atomic transactions for reasons unrelated to notifications (joining the
  // segment-insert/clip-update in the SAME transaction) and bypass this
  // function entirely - those two files import derivePipelineThreadPresentation
  // and call recordThreadNotification() themselves, right after their own
  // transaction commits, so the presentation table is never duplicated.
  //
  // try/catch (not just recordThreadNotification's own internal .catch()
  // handling) since derivePipelineThreadPresentation() runs synchronously
  // BEFORE that call - a secondary write's failure must never break the
  // primary status update, same "a secondary write must never break the
  // primary action" posture as the RENDER_FAILED block above.
  try {
    const presentation = derivePipelineThreadPresentation(status, { title: video.title });
    await recordThreadNotification(
      prisma,
      {
        userId: video.ownerId,
        type: presentation.type,
        title: presentation.title,
        body: presentation.body,
        category: presentation.category,
        threadKey: `PIPELINE:${videoId}`,
        status: presentation.threadStatus,
        videoId,
        metadata: options.errorMessage ? { errorMessage: options.errorMessage } : undefined,
        terminal: status === VideoStatus.FAILED || status === VideoStatus.RENDERED,
      },
      deps,
    );
  } catch (error) {
    console.warn(
      '[updateVideoStatus] failed to record pipeline thread notification',
      videoId,
      error,
    );
  }
}
