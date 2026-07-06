import type { Prisma, PrismaClient, VideoStatus } from './generated/prisma/client';

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
): Promise<void> {
  await prisma.$transaction([
    prisma.video.update({ where: { id: videoId }, data: { ...options.data, status } }),
    prisma.videoStatusEvent.create({
      data: { videoId, toStatus: status, errorMessage: options.errorMessage ?? null },
    }),
  ]);
}
