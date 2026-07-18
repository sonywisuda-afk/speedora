import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { QueueName } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

// A genuine step up from export.controller.spec.ts/export.service.spec.ts's
// per-class mocked-service unit tests - this wires the REAL ExportController
// and REAL ExportService together through actual NestJS DI (a real module
// compile, real constructor injection), only mocking Prisma/the BullMQ
// queue at the injection boundary. No real Postgres/Redis needed -
// apps/api/test/'s e2e harness is untouched Nest boilerplate with no
// precedent anywhere in this repo of a real-database Jest suite, so this
// stays consistent with how every other "integration" concern in this
// codebase is actually tested (see docs/testing.md's module/adapter split).
describe('Export module integration (Controller + Service via real DI)', () => {
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  let controller: ExportController;
  let prisma: {
    video: { findUnique: jest.Mock };
    exportJob: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    prisma = {
      video: { findUnique: jest.fn() },
      exportJob: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    };
    queue = { add: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [
        ExportService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(QueueName.EXPORT_GENERATE), useValue: queue },
      ],
    }).compile();

    controller = moduleRef.get(ExportController);
  });

  it('POST /export creates a job, enqueues export-generate, and returns the DTO', async () => {
    prisma.video.findUnique.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
    const createdAt = new Date('2026-07-17T00:00:00.000Z');
    prisma.exportJob.create.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: 'video-1',
      type: 'PDF',
      status: 'PENDING',
      resultUrl: null,
      failReason: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await controller.create(user, { videoId: 'video-1' });

    expect(queue.add).toHaveBeenCalledWith('export-generate', { exportJobId: 'job-1' });
    expect(result).toMatchObject({ id: 'job-1', status: 'PENDING' });
  });

  it('GET /export?videoId= returns the wrapped job list, newest first', async () => {
    const createdAt = new Date('2026-07-17T00:00:00.000Z');
    prisma.exportJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        userId: 'user-1',
        videoId: 'video-1',
        type: 'PDF',
        status: 'READY',
        resultUrl: 'exports/job-1.pdf',
        failReason: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await controller.list(user, 'video-1');

    expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', videoId: 'video-1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].resultUrl).toBe('/export/job-1/download');
  });

  it('GET /export without videoId is rejected before the service is ever called', async () => {
    await expect(controller.list(user, undefined)).rejects.toThrow(BadRequestException);
    expect(prisma.exportJob.findMany).not.toHaveBeenCalled();
  });

  it('POST /export with type=ANALYTICS_REPORT creates a videoId-less job, no video lookup', async () => {
    const createdAt = new Date('2026-07-18T00:00:00.000Z');
    prisma.exportJob.create.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      videoId: null,
      type: 'ANALYTICS_REPORT',
      status: 'PENDING',
      resultUrl: null,
      failReason: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await controller.create(user, { type: 'ANALYTICS_REPORT' as never });

    expect(prisma.video.findUnique).not.toHaveBeenCalled();
    expect(prisma.exportJob.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', type: 'ANALYTICS_REPORT' },
    });
    expect(result.videoId).toBeNull();
  });

  it('GET /export?type=ANALYTICS_REPORT lists jobs by type when there is no videoId', async () => {
    prisma.exportJob.findMany.mockResolvedValue([]);

    await controller.list(user, undefined, 'ANALYTICS_REPORT');

    expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'ANALYTICS_REPORT' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('GET /export/:id/download 404s for a job owned by a different user', async () => {
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-1',
      userId: 'someone-else',
      status: 'READY',
      resultUrl: 'exports/job-1.pdf',
    });
    const res = { setHeader: jest.fn() } as unknown as Parameters<typeof controller.download>[2];

    await expect(controller.download(user, 'job-1', res)).rejects.toThrow(
      'Export job job-1 not found',
    );
  });
});
