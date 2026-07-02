import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { QueueName, type TranscribeJobData } from '@viral-clip-app/shared';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue<TranscribeJobData>,
  ) {}

  async upload(ownerId: string, file: Express.Multer.File) {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      throw new NotFoundException(`User ${ownerId} not found`);
    }

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

  async findOne(id: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: { orderBy: { viralityScore: 'desc' } } },
    });
    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    // Don't leak the server's local filesystem path; the client should hit
    // the download endpoint instead.
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
