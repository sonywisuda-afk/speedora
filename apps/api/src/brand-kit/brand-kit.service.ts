import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRole } from '@speedora/database';
import type {
  BrandKitDto,
  BrandKitTemplateDto,
  IntroType,
  WatermarkPosition,
} from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import type { UpdateBrandKitDto } from './dto/update-brand-kit.dto';

interface BrandKitTemplateRow {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
  watermarkUrl: string | null;
  watermarkOpacity: number | null;
  watermarkScale: number | null;
  watermarkMargin: number | null;
  watermarkPosition: string | null;
  introUrl: string | null;
  introType: string | null;
  introImageDurationSeconds: number | null;
  outroUrl: string | null;
  outroType: string | null;
  outroImageDurationSeconds: number | null;
  createdAt: Date;
}

interface BrandKitRow {
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  brandFontFamily: string | null;
  brandWatermarkUrl: string | null;
  brandWatermarkOpacity: number | null;
  brandWatermarkScale: number | null;
  brandWatermarkMargin: number | null;
  brandWatermarkPosition: string | null;
  brandIntroUrl: string | null;
  brandIntroType: string | null;
  brandIntroImageDurationSeconds: number | null;
  brandOutroUrl: string | null;
  brandOutroType: string | null;
  brandOutroImageDurationSeconds: number | null;
}

const BRAND_KIT_SELECT = {
  brandLogoUrl: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  brandFontFamily: true,
  brandWatermarkUrl: true,
  brandWatermarkOpacity: true,
  brandWatermarkScale: true,
  brandWatermarkMargin: true,
  brandWatermarkPosition: true,
  brandIntroUrl: true,
  brandIntroType: true,
  brandIntroImageDurationSeconds: true,
  brandOutroUrl: true,
  brandOutroType: true,
  brandOutroImageDurationSeconds: true,
} as const;

// Workspace-level Brand Kit roadmap (P3g) - which row a Brand Kit operation
// actually reads/writes. 'user' is the pre-P3g behavior (unchanged meaning -
// a personal workspace's Brand Kit IS the owner's User row); 'workspace' is
// new, only ever produced by resolveTarget() for a non-personal workspace
// the requester has sufficient role on. Every existing method below took a
// bare userId before this roadmap step; they now take this instead, so the
// same read/write logic works unchanged for either row shape.
export type BrandKitTarget = { kind: 'user'; id: string } | { kind: 'workspace'; id: string };

@Injectable()
export class BrandKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
  ) {}

  // Resolves which row a request should operate on. No workspaceId (the
  // common case, and the ONLY case before P3g) -> the requester's own User
  // row, no access check needed (it's their own data). An explicit
  // workspaceId requires at least minRole membership (assertMinRole 404s
  // for a non-member, same "don't leak existence" posture used everywhere
  // else) - if that workspace turns out to be the requester's own personal
  // one, it still resolves to their User row (a personal workspace's Brand
  // Kit has always been the User row, not a separate concept); any other
  // workspace resolves to that Workspace's own brand* columns.
  async resolveTarget(
    userId: string,
    workspaceId: string | undefined,
    minRole: WorkspaceRole,
  ): Promise<BrandKitTarget> {
    if (!workspaceId) return { kind: 'user', id: userId };
    await this.workspaceAccess.assertMinRole(userId, workspaceId, minRole);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { isPersonal: true },
    });
    return workspace.isPersonal
      ? { kind: 'user', id: userId }
      : { kind: 'workspace', id: workspaceId };
  }

  private async readRow(target: BrandKitTarget): Promise<BrandKitRow> {
    if (target.kind === 'workspace') {
      return this.prisma.workspace.findUniqueOrThrow({
        where: { id: target.id },
        select: BRAND_KIT_SELECT,
      });
    }
    return this.prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: BRAND_KIT_SELECT,
    });
  }

  private async writeRow(target: BrandKitTarget, data: Partial<BrandKitRow>): Promise<BrandKitRow> {
    if (target.kind === 'workspace') {
      return this.prisma.workspace.update({
        where: { id: target.id },
        data,
        select: BRAND_KIT_SELECT,
      });
    }
    return this.prisma.user.update({ where: { id: target.id }, data, select: BRAND_KIT_SELECT });
  }

  async get(target: BrandKitTarget): Promise<BrandKitDto> {
    const row = await this.readRow(target);
    return this.toDto(row);
  }

  // Undefined fields are left untouched (a client can set just one color),
  // same "only the fields actually sent get updated" convention as every
  // other partial-update DTO in this codebase.
  async update(target: BrandKitTarget, dto: UpdateBrandKitDto): Promise<BrandKitDto> {
    const row = await this.writeRow(target, {
      ...(dto.primaryColor !== undefined ? { brandPrimaryColor: dto.primaryColor } : {}),
      ...(dto.secondaryColor !== undefined ? { brandSecondaryColor: dto.secondaryColor } : {}),
      ...(dto.fontFamily !== undefined ? { brandFontFamily: dto.fontFamily } : {}),
      ...(dto.watermarkOpacity !== undefined
        ? { brandWatermarkOpacity: dto.watermarkOpacity }
        : {}),
      ...(dto.watermarkScale !== undefined ? { brandWatermarkScale: dto.watermarkScale } : {}),
      ...(dto.watermarkMargin !== undefined ? { brandWatermarkMargin: dto.watermarkMargin } : {}),
      ...(dto.watermarkPosition !== undefined
        ? { brandWatermarkPosition: dto.watermarkPosition }
        : {}),
      ...(dto.introImageDurationSeconds !== undefined
        ? { brandIntroImageDurationSeconds: dto.introImageDurationSeconds }
        : {}),
      ...(dto.outroImageDurationSeconds !== undefined
        ? { brandOutroImageDurationSeconds: dto.outroImageDurationSeconds }
        : {}),
    });
    return this.toDto(row);
  }

  async saveLogo(target: BrandKitTarget, logoKey: string): Promise<BrandKitDto> {
    const row = await this.writeRow(target, { brandLogoUrl: logoKey });
    return this.toDto(row);
  }

  // Returns the raw key (or null), doesn't throw for "no logo yet" - same
  // "service returns null, controller decides whether that's a 404"
  // convention as VideosService.findThumbnailOrThrow.
  async findLogoKeyOrThrow(target: BrandKitTarget): Promise<{ logoKey: string | null }> {
    const row = await this.readRow(target);
    return { logoKey: row.brandLogoUrl };
  }

  // Watermark roadmap (P3c) - same shape as saveLogo/findLogoKeyOrThrow
  // above.
  async saveWatermark(target: BrandKitTarget, watermarkKey: string): Promise<BrandKitDto> {
    const row = await this.writeRow(target, { brandWatermarkUrl: watermarkKey });
    return this.toDto(row);
  }

  async findWatermarkKeyOrThrow(target: BrandKitTarget): Promise<{ watermarkKey: string | null }> {
    const row = await this.readRow(target);
    return { watermarkKey: row.brandWatermarkUrl };
  }

  async removeWatermark(target: BrandKitTarget): Promise<void> {
    await this.writeRow(target, { brandWatermarkUrl: null });
  }

  // Intro roadmap (P3d) - same shape as saveWatermark/findWatermarkKeyOrThrow/
  // removeWatermark above. saveIntro also writes brandIntroType (determined
  // by the controller from the upload's mimetype) in the same update, since
  // a new intro upload always replaces both together - there's no valid
  // state where the URL changes but the type doesn't.
  async saveIntro(
    target: BrandKitTarget,
    introKey: string,
    introType: IntroType,
  ): Promise<BrandKitDto> {
    const row = await this.writeRow(target, { brandIntroUrl: introKey, brandIntroType: introType });
    return this.toDto(row);
  }

  async findIntroKeyOrThrow(target: BrandKitTarget): Promise<{ introKey: string | null }> {
    const row = await this.readRow(target);
    return { introKey: row.brandIntroUrl };
  }

  async removeIntro(target: BrandKitTarget): Promise<void> {
    await this.writeRow(target, { brandIntroUrl: null, brandIntroType: null });
  }

  // Outro roadmap (P3e) - same shape as saveIntro/findIntroKeyOrThrow/
  // removeIntro above.
  async saveOutro(
    target: BrandKitTarget,
    outroKey: string,
    outroType: IntroType,
  ): Promise<BrandKitDto> {
    const row = await this.writeRow(target, { brandOutroUrl: outroKey, brandOutroType: outroType });
    return this.toDto(row);
  }

  async findOutroKeyOrThrow(target: BrandKitTarget): Promise<{ outroKey: string | null }> {
    const row = await this.readRow(target);
    return { outroKey: row.brandOutroUrl };
  }

  async removeOutro(target: BrandKitTarget): Promise<void> {
    await this.writeRow(target, { brandOutroUrl: null, brandOutroType: null });
  }

  // Template Presets roadmap (P3f) - snapshots the CURRENT Brand Kit fields
  // (BRAND_KIT_SELECT) into a new named BrandKitTemplate row. Raw keys, not
  // the DTO's resolved `/brand-kit/...` URLs - a template is a server-side
  // snapshot, re-applied by copying straight back onto the target row.
  // Workspace-level Brand Kit roadmap (P3g) - source is now whichever
  // target the requester currently has active (their own User row, or a
  // workspace's), not always User; templates themselves stay userId-owned
  // (a personal collection of saved snapshots, not workspace-shared) -
  // only WHERE a snapshot is taken from/applied to becomes target-aware.
  async createTemplate(
    userId: string,
    name: string,
    target: BrandKitTarget,
  ): Promise<BrandKitTemplateDto> {
    const current = await this.readRow(target);
    const template = await this.prisma.brandKitTemplate.create({
      data: {
        userId,
        name,
        logoUrl: current.brandLogoUrl,
        primaryColor: current.brandPrimaryColor,
        secondaryColor: current.brandSecondaryColor,
        fontFamily: current.brandFontFamily,
        watermarkUrl: current.brandWatermarkUrl,
        watermarkOpacity: current.brandWatermarkOpacity,
        watermarkScale: current.brandWatermarkScale,
        watermarkMargin: current.brandWatermarkMargin,
        watermarkPosition: current.brandWatermarkPosition,
        introUrl: current.brandIntroUrl,
        introType: current.brandIntroType,
        introImageDurationSeconds: current.brandIntroImageDurationSeconds,
        outroUrl: current.brandOutroUrl,
        outroType: current.brandOutroType,
        outroImageDurationSeconds: current.brandOutroImageDurationSeconds,
      },
    });
    return this.templateToDto(template);
  }

  async listTemplates(userId: string): Promise<{ templates: BrandKitTemplateDto[] }> {
    const templates = await this.prisma.brandKitTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { templates: templates.map((t) => this.templateToDto(t)) };
  }

  // Same "findOwnedOrThrow, 404 rather than leaking another user's template
  // existence" convention as SubtitlePresetsService.
  private async findTemplateOwnedOrThrow(
    userId: string,
    templateId: string,
  ): Promise<BrandKitTemplateRow> {
    const template = await this.prisma.brandKitTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.userId !== userId) {
      throw new NotFoundException(`Brand Kit template ${templateId} not found`);
    }
    return template;
  }

  async renameTemplate(
    userId: string,
    templateId: string,
    name: string,
  ): Promise<BrandKitTemplateDto> {
    await this.findTemplateOwnedOrThrow(userId, templateId);
    const template = await this.prisma.brandKitTemplate.update({
      where: { id: templateId },
      data: { name },
    });
    return this.templateToDto(template);
  }

  async deleteTemplate(userId: string, templateId: string): Promise<void> {
    await this.findTemplateOwnedOrThrow(userId, templateId);
    await this.prisma.brandKitTemplate.delete({ where: { id: templateId } });
  }

  // Copies a template's snapshot back onto the target's live Brand Kit
  // fields - the same flat fields render-enqueue resolution already reads,
  // so "applying" a template needs no new render-time code path.
  async applyTemplate(
    userId: string,
    templateId: string,
    target: BrandKitTarget,
  ): Promise<BrandKitDto> {
    const template = await this.findTemplateOwnedOrThrow(userId, templateId);
    const row = await this.writeRow(target, {
      brandLogoUrl: template.logoUrl,
      brandPrimaryColor: template.primaryColor,
      brandSecondaryColor: template.secondaryColor,
      brandFontFamily: template.fontFamily,
      brandWatermarkUrl: template.watermarkUrl,
      brandWatermarkOpacity: template.watermarkOpacity,
      brandWatermarkScale: template.watermarkScale,
      brandWatermarkMargin: template.watermarkMargin,
      brandWatermarkPosition: template.watermarkPosition,
      brandIntroUrl: template.introUrl,
      brandIntroType: template.introType,
      brandIntroImageDurationSeconds: template.introImageDurationSeconds,
      brandOutroUrl: template.outroUrl,
      brandOutroType: template.outroType,
      brandOutroImageDurationSeconds: template.outroImageDurationSeconds,
    });
    return this.toDto(row);
  }

  private templateToDto(template: BrandKitTemplateRow): BrandKitTemplateDto {
    return {
      id: template.id,
      name: template.name,
      primaryColor: template.primaryColor,
      secondaryColor: template.secondaryColor,
      fontFamily: template.fontFamily,
      hasLogo: template.logoUrl !== null,
      hasWatermark: template.watermarkUrl !== null,
      watermarkPosition: (template.watermarkPosition as WatermarkPosition | null) ?? null,
      hasIntro: template.introUrl !== null,
      introType: (template.introType as IntroType | null) ?? null,
      hasOutro: template.outroUrl !== null,
      outroType: (template.outroType as IntroType | null) ?? null,
      createdAt: template.createdAt.toISOString(),
    };
  }

  private toDto(row: BrandKitRow): BrandKitDto {
    return {
      logoUrl: row.brandLogoUrl ? '/brand-kit/logo' : null,
      primaryColor: row.brandPrimaryColor,
      secondaryColor: row.brandSecondaryColor,
      fontFamily: row.brandFontFamily,
      watermarkUrl: row.brandWatermarkUrl ? '/brand-kit/watermark' : null,
      watermarkOpacity: row.brandWatermarkOpacity,
      watermarkScale: row.brandWatermarkScale,
      watermarkMargin: row.brandWatermarkMargin,
      watermarkPosition: (row.brandWatermarkPosition as WatermarkPosition | null) ?? null,
      introUrl: row.brandIntroUrl ? '/brand-kit/intro' : null,
      introType: (row.brandIntroType as IntroType | null) ?? null,
      introImageDurationSeconds: row.brandIntroImageDurationSeconds,
      outroUrl: row.brandOutroUrl ? '/brand-kit/outro' : null,
      outroType: (row.brandOutroType as IntroType | null) ?? null,
      outroImageDurationSeconds: row.brandOutroImageDurationSeconds,
    };
  }
}
