import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import type { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import type { WorkspaceAccessService } from './workspace-access.service';
import {
  mapAuditAction,
  mapPendingInviteStatus,
  mapWorkspaceRole,
  WorkspaceService,
} from './workspace.service';
import { AuditAction, PendingInviteStatus, WorkspaceRole } from '@speedora/shared';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let prisma: {
    workspace: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    workspaceMembership: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      upsert: jest.Mock;
      count: jest.Mock;
    };
    pendingInvite: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    auditLogEntry: { create: jest.Mock; findMany: jest.Mock };
    activityEvent: { create: jest.Mock };
    notification: { create: jest.Mock };
    notificationPreference: { findUnique: jest.Mock };
    publishRecord: { findMany: jest.Mock };
    project: { count: jest.Mock };
    video: { count: jest.Mock };
    campaign: { count: jest.Mock };
    recurringSchedule: { count: jest.Mock };
    trackedLink: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let access: { assertMinRole: jest.Mock; getRole: jest.Mock };
  let mailService: { sendWorkspaceInviteEmail: jest.Mock };
  let notificationPublisher: { publish: jest.Mock };
  let notificationDeliveryProducer: { enqueue: jest.Mock };

  beforeEach(() => {
    prisma = {
      workspace: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      pendingInvite: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
      activityEvent: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      publishRecord: { findMany: jest.fn().mockResolvedValue([]) },
      project: { count: jest.fn().mockResolvedValue(0) },
      video: { count: jest.fn().mockResolvedValue(0) },
      campaign: { count: jest.fn().mockResolvedValue(0) },
      recurringSchedule: { count: jest.fn().mockResolvedValue(0) },
      trackedLink: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    // Handles both $transaction call shapes this service uses: a callback
    // (create/acceptInvite) and an array of already-in-flight operations
    // (transferOwnership).
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    );
    access = {
      assertMinRole: jest.fn().mockResolvedValue('ADMIN'),
      getRole: jest.fn().mockResolvedValue('OWNER'),
    };
    mailService = { sendWorkspaceInviteEmail: jest.fn().mockResolvedValue(undefined) };
    notificationPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    notificationDeliveryProducer = { enqueue: jest.fn().mockResolvedValue(undefined) };

    service = new WorkspaceService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
      mailService as unknown as MailService,
      notificationPublisher as unknown as NotificationPublisherService,
      notificationDeliveryProducer as unknown as NotificationDeliveryProducer,
    );
  });

  describe('create', () => {
    it('creates a Workspace and an OWNER membership for the creator', async () => {
      prisma.workspace.create.mockResolvedValue({
        id: 'ws-1',
        name: 'Acme',
        isPersonal: false,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      const result = await service.create('user-1', 'Acme');

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { name: 'Acme', isPersonal: false, ownerId: 'user-1' },
      });
      expect(prisma.workspaceMembership.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-1', role: 'OWNER' },
      });
      expect(result).toMatchObject({ id: 'ws-1', role: 'OWNER', memberCount: 1 });
    });
  });

  describe('createInvite', () => {
    it('creates a PendingInvite, sends the email, and records an audit log entry', async () => {
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ id: 'ws-1', name: 'Acme' });
      prisma.pendingInvite.create.mockResolvedValue({
        id: 'invite-1',
        workspaceId: 'ws-1',
        email: 'friend@example.com',
        role: 'EDITOR',
        status: 'PENDING',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      const result = await service.createInvite(
        'admin-1',
        'admin@example.com',
        'ws-1',
        { email: 'friend@example.com', role: 'EDITOR' as never },
        'https://app.test',
      );

      expect(access.assertMinRole).toHaveBeenCalledWith('admin-1', 'ws-1', 'ADMIN');
      expect(mailService.sendWorkspaceInviteEmail).toHaveBeenCalledWith(
        'friend@example.com',
        'admin@example.com',
        'Acme',
        'EDITOR',
        expect.stringContaining('https://app.test/invites/'),
      );
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'INVITE_CREATED',
          actorId: 'admin-1',
          targetType: 'PendingInvite',
          targetId: 'invite-1',
        }),
      });
      expect(result.id).toBe('invite-1');
    });
  });

  describe('acceptInvite', () => {
    const invite = {
      id: 'invite-1',
      inviterId: 'admin-1',
      workspaceId: 'ws-1',
      email: 'friend@example.com',
      role: 'EDITOR',
      status: 'PENDING',
      createdAt: new Date(),
      workspace: { name: 'Acme' },
    };

    it('creates the membership, marks the invite accepted, and records an audit log entry', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue(invite);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({
        id: 'ws-1',
        name: 'Acme',
        isPersonal: false,
        createdAt: new Date(),
      });

      await service.acceptInvite('user-2', 'friend@example.com', 'raw-token');

      expect(prisma.workspaceMembership.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' } },
        create: { workspaceId: 'ws-1', userId: 'user-2', role: 'EDITOR' },
        update: { role: 'EDITOR' },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'INVITE_ACCEPTED',
          actorId: 'user-2',
          targetId: 'invite-1',
        }),
      });
    });

    it('records a MEMBER_INVITATION_ACCEPTED notification for the inviter (Milestone 04f)', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue(invite);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({
        id: 'ws-1',
        name: 'Acme',
        isPersonal: false,
        createdAt: new Date(),
      });

      await service.acceptInvite('user-2', 'friend@example.com', 'raw-token');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          type: 'MEMBER_INVITATION_ACCEPTED',
        }),
      });
      expect(notificationPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', type: 'MEMBER_INVITATION_ACCEPTED' }),
      );
      expect(notificationDeliveryProducer.enqueue).toHaveBeenCalledWith({
        notificationId: 'notif-1',
      });
    });

    it('skips the notification when the inviter accepts their own invite', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue({ ...invite, inviterId: 'user-2' });
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({
        id: 'ws-1',
        name: 'Acme',
        isPersonal: false,
        createdAt: new Date(),
      });

      await service.acceptInvite('user-2', 'friend@example.com', 'raw-token');

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the accepting email does not match', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue(invite);

      await expect(
        service.acceptInvite('user-2', 'someone-else@example.com', 'raw-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the invite is not PENDING', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue({ ...invite, status: 'REVOKED' });

      await expect(
        service.acceptInvite('user-2', 'friend@example.com', 'raw-token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown token', async () => {
      prisma.pendingInvite.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvite('user-2', 'friend@example.com', 'raw-token'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMemberRole', () => {
    it('updates the role and records an audit log entry with old/new roles', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'EDITOR' });

      await service.updateMemberRole('admin-1', 'ws-1', 'user-2', 'REVIEWER' as never);

      expect(prisma.workspaceMembership.update).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' } },
        data: { role: 'REVIEWER' },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'MEMBER_ROLE_CHANGED',
          targetId: 'user-2',
          metadata: { oldRole: 'EDITOR', newRole: 'REVIEWER' },
        }),
      });
    });

    it('throws BadRequestException when demoting the last OWNER', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.workspaceMembership.count.mockResolvedValue(1);

      await expect(
        service.updateMemberRole('admin-1', 'ws-1', 'user-2', 'ADMIN' as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workspaceMembership.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target is not a member', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('admin-1', 'ws-1', 'missing-user', 'EDITOR' as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects granting OWNER through this route (Transfer Ownership roadmap)', async () => {
      await expect(
        service.updateMemberRole('admin-1', 'ws-1', 'user-2', 'OWNER' as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workspaceMembership.update).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('deletes the membership and records an audit log entry', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'EDITOR' });

      await service.removeMember('admin-1', 'ws-1', 'user-2');

      expect(prisma.workspaceMembership.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' } },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'MEMBER_REMOVED',
          targetId: 'user-2',
          metadata: { role: 'EDITOR' },
        }),
      });
    });

    it('throws BadRequestException when removing the last OWNER', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.workspaceMembership.count.mockResolvedValue(1);

      await expect(service.removeMember('admin-1', 'ws-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.workspaceMembership.delete).not.toHaveBeenCalled();
    });
  });

  describe('transferOwnership', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Acme',
      isPersonal: false,
      ownerId: 'owner-1',
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
    };

    it('updates ownerId, demotes the old owner, promotes the new owner, and records an audit log entry', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue(workspace);
      prisma.workspaceMembership.findUnique.mockResolvedValue({
        role: 'EDITOR',
        user: { email: 'newowner@example.com' },
      });
      access.getRole.mockResolvedValue('ADMIN');

      const result = await service.transferOwnership('owner-1', 'ws-1', 'user-2');

      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: { ownerId: 'user-2' },
      });
      expect(prisma.workspaceMembership.update).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'owner-1' } },
        data: { role: 'ADMIN' },
      });
      expect(prisma.workspaceMembership.update).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' } },
        data: { role: 'OWNER' },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
          actorId: 'owner-1',
          targetType: 'Workspace',
          targetId: 'ws-1',
          metadata: { fromUserId: 'owner-1', toUserId: 'user-2', toEmail: 'newowner@example.com' },
        }),
      });
      expect(result.id).toBe('ws-1');
    });

    it('records a WORKSPACE_OWNERSHIP_TRANSFERRED notification for the new owner', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue(workspace);
      prisma.workspaceMembership.findUnique.mockResolvedValue({
        role: 'EDITOR',
        user: { email: 'newowner@example.com' },
      });

      await service.transferOwnership('owner-1', 'ws-1', 'user-2');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-2',
          type: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
        }),
      });
      expect(notificationPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-2', type: 'WORKSPACE_OWNERSHIP_TRANSFERRED' }),
      );
    });

    it('throws NotFoundException for an unknown workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.transferOwnership('owner-1', 'ws-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects transferring a personal workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue({ ...workspace, isPersonal: true });

      await expect(service.transferOwnership('owner-1', 'ws-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    it('rejects when the requester is not the current owner', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      await expect(service.transferOwnership('not-the-owner', 'ws-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    it('rejects transferring to self', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      await expect(service.transferOwnership('owner-1', 'ws-1', 'owner-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    it('rejects when the recipient is not already a member', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.workspaceMembership.findUnique.mockResolvedValue(null);

      await expect(service.transferOwnership('owner-1', 'ws-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Acme',
      isPersonal: false,
      ownerId: 'owner-1',
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
    };

    it('runs the precondition checks and the delete inside one $transaction', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      await service.remove('owner-1', 'ws-1');

      // Every count check + workspace.delete() must go through the same
      // $transaction call - see remove()'s own comment on why this closes
      // the race where a resource created between the checks and the
      // delete would otherwise get silently swept into the cascade instead
      // of blocking it.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });

    it('deletes an empty workspace and records a WORKSPACE_DELETED activity event', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      await service.remove('owner-1', 'ws-1');

      expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: 'ws-1' } });
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'owner-1',
          type: 'WORKSPACE_DELETED',
          metadata: { workspaceId: 'ws-1', name: 'Acme' },
        }),
      });
      // See AuditAction's schema comment - this event must never be written
      // to AuditLogEntry, since it would be cascade-deleted with the
      // workspace it describes in the same statement.
      expect(prisma.auditLogEntry.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(NotFoundException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a personal workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue({ ...workspace, isPersonal: true });

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(BadRequestException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the requester is not the current owner', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      await expect(service.remove('not-the-owner', 'ws-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still has other members', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.workspaceMembership.count.mockResolvedValue(2);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still contains projects', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.project.count.mockResolvedValue(1);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still contains videos', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.video.count.mockResolvedValue(1);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still has campaigns', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.campaign.count.mockResolvedValue(1);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still has recurring schedules', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.recurringSchedule.count.mockResolvedValue(1);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('rejects when the workspace still has tracked links', async () => {
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.trackedLink.count.mockResolvedValue(1);

      await expect(service.remove('owner-1', 'ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    it('deletes the membership and records a WORKSPACE_LEFT audit log entry', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'EDITOR' });

      await service.leave('user-2', 'ws-1');

      expect(prisma.workspaceMembership.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' } },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'WORKSPACE_LEFT',
          actorId: 'user-2',
          targetType: 'WorkspaceMembership',
          targetId: 'user-2',
          metadata: { role: 'EDITOR' },
        }),
      });
    });

    it('rejects when the OWNER tries to leave', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue({ role: 'OWNER' });

      await expect(service.leave('owner-1', 'ws-1')).rejects.toThrow(BadRequestException);
      expect(prisma.workspaceMembership.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the requester is not a member', async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue(null);

      await expect(service.leave('user-2', 'ws-1')).rejects.toThrow(NotFoundException);
      expect(prisma.workspaceMembership.delete).not.toHaveBeenCalled();
    });
  });

  describe('listAuditLog', () => {
    it('requires ADMIN+ and maps entries to DTOs', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([
        {
          id: 'log-1',
          action: 'MEMBER_REMOVED',
          actor: { email: 'admin@example.com' },
          targetType: 'WorkspaceMembership',
          targetId: 'user-2',
          metadata: { role: 'EDITOR' },
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      ]);

      const result = await service.listAuditLog('admin-1', 'ws-1', { limit: 20 });

      expect(access.assertMinRole).toHaveBeenCalledWith('admin-1', 'ws-1', 'ADMIN');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        id: 'log-1',
        action: 'MEMBER_REMOVED',
        actorEmail: 'admin@example.com',
      });
      expect(result.nextCursor).toBeNull();
    });

    it('paginates via cursor and reports nextCursor when there are more rows than the limit', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([
        {
          id: 'log-2',
          action: 'MEMBER_REMOVED',
          actor: { email: 'a@example.com' },
          targetType: 'WorkspaceMembership',
          targetId: null,
          metadata: null,
          createdAt: new Date(),
        },
        {
          id: 'log-1',
          action: 'MEMBER_REMOVED',
          actor: { email: 'a@example.com' },
          targetType: 'WorkspaceMembership',
          targetId: null,
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listAuditLog('admin-1', 'ws-1', { limit: 1 });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
      expect(result.entries).toHaveLength(1);
      expect(result.nextCursor).toBe('log-2');
    });
  });

  describe('getCalendar', () => {
    const start = new Date('2026-07-01T00:00:00.000Z');
    const end = new Date('2026-08-01T00:00:00.000Z');

    function baseRecord(overrides: Record<string, unknown> = {}) {
      return {
        id: 'record-1',
        clipId: 'clip-1',
        status: 'PUBLISHED',
        scheduledAt: null as Date | null,
        publishedAt: null as Date | null,
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        errorMessage: null,
        clip: { hookText: 'Wait for it' },
        socialAccount: { platform: 'TIKTOK' },
        campaign: null as { id: string; name: string } | null,
        ...overrides,
      };
    }

    it('requires VIEWER+ and queries by clip.video.workspaceId with the [start, end) range', async () => {
      await service.getCalendar('user-1', 'ws-1', start, end);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(prisma.publishRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clip: { video: { workspaceId: 'ws-1' } } }),
        }),
      );
    });

    it('uses publishedAt as the display date when set', async () => {
      const publishedAt = new Date('2026-07-15T12:00:00.000Z');
      prisma.publishRecord.findMany.mockResolvedValue([
        baseRecord({ publishedAt, scheduledAt: null }),
      ]);

      const result = await service.getCalendar('user-1', 'ws-1', start, end);

      expect(result.entries[0].date).toBe(publishedAt.toISOString());
    });

    it('falls back to scheduledAt when publishedAt is not set', async () => {
      const scheduledAt = new Date('2026-07-20T09:00:00.000Z');
      prisma.publishRecord.findMany.mockResolvedValue([
        baseRecord({ scheduledAt, publishedAt: null, status: 'SCHEDULED' }),
      ]);

      const result = await service.getCalendar('user-1', 'ws-1', start, end);

      expect(result.entries[0].date).toBe(scheduledAt.toISOString());
    });

    it('falls back to createdAt when neither scheduledAt nor publishedAt is set', async () => {
      const createdAt = new Date('2026-07-05T08:00:00.000Z');
      prisma.publishRecord.findMany.mockResolvedValue([
        baseRecord({ scheduledAt: null, publishedAt: null, createdAt, status: 'QUEUED' }),
      ]);

      const result = await service.getCalendar('user-1', 'ws-1', start, end);

      expect(result.entries[0].date).toBe(createdAt.toISOString());
    });

    it('maps platform/clipHookText/campaign onto the entry, null campaign when unset', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        baseRecord({
          publishedAt: new Date('2026-07-15T12:00:00.000Z'),
          campaign: { id: 'camp-1', name: 'Launch Week' },
        }),
      ]);

      const result = await service.getCalendar('user-1', 'ws-1', start, end);

      expect(result.entries[0]).toMatchObject({
        id: 'record-1',
        clipId: 'clip-1',
        clipHookText: 'Wait for it',
        platform: 'TIKTOK',
        status: 'PUBLISHED',
        campaignId: 'camp-1',
        campaignName: 'Launch Week',
        errorMessage: null,
      });
    });

    it('returns null campaignId/campaignName when the record has no campaign', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        baseRecord({ publishedAt: new Date('2026-07-15T12:00:00.000Z'), campaign: null }),
      ]);

      const result = await service.getCalendar('user-1', 'ws-1', start, end);

      expect(result.entries[0].campaignId).toBeNull();
      expect(result.entries[0].campaignName).toBeNull();
    });
  });
});

// Contract Governance audit (2026-08-01) - proves mapWorkspaceRole/
// mapPendingInviteStatus/mapAuditAction (the replacement for the old
// `as unknown as` casts) round-trip every real Prisma enum member. If a
// future schema.prisma addition isn't wired into these mappers, the build
// fails before this test can even run (assertNever) - this test guards the
// mapping's runtime correctness, not its exhaustiveness, which is a
// compile-time guarantee.
describe('mapWorkspaceRole', () => {
  it('maps every known Prisma WorkspaceRole to its shared counterpart', () => {
    expect(mapWorkspaceRole('OWNER')).toBe(WorkspaceRole.OWNER);
    expect(mapWorkspaceRole('ADMIN')).toBe(WorkspaceRole.ADMIN);
    expect(mapWorkspaceRole('EDITOR')).toBe(WorkspaceRole.EDITOR);
    expect(mapWorkspaceRole('REVIEWER')).toBe(WorkspaceRole.REVIEWER);
    expect(mapWorkspaceRole('VIEWER')).toBe(WorkspaceRole.VIEWER);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapWorkspaceRole('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});

describe('mapPendingInviteStatus', () => {
  it('maps every known Prisma PendingInviteStatus to its shared counterpart', () => {
    expect(mapPendingInviteStatus('PENDING')).toBe(PendingInviteStatus.PENDING);
    expect(mapPendingInviteStatus('ACCEPTED')).toBe(PendingInviteStatus.ACCEPTED);
    expect(mapPendingInviteStatus('REVOKED')).toBe(PendingInviteStatus.REVOKED);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapPendingInviteStatus('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});

describe('mapAuditAction', () => {
  it('maps every known Prisma AuditAction to its shared counterpart, including the 4 the audit found missing from packages/shared', () => {
    const rawActions = [
      'MEMBER_ROLE_CHANGED',
      'MEMBER_REMOVED',
      'INVITE_CREATED',
      'INVITE_ACCEPTED',
      'PROJECT_CREATED',
      'PROJECT_DELETED',
      'PROJECT_ARCHIVED',
      'PROJECT_UNARCHIVED',
      'PROJECT_MOVED',
      'WORKSPACE_OWNERSHIP_TRANSFERRED',
      'FOLDER_CREATED',
      'FOLDER_DELETED',
      'VIDEO_MOVED',
      'VIDEO_DELETED',
      'CLIP_DELETED',
      'SHARE_LINK_CREATED',
      'SHARE_LINK_REVOKED',
      'APPROVAL_DECIDED',
      'CAMPAIGN_CREATED',
      'CAMPAIGN_CANCELLED',
      'RECURRING_SCHEDULE_CREATED',
      'RECURRING_SCHEDULE_DELETED',
      'WORKSPACE_LEFT',
    ] as const;
    for (const raw of rawActions) {
      expect(mapAuditAction(raw)).toBe(AuditAction[raw]);
    }
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapAuditAction('SOMETHING_NEW' as never)).toThrow(/Unhandled enum value/);
  });
});
