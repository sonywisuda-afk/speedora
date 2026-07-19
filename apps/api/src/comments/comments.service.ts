import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { recordNotification, WorkspaceRole, type Comment, type Video } from '@speedora/database';
import type { CommentAttachmentDto, CommentDto, CommentListDto } from '@speedora/shared';
import { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import { StorageService } from '../storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import type { CreateCommentDto } from './dto/create-comment.dto';

const COMMENT_INCLUDE = {
  author: { select: { email: true } },
  resolvedBy: { select: { email: true } },
  mentions: { include: { user: { select: { email: true } } } },
  reactions: true,
  attachments: true,
} as const;

type CommentWithRelations = Comment & {
  author: { email: string };
  resolvedBy: { email: string } | null;
  mentions: { userId: string; user: { email: string } }[];
  reactions: { userId: string; emoji: string }[];
  attachments: {
    id: string;
    fileName: string;
    fileSize: number;
    contentType: string;
  }[];
};

function toDto(comment: CommentWithRelations, requesterId: string): CommentDto {
  const reactionsByEmoji = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const reaction of comment.reactions) {
    const entry = reactionsByEmoji.get(reaction.emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (reaction.userId === requesterId) entry.reactedByMe = true;
    reactionsByEmoji.set(reaction.emoji, entry);
  }

  return {
    id: comment.id,
    videoId: comment.videoId,
    clipId: comment.clipId,
    authorId: comment.authorId,
    authorEmail: comment.author.email,
    parentId: comment.parentId,
    body: comment.body,
    timestampSeconds: comment.timestampSeconds,
    resolved: comment.resolved,
    resolvedAt: comment.resolvedAt?.toISOString() ?? null,
    resolvedByEmail: comment.resolvedBy?.email ?? null,
    editedAt: comment.editedAt?.toISOString() ?? null,
    createdAt: comment.createdAt.toISOString(),
    mentions: comment.mentions.map((m) => ({ userId: m.userId, email: m.user.email })),
    reactions: Array.from(reactionsByEmoji.entries()).map(([emoji, v]) => ({ emoji, ...v })),
    attachments: comment.attachments.map((a): CommentAttachmentDto => ({
      id: a.id,
      fileName: a.fileName,
      fileSize: a.fileSize,
      contentType: a.contentType,
      url: `/comments/${comment.id}/attachments/${a.id}`,
    })),
  };
}

// Sprint 5C (Comments). Timestamp-anchored, two-level threading (a root
// comment plus flat replies - replying to a reply is rejected, redirecting
// the client to the root, same "resolve the whole thread" posture as
// Figma/Notion), @mention (validated against real WorkspaceMembership,
// never an arbitrary user id), emoji reactions, and file attachments.
// REVIEWER+ is the minimum role that can write (comment/react/resolve) -
// VIEWER can only read, matching this role's whole reason for existing
// above VIEWER in the rank table (see WorkspaceAccessService).
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly storage: StorageService,
    private readonly notificationPublisher: NotificationPublisherService,
    private readonly notificationDeliveryProducer: NotificationDeliveryProducer,
  ) {}

  async create(userId: string, videoId: string, dto: CreateCommentDto): Promise<CommentDto> {
    const video = await this.workspaceAccess.assertVideoAccess(
      userId,
      videoId,
      WorkspaceRole.REVIEWER,
    );

    if (dto.clipId) {
      const clip = await this.prisma.clip.findUnique({ where: { id: dto.clipId } });
      if (!clip || clip.videoId !== videoId) {
        throw new BadRequestException('clipId must belong to this video');
      }
    }

    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.videoId !== videoId) {
        throw new NotFoundException(`Comment ${dto.parentId} not found`);
      }
      if (parent.parentId) {
        throw new BadRequestException(
          'Cannot reply to a reply - reply to the root comment instead',
        );
      }
    }

    const mentionedUserIds = [...new Set(dto.mentionedUserIds ?? [])];
    if (mentionedUserIds.length > 0) {
      const members = await this.prisma.workspaceMembership.findMany({
        where: { workspaceId: video.workspaceId, userId: { in: mentionedUserIds } },
        select: { userId: true },
      });
      if (members.length !== mentionedUserIds.length) {
        throw new BadRequestException('mentionedUserIds must all be members of this workspace');
      }
    }

    const comment = await this.prisma.comment.create({
      data: {
        videoId,
        clipId: dto.clipId ?? null,
        authorId: userId,
        parentId: dto.parentId ?? null,
        body: dto.body,
        timestampSeconds: dto.timestampSeconds ?? null,
        mentions: {
          create: mentionedUserIds.map((mentionedUserId) => ({ userId: mentionedUserId })),
        },
      },
      include: COMMENT_INCLUDE,
    });

    await this.notifyNewComment(video, comment, mentionedUserIds);

    return toDto(comment, userId);
  }

  async list(userId: string, videoId: string): Promise<CommentListDto> {
    await this.workspaceAccess.assertVideoAccess(userId, videoId, WorkspaceRole.VIEWER);
    const comments = await this.prisma.comment.findMany({
      where: { videoId },
      orderBy: { createdAt: 'asc' },
      include: COMMENT_INCLUDE,
      // Stabilization Pass (API Contract Audit) - this was the highest-risk
      // unbounded list in the audit: it eager-loads reactions/attachments/
      // mentions per row and comment volume grows unboundedly per video. A
      // hard cap here is a stopgap, not a fix - if a video's comment count
      // realistically approaches this, this list needs real cursor
      // pagination (see docs/backend.md's Pagination convention section),
      // not just a higher number.
      take: 500,
    });
    return { comments: comments.map((c) => toDto(c, userId)) };
  }

  async update(userId: string, commentId: string, body: string): Promise<CommentDto> {
    const comment = await this.findCommentOrThrow(commentId);
    if (comment.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit this comment');
    }
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    // Author-only isn't enough on its own - a member removed from the
    // workspace still has authorId === userId on their old comments, so we
    // also require they still hold at least the REVIEWER write floor (same
    // membership check every sibling write method below enforces).
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.REVIEWER);
    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      include: COMMENT_INCLUDE,
    });
    return toDto(updated, userId);
  }

  async remove(userId: string, commentId: string): Promise<void> {
    const comment = await this.findCommentOrThrow(commentId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    // Same membership requirement as update() above - deleting your own
    // comment still requires you to still be a REVIEWER+ member, not just
    // the historical author; anyone else needs ADMIN.
    await this.workspaceAccess.assertMinRole(
      userId,
      video.workspaceId,
      comment.authorId !== userId ? WorkspaceRole.ADMIN : WorkspaceRole.REVIEWER,
    );
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  async setResolved(userId: string, commentId: string, resolved: boolean): Promise<CommentDto> {
    const comment = await this.findCommentOrThrow(commentId);
    if (comment.parentId) {
      throw new BadRequestException('Only a root comment can be resolved');
    }
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.REVIEWER);

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: resolved
        ? { resolved: true, resolvedAt: new Date(), resolvedById: userId }
        : { resolved: false, resolvedAt: null, resolvedById: null },
      include: COMMENT_INCLUDE,
    });
    return toDto(updated, userId);
  }

  async addReaction(userId: string, commentId: string, emoji: string): Promise<CommentDto> {
    const comment = await this.findCommentOrThrow(commentId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.REVIEWER);

    await this.prisma.commentReaction.upsert({
      where: { commentId_userId_emoji: { commentId, userId, emoji } },
      create: { commentId, userId, emoji },
      update: {},
    });

    return this.reloadDto(commentId, userId);
  }

  async removeReaction(userId: string, commentId: string, emoji: string): Promise<CommentDto> {
    const comment = await this.findCommentOrThrow(commentId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.VIEWER);

    await this.prisma.commentReaction.deleteMany({ where: { commentId, userId, emoji } });

    return this.reloadDto(commentId, userId);
  }

  async addAttachment(
    userId: string,
    commentId: string,
    file: Express.Multer.File,
  ): Promise<CommentAttachmentDto> {
    const comment = await this.findCommentOrThrow(commentId);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.REVIEWER);

    const storageKey = await this.storage.saveCommentAttachment(file);
    const attachment = await this.prisma.commentAttachment.create({
      data: {
        commentId,
        storageKey,
        fileName: file.originalname,
        fileSize: file.buffer.length,
        contentType: file.mimetype,
      },
    });

    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      contentType: attachment.contentType,
      url: `/comments/${commentId}/attachments/${attachment.id}`,
    };
  }

  async getAttachmentOrThrow(
    userId: string,
    attachmentId: string,
  ): Promise<{ storageKey: string; fileName: string; contentType: string }> {
    const attachment = await this.prisma.commentAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    const comment = await this.prisma.comment.findUniqueOrThrow({
      where: { id: attachment.commentId },
    });
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: comment.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.VIEWER);
    return attachment;
  }

  private async reloadDto(commentId: string, requesterId: string): Promise<CommentDto> {
    const updated = await this.prisma.comment.findUniqueOrThrow({
      where: { id: commentId },
      include: COMMENT_INCLUDE,
    });
    return toDto(updated, requesterId);
  }

  private async findCommentOrThrow(commentId: string): Promise<Comment> {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException(`Comment ${commentId} not found`);
    }
    return comment;
  }

  // Sprint 4A/4C-style best-effort notification fan-out - a failed write
  // here must never fail the comment itself, same posture as every other
  // recordNotification call site in this codebase. COMMENT goes to the
  // video's owner (unless they're the author); MENTION goes to each
  // explicitly @mentioned user (unless they're the author) - two different
  // event types since a mention and "someone commented on your video" are
  // meaningfully different things to a recipient, even for the same event.
  private async notifyNewComment(
    video: Video,
    comment: CommentWithRelations,
    mentionedUserIds: string[],
  ): Promise<void> {
    const deps = {
      publish: (event: Parameters<NotificationPublisherService['publish']>[0]) =>
        this.notificationPublisher.publish(event),
      enqueueDelivery: (event: Parameters<NotificationDeliveryProducer['enqueue']>[0]) =>
        this.notificationDeliveryProducer.enqueue(event),
    };
    const authorEmail = comment.author.email;
    const videoTitle = video.title ?? 'tanpa judul';

    if (video.ownerId !== comment.authorId) {
      await recordNotification(
        this.prisma,
        {
          userId: video.ownerId,
          type: 'COMMENT',
          title: 'Komentar baru',
          body: `${authorEmail} mengomentari video "${videoTitle}"`,
          videoId: video.id,
        },
        deps,
      ).catch((error) => this.logger.warn(`failed to record COMMENT notification: ${error}`));
    }

    for (const mentionedUserId of mentionedUserIds) {
      if (mentionedUserId === comment.authorId) continue;
      await recordNotification(
        this.prisma,
        {
          userId: mentionedUserId,
          type: 'MENTION',
          title: 'Kamu disebut dalam komentar',
          body: `${authorEmail} menyebut kamu di video "${videoTitle}"`,
          videoId: video.id,
        },
        deps,
      ).catch((error) => this.logger.warn(`failed to record MENTION notification: ${error}`));
    }
  }
}
