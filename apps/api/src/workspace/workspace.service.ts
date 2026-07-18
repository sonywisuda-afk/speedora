import * as crypto from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PendingInviteStatus, WorkspaceRole } from '@speedora/database';
import { recordActivityEvent, recordAuditLog, recordNotification } from '@speedora/database';
import type {
  AuditLogEntryDto,
  AuditLogListDto,
  CalendarDto,
  CalendarEntryDto,
  PendingInviteDto,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@speedora/shared';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import { WorkspaceAccessService } from './workspace-access.service';

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same order of
// magnitude as password-reset's 1 hour is deliberately longer - an invite
// sits in someone's inbox far longer than a reset link before they act on
// it.

// Sprint 5A (Collaboration Foundation). Owns Workspace CRUD, membership
// management, and the invite create/accept lifecycle - replaces
// apps/api/src/team's TeamService (retired, see its own final comment in
// git history) now that a real Workspace/Membership schema exists.
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly mailService: MailService,
    private readonly notificationPublisher: NotificationPublisherService,
    private readonly notificationDeliveryProducer: NotificationDeliveryProducer,
  ) {}

  private async toDto(workspaceId: string, requesterId: string): Promise<WorkspaceDto> {
    const [workspace, role, memberCount] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.access.getRole(requesterId, workspaceId),
      this.prisma.workspaceMembership.count({ where: { workspaceId } }),
    ]);
    return {
      id: workspace.id,
      name: workspace.name,
      isPersonal: workspace.isPersonal,
      // Always non-null here - every caller of this method has already
      // passed an assertMinRole/membership check for this workspaceId.
      // Prisma's own WorkspaceRole and @speedora/shared's are nominally
      // distinct TS types even though they share the same runtime string
      // values - same "cast at the one call site that needs it" convention
      // as ExportService.toDto().
      role: role as unknown as WorkspaceDto['role'],
      memberCount,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  private toInviteDto(invite: {
    id: string;
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    status: PendingInviteStatus;
    createdAt: Date;
  }): PendingInviteDto {
    return {
      id: invite.id,
      workspaceId: invite.workspaceId,
      email: invite.email,
      role: invite.role as unknown as PendingInviteDto['role'],
      status: invite.status as unknown as PendingInviteDto['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  async create(userId: string, name: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: { name, isPersonal: false, ownerId: userId },
      });
      await tx.workspaceMembership.create({
        data: { workspaceId: created.id, userId, role: WorkspaceRole.OWNER },
      });
      return created;
    });

    return {
      id: workspace.id,
      name: workspace.name,
      isPersonal: workspace.isPersonal,
      role: WorkspaceRole.OWNER as unknown as WorkspaceDto['role'],
      memberCount: 1,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async listMine(userId: string): Promise<{ workspaces: WorkspaceDto[] }> {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { workspace: { createdAt: 'asc' } },
    });

    const workspaces = await Promise.all(
      memberships.map(async (m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        isPersonal: m.workspace.isPersonal,
        role: m.role as unknown as WorkspaceDto['role'],
        memberCount: await this.prisma.workspaceMembership.count({
          where: { workspaceId: m.workspaceId },
        }),
        createdAt: m.workspace.createdAt.toISOString(),
      })),
    );

    return { workspaces };
  }

  async getDetail(userId: string, workspaceId: string): Promise<WorkspaceDetailDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const members: WorkspaceMemberDto[] = memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role as unknown as WorkspaceMemberDto['role'],
      createdAt: m.createdAt.toISOString(),
    }));

    const dto = await this.toDto(workspaceId, userId);
    return { ...dto, members };
  }

  async update(userId: string, workspaceId: string, name: string): Promise<WorkspaceDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.ADMIN);
    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
    return this.toDto(workspaceId, userId);
  }

  async createInvite(
    inviterId: string,
    inviterEmail: string,
    workspaceId: string,
    input: { email: string; role: WorkspaceRole },
    webOrigin: string,
  ): Promise<PendingInviteDto> {
    await this.access.assertMinRole(inviterId, workspaceId, WorkspaceRole.ADMIN);

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });

    // Same "raw token only ever exists here and in the emailed link, only
    // its SHA-256 hash is persisted" convention as AuthService's
    // password-reset flow.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invite = await this.prisma.pendingInvite.create({
      data: {
        inviterId,
        workspaceId,
        email: input.email,
        role: input.role,
        tokenHash,
      },
    });

    const acceptUrl = `${webOrigin}/invites/${rawToken}/accept`;
    await this.mailService.sendWorkspaceInviteEmail(
      input.email,
      inviterEmail,
      workspace.name,
      input.role,
      acceptUrl,
    );

    await recordActivityEvent(this.prisma, {
      userId: inviterId,
      type: 'MEMBER_INVITED',
      metadata: { email: input.email, role: input.role, workspaceId },
    }).catch(() => {
      // Best-effort, same posture as every other recordActivityEvent call
      // site - the invite itself (create + email) already succeeded.
    });
    // Sprint 5F (Audit Log) - same best-effort posture: a lost audit row
    // must never fail the invite itself.
    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'INVITE_CREATED',
      actorId: inviterId,
      targetType: 'PendingInvite',
      targetId: invite.id,
      metadata: { email: input.email, role: input.role },
    }).catch(() => {});

    return this.toInviteDto(invite);
  }

  async listInvites(userId: string, workspaceId: string): Promise<{ invites: PendingInviteDto[] }> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.ADMIN);
    const invites = await this.prisma.pendingInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return { invites: invites.map((i) => this.toInviteDto(i)) };
  }

  async previewInvite(rawToken: string): Promise<{
    email: string;
    role: WorkspaceRole;
    workspaceName: string;
    status: PendingInviteStatus;
  }> {
    const invite = await this.findInviteByRawToken(rawToken);
    return {
      email: invite.email,
      role: invite.role,
      workspaceName: invite.workspace.name,
      status: invite.status,
    };
  }

  async acceptInvite(userId: string, userEmail: string, rawToken: string): Promise<WorkspaceDto> {
    const invite = await this.findInviteByRawToken(rawToken);

    if (invite.status !== PendingInviteStatus.PENDING) {
      throw new BadRequestException('This invite has already been used or revoked');
    }
    if (invite.createdAt.getTime() + INVITE_TOKEN_TTL_MS < Date.now()) {
      throw new BadRequestException('This invite has expired');
    }
    if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException('This invite was sent to a different email address');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        create: { workspaceId: invite.workspaceId, userId, role: invite.role },
        update: { role: invite.role },
      });
      await tx.pendingInvite.update({
        where: { id: invite.id },
        data: { status: PendingInviteStatus.ACCEPTED },
      });
    });

    await recordActivityEvent(this.prisma, {
      userId,
      type: 'MEMBER_INVITED',
      metadata: { workspaceId: invite.workspaceId, accepted: true },
    }).catch(() => {});
    await recordAuditLog(this.prisma, {
      workspaceId: invite.workspaceId,
      action: 'INVITE_ACCEPTED',
      actorId: userId,
      targetType: 'PendingInvite',
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role },
    }).catch(() => {});

    // Milestone 04f - the last of the four originally "Collaboration-
    // blocked" notification types (see NotificationType's own schema
    // comment). Fires to the inviter, same best-effort/never-fail-the-
    // primary-action posture as every other recordNotification call site.
    if (invite.inviterId !== userId) {
      await recordNotification(
        this.prisma,
        {
          userId: invite.inviterId,
          type: 'MEMBER_INVITATION_ACCEPTED',
          title: 'Undangan diterima',
          body: `${userEmail} bergabung ke workspace "${invite.workspace.name}"`,
          metadata: { workspaceId: invite.workspaceId },
        },
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      ).catch((error) =>
        this.logger.warn(`failed to record MEMBER_INVITATION_ACCEPTED notification: ${error}`),
      );
    }

    return this.toDto(invite.workspaceId, userId);
  }

  async updateMemberRole(
    requesterId: string,
    workspaceId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await this.access.assertMinRole(requesterId, workspaceId, WorkspaceRole.ADMIN);
    const previous = await this.assertNotLastOwnerChange(workspaceId, targetUserId, role);

    await this.prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role },
    });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'MEMBER_ROLE_CHANGED',
      actorId: requesterId,
      targetType: 'WorkspaceMembership',
      targetId: targetUserId,
      metadata: { oldRole: previous.role, newRole: role },
    }).catch(() => {});
  }

  async removeMember(
    requesterId: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.access.assertMinRole(requesterId, workspaceId, WorkspaceRole.ADMIN);
    const previous = await this.assertNotLastOwnerChange(workspaceId, targetUserId, null);

    await this.prisma.workspaceMembership.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'MEMBER_REMOVED',
      actorId: requesterId,
      targetType: 'WorkspaceMembership',
      targetId: targetUserId,
      metadata: { role: previous.role },
    }).catch(() => {});
  }

  // Sprint 5F (Audit Log) - ADMIN+-only, same role threshold as this
  // codebase's other governance/security surfaces (Milestone 5C-B's Ops
  // Dashboard precedent). Cursor-paginated, same shape as
  // VideosService.findAll - can grow unbounded over a workspace's lifetime.
  async listAuditLog(
    userId: string,
    workspaceId: string,
    { cursor, limit }: { cursor?: string; limit: number },
  ): Promise<AuditLogListDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.ADMIN);

    const entries = await this.prisma.auditLogEntry.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { email: true } } },
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;

    return {
      entries: page.map((e): AuditLogEntryDto => ({
        id: e.id,
        action: e.action as unknown as AuditLogEntryDto['action'],
        actorEmail: e.actor.email,
        targetType: e.targetType,
        targetId: e.targetId,
        metadata: e.metadata as Record<string, unknown> | null,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Publishing Expansion Phase 6D (Calendar view) - a read-only rollup of
  // PublishRecord rows for a date range. PublishRecord has no workspaceId
  // column - the only join path is clip.video.workspaceId (Campaign's/
  // RecurringSchedule's own workspaceId can't be used instead, since a
  // PublishRecord's campaignId/recurringScheduleId are both nullable and
  // independent - joining through either would miss an ad-hoc publish
  // attached to neither).
  //
  // Each record needs exactly one "calendar day": publishedAt once real,
  // otherwise scheduledAt, otherwise (an immediate "publish now" that
  // hasn't resolved yet) createdAt - encoded directly in this WHERE rather
  // than fetched-then-filtered, so exactly the right rows come back in one
  // query for the [start, end) range requested.
  async getCalendar(
    userId: string,
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<CalendarDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const records = await this.prisma.publishRecord.findMany({
      where: {
        clip: { video: { workspaceId } },
        OR: [
          { scheduledAt: { gte: start, lt: end } },
          { scheduledAt: null, publishedAt: { gte: start, lt: end } },
          { scheduledAt: null, publishedAt: null, createdAt: { gte: start, lt: end } },
        ],
      },
      include: {
        clip: { select: { hookText: true } },
        socialAccount: { select: { platform: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    return {
      entries: records.map((record): CalendarEntryDto => {
        const date = record.publishedAt ?? record.scheduledAt ?? record.createdAt;
        return {
          id: record.id,
          clipId: record.clipId,
          clipHookText: record.clip.hookText,
          // Prisma's own SocialPlatform/PublishStatus enums and
          // @speedora/shared's are nominally distinct TS types even though
          // they share the same runtime string values - same "cast at the
          // one call site that needs it" convention as toDto() above.
          platform: record.socialAccount.platform as unknown as CalendarEntryDto['platform'],
          status: record.status as unknown as CalendarEntryDto['status'],
          date: date.toISOString(),
          campaignId: record.campaign?.id ?? null,
          campaignName: record.campaign?.name ?? null,
          errorMessage: record.errorMessage,
        };
      }),
    };
  }

  // Guards against leaving a Workspace with zero OWNERs - `newRole: null`
  // means "the member is being removed entirely," any other value means
  // "the member's role is changing to this." Both collapse to the same
  // check: would this leave the OWNER count at zero? Returns the
  // pre-change membership row so callers (updateMemberRole/removeMember)
  // can log the OLD role to the audit log without a second query.
  private async assertNotLastOwnerChange(
    workspaceId: string,
    targetUserId: string,
    newRole: WorkspaceRole | null,
  ) {
    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('This user is not a member of this workspace');
    }
    if (target.role !== WorkspaceRole.OWNER || newRole === WorkspaceRole.OWNER) {
      return target;
    }
    const ownerCount = await this.prisma.workspaceMembership.count({
      where: { workspaceId, role: WorkspaceRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new BadRequestException('A workspace must always have at least one OWNER');
    }
    return target;
  }

  private async findInviteByRawToken(rawToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invite = await this.prisma.pendingInvite.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    return invite;
  }
}
