import * as crypto from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRole, type ShareLink } from '@speedora/database';
import type {
  ShareLinkCreatedDto,
  ShareLinkDto,
  SharedClipDto,
  SharedVideoDto,
} from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDto(link: ShareLink): ShareLinkDto {
  return {
    id: link.id,
    videoId: link.videoId,
    role: link.role as unknown as ShareLinkDto['role'],
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revoked: link.revokedAt !== null,
    createdAt: link.createdAt.toISOString(),
  };
}

// Sprint 5B (Shared Clips). A share link is deliberately NOT a
// WorkspaceMembership - it grants read-only (or REVIEWER) access to one
// Video to anyone holding the raw token, with no account/membership
// required on their end. Create/list/revoke require EDITOR+ in the
// video's workspace (same threshold as ClipsService.render() - a
// meaningful, not merely read-only, action).
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
  ) {}

  async create(
    userId: string,
    videoId: string,
    input: { role?: ShareLink['role']; expiresInDays?: number },
    webOrigin: string,
  ): Promise<ShareLinkCreatedDto> {
    const video = await this.workspaceAccess.assertVideoAccess(
      userId,
      videoId,
      WorkspaceRole.EDITOR,
    );

    // Same "raw token only ever exists here and in the returned URL, only
    // its SHA-256 hash is persisted" convention as WorkspaceService's
    // invite tokens / AuthService's password-reset tokens.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const link = await this.prisma.shareLink.create({
      data: {
        tokenHash,
        videoId: video.id,
        createdById: userId,
        role: input.role ?? 'VIEWER',
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * MS_PER_DAY)
          : null,
      },
    });

    return { ...toDto(link), url: `${webOrigin}/share/${rawToken}` };
  }

  async listForVideo(userId: string, videoId: string): Promise<{ links: ShareLinkDto[] }> {
    await this.workspaceAccess.assertVideoAccess(userId, videoId, WorkspaceRole.EDITOR);
    const links = await this.prisma.shareLink.findMany({
      where: { videoId },
      orderBy: { createdAt: 'desc' },
    });
    return { links: links.map(toDto) };
  }

  async revoke(userId: string, shareLinkId: string): Promise<void> {
    const link = await this.prisma.shareLink.findUnique({ where: { id: shareLinkId } });
    if (!link) {
      throw new NotFoundException(`Share link ${shareLinkId} not found`);
    }
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: link.videoId } });
    await this.workspaceAccess.assertMinRole(userId, video.workspaceId, WorkspaceRole.EDITOR);

    if (link.revokedAt) return;
    await this.prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() },
    });
  }

  // Resolves a raw token to its live ShareLink row, or throws - the one
  // place expiry/revocation is actually enforced. Every public route below
  // goes through this first.
  private async resolveActiveLink(rawToken: string): Promise<ShareLink> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const link = await this.prisma.shareLink.findUnique({ where: { tokenHash } });
    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    if (link.revokedAt) {
      throw new ForbiddenException('This share link has been revoked');
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('This share link has expired');
    }
    return link;
  }

  async getPublicView(rawToken: string): Promise<SharedVideoDto> {
    const link = await this.resolveActiveLink(rawToken);
    const video = await this.prisma.video.findUniqueOrThrow({
      where: { id: link.videoId },
      include: { clips: { orderBy: { viralityScore: 'desc' } } },
    });

    const clips: SharedClipDto[] = video.clips.map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      endTime: clip.endTime,
      hookText: clip.hookText,
      hashtags: clip.hashtags,
      streamUrl: clip.outputUrl ? `/share/${rawToken}/clips/${clip.id}/stream` : null,
      thumbnailUrl: clip.thumbnailUrl ? `/share/${rawToken}/clips/${clip.id}/thumbnail` : null,
    }));

    return {
      role: link.role as unknown as SharedVideoDto['role'],
      video: {
        title: video.title,
        durationSeconds: video.durationSeconds,
        thumbnailUrl: video.thumbnailUrl ? `/share/${rawToken}/thumbnail` : null,
        sourceStreamUrl: `/share/${rawToken}/source`,
        createdAt: video.createdAt.toISOString(),
      },
      clips,
    };
  }

  async getVideoSourceForToken(rawToken: string): Promise<{ sourceUrl: string }> {
    const link = await this.resolveActiveLink(rawToken);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: link.videoId } });
    return { sourceUrl: video.sourceUrl };
  }

  async getVideoThumbnailForToken(rawToken: string): Promise<{ thumbnailUrl: string | null }> {
    const link = await this.resolveActiveLink(rawToken);
    const video = await this.prisma.video.findUniqueOrThrow({ where: { id: link.videoId } });
    return { thumbnailUrl: video.thumbnailUrl };
  }

  async getClipStreamForToken(
    rawToken: string,
    clipId: string,
  ): Promise<{ outputUrl: string | null }> {
    const link = await this.resolveActiveLink(rawToken);
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip || clip.videoId !== link.videoId) {
      throw new NotFoundException(`Clip ${clipId} not found`);
    }
    return { outputUrl: clip.outputUrl };
  }

  async getClipThumbnailForToken(
    rawToken: string,
    clipId: string,
  ): Promise<{ thumbnailUrl: string | null }> {
    const link = await this.resolveActiveLink(rawToken);
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip || clip.videoId !== link.videoId) {
      throw new NotFoundException(`Clip ${clipId} not found`);
    }
    return { thumbnailUrl: clip.thumbnailUrl };
  }
}
