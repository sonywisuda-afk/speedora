import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CaptionStyle } from '@viral-clip-app/database';
import {
  filterSegmentsForClip,
  QueueName,
  sanitizeHashtags,
  type PublishClipJobData,
  type PublishRecord,
  type RenderClipJobData,
} from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { SocialAccountsService } from '../social/social.service';
import { toSharedCaptionStyle, toSharedTranscriptSegment } from '../videos/transcript-segment.util';
import type { PublishClipDto } from './dto/publish-clip.dto';
import type { UpdateClipDto } from './dto/update-clip.dto';

// A transient failure calling out to a social platform's API (rate limit,
// a temporary 5xx) shouldn't need a human to notice and manually retry -
// unlike every other job in this codebase (transcribe/detect-clips/
// render-clip all fail once and wait for an explicit user Retry), so this
// is the first job configured with BullMQ's own automatic retry.
const PUBLISH_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialAccounts: SocialAccountsService,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
    @InjectQueue(QueueName.PUBLISH_CLIP)
    private readonly publishClipQueue: Queue<PublishClipJobData>,
  ) {}

  // Same "not found" for a missing clip and someone else's clip, so a
  // client can't use this endpoint to probe which clip IDs exist.
  async findOwnedOrThrow(id: string, requesterId: string) {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      include: { video: true },
    });

    if (!clip || clip.video.ownerId !== requesterId) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    return clip;
  }

  async findRenderedOrThrow(id: string, requesterId: string) {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    if (!clip.outputUrl) {
      throw new NotFoundException(`Clip ${id} has not finished rendering yet`);
    }
    return clip;
  }

  // Manual trim/style change from the timeline editor. Deliberately does not
  // touch outputUrl or enqueue a render - re-rendering is a separate
  // explicit action (see render() below) so dragging a trim handle or
  // switching caption presets doesn't burn FFmpeg compute on every
  // intermediate value.
  async update(id: string, requesterId: string, input: UpdateClipDto) {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    const startTime = input.startTime ?? clip.startTime;
    const endTime = input.endTime ?? clip.endTime;
    const captionStyle = input.captionStyle ?? clip.captionStyle;
    const hookText = input.hookText ?? clip.hookText;
    const hashtags = input.hashtags ? sanitizeHashtags(input.hashtags) : clip.hashtags;

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const updated = await this.prisma.clip.update({
      where: { id },
      data: { startTime, endTime, captionStyle, hookText, hashtags },
      include: { publishRecords: { include: { socialAccount: true } } },
    });

    return this.toDto(updated);
  }

  // Re-renders a single clip with its current startTime/endTime (reuses the
  // same render-clip job/worker as the initial auto-detected render - its
  // logic is already generic over start/end and overwrites the same
  // renders/<clipId>.mp4 key, so nothing there needs to know this is a
  // "re-render" rather than the first one).
  async render(id: string, requesterId: string) {
    const clip = await this.findOwnedOrThrow(id, requesterId);

    const segments = await this.prisma.transcriptSegment.findMany({
      where: { videoId: clip.videoId },
    });

    // Cleared before enqueueing, not left stale, so two things stay true
    // while the re-render is in flight: apps/web's existing "Rendering..."
    // fallback (shown whenever a clip's downloadUrl is null) kicks in for
    // free, and if this render-clip job fails, VideosService.retry's
    // "clips without outputUrl need render-clip" check finds this clip
    // again instead of thinking it's still fine. Also bumps updatedAt,
    // which apps/web polls to detect when the re-render finishes.
    const cleared = await this.prisma.clip.update({
      where: { id },
      data: { outputUrl: null },
      include: { publishRecords: { include: { socialAccount: true } } },
    });

    await this.renderClipQueue.add(QueueName.RENDER_CLIP, {
      clipId: clip.id,
      videoId: clip.videoId,
      sourceUrl: clip.video.sourceUrl,
      startTime: clip.startTime,
      endTime: clip.endTime,
      transcript: filterSegmentsForClip(
        segments.map(toSharedTranscriptSegment),
        clip.startTime,
        clip.endTime,
      ),
      captionStyle: toSharedCaptionStyle(clip.captionStyle),
    });

    return this.toDto(cleared);
  }

  // Manual "publish now" (Fase 6b) - creates the PublishRecord row
  // synchronously (so it exists immediately for the UI to show/poll, same
  // reasoning as render()'s eager outputUrl clear) before enqueueing the
  // job that does the actual upload. Purely additive to the clip - unlike
  // render(), does not touch/clear anything on the Clip row itself.
  async publish(id: string, requesterId: string, input: PublishClipDto) {
    const clip = await this.findRenderedOrThrow(id, requesterId);
    // Throws NotFoundException if the account doesn't exist or belongs to
    // someone else - same ownership check pattern as findOwnedOrThrow.
    await this.socialAccounts.findOwnedOrThrow(input.socialAccountId, requesterId);

    const record = await this.prisma.publishRecord.create({
      data: { clipId: clip.id, socialAccountId: input.socialAccountId },
      include: { socialAccount: true },
    });

    await this.publishClipQueue.add(
      QueueName.PUBLISH_CLIP,
      { publishRecordId: record.id },
      PUBLISH_RETRY_OPTIONS,
    );

    return toSharedPublishRecord(record);
  }

  private toDto(clip: {
    id: string;
    videoId: string;
    startTime: number;
    endTime: number;
    viralityScore: number;
    outputUrl: string | null;
    captionStyle: CaptionStyle;
    hookText: string | null;
    hashtags: string[];
    publishRecords: Parameters<typeof toSharedPublishRecord>[0][];
    updatedAt: Date;
  }) {
    return {
      id: clip.id,
      videoId: clip.videoId,
      startTime: clip.startTime,
      endTime: clip.endTime,
      viralityScore: clip.viralityScore,
      downloadUrl: clip.outputUrl ? `/clips/${clip.id}/download` : null,
      captionStyle: clip.captionStyle,
      hookText: clip.hookText,
      hashtags: clip.hashtags,
      publishRecords: clip.publishRecords.map(toSharedPublishRecord) satisfies PublishRecord[],
      updatedAt: clip.updatedAt,
    };
  }
}
