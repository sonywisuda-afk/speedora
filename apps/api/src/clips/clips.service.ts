import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CaptionStyle } from '@viral-clip-app/database';
import {
  filterSegmentsForClip,
  QueueName,
  sanitizeHashtags,
  type RenderClipJobData,
} from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { toSharedCaptionStyle, toSharedTranscriptSegment } from '../videos/transcript-segment.util';
import type { UpdateClipDto } from './dto/update-clip.dto';

@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
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
      updatedAt: clip.updatedAt,
    };
  }
}
