import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkspaceRole, type TrackedLink } from '@speedora/database';
import type { TrackedLinkDto, TrackedLinkListDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import type { CreateTrackedLinkDto } from './dto/create-tracked-link.dto';
import { generateSlug } from './slug.util';

// A slug collision at 48 bits of entropy is vanishingly rare - this bound
// only exists so a pathological run of bad luck fails loudly instead of
// looping forever.
const MAX_SLUG_ATTEMPTS = 5;

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
}

function toDto(link: TrackedLink): TrackedLinkDto {
  return {
    id: link.id,
    slug: link.slug,
    redirectUrl: `${apiBaseUrl()}/r/${link.slug}`,
    destinationUrl: link.destinationUrl,
    publishRecordId: link.publishRecordId,
    campaignId: link.campaignId,
    clickCount: link.clickCount,
    createdAt: link.createdAt.toISOString(),
  };
}

// Sprint 6K (Conversion) - EDITOR+ to create/delete, VIEWER+ to read, same
// role split as CampaignsService (the closest precedent: a workspace-
// scoped resource attributable to a publish or a campaign).
@Injectable()
export class TrackedLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  // Security: protocol is already gated by CreateTrackedLinkDto's
  // class-validator @IsUrl (http(s)-only) - this catches the one thing a
  // declarative validator can't express: a destination that would
  // redirect straight back into this app's own /r/ path, which would let
  // a TrackedLink chain into another TrackedLink (or into itself) - an
  // open-redirect-style abuse this app's own domain shouldn't be usable
  // for. Anything else (an arbitrary external http(s) URL) is exactly
  // what this feature is for - a creator's own landing page/product link -
  // so it's deliberately not restricted to same-domain.
  private assertNotSelfRedirect(destinationUrl: string): void {
    let destination: URL;
    try {
      destination = new URL(destinationUrl);
    } catch {
      throw new BadRequestException('destinationUrl is not a valid URL');
    }
    const apiHost = new URL(apiBaseUrl()).host;
    if (destination.host === apiHost && destination.pathname.startsWith('/r/')) {
      throw new BadRequestException("destinationUrl cannot point back to this app's own tracked links");
    }
  }

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateTrackedLinkDto,
  ): Promise<TrackedLinkDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.EDITOR);

    // Attribution: exactly one of publishRecordId/campaignId - the
    // database CHECK constraint (see TrackedLink's schema comment) is the
    // real guarantee; this is just a friendlier 400 before ever reaching
    // it.
    const hasPublishRecord = Boolean(dto.publishRecordId);
    const hasCampaign = Boolean(dto.campaignId);
    if (hasPublishRecord === hasCampaign) {
      throw new BadRequestException('Provide exactly one of publishRecordId or campaignId');
    }

    this.assertNotSelfRedirect(dto.destinationUrl);

    // Authorization: the target (publish record or campaign) must
    // actually belong to this workspace - otherwise a member of workspace
    // A could attribute a tracked link's conversions to workspace B's
    // publish/campaign, which would misattribute real data across
    // tenants.
    if (dto.publishRecordId) {
      const record = await this.prisma.publishRecord.findUnique({
        where: { id: dto.publishRecordId },
        select: { clip: { select: { video: { select: { workspaceId: true } } } } },
      });
      if (!record || record.clip.video.workspaceId !== workspaceId) {
        throw new NotFoundException(`PublishRecord ${dto.publishRecordId} not found in this workspace`);
      }
    } else if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
        select: { workspaceId: true },
      });
      if (!campaign || campaign.workspaceId !== workspaceId) {
        throw new NotFoundException(`Campaign ${dto.campaignId} not found in this workspace`);
      }
    }

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        const link = await this.prisma.trackedLink.create({
          data: {
            workspaceId,
            slug: generateSlug(),
            destinationUrl: dto.destinationUrl,
            publishRecordId: dto.publishRecordId ?? null,
            campaignId: dto.campaignId ?? null,
            createdById: userId,
          },
        });
        return toDto(link);
      } catch (error) {
        // P2002 = unique constraint violation - a slug collision. Same
        // established check as alert-engine.ts's own P2002 handling in
        // packages/database. Retried rather than surfaced to the user.
        const isSlugCollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isSlugCollision || attempt === MAX_SLUG_ATTEMPTS - 1) throw error;
      }
    }
    // Unreachable (the loop above always throws or returns), but keeps
    // this function's return type honest without a non-null assertion.
    throw new Error('Failed to generate a unique tracked-link slug');
  }

  async listByWorkspace(userId: string, workspaceId: string): Promise<TrackedLinkListDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);
    const links = await this.prisma.trackedLink.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return { links: links.map(toDto) };
  }

  async remove(userId: string, id: string): Promise<void> {
    const link = await this.prisma.trackedLink.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!link) {
      throw new NotFoundException(`TrackedLink ${id} not found`);
    }
    await this.access.assertMinRole(userId, link.workspaceId, WorkspaceRole.EDITOR);
    await this.prisma.trackedLink.delete({ where: { id } });
  }
}
