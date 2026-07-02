import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@viral-clip-app/database';
import { QueueName, type TranscribeJobData } from '@viral-clip-app/shared';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type VideoWithClips = Prisma.VideoGetPayload<{ include: { clips: true } }>;

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue<TranscribeJobData>,
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
      include: { clips: { orderBy: { viralityScore: 'desc' } } },
    });

    return videos.map((video) => this.mapVideoWithClips(video));
  }

  async findOne(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: { orderBy: { viralityScore: 'desc' } } },
    });

    // Same "not found" for a missing video and someone else's video, so a
    // client can't use this endpoint to probe which video IDs exist.
    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return this.mapVideoWithClips(video);
  }

  // Don't leak the server's local filesystem path; the client should hit
  // the download endpoint instead.
  private mapVideoWithClips(video: VideoWithClips) {
    const { clips, ...rest } = video;
    return {
      ...rest,
      clips: clips.map(({ outputUrl, ...clip }) => ({
        ...clip,
        downloadUrl: outputUrl ? `/clips/${clip.id}/download` : null,
      })),
    };
  }
}
