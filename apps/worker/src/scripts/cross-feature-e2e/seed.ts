import { randomUUID } from 'node:crypto';
import { SocialPlatform, VideoStatus, updateVideoStatus } from '@speedora/database';
import { encryptToken } from '@speedora/social';
import { prisma } from '../../prisma';

export async function findPersonalWorkspaceId(ownerId: string): Promise<string> {
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { ownerId, isPersonal: true },
  });
  return workspace.id;
}

export interface SeedSocialAccounts {
  youtubeId: string;
  youtubePlatformAccountId: string;
  tiktokId: string;
  threadsId: string;
}

// Real OAuth can't be driven headlessly, so these are the one deliberate
// direct-Prisma seed point in the whole script - everything downstream
// (publish, snapshot sync, follower sync) is exercised for real against
// these rows via real HTTP/real worker code.
export async function seedSocialAccounts(userId: string): Promise<SeedSocialAccounts> {
  const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const make = (platform: SocialPlatform, label: string) =>
    prisma.socialAccount.create({
      data: {
        userId,
        platform,
        platformAccountId: `e2e-${label}-${randomUUID()}`,
        displayName: `E2E ${label} account`,
        accessToken: encryptToken('e2e-fake-access-token'),
        refreshToken: encryptToken('e2e-fake-refresh-token'),
        tokenExpiresAt,
      },
    });

  const [youtube, tiktok, threads] = await Promise.all([
    make(SocialPlatform.YOUTUBE, 'youtube'),
    make(SocialPlatform.TIKTOK, 'tiktok'),
    make(SocialPlatform.THREADS, 'threads'),
  ]);
  return {
    youtubeId: youtube.id,
    youtubePlatformAccountId: youtube.platformAccountId,
    tiktokId: tiktok.id,
    threadsId: threads.id,
  };
}

export interface SeedClip {
  id: string;
  highlightScore: number;
}

// Walks ONE video through the real Upload -> Processing state machine (via
// the real updateVideoStatus()), then attaches `clipCount` rendered clips to
// it directly (Fusion Engine output / real FFmpeg render is out of scope -
// same "frozen AI pipeline" scoping this codebase already applies
// elsewhere), each with a distinct highlightScore so Prediction's
// correlation has real spread to fit.
export async function seedVideoWithClips(
  ownerId: string,
  workspaceId: string,
  clipCount: number,
): Promise<SeedClip[]> {
  const video = await prisma.video.create({
    data: {
      ownerId,
      workspaceId,
      sourceUrl: '',
      importSourceUrl: 'https://youtube.com/watch?v=e2e-cross-feature-seed',
      status: VideoStatus.IMPORTING,
      title: 'Cross-feature E2E seed video',
    },
  });

  await updateVideoStatus(prisma, video.id, VideoStatus.UPLOADED, {
    data: { sourceUrl: `videos/${video.id}/source.mp4`, importProgress: 100 },
  });
  await prisma.transcriptSegment.create({
    data: { videoId: video.id, start: 0, end: 5, text: 'Cross-feature E2E seed transcript' },
  });
  await updateVideoStatus(prisma, video.id, VideoStatus.TRANSCRIBED);

  const clips: SeedClip[] = [];
  for (let i = 0; i < clipCount; i++) {
    const highlightScore = 0.2 + (i / Math.max(1, clipCount - 1)) * 0.7;
    const clip = await prisma.clip.create({
      data: {
        videoId: video.id,
        startTime: i * 10,
        endTime: i * 10 + 8,
        durationSeconds: 8,
        viralityScore: highlightScore,
        outputUrl: `renders/${video.id}/${i}.mp4`,
        highlightScore,
        highlightConfidence: 0.8,
      },
    });
    clips.push({ id: clip.id, highlightScore });
  }
  await updateVideoStatus(prisma, video.id, VideoStatus.CLIPS_DETECTED);
  await updateVideoStatus(prisma, video.id, VideoStatus.RENDERED);

  return clips;
}

// A dedicated small video for the "worker failed, then retry" scenario -
// genuinely partial state (segments exist, no Clip rows), not a flag, so
// VideosService.retry()'s real stage-inference logic is what's under test.
export async function seedFailedAtDetectClipsVideo(
  ownerId: string,
  workspaceId: string,
): Promise<string> {
  const video = await prisma.video.create({
    data: {
      ownerId,
      workspaceId,
      sourceUrl: `videos/e2e-retry-${randomUUID()}/source.mp4`,
      status: VideoStatus.UPLOADED,
      title: 'Cross-feature E2E retry-scenario video',
    },
  });
  await prisma.transcriptSegment.create({
    data: { videoId: video.id, start: 0, end: 5, text: 'Retry scenario transcript' },
  });
  await updateVideoStatus(prisma, video.id, VideoStatus.TRANSCRIBED);
  await updateVideoStatus(prisma, video.id, VideoStatus.FAILED, {
    errorMessage: 'E2E-simulated: detect-clips job failed',
  });
  return video.id;
}

// Cascades everything this script created (Workspace/Video/Clip/
// SocialAccount/PublishRecord/PublishRecordStatsSnapshot/Campaign/
// TrackedLink/TrackedLinkClick all have onDelete: Cascade back to User, per
// schema.prisma - confirmed the same way apps/api/src/auth/auth.service.ts's
// own deleteAccount() already relies on) - deleting the seed User is enough
// to leave the dev DB exactly as it found it.
export async function deleteUserCascade(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch((error) => {
    // Already gone (e.g. a re-run after a partial failure) - not fatal for
    // cleanup's own purpose.
    console.warn(`[cleanup] user ${userId} delete skipped:`, (error as Error).message);
  });
}
