import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import type { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { ApprovalsService } from './approvals.service';

const BASE_APPROVAL = {
  id: 'approval-1',
  videoId: 'video-1',
  clipId: null,
  status: 'PENDING',
  requestedById: 'requester-1',
  reviewerId: null,
  note: null,
  reviewedAt: null,
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  updatedAt: new Date('2026-07-18T00:00:00.000Z'),
};

const BASE_VIDEO = { id: 'video-1', ownerId: 'owner-1', workspaceId: 'ws-1', title: 'My video' };

const WITH_RELATIONS = {
  ...BASE_APPROVAL,
  requestedBy: { email: 'requester-1@example.com' },
  reviewer: null,
  events: [],
};

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let prisma: {
    approval: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    approvalEvent: { create: jest.Mock };
    clip: { findUnique: jest.Mock };
    video: { findUniqueOrThrow: jest.Mock };
    notification: { create: jest.Mock };
    notificationPreference: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let workspaceAccess: {
    assertVideoAccess: jest.Mock;
    assertMinRole: jest.Mock;
    getRole: jest.Mock;
  };
  let notificationPublisher: { publish: jest.Mock };
  let notificationDeliveryProducer: { enqueue: jest.Mock };

  beforeEach(() => {
    prisma = {
      approval: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(WITH_RELATIONS),
        update: jest.fn(),
      },
      approvalEvent: { create: jest.fn() },
      clip: { findUnique: jest.fn() },
      video: { findUniqueOrThrow: jest.fn().mockResolvedValue(BASE_VIDEO) },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));

    workspaceAccess = {
      assertVideoAccess: jest.fn().mockResolvedValue(BASE_VIDEO),
      assertMinRole: jest.fn().mockResolvedValue('OWNER'),
      getRole: jest.fn().mockResolvedValue('REVIEWER'),
    };
    notificationPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    notificationDeliveryProducer = { enqueue: jest.fn().mockResolvedValue(undefined) };

    prisma.approval.create.mockResolvedValue(BASE_APPROVAL);

    service = new ApprovalsService(
      prisma as unknown as PrismaService,
      workspaceAccess as unknown as WorkspaceAccessService,
      notificationPublisher as unknown as NotificationPublisherService,
      notificationDeliveryProducer as unknown as NotificationDeliveryProducer,
    );
  });

  describe('request', () => {
    it('creates a PENDING approval, an initial event, and notifies the video owner', async () => {
      const result = await service.request('requester-1', 'video-1', {});

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith(
        'requester-1',
        'video-1',
        'EDITOR',
      );
      expect(prisma.approval.create).toHaveBeenCalledWith({
        data: {
          videoId: 'video-1',
          clipId: null,
          requestedById: 'requester-1',
          reviewerId: null,
          note: null,
        },
      });
      expect(prisma.approvalEvent.create).toHaveBeenCalledWith({
        data: { approvalId: 'approval-1', status: 'PENDING', actorId: 'requester-1', note: null },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'owner-1', type: 'REVIEW_REQUEST' }),
        }),
      );
      expect(result.id).toBe('approval-1');
    });

    it('does not notify when the requester is also the target (owner requesting their own video)', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({ ...BASE_VIDEO, ownerId: 'requester-1' });

      await service.request('requester-1', 'video-1', {});

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('validates clipId belongs to the video', async () => {
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'other-video' });

      await expect(
        service.request('requester-1', 'video-1', { clipId: 'clip-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a second active request for the same target', async () => {
      prisma.approval.findFirst.mockResolvedValue({ ...BASE_APPROVAL, status: 'PENDING' });

      await expect(service.request('requester-1', 'video-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('validates an explicit reviewerId is a REVIEWER+ workspace member', async () => {
      workspaceAccess.getRole.mockResolvedValue('VIEWER');

      await expect(
        service.request('requester-1', 'video-1', { reviewerId: 'viewer-user' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('notifies the named reviewer instead of the owner when reviewerId is set', async () => {
      prisma.approval.create.mockResolvedValue({ ...BASE_APPROVAL, reviewerId: 'reviewer-2' });

      await service.request('requester-1', 'video-1', { reviewerId: 'reviewer-2' });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'reviewer-2', type: 'REVIEW_REQUEST' }),
        }),
      );
    });
  });

  describe('decide', () => {
    it('approves a PENDING approval and notifies the requester', async () => {
      prisma.approval.findUnique.mockResolvedValue(BASE_APPROVAL);

      const result = await service.decide('reviewer-1', 'approval-1', { status: 'APPROVED' });

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('reviewer-1', 'ws-1', 'REVIEWER');
      expect(prisma.approval.update).toHaveBeenCalledWith({
        where: { id: 'approval-1' },
        data: {
          status: 'APPROVED',
          reviewerId: 'reviewer-1',
          note: null,
          reviewedAt: expect.any(Date),
        },
      });
      expect(prisma.approvalEvent.create).toHaveBeenCalledWith({
        data: { approvalId: 'approval-1', status: 'APPROVED', actorId: 'reviewer-1', note: null },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'requester-1', type: 'APPROVAL' }),
        }),
      );
      expect(result.id).toBe('approval-1');
    });

    it('throws BadRequestException when the approval is not PENDING', async () => {
      prisma.approval.findUnique.mockResolvedValue({ ...BASE_APPROVAL, status: 'APPROVED' });

      await expect(
        service.decide('reviewer-1', 'approval-1', { status: 'REJECTED' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for a missing approval', async () => {
      prisma.approval.findUnique.mockResolvedValue(null);

      await expect(
        service.decide('reviewer-1', 'missing', { status: 'APPROVED' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not notify when the reviewer is also the requester', async () => {
      prisma.approval.findUnique.mockResolvedValue({
        ...BASE_APPROVAL,
        requestedById: 'reviewer-1',
      });

      await service.decide('reviewer-1', 'approval-1', { status: 'APPROVED' });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('resubmit', () => {
    it('moves a NEEDS_REVISION approval back to PENDING', async () => {
      prisma.approval.findUnique.mockResolvedValue({
        ...BASE_APPROVAL,
        status: 'NEEDS_REVISION',
      });

      await service.resubmit('requester-1', 'approval-1', {});

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('requester-1', 'ws-1', 'EDITOR');
      expect(prisma.approval.update).toHaveBeenCalledWith({
        where: { id: 'approval-1' },
        data: { status: 'PENDING', reviewedAt: null, note: null },
      });
    });

    it('moves a REJECTED approval back to PENDING', async () => {
      prisma.approval.findUnique.mockResolvedValue({ ...BASE_APPROVAL, status: 'REJECTED' });

      await service.resubmit('requester-1', 'approval-1', {});

      expect(prisma.approval.update).toHaveBeenCalled();
    });

    it('throws BadRequestException for a PENDING or APPROVED approval', async () => {
      prisma.approval.findUnique.mockResolvedValue({ ...BASE_APPROVAL, status: 'PENDING' });

      await expect(service.resubmit('requester-1', 'approval-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listForVideo', () => {
    it('requires VIEWER+ access and returns approvals mapped to DTOs', async () => {
      prisma.approval.findMany.mockResolvedValue([WITH_RELATIONS]);

      const result = await service.listForVideo('user-1', 'video-1');

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith('user-1', 'video-1', 'VIEWER');
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0].requestedByEmail).toBe('requester-1@example.com');
    });
  });
});
