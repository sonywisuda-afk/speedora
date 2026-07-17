import { VideoStatus, type Prisma, type PrismaClient } from './generated/prisma/client';
import { recordNotification, type PublishNotificationFn } from './notification';

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
  deps: { publish?: PublishNotificationFn } = {},
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
}
