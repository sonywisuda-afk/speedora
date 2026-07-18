import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExportJob } from '@speedora/database';
import {
  ExportType,
  QueueName,
  type ExportGenerateJobData,
  type ExportJobDto,
} from '@speedora/shared';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateExportDto } from './dto/create-export.dto';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.EXPORT_GENERATE)
    private readonly exportGenerateQueue: Queue<ExportGenerateJobData>,
  ) {}

  // Sprint 03c - creates the ExportJob row synchronously (so it exists
  // immediately for the client to poll) before enqueueing, same pattern as
  // ClipsService.publish()'s PublishRecord. Ownership check is a lightweight
  // inline query rather than a call into VideosService.findOne, which does
  // far more work (full clip mapping) than a bare existence check needs.
  //
  // ANALYTICS_REPORT is account-wide, not video-scoped - videoId and it are
  // mutually exclusive, enforced here (not just via the DTO) since
  // class-validator has no clean "required unless sibling field X" rule.
  async create(userId: string, dto: CreateExportDto): Promise<ExportJobDto> {
    const type = dto.type ?? ExportType.PDF;

    if (type === ExportType.ANALYTICS_REPORT) {
      if (dto.videoId) {
        throw new BadRequestException('videoId must not be set for ANALYTICS_REPORT');
      }

      const job = await this.prisma.exportJob.create({ data: { userId, type } });
      await this.exportGenerateQueue.add(QueueName.EXPORT_GENERATE, { exportJobId: job.id });
      return this.toDto(job);
    }

    if (!dto.videoId) {
      throw new BadRequestException('videoId is required for this export type');
    }

    const video = await this.prisma.video.findUnique({
      where: { id: dto.videoId },
      select: { id: true, ownerId: true },
    });
    if (!video || video.ownerId !== userId) {
      throw new NotFoundException(`Video ${dto.videoId} not found`);
    }

    const job = await this.prisma.exportJob.create({
      data: { userId, videoId: dto.videoId, type },
    });

    await this.exportGenerateQueue.add(QueueName.EXPORT_GENERATE, { exportJobId: job.id });

    return this.toDto(job);
  }

  // Same "not found" for a missing job and someone else's job, so a client
  // can't use this endpoint to probe which export job IDs exist.
  async findOwnedOrThrow(id: string, requesterId: string): Promise<ExportJob> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job || job.userId !== requesterId) {
      throw new NotFoundException(`Export job ${id} not found`);
    }
    return job;
  }

  async findReadyOrThrow(id: string, requesterId: string): Promise<ExportJob> {
    const job = await this.findOwnedOrThrow(id, requesterId);
    if (job.status !== 'READY' || !job.resultUrl) {
      throw new NotFoundException(`Export job ${id} is not ready yet (status: ${job.status})`);
    }
    return job;
  }

  // Recent Exports / Persistent Export History - the 10 most recent jobs
  // matching the given filter, newest first. Filtering by userId is enough
  // on its own (no separate video-ownership check, unlike create()) - a
  // video that isn't the requester's simply yields an empty list, same
  // non-leaking "list endpoints degrade to empty, not 404" posture as every
  // other list endpoint in this codebase. `videoId` scopes the existing
  // per-video tabs; `type` (ANALYTICS_REPORT has no videoId to scope by)
  // covers the account-wide list.
  async listRecent(
    userId: string,
    filter: { videoId?: string; type?: ExportType },
  ): Promise<ExportJobDto[]> {
    const jobs = await this.prisma.exportJob.findMany({
      where: {
        userId,
        ...(filter.videoId ? { videoId: filter.videoId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return jobs.map((job) => this.toDto(job));
  }

  toDto(job: ExportJob): ExportJobDto {
    return {
      id: job.id,
      videoId: job.videoId,
      type: job.type as unknown as ExportJobDto['type'],
      status: job.status as unknown as ExportJobDto['status'],
      resultUrl: job.status === 'READY' && job.resultUrl ? `/export/${job.id}/download` : null,
      failReason: job.failReason,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
