import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PublishStatus, recordAuditLog, WorkspaceRole, type RecurringSchedule } from '@speedora/database';
import type { RecurringScheduleDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccountsService } from '../social/social.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import type { CreateRecurringScheduleDto } from './dto/create-recurring-schedule.dto';
import type { UpdateRecurringScheduleDto } from './dto/update-recurring-schedule.dto';
import { computeNextSlot } from './next-slot.util';

function toDto(schedule: RecurringSchedule): RecurringScheduleDto {
  return {
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    name: schedule.name,
    platform: schedule.platform as unknown as RecurringScheduleDto['platform'],
    socialAccountId: schedule.socialAccountId,
    timezone: schedule.timezone,
    daysOfWeek: schedule.daysOfWeek,
    timeOfDay: schedule.timeOfDay,
    active: schedule.active,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

// `Intl` is the only thing that actually knows the full IANA timezone
// database - there's no realistic way to validate a timezone string
// without asking it. An invalid zone throws a RangeError on construction.
function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new BadRequestException(`Invalid IANA timezone: "${timezone}"`);
  }
}

// Publishing Expansion Phase 6 (Scheduling). Same EDITOR-to-create/ADMIN-
// to-delete role split as ProjectService, and the same "log create/delete,
// not every plain edit" audit posture.
@Injectable()
export class RecurringSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly socialAccounts: SocialAccountsService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateRecurringScheduleDto,
  ): Promise<RecurringScheduleDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.EDITOR);
    assertValidTimezone(dto.timezone);

    // Throws NotFoundException if the account doesn't exist or belongs to
    // someone else - same ownership check ClipsService.publish() already
    // uses for a one-off publish (see CLAUDE.md's Publish Center section on
    // SocialAccount being userId-scoped, not workspace-scoped).
    const account = await this.socialAccounts.findOwnedOrThrow(dto.socialAccountId, userId);
    if (account.platform !== (dto.platform as unknown as typeof account.platform)) {
      throw new BadRequestException(
        `Social account ${dto.socialAccountId} is a ${account.platform} account, not ${dto.platform}`,
      );
    }

    const schedule = await this.prisma.recurringSchedule.create({
      data: {
        workspaceId,
        name: dto.name,
        platform: dto.platform as unknown as typeof account.platform,
        socialAccountId: dto.socialAccountId,
        timezone: dto.timezone,
        daysOfWeek: dto.daysOfWeek,
        timeOfDay: dto.timeOfDay,
      },
    });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'RECURRING_SCHEDULE_CREATED',
      actorId: userId,
      targetType: 'RecurringSchedule',
      targetId: schedule.id,
      metadata: { name: dto.name, platform: dto.platform },
    }).catch(() => {});

    return toDto(schedule);
  }

  async listByWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ recurringSchedules: RecurringScheduleDto[] }> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);
    const schedules = await this.prisma.recurringSchedule.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
    });
    return { recurringSchedules: schedules.map(toDto) };
  }

  private async findOrThrow(id: string): Promise<RecurringSchedule> {
    const schedule = await this.prisma.recurringSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new NotFoundException(`Recurring schedule ${id} not found`);
    }
    return schedule;
  }

  async get(userId: string, id: string): Promise<RecurringScheduleDto> {
    const schedule = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, schedule.workspaceId, WorkspaceRole.VIEWER);
    return toDto(schedule);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRecurringScheduleDto,
  ): Promise<RecurringScheduleDto> {
    const schedule = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, schedule.workspaceId, WorkspaceRole.EDITOR);
    if (dto.timezone) assertValidTimezone(dto.timezone);

    const updated = await this.prisma.recurringSchedule.update({
      where: { id },
      data: {
        name: dto.name,
        timezone: dto.timezone,
        daysOfWeek: dto.daysOfWeek,
        timeOfDay: dto.timeOfDay,
        active: dto.active,
      },
    });
    return toDto(updated);
  }

  // Hard delete - existing PublishRecords just detach (onDelete: SetNull on
  // PublishRecord.recurringScheduleId, see schema.prisma) rather than being
  // deleted or cancelled, so a completed/in-flight job never vanishes
  // because its schedule was cleaned up afterward.
  async remove(userId: string, id: string): Promise<void> {
    const schedule = await this.findOrThrow(id);
    await this.access.assertMinRole(userId, schedule.workspaceId, WorkspaceRole.ADMIN);
    await this.prisma.recurringSchedule.delete({ where: { id } });

    await recordAuditLog(this.prisma, {
      workspaceId: schedule.workspaceId,
      action: 'RECURRING_SCHEDULE_DELETED',
      actorId: userId,
      targetType: 'RecurringSchedule',
      targetId: id,
      metadata: { name: schedule.name },
    }).catch(() => {});
  }

  // Used by ClipsService.publish() when a clip is queued against a
  // recurringScheduleId - validates the schedule belongs to the clip's own
  // workspace and is active, that the caller-supplied socialAccountId
  // matches the schedule's own account (catches a stale/wrong client state
  // rather than silently overriding it), and returns the next open slot.
  // No role check here - ClipsService.publish() already asserted EDITOR on
  // the clip's own workspace before calling this.
  async resolveSlotForQueue(
    workspaceId: string,
    recurringScheduleId: string,
    socialAccountId: string,
  ): Promise<Date> {
    const schedule = await this.findOrThrow(recurringScheduleId);
    if (schedule.workspaceId !== workspaceId) {
      throw new NotFoundException(`Recurring schedule ${recurringScheduleId} not found`);
    }
    if (!schedule.active) {
      throw new BadRequestException(`Recurring schedule ${recurringScheduleId} is not active`);
    }
    if (schedule.socialAccountId !== socialAccountId) {
      throw new BadRequestException(
        `socialAccountId does not match recurring schedule ${recurringScheduleId}'s own account`,
      );
    }

    // The next slot is assigned strictly after both "now" and the latest
    // slot already claimed by another job on this same schedule, so
    // multiple clips queued in quick succession land on distinct slots
    // rather than piling onto the same one.
    const lastJob = await this.prisma.publishRecord.findFirst({
      where: {
        recurringScheduleId,
        scheduledAt: { not: null },
        status: { in: [PublishStatus.SCHEDULED, PublishStatus.QUEUED, PublishStatus.PUBLISHED] },
      },
      orderBy: { scheduledAt: 'desc' },
      select: { scheduledAt: true },
    });
    const now = new Date();
    const after = lastJob?.scheduledAt && lastJob.scheduledAt > now ? lastJob.scheduledAt : now;
    return computeNextSlot(schedule, after);
  }
}
