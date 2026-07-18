import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, WorkspaceRole, type Approval, type Video } from '@speedora/database';
import type { ApprovalDto, ApprovalListDto } from '@speedora/shared';
import { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import { WORKSPACE_ROLE_RANK, WorkspaceAccessService } from '../workspace/workspace-access.service';
import { recordNotification } from '@speedora/database';
import type { DecideApprovalDto } from './dto/decide-approval.dto';
import type { RequestApprovalDto } from './dto/request-approval.dto';

const APPROVAL_INCLUDE = {
  requestedBy: { select: { email: true } },
  reviewer: { select: { email: true } },
  events: {
    orderBy: { createdAt: 'asc' as const },
    include: { actor: { select: { email: true } } },
  },
} as const;

type ApprovalWithRelations = Approval & {
  requestedBy: { email: string };
  reviewer: { email: string } | null;
  events: {
    id: string;
    status: ApprovalStatus;
    note: string | null;
    createdAt: Date;
    actor: { email: string };
  }[];
};

function toDto(approval: ApprovalWithRelations): ApprovalDto {
  return {
    id: approval.id,
    videoId: approval.videoId,
    clipId: approval.clipId,
    status: approval.status as unknown as ApprovalDto['status'],
    requestedById: approval.requestedById,
    requestedByEmail: approval.requestedBy.email,
    reviewerId: approval.reviewerId,
    reviewerEmail: approval.reviewer?.email ?? null,
    note: approval.note,
    reviewedAt: approval.reviewedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
    updatedAt: approval.updatedAt.toISOString(),
    events: approval.events.map((e) => ({
      id: e.id,
      status: e.status as unknown as ApprovalDto['status'],
      actorEmail: e.actor.email,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// Sprint 5D (Approval). EDITOR+ requests/resubmits (the person submitting
// work for review must be able to edit it); REVIEWER+ decides (the actual
// reviewing role). Only one active (PENDING/NEEDS_REVISION) Approval may
// exist per video/clip target at a time. Every transition is also appended
// to ApprovalEvent - the Approval row's own status is a projection of
// "whatever the latest event says," same relationship VideoStatusEvent has
// to Video.status.
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly notificationPublisher: NotificationPublisherService,
    private readonly notificationDeliveryProducer: NotificationDeliveryProducer,
  ) {}

  async request(userId: string, videoId: string, dto: RequestApprovalDto): Promise<ApprovalDto> {
    const video = await this.workspaceAccess.assertVideoAccess(
      userId,
      videoId,
      WorkspaceRole.EDITOR,
    );

    if (dto.clipId) {
      const clip = await this.prisma.clip.findUnique({ where: { id: dto.clipId } });
      if (!clip || clip.videoId !== videoId) {
        throw new BadRequestException('clipId must belong to this video');
      }
    }

    const existing = await this.prisma.approval.findFirst({
      where: {
        videoId,
        clipId: dto.clipId ?? null,
        status: { in: [ApprovalStatus.PENDING, ApprovalStatus.NEEDS_REVISION] },
      },
    });
    if (existing) {
      throw new BadRequestException(
        'An active approval already exists for this target - resolve or resubmit it instead',
      );
    }

    let reviewerId: string | null = null;
    if (dto.reviewerId) {
      const role = await this.workspaceAccess.getRole(dto.reviewerId, video.workspaceId);
      if (!role || WORKSPACE_ROLE_RANK[role] < WORKSPACE_ROLE_RANK[WorkspaceRole.REVIEWER]) {
        throw new BadRequestException('reviewerId must be a REVIEWER+ member of this workspace');
      }
      reviewerId = dto.reviewerId;
    }

    const approval = await this.prisma.$transaction(async (tx) => {
      const created = await tx.approval.create({
        data: {
          videoId,
          clipId: dto.clipId ?? null,
          requestedById: userId,
          reviewerId,
          note: dto.note ?? null,
        },
      });
      await tx.approvalEvent.create({
        data: {
          approvalId: created.id,
          status: ApprovalStatus.PENDING,
          actorId: userId,
          note: dto.note ?? null,
        },
      });
      return created;
    });

    await this.notifyReviewRequest(video, approval, userId);

    return this.reloadDto(approval.id);
  }

  async decide(userId: string, approvalId: string, dto: DecideApprovalDto): Promise<ApprovalDto> {
    const approval = await this.findOrThrow(approvalId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: approval.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.REVIEWER);

    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException(`Cannot decide an approval in status ${approval.status}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.approval.update({
        where: { id: approvalId },
        data: {
          status: dto.status,
          reviewerId: userId,
          note: dto.note ?? approval.note,
          reviewedAt: new Date(),
        },
      });
      await tx.approvalEvent.create({
        data: { approvalId, status: dto.status, actorId: userId, note: dto.note ?? null },
      });
    });

    await this.notifyDecision(video, approval, userId, dto.status);

    return this.reloadDto(approvalId);
  }

  async resubmit(userId: string, approvalId: string, dto: { note?: string }): Promise<ApprovalDto> {
    const approval = await this.findOrThrow(approvalId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: approval.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.EDITOR);

    if (
      approval.status !== ApprovalStatus.NEEDS_REVISION &&
      approval.status !== ApprovalStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Only a NEEDS_REVISION or REJECTED approval can be resubmitted',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.approval.update({
        where: { id: approvalId },
        data: { status: ApprovalStatus.PENDING, reviewedAt: null, note: dto.note ?? approval.note },
      });
      await tx.approvalEvent.create({
        data: {
          approvalId,
          status: ApprovalStatus.PENDING,
          actorId: userId,
          note: dto.note ?? null,
        },
      });
    });

    await this.notifyReviewRequest(video, approval, userId);

    return this.reloadDto(approvalId);
  }

  async listForVideo(userId: string, videoId: string): Promise<ApprovalListDto> {
    await this.workspaceAccess.assertVideoAccess(userId, videoId, WorkspaceRole.VIEWER);
    const approvals = await this.prisma.approval.findMany({
      where: { videoId },
      orderBy: { createdAt: 'desc' },
      include: APPROVAL_INCLUDE,
    });
    return { approvals: approvals.map(toDto) };
  }

  private async reloadDto(approvalId: string): Promise<ApprovalDto> {
    const approval = await this.prisma.approval.findUniqueOrThrow({
      where: { id: approvalId },
      include: APPROVAL_INCLUDE,
    });
    return toDto(approval);
  }

  private async findOrThrow(approvalId: string): Promise<Approval> {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId } });
    if (!approval) {
      throw new NotFoundException(`Approval ${approvalId} not found`);
    }
    return approval;
  }

  private async notifyReviewRequest(
    video: Video,
    approval: Approval,
    actorId: string,
  ): Promise<void> {
    const targetUserId = approval.reviewerId ?? video.ownerId;
    if (targetUserId === actorId) return;

    await recordNotification(
      this.prisma,
      {
        userId: targetUserId,
        type: 'REVIEW_REQUEST',
        title: 'Permintaan review baru',
        body: `Ada konten menunggu review di video "${video.title ?? 'tanpa judul'}"`,
        videoId: video.id,
        clipId: approval.clipId ?? undefined,
      },
      this.notificationDeps(),
    ).catch((error) => this.logger.warn(`failed to record REVIEW_REQUEST notification: ${error}`));
  }

  private async notifyDecision(
    video: Video,
    approval: Approval,
    actorId: string,
    status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION',
  ): Promise<void> {
    if (approval.requestedById === actorId) return;

    const statusLabel: Record<typeof status, string> = {
      APPROVED: 'disetujui',
      REJECTED: 'ditolak',
      NEEDS_REVISION: 'perlu direvisi',
    };

    await recordNotification(
      this.prisma,
      {
        userId: approval.requestedById,
        type: 'APPROVAL',
        title: 'Keputusan review',
        body: `Konten kamu di video "${video.title ?? 'tanpa judul'}" ${statusLabel[status]}`,
        videoId: video.id,
        clipId: approval.clipId ?? undefined,
      },
      this.notificationDeps(),
    ).catch((error) => this.logger.warn(`failed to record APPROVAL notification: ${error}`));
  }

  private notificationDeps() {
    return {
      publish: (event: Parameters<NotificationPublisherService['publish']>[0]) =>
        this.notificationPublisher.publish(event),
      enqueueDelivery: (event: Parameters<NotificationDeliveryProducer['enqueue']>[0]) =>
        this.notificationDeliveryProducer.enqueue(event),
    };
  }
}
