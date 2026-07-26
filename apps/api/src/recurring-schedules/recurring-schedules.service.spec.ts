import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialPlatform } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import type { SocialAccountsService } from '../social/social.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { RecurringSchedulesService } from './recurring-schedules.service';

describe('RecurringSchedulesService', () => {
  let service: RecurringSchedulesService;
  let prisma: {
    recurringSchedule: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    publishRecord: { findFirst: jest.Mock };
    auditLogEntry: { create: jest.Mock };
  };
  let access: { assertMinRole: jest.Mock };
  let socialAccounts: { findOwnedOrThrow: jest.Mock };

  const baseSchedule = {
    id: 'schedule-1',
    workspaceId: 'ws-1',
    name: 'TikTok mornings',
    platform: SocialPlatform.TIKTOK,
    socialAccountId: 'account-1',
    timezone: 'Asia/Jakarta',
    daysOfWeek: [1, 3, 5],
    timeOfDay: '09:00',
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      recurringSchedule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      publishRecord: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    access = { assertMinRole: jest.fn().mockResolvedValue('EDITOR') };
    socialAccounts = {
      findOwnedOrThrow: jest.fn().mockResolvedValue({ platform: SocialPlatform.TIKTOK }),
    };

    service = new RecurringSchedulesService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
      socialAccounts as unknown as SocialAccountsService,
    );
  });

  describe('create', () => {
    const dto = {
      name: 'TikTok mornings',
      platform: SocialPlatform.TIKTOK,
      socialAccountId: 'account-1',
      timezone: 'Asia/Jakarta',
      daysOfWeek: [1, 3, 5],
      timeOfDay: '09:00',
    };

    it('requires EDITOR+, validates account ownership/platform, and creates the schedule', async () => {
      prisma.recurringSchedule.create.mockResolvedValue(baseSchedule);

      const result = await service.create('user-1', 'ws-1', dto as never);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(socialAccounts.findOwnedOrThrow).toHaveBeenCalledWith('account-1', 'user-1');
      expect(prisma.recurringSchedule.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          name: 'TikTok mornings',
          platform: SocialPlatform.TIKTOK,
          socialAccountId: 'account-1',
          timezone: 'Asia/Jakarta',
          daysOfWeek: [1, 3, 5],
          timeOfDay: '09:00',
        },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'RECURRING_SCHEDULE_CREATED',
          targetId: 'schedule-1',
        }),
      });
      expect(result.id).toBe('schedule-1');
    });

    it('throws when the social account platform does not match the requested platform', async () => {
      socialAccounts.findOwnedOrThrow.mockResolvedValue({ platform: SocialPlatform.YOUTUBE });

      await expect(service.create('user-1', 'ws-1', dto as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringSchedule.create).not.toHaveBeenCalled();
    });

    it('throws on an invalid IANA timezone', async () => {
      await expect(
        service.create('user-1', 'ws-1', { ...dto, timezone: 'Not/AZone' } as never),
      ).rejects.toThrow(/Invalid IANA timezone/);
      expect(prisma.recurringSchedule.create).not.toHaveBeenCalled();
    });
  });

  describe('listByWorkspace', () => {
    it('requires VIEWER+ and lists schedules for the workspace', async () => {
      prisma.recurringSchedule.findMany.mockResolvedValue([baseSchedule]);

      const result = await service.listByWorkspace('user-1', 'ws-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(result.recurringSchedules).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('requires EDITOR+ and updates the schedule', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);
      prisma.recurringSchedule.update.mockResolvedValue({ ...baseSchedule, active: false });

      const result = await service.update('user-1', 'schedule-1', { active: false });

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.recurringSchedule.update).toHaveBeenCalledWith({
        where: { id: 'schedule-1' },
        data: {
          name: undefined,
          timezone: undefined,
          daysOfWeek: undefined,
          timeOfDay: undefined,
          active: false,
        },
      });
      expect(result.active).toBe(false);
    });

    it('throws NotFoundException for a missing schedule', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(null);

      await expect(service.update('user-1', 'missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('requires ADMIN+, deletes the schedule, and records an audit log entry', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);

      await service.remove('admin-1', 'schedule-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('admin-1', 'ws-1', 'ADMIN');
      expect(prisma.recurringSchedule.delete).toHaveBeenCalledWith({ where: { id: 'schedule-1' } });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'RECURRING_SCHEDULE_DELETED' }),
      });
    });
  });

  describe('resolveSlotForQueue', () => {
    it('computes the next slot from now when no jobs are queued against the schedule yet', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);
      prisma.publishRecord.findFirst.mockResolvedValue(null);
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T03:00:00Z')); // past Monday 09:00 Jakarta

      const slot = await service.resolveSlotForQueue('ws-1', 'schedule-1', 'account-1');

      expect(slot.toISOString()).toBe('2024-01-03T02:00:00.000Z'); // next Wed 09:00 Jakarta
      jest.useRealTimers();
    });

    it('assigns the slot after the latest already-claimed slot on the same schedule', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);
      prisma.publishRecord.findFirst.mockResolvedValue({
        scheduledAt: new Date('2024-01-03T02:00:00.000Z'), // Wednesday's slot already taken
      });
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const slot = await service.resolveSlotForQueue('ws-1', 'schedule-1', 'account-1');

      expect(slot.toISOString()).toBe('2024-01-05T02:00:00.000Z'); // next Friday 09:00 Jakarta
      jest.useRealTimers();
    });

    it('throws NotFoundException when the schedule belongs to a different workspace', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);

      await expect(
        service.resolveSlotForQueue('other-ws', 'schedule-1', 'account-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the schedule is inactive', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue({ ...baseSchedule, active: false });

      await expect(service.resolveSlotForQueue('ws-1', 'schedule-1', 'account-1')).rejects.toThrow(
        /is not active/,
      );
    });

    it('throws BadRequestException when socialAccountId does not match the schedule', async () => {
      prisma.recurringSchedule.findUnique.mockResolvedValue(baseSchedule);

      await expect(
        service.resolveSlotForQueue('ws-1', 'schedule-1', 'wrong-account'),
      ).rejects.toThrow(/does not match recurring schedule/);
    });
  });
});
