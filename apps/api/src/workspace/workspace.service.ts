import * as crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PendingInviteStatus,
  WorkspaceRole,
  type AuditAction as PrismaAuditAction,
} from '@speedora/database';
import { recordActivityEvent, recordAuditLog, recordNotification } from '@speedora/database';
import {
  AuditAction as SharedAuditAction,
  WorkspaceRole as SharedWorkspaceRole,
  PendingInviteStatus as SharedPendingInviteStatus,
  type AuditLogEntryDto,
  type AuditLogListDto,
  type CalendarDto,
  type CalendarEntryDto,
  type PendingInviteDto,
  type WorkspaceDetailDto,
  type WorkspaceDto,
  type WorkspaceMemberDto,
} from '@speedora/shared';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import { mapPublishStatus, mapSocialPlatform } from '../social/publish-record.util';
import { WorkspaceAccessService } from './workspace-access.service';

function assertNever(value: never): never {
  throw new Error(`Unhandled enum value: ${JSON.stringify(value)}`);
}

// Prisma's WorkspaceRole and packages/shared's are nominally distinct TS
// enum types even though they share the same runtime string values (same
// "Mirrors X" convention used throughout this project). The switch has no
// `default` case, so a new schema.prisma member fails to compile here until
// a matching case is added - same Contract Synchronization pattern as
// dashboard.service.ts's mapActivityEventType, replacing what used to be a
// blind `as unknown as` cast.
export function mapWorkspaceRole(role: WorkspaceRole): SharedWorkspaceRole {
  switch (role) {
    case 'OWNER':
      return SharedWorkspaceRole.OWNER;
    case 'ADMIN':
      return SharedWorkspaceRole.ADMIN;
    case 'EDITOR':
      return SharedWorkspaceRole.EDITOR;
    case 'REVIEWER':
      return SharedWorkspaceRole.REVIEWER;
    case 'VIEWER':
      return SharedWorkspaceRole.VIEWER;
    default:
      return assertNever(role);
  }
}

// Same convention as mapWorkspaceRole above, for PendingInviteStatus.
export function mapPendingInviteStatus(status: PendingInviteStatus): SharedPendingInviteStatus {
  switch (status) {
    case 'PENDING':
      return SharedPendingInviteStatus.PENDING;
    case 'ACCEPTED':
      return SharedPendingInviteStatus.ACCEPTED;
    case 'REVOKED':
      return SharedPendingInviteStatus.REVOKED;
    default:
      return assertNever(status);
  }
}

// Same convention as mapWorkspaceRole above, for AuditAction. This mapper is
// what caught packages/shared's AuditAction enum silently missing
// CAMPAIGN_CREATED/CAMPAIGN_CANCELLED/RECURRING_SCHEDULE_CREATED/
// RECURRING_SCHEDULE_DELETED (Contract Governance audit, 2026-08-01) - all 4
// were already being written by CampaignsService/RecurringSchedulesService,
// exactly the ActivityEventType/WORKSPACE_DELETED bug class, just not yet
// caught because nothing exhaustively checked this boundary before.
export function mapAuditAction(action: PrismaAuditAction): SharedAuditAction {
  switch (action) {
    case 'MEMBER_ROLE_CHANGED':
      return SharedAuditAction.MEMBER_ROLE_CHANGED;
    case 'MEMBER_REMOVED':
      return SharedAuditAction.MEMBER_REMOVED;
    case 'INVITE_CREATED':
      return SharedAuditAction.INVITE_CREATED;
    case 'INVITE_ACCEPTED':
      return SharedAuditAction.INVITE_ACCEPTED;
    case 'PROJECT_CREATED':
      return SharedAuditAction.PROJECT_CREATED;
    case 'PROJECT_DELETED':
      return SharedAuditAction.PROJECT_DELETED;
    case 'PROJECT_ARCHIVED':
      return SharedAuditAction.PROJECT_ARCHIVED;
    case 'PROJECT_UNARCHIVED':
      return SharedAuditAction.PROJECT_UNARCHIVED;
    case 'PROJECT_MOVED':
      return SharedAuditAction.PROJECT_MOVED;
    case 'WORKSPACE_OWNERSHIP_TRANSFERRED':
      return SharedAuditAction.WORKSPACE_OWNERSHIP_TRANSFERRED;
    case 'FOLDER_CREATED':
      return SharedAuditAction.FOLDER_CREATED;
    case 'FOLDER_DELETED':
      return SharedAuditAction.FOLDER_DELETED;
    case 'VIDEO_MOVED':
      return SharedAuditAction.VIDEO_MOVED;
    case 'VIDEO_DELETED':
      return SharedAuditAction.VIDEO_DELETED;
    case 'CLIP_DELETED':
      return SharedAuditAction.CLIP_DELETED;
    case 'SHARE_LINK_CREATED':
      return SharedAuditAction.SHARE_LINK_CREATED;
    case 'SHARE_LINK_REVOKED':
      return SharedAuditAction.SHARE_LINK_REVOKED;
    case 'APPROVAL_DECIDED':
      return SharedAuditAction.APPROVAL_DECIDED;
    case 'CAMPAIGN_CREATED':
      return SharedAuditAction.CAMPAIGN_CREATED;
    case 'CAMPAIGN_CANCELLED':
      return SharedAuditAction.CAMPAIGN_CANCELLED;
    case 'RECURRING_SCHEDULE_CREATED':
      return SharedAuditAction.RECURRING_SCHEDULE_CREATED;
    case 'RECURRING_SCHEDULE_DELETED':
      return SharedAuditAction.RECURRING_SCHEDULE_DELETED;
    case 'WORKSPACE_LEFT':
      return SharedAuditAction.WORKSPACE_LEFT;
    default:
      return assertNever(action);
  }
}

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
      role: mapWorkspaceRole(role as WorkspaceRole),
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
      role: mapWorkspaceRole(invite.role),
      status: mapPendingInviteStatus(invite.status),
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
      role: mapWorkspaceRole(WorkspaceRole.OWNER),
      memberCount: 1,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async listMine(userId: string): Promise<{ workspaces: WorkspaceDto[] }> {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { workspace: { createdAt: 'asc' } },
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
    });

    const workspaces = await Promise.all(
      memberships.map(async (m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        isPersonal: m.workspace.isPersonal,
        role: mapWorkspaceRole(m.role),
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
      role: mapWorkspaceRole(m.role),
      createdAt: m.createdAt.toISOString(),
    }));

    const dto = await this.toDto(workspaceId, userId);
    return { ...dto, members };
  }

  // Returns WorkspaceDetailDto (not the narrower WorkspaceDto) so this
  // matches the shape WorkspaceController.update() returns on its no-op
  // branch (`dto.name === undefined` -> getDetail()) - PATCH /workspaces/:id
  // must return the same shape regardless of which fields were in the body.
  async update(userId: string, workspaceId: string, name: string): Promise<WorkspaceDetailDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.ADMIN);
    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
    return this.getDetail(userId, workspaceId);
  }

  async createInvite(
    inviterId: string,
    inviterEmail: string,
    workspaceId: string,
    input: { email: string; role: WorkspaceRole },
    webOrigin: string,
  ): Promise<PendingInviteDto> {
    // Phase F (RBAC hardening) - closes a real gap found while auditing
    // updateMemberRole's own "OWNER can no longer be granted through this
    // generic role-PATCH" comment (see below in this file): that comment
    // was only true for the PATCH endpoint. This invite path had no
    // matching check - the DTO's @IsEnum(WorkspaceRole) accepts OWNER, and
    // acceptInvite() writes invite.role directly onto a new
    // WorkspaceMembership with no guard. Any ADMIN could invite someone as
    // OWNER, producing a second OWNER-ranked membership without ever
    // touching Workspace.ownerId - exactly the anomalous state
    // updateMemberRole's comment describes as "since-patched." Same
    // "granting OWNER only happens through transferOwnership(), which
    // atomically demotes the old owner" reasoning as that block.
    if (input.role === WorkspaceRole.OWNER) {
      throw new BadRequestException('Cannot invite a member as OWNER - use transfer-ownership');
    }
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
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
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
    // Phase F (RBAC hardening) - defense in depth alongside createInvite's
    // own new guard, for any PendingInvite row with role=OWNER that was
    // already created before that fix shipped.
    if (invite.role === WorkspaceRole.OWNER) {
      throw new BadRequestException('This invite is invalid - use transfer-ownership for OWNER');
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
    // Transfer Ownership roadmap - OWNER can no longer be granted through
    // this generic role-PATCH (previously any ADMIN could set a second
    // member's role to OWNER here without demoting the existing owner or
    // touching Workspace.ownerId, silently producing >1 OWNER-ranked
    // membership). Granting OWNER is now exclusively transferOwnership()'s
    // job, which demotes the old owner and updates Workspace.ownerId in the
    // same transaction.
    if (role === WorkspaceRole.OWNER) {
      throw new BadRequestException('Use transfer-ownership to make another member the OWNER');
    }
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

  // Transfer Ownership roadmap - gated on Workspace.ownerId directly (not
  // assertMinRole(OWNER)), the one authoritative "who really owns this"
  // field, rather than OWNER-rank membership - see updateMemberRole's own
  // comment on why membership rank alone isn't trustworthy here. Blocked
  // for isPersonal workspaces: every User has exactly one, auto-created at
  // signup and structurally 1:1 with their own account (see
  // WorkspaceAccessService.getPersonalWorkspaceId) - "transferring" it
  // would leave the original owner without a personal workspace at all.
  // The recipient must already be a member (no implicit invite-and-transfer
  // in one step) - same "membership is a precondition, not a side effect"
  // posture as every other membership-scoped action here.
  async transferOwnership(
    requesterId: string,
    workspaceId: string,
    newOwnerUserId: string,
  ): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }
    if (workspace.isPersonal) {
      throw new BadRequestException('A personal workspace cannot be transferred');
    }
    if (workspace.ownerId !== requesterId) {
      throw new ForbiddenException('Only the current owner can transfer ownership');
    }
    if (newOwnerUserId === requesterId) {
      throw new BadRequestException('Workspace already belongs to this user');
    }

    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: newOwnerUserId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) {
      throw new BadRequestException('The recipient must already be a member of this workspace');
    }

    await this.prisma.$transaction([
      this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { ownerId: newOwnerUserId },
      }),
      this.prisma.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId, userId: requesterId } },
        data: { role: WorkspaceRole.ADMIN },
      }),
      this.prisma.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId, userId: newOwnerUserId } },
        data: { role: WorkspaceRole.OWNER },
      }),
    ]);

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
      actorId: requesterId,
      targetType: 'Workspace',
      targetId: workspaceId,
      metadata: { fromUserId: requesterId, toUserId: newOwnerUserId, toEmail: target.user.email },
    }).catch(() => {});

    await recordNotification(
      this.prisma,
      {
        userId: newOwnerUserId,
        type: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
        title: 'Kepemilikan workspace ditransfer',
        body: `Kamu sekarang menjadi owner workspace "${workspace.name}"`,
        metadata: { workspaceId },
      },
      {
        publish: (event) => this.notificationPublisher.publish(event),
        enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
      },
    ).catch((error) =>
      this.logger.warn(`failed to record WORKSPACE_OWNERSHIP_TRANSFERRED notification: ${error}`),
    );

    return this.toDto(workspaceId, requesterId);
  }

  // Workspace Lifecycle Management roadmap - OWNER-only, gated on
  // Workspace.ownerId directly, same "the one authoritative field" posture
  // as transferOwnership (not assertMinRole(OWNER), since membership rank
  // alone isn't trustworthy - see updateMemberRole's own comment). Blocked
  // for isPersonal workspaces the same way transferOwnership is - every
  // User has exactly one, and it isn't a deletable "team" resource.
  //
  // Deliberately no cascade delete: every child resource with a direct
  // workspaceId FK (WorkspaceMembership beyond the owner, Project, Video,
  // Campaign, RecurringSchedule, TrackedLink) is onDelete: Cascade at the
  // schema level, so an unconditional workspace.delete() would silently
  // destroy all of it. Each is checked and rejected with a specific message
  // instead - the caller must empty the workspace first. PendingInvite and
  // AuditLogEntry are NOT checked: they're administrative/historical
  // records, not resources a user would lose real work by cascading away.
  //
  // The count checks and the delete itself run inside one $transaction
  // (same interactive-transaction shape as create()/acceptInvite() above),
  // not as separate round trips - closes the window where a resource
  // created by a concurrent request right after the checks would otherwise
  // get silently swept into the cascade delete despite the workspace no
  // longer being "empty" by the time delete() actually runs. (Postgres's
  // own FK enforcement already takes a FOR KEY SHARE lock on the workspace
  // row for any concurrent child insert, so this race was never a
  // data-corruption/orphaning risk - only a "swept away instead of blocking
  // the delete" risk. The transaction closes that too by making the checks
  // and the delete one atomic unit on a single connection.)
  async remove(userId: string, workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }
    if (workspace.isPersonal) {
      throw new BadRequestException('A personal workspace cannot be deleted');
    }
    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only the current owner can delete this workspace');
    }

    await this.prisma.$transaction(async (tx) => {
      const [
        memberCount,
        projectCount,
        videoCount,
        campaignCount,
        recurringScheduleCount,
        trackedLinkCount,
      ] = await Promise.all([
        tx.workspaceMembership.count({ where: { workspaceId } }),
        tx.project.count({ where: { workspaceId } }),
        tx.video.count({ where: { workspaceId } }),
        tx.campaign.count({ where: { workspaceId } }),
        tx.recurringSchedule.count({ where: { workspaceId } }),
        tx.trackedLink.count({ where: { workspaceId } }),
      ]);

      // memberCount includes the owner themselves - >1 means someone else
      // is still a member.
      if (memberCount > 1) {
        throw new ConflictException('This workspace still has other members. Remove them first.');
      }
      if (projectCount > 0) {
        throw new ConflictException(
          'This workspace still contains projects. Remove or move them first.',
        );
      }
      if (videoCount > 0) {
        throw new ConflictException(
          'This workspace still contains videos. Move or delete them first.',
        );
      }
      if (campaignCount > 0) {
        throw new ConflictException(
          'This workspace still has campaigns. Cancel or remove them first.',
        );
      }
      if (recurringScheduleCount > 0) {
        throw new ConflictException(
          'This workspace still has recurring schedules. Remove them first.',
        );
      }
      if (trackedLinkCount > 0) {
        throw new ConflictException('This workspace still has tracked links. Remove them first.');
      }

      await tx.workspace.delete({ where: { id: workspaceId } });
    });

    // AuditLogEntry is NOT used here - AuditLogEntry.workspace is
    // onDelete: Cascade, so a row logging this workspace's own deletion
    // would be cascade-deleted in the same statement, losing the record it
    // exists to keep (see AuditAction's schema comment). ActivityEvent is
    // only FK'd to User, so it survives. Logged after the delete succeeds,
    // not before, so a failed delete never produces a false "deleted" event.
    await recordActivityEvent(this.prisma, {
      userId,
      type: 'WORKSPACE_DELETED',
      metadata: { workspaceId, name: workspace.name },
    }).catch((error) =>
      this.logger.warn(`failed to record WORKSPACE_DELETED activity event: ${error}`),
    );
  }

  // Workspace Lifecycle Management roadmap - the inverse of removeMember,
  // called by the member themselves rather than an ADMIN+ acting on someone
  // else. Reuses assertNotLastOwnerChange's same "would this leave zero
  // OWNERs" guard, which also naturally rejects an OWNER leaving without an
  // explicit, clearer message pointing at transfer-ownership instead.
  async leave(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }
    if (membership.role === WorkspaceRole.OWNER) {
      throw new BadRequestException(
        'The workspace owner cannot leave - transfer ownership to another member first',
      );
    }

    await this.prisma.workspaceMembership.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'WORKSPACE_LEFT',
      actorId: userId,
      targetType: 'WorkspaceMembership',
      targetId: userId,
      metadata: { role: membership.role },
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
        action: mapAuditAction(e.action),
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
          platform: mapSocialPlatform(record.socialAccount.platform),
          status: mapPublishStatus(record.status),
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
