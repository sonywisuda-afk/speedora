import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VideoStatus, type Prisma } from '@viral-clip-app/database';
import {
  filterSegmentsForClip,
  QueueName,
  type DetectClipsJobData,
  type RenderClipJobData,
  type TranscribeJobData,
} from '@viral-clip-app/shared';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { StorageService } from '../storage/storage.service';
import { toSharedCaptionStyle, toSharedTranscriptSegment } from './transcript-segment.util';

const CLIPS_WITH_PUBLISH_RECORDS = {
  orderBy: { viralityScore: 'desc' },
  include: { publishRecords: { include: { socialAccount: true } } },
} as const;

type VideoWithClips = Prisma.VideoGetPayload<{
  include: { clips: typeof CLIPS_WITH_PUBLISH_RECORDS };
}>;

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue<TranscribeJobData>,
    @InjectQueue(QueueName.DETECT_CLIPS)
    private readonly detectClipsQueue: Queue<DetectClipsJobData>,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
  ) {}

  async upload(ownerId: string, file: Express.Multer.File) {
    const { sourceUrl } = await this.storage.saveVideo(file);

    const video = await this.prisma.video.create({
      data: { ownerId, sourceUrl },
    });

    await this.transcribeQueue.add(QueueName.TRANSCRIBE, {
      videoId: video.id,
      sourceUrl: video.sourceUrl,
    });

    return video;
  }

  async findAll(ownerId: string) {
    const videos = await this.prisma.video.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: { clips: CLIPS_WITH_PUBLISH_RECORDS },
    });

    return videos.map((video) => this.mapVideoWithClips(video));
  }

  // Re-enqueues whichever stage actually failed, inferred from what data
  // already exists rather than a stored "failed at" marker: no transcript
  // segments means transcribe never finished, segments-but-no-clips means
  // detect-clips never finished, and clips-without-outputUrl means one or
  // more render-clip jobs failed (each clip renders independently, so a
  // single failed clip doesn't imply the others need retrying too). Safe
  // because transcribe and detect-clips each persist their output and
  // advance status in the same step (see transcribe.worker.ts/
  // detect-clips.worker.ts) - if the job's own catch block ran, that step's
  // data was never written.
  async retry(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: true, transcriptSegments: true },
    });

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    if (video.status !== VideoStatus.FAILED) {
      throw new BadRequestException('Only a failed video can be retried');
    }

    if (video.transcriptSegments.length === 0) {
      await this.prisma.video.update({
        where: { id },
        data: { status: VideoStatus.UPLOADED },
      });
      await this.transcribeQueue.add(QueueName.TRANSCRIBE, {
        videoId: id,
        sourceUrl: video.sourceUrl,
      });
    } else if (video.clips.length === 0) {
      await this.prisma.video.update({
        where: { id },
        data: { status: VideoStatus.TRANSCRIBED },
      });
      await this.detectClipsQueue.add(QueueName.DETECT_CLIPS, {
        videoId: id,
        segments: video.transcriptSegments.map(toSharedTranscriptSegment),
      });
    } else {
      const unrendered = video.clips.filter((clip) => !clip.outputUrl);

      if (unrendered.length === 0) {
        // Nothing left to redo - every clip already has output. Shouldn't
        // normally happen (status only becomes FAILED from an active job's
        // catch block), but self-heal rather than error if it does.
        await this.prisma.video.update({
          where: { id },
          data: { status: VideoStatus.RENDERED },
        });
        return this.findOne(id, requesterId);
      }

      await this.prisma.video.update({
        where: { id },
        data: { status: VideoStatus.CLIPS_DETECTED },
      });
      await Promise.all(
        unrendered.map((clip) =>
          this.renderClipQueue.add(QueueName.RENDER_CLIP, {
            clipId: clip.id,
            videoId: id,
            sourceUrl: video.sourceUrl,
            startTime: clip.startTime,
            endTime: clip.endTime,
            transcript: filterSegmentsForClip(
              video.transcriptSegments.map(toSharedTranscriptSegment),
              clip.startTime,
              clip.endTime,
            ),
            captionStyle: toSharedCaptionStyle(clip.captionStyle),
          }),
        ),
      );
    }

    return this.findOne(id, requesterId);
  }

  async findOne(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: CLIPS_WITH_PUBLISH_RECORDS },
    });

    // Same "not found" for a missing video and someone else's video, so a
    // client can't use this endpoint to probe which video IDs exist.
    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return this.mapVideoWithClips(video);
  }

  // Used by GET /videos/:id/source (timeline editor's <video> preview) -
  // only needs the object key, not the full clips/status shape findOne()
  // returns.
  async findSourceOrThrow(id: string, requesterId: string): Promise<{ sourceUrl: string }> {
    const video = await this.prisma.video.findUnique({ where: { id } });

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return { sourceUrl: video.sourceUrl };
  }

  // Separate from findOne()/mapVideoWithClips() on purpose - transcript
  // segments can be a lot of rows for a long video, and findOne() is
  // polled every 2s by both the upload-progress view and the dashboard,
  // neither of which needs caption text. Only the timeline editor does.
  async findTranscriptOrThrow(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { transcriptSegments: { orderBy: { start: 'asc' } } },
    });

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return video.transcriptSegments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker ?? undefined,
    }));
  }

  // Don't leak the server's local filesystem path; the client should hit
  // the download endpoint instead.
  private mapVideoWithClips(video: VideoWithClips) {
    const { clips, ...rest } = video;
    return {
      ...rest,
      clips: clips.map(({ outputUrl, publishRecords, ...clip }) => ({
        ...clip,
        downloadUrl: outputUrl ? `/clips/${clip.id}/download` : null,
        publishRecords: publishRecords.map(toSharedPublishRecord),
      })),
    };
  }
}
