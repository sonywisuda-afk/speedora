import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import type { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import type { StorageService } from '../storage/storage.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { CommentsService } from './comments.service';

const BASE_COMMENT = {
  id: 'comment-1',
  videoId: 'video-1',
  clipId: null,
  authorId: 'user-1',
  parentId: null,
  body: 'Nice clip!',
  timestampSeconds: 12.5,
  resolved: false,
  resolvedAt: null,
  resolvedById: null,
  editedAt: null,
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  author: { email: 'user-1@example.com' },
  resolvedBy: null,
  mentions: [],
  reactions: [],
  attachments: [],
};

describe('CommentsService', () => {
  let service: CommentsService;
  let prisma: {
    comment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    clip: { findUnique: jest.Mock };
    video: { findUniqueOrThrow: jest.Mock };
    workspaceMembership: { findMany: jest.Mock };
    commentReaction: { upsert: jest.Mock; deleteMany: jest.Mock };
    commentAttachment: { create: jest.Mock; findUnique: jest.Mock };
    notification: { create: jest.Mock };
    notificationPreference: { findUnique: jest.Mock };
  };
  let workspaceAccess: { assertVideoAccess: jest.Mock; assertMinRole: jest.Mock };
  let storage: { saveCommentAttachment: jest.Mock };
  let notificationPublisher: { publish: jest.Mock };
  let notificationDeliveryProducer: { enqueue: jest.Mock };

  beforeEach(() => {
    prisma = {
      comment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      clip: { findUnique: jest.fn() },
      video: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'video-1',
          ownerId: 'owner-1',
          workspaceId: 'ws-1',
          title: 'My video',
        }),
      },
      workspaceMembership: { findMany: jest.fn().mockResolvedValue([]) },
      commentReaction: { upsert: jest.fn(), deleteMany: jest.fn() },
      commentAttachment: { create: jest.fn(), findUnique: jest.fn() },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    workspaceAccess = {
      assertVideoAccess: jest.fn().mockResolvedValue({
        id: 'video-1',
        ownerId: 'owner-1',
        workspaceId: 'ws-1',
        title: 'My video',
      }),
      assertMinRole: jest.fn().mockResolvedValue('OWNER'),
    };
    storage = { saveCommentAttachment: jest.fn().mockResolvedValue('comment-attachments/x.png') };
    notificationPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    notificationDeliveryProducer = { enqueue: jest.fn().mockResolvedValue(undefined) };

    service = new CommentsService(
      prisma as unknown as PrismaService,
      workspaceAccess as unknown as WorkspaceAccessService,
      storage as unknown as StorageService,
      notificationPublisher as unknown as NotificationPublisherService,
      notificationDeliveryProducer as unknown as NotificationDeliveryProducer,
    );
  });

  describe('create', () => {
    it('creates a root comment and notifies the video owner (not the author)', async () => {
      prisma.comment.create.mockResolvedValue({ ...BASE_COMMENT, authorId: 'commenter-1' });

      const result = await service.create('commenter-1', 'video-1', { body: 'Nice clip!' });

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith(
        'commenter-1',
        'video-1',
        'REVIEWER',
      );
      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          videoId: 'video-1',
          authorId: 'commenter-1',
          body: 'Nice clip!',
          clipId: null,
          parentId: null,
          timestampSeconds: null,
        }),
        include: expect.any(Object),
      });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'owner-1', type: 'COMMENT' }),
        }),
      );
      expect(result.id).toBe('comment-1');
    });

    it('does not notify the owner when the owner is the commenter', async () => {
      prisma.comment.create.mockResolvedValue({ ...BASE_COMMENT, authorId: 'owner-1' });

      await service.create('owner-1', 'video-1', { body: 'my own comment' });

      expect(prisma.notification.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'COMMENT' }) }),
      );
    });

    it('validates mentionedUserIds are real workspace members and notifies each', async () => {
      prisma.workspaceMembership.findMany.mockResolvedValue([{ userId: 'member-2' }]);
      prisma.comment.create.mockResolvedValue({
        ...BASE_COMMENT,
        authorId: 'commenter-1',
        mentions: [{ userId: 'member-2', user: { email: 'member-2@example.com' } }],
      });

      await service.create('commenter-1', 'video-1', {
        body: 'hey @member-2',
        mentionedUserIds: ['member-2'],
      });

      expect(prisma.workspaceMembership.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', userId: { in: ['member-2'] } },
        select: { userId: true },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'member-2', type: 'MENTION' }),
        }),
      );
    });

    it('throws BadRequestException when a mentioned user is not a workspace member', async () => {
      prisma.workspaceMembership.findMany.mockResolvedValue([]); // none found

      await expect(
        service.create('commenter-1', 'video-1', {
          body: 'hey',
          mentionedUserIds: ['not-a-member'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when clipId does not belong to the video', async () => {
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'other-video' });

      await expect(
        service.create('commenter-1', 'video-1', { body: 'hi', clipId: 'clip-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when parentId does not belong to the video', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.create('commenter-1', 'video-1', { body: 'reply', parentId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects replying to a reply', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        ...BASE_COMMENT,
        id: 'reply-1',
        parentId: 'root-1',
      });

      await expect(
        service.create('commenter-1', 'video-1', { body: 'nested reply', parentId: 'reply-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('requires at least VIEWER access and returns comments mapped to DTOs', async () => {
      prisma.comment.findMany.mockResolvedValue([BASE_COMMENT]);

      const result = await service.list('user-1', 'video-1');

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith('user-1', 'video-1', 'VIEWER');
      expect(result.comments).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('allows the author to edit their own comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);
      prisma.comment.update.mockResolvedValue({
        ...BASE_COMMENT,
        body: 'edited',
        editedAt: new Date(),
      });

      const result = await service.update('user-1', 'comment-1', 'edited');

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { body: 'edited', editedAt: expect.any(Date) },
        include: expect.any(Object),
      });
      expect(result.body).toBe('edited');
    });

    it('throws ForbiddenException for a non-author', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);

      await expect(service.update('someone-else', 'comment-1', 'hijack')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('allows the author to delete without a role check', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);

      await service.remove('user-1', 'comment-1');

      expect(workspaceAccess.assertMinRole).not.toHaveBeenCalled();
      expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'comment-1' } });
    });

    it('requires ADMIN+ for a non-author', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);

      await service.remove('admin-user', 'comment-1');

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('admin-user', 'ws-1', 'ADMIN');
      expect(prisma.comment.delete).toHaveBeenCalled();
    });
  });

  describe('setResolved', () => {
    it('resolves a root comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);
      prisma.comment.update.mockResolvedValue({ ...BASE_COMMENT, resolved: true });

      const result = await service.setResolved('user-1', 'comment-1', true);

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'REVIEWER');
      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { resolved: true, resolvedAt: expect.any(Date), resolvedById: 'user-1' },
        include: expect.any(Object),
      });
      expect(result.resolved).toBe(true);
    });

    it('throws BadRequestException for a reply (non-root comment)', async () => {
      prisma.comment.findUnique.mockResolvedValue({ ...BASE_COMMENT, parentId: 'root-1' });

      await expect(service.setResolved('user-1', 'comment-1', true)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reactions', () => {
    it('addReaction upserts on the compound key and returns the aggregated DTO', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);
      prisma.comment.findUniqueOrThrow.mockResolvedValue({
        ...BASE_COMMENT,
        reactions: [
          { userId: 'user-1', emoji: '👍' },
          { userId: 'user-2', emoji: '👍' },
        ],
      });

      const result = await service.addReaction('user-1', 'comment-1', '👍');

      expect(prisma.commentReaction.upsert).toHaveBeenCalledWith({
        where: {
          commentId_userId_emoji: { commentId: 'comment-1', userId: 'user-1', emoji: '👍' },
        },
        create: { commentId: 'comment-1', userId: 'user-1', emoji: '👍' },
        update: {},
      });
      expect(result.reactions).toEqual([{ emoji: '👍', count: 2, reactedByMe: true }]);
    });

    it('removeReaction deletes matching rows only', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);
      prisma.comment.findUniqueOrThrow.mockResolvedValue(BASE_COMMENT);

      await service.removeReaction('user-1', 'comment-1', '👍');

      expect(prisma.commentReaction.deleteMany).toHaveBeenCalledWith({
        where: { commentId: 'comment-1', userId: 'user-1', emoji: '👍' },
      });
    });
  });

  describe('attachments', () => {
    it('addAttachment stores the file and returns a download endpoint path', async () => {
      prisma.comment.findUnique.mockResolvedValue(BASE_COMMENT);
      prisma.commentAttachment.create.mockResolvedValue({
        id: 'att-1',
        fileName: 'notes.png',
        fileSize: 3,
        contentType: 'image/png',
      });
      const file = {
        originalname: 'notes.png',
        mimetype: 'image/png',
        buffer: Buffer.from('abc'),
      } as Express.Multer.File;

      const result = await service.addAttachment('user-1', 'comment-1', file);

      expect(storage.saveCommentAttachment).toHaveBeenCalledWith(file);
      expect(result.url).toBe('/comments/comment-1/attachments/att-1');
    });

    it('getAttachmentOrThrow requires VIEWER+ access to the owning video', async () => {
      prisma.commentAttachment.findUnique.mockResolvedValue({
        id: 'att-1',
        commentId: 'comment-1',
        storageKey: 'comment-attachments/x.png',
        fileName: 'notes.png',
        contentType: 'image/png',
      });
      prisma.comment.findUniqueOrThrow.mockResolvedValue(BASE_COMMENT);

      await service.getAttachmentOrThrow('user-1', 'att-1');

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it('throws NotFoundException for an unknown attachment', async () => {
      prisma.commentAttachment.findUnique.mockResolvedValue(null);

      await expect(service.getAttachmentOrThrow('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
