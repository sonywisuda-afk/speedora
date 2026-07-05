import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PublishStatus, type CaptionStyle, type Prisma } from '@speedora/database';
import {
  filterSegmentsForClip,
  PUBLISH_RETRY_OPTIONS,
  QueueName,
  sanitizeHashtags,
  type PublishClipJobData,
  type PublishRecord,
  type RenderClipJobData,
} from '@speedora/shared';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { SocialAccountsService } from '../social/social.service';
import { StorageService } from '../storage/storage.service';
import {
  toSharedCaptionStyle,
  toSharedClipScores,
  toSharedTranscriptSegment,
} from '../videos/transcript-segment.util';
import type { PublishClipDto } from './dto/publish-clip.dto';
import type { UpdateClipDto } from './dto/update-clip.dto';

@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialAccounts: SocialAccountsService,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
    @InjectQueue(QueueName.PUBLISH_CLIP)
    private readonly publishClipQueue: Queue<PublishClipJobData>,
  ) {}

  // Explicit return type (rather than inferred) - a Clip row now includes
  // the Json `scores` column (Fase 8), and an un-annotated inferred type
  // that includes a Json field can't be named without referencing Prisma's
  // internal runtime module, which breaks declaration emit (TS2742) for
  // every caller up the chain.
  private static readonly CLIP_WITH_VIDEO = { include: { video: true } } as const;

  // Same "not found" for a missing clip and someone else's clip, so a
  // client can't use this endpoint to probe which clip IDs exist.
  async findOwnedOrThrow(
    id: string,
    requesterId: string,
  ): Promise<Prisma.ClipGetPayload<typeof ClipsService.CLIP_WITH_VIDEO>> {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      ...ClipsService.CLIP_WITH_VIDEO,
    });

    if (!clip || clip.video.ownerId !== requesterId) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    return clip;
  }

  async findRenderedOrThrow(
    id: string,
    requesterId: string,
  ): Promise<Prisma.ClipGetPayload<typeof ClipsService.CLIP_WITH_VIDEO>> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    if (!clip.outputUrl) {
      throw new NotFoundException(`Clip ${id} has not finished rendering yet`);
    }
    return clip;
  }

  // Permanently deletes one clip (its publish records cascade via the
  // schema) and best-effort cleans up its rendered output in storage - not
  // the parent video or any sibling clip. Video.status is left untouched:
  // it only ever moves forward through the pipeline (see CLAUDE.md's state
  // machine) and is never recomputed from the current clip count, so
  // removing one clip here has no bearing on it.
  async remove(id: string, requesterId: string): Promise<void> {
    const clip = await this.findOwnedOrThrow(id, requesterId);

    await this.prisma.clip.delete({ where: { id } });
    if (clip.outputUrl) {
      await this.storage.deleteObjects([clip.outputUrl]);
    }
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
      keywords: clip.keywords,
    });

    return this.toDto(cleared);
  }

  // Manual "publish now" (Fase 6b), or a scheduled future publish (Fase 6c)
  // when input.scheduledAt is set - either way creates the PublishRecord row
  // synchronously (so it exists immediately for the UI to show/poll, same
  // reasoning as render()'s eager outputUrl clear). Purely additive to the
  // clip - unlike render(), does not touch/clear anything on the Clip row
  // itself. A scheduled record is NOT enqueued here - it starts at
  // SCHEDULED and apps/worker's schedule-publish-clip poller enqueues it
  // (moving it to QUEUED) once scheduledAt arrives.
  async publish(id: string, requesterId: string, input: PublishClipDto) {
    const clip = await this.findRenderedOrThrow(id, requesterId);
    // Throws NotFoundException if the account doesn't exist or belongs to
    // someone else - same ownership check pattern as findOwnedOrThrow.
    await this.socialAccounts.findOwnedOrThrow(input.socialAccountId, requesterId);

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const record = await this.prisma.publishRecord.create({
      data: {
        clipId: clip.id,
        socialAccountId: input.socialAccountId,
        status: scheduledAt ? PublishStatus.SCHEDULED : PublishStatus.QUEUED,
        scheduledAt,
      },
      include: { socialAccount: true },
    });

    if (!scheduledAt) {
      await this.publishClipQueue.add(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: record.id },
        PUBLISH_RETRY_OPTIONS,
      );
    }

    return toSharedPublishRecord(record);
  }

  // Cancel a publish that hasn't fired yet (Fase 6c). Scoped to id+clipId+
  // SCHEDULED in one atomic deleteMany - a record that's already QUEUED/
  // PUBLISHING/PUBLISHED/FAILED has either already been handed to the
  // worker or finished, and canceling it here wouldn't stop/undo an
  // in-flight or completed upload, so it's deliberately not cancellable
  // past SCHEDULED.
  async cancelScheduledPublish(id: string, recordId: string, requesterId: string): Promise<void> {
    await this.findOwnedOrThrow(id, requesterId);

    const { count } = await this.prisma.publishRecord.deleteMany({
      where: { id: recordId, clipId: id, status: PublishStatus.SCHEDULED },
    });
    if (count === 0) {
      throw new NotFoundException(`Scheduled publish ${recordId} not found`);
    }
  }

  // Reschedule a publish that hasn't fired yet (Fase 6c) to a new future
  // time. Same SCHEDULED-only scoping as cancelScheduledPublish, for the
  // same reason - once claimed by the poller it's no longer just a plan,
  // it's an in-flight (or finished) job.
  async reschedulePublish(
    id: string,
    recordId: string,
    requesterId: string,
    newScheduledAt: string,
  ) {
    await this.findOwnedOrThrow(id, requesterId);

    const parsed = new Date(newScheduledAt);
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const { count } = await this.prisma.publishRecord.updateMany({
      where: { id: recordId, clipId: id, status: PublishStatus.SCHEDULED },
      data: { scheduledAt: parsed },
    });
    if (count === 0) {
      throw new NotFoundException(`Scheduled publish ${recordId} not found`);
    }

    const record = await this.prisma.publishRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { socialAccount: true },
    });
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
    scores: unknown;
    reason: string | null;
    topics: string[];
    keywords: string[];
    intent: string | null;
    ctaText: string | null;
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
      scores: toSharedClipScores(clip.scores),
      reason: clip.reason,
      topics: clip.topics,
      keywords: clip.keywords,
      intent: clip.intent,
      ctaText: clip.ctaText,
      publishRecords: clip.publishRecords.map(toSharedPublishRecord) satisfies PublishRecord[],
      updatedAt: clip.updatedAt,
    };
  }
}
