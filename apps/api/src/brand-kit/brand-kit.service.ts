import { Injectable, NotFoundException } from '@nestjs/common';
import type { BrandKitDto, BrandKitTemplateDto, IntroType, WatermarkPosition } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class BrandKitService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<BrandKitDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  // Undefined fields are left untouched (a client can set just one color),
  // same "only the fields actually sent get updated" convention as every
  // other partial-update DTO in this codebase.
  async update(userId: string, dto: UpdateBrandKitDto): Promise<BrandKitDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.primaryColor !== undefined ? { brandPrimaryColor: dto.primaryColor } : {}),
        ...(dto.secondaryColor !== undefined ? { brandSecondaryColor: dto.secondaryColor } : {}),
        ...(dto.fontFamily !== undefined ? { brandFontFamily: dto.fontFamily } : {}),
        ...(dto.watermarkOpacity !== undefined
          ? { brandWatermarkOpacity: dto.watermarkOpacity }
          : {}),
        ...(dto.watermarkScale !== undefined ? { brandWatermarkScale: dto.watermarkScale } : {}),
        ...(dto.watermarkMargin !== undefined
          ? { brandWatermarkMargin: dto.watermarkMargin }
          : {}),
        ...(dto.watermarkPosition !== undefined
          ? { brandWatermarkPosition: dto.watermarkPosition }
          : {}),
        ...(dto.introImageDurationSeconds !== undefined
          ? { brandIntroImageDurationSeconds: dto.introImageDurationSeconds }
          : {}),
        ...(dto.outroImageDurationSeconds !== undefined
          ? { brandOutroImageDurationSeconds: dto.outroImageDurationSeconds }
          : {}),
      },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  async saveLogo(userId: string, logoKey: string): Promise<BrandKitDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { brandLogoUrl: logoKey },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  // Returns the raw key (or null), doesn't throw for "no logo yet" - same
  // "service returns null, controller decides whether that's a 404"
  // convention as VideosService.findThumbnailOrThrow.
  async findLogoKeyOrThrow(userId: string): Promise<{ logoKey: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { brandLogoUrl: true },
    });
    return { logoKey: user.brandLogoUrl };
  }

  // Watermark roadmap (P3c) - same shape as saveLogo/findLogoKeyOrThrow
  // above.
  async saveWatermark(userId: string, watermarkKey: string): Promise<BrandKitDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { brandWatermarkUrl: watermarkKey },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  async findWatermarkKeyOrThrow(userId: string): Promise<{ watermarkKey: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { brandWatermarkUrl: true },
    });
    return { watermarkKey: user.brandWatermarkUrl };
  }

  async removeWatermark(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { brandWatermarkUrl: null },
    });
  }

  // Intro roadmap (P3d) - same shape as saveWatermark/findWatermarkKeyOrThrow/
  // removeWatermark above. saveIntro also writes brandIntroType (determined
  // by the controller from the upload's mimetype) in the same update, since
  // a new intro upload always replaces both together - there's no valid
  // state where the URL changes but the type doesn't.
  async saveIntro(userId: string, introKey: string, introType: IntroType): Promise<BrandKitDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { brandIntroUrl: introKey, brandIntroType: introType },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  async findIntroKeyOrThrow(userId: string): Promise<{ introKey: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { brandIntroUrl: true },
    });
    return { introKey: user.brandIntroUrl };
  }

  async removeIntro(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { brandIntroUrl: null, brandIntroType: null },
    });
  }

  // Outro roadmap (P3e) - same shape as saveIntro/findIntroKeyOrThrow/
  // removeIntro above.
  async saveOutro(userId: string, outroKey: string, outroType: IntroType): Promise<BrandKitDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { brandOutroUrl: outroKey, brandOutroType: outroType },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
  }

  async findOutroKeyOrThrow(userId: string): Promise<{ outroKey: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { brandOutroUrl: true },
    });
    return { outroKey: user.brandOutroUrl };
  }

  async removeOutro(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { brandOutroUrl: null, brandOutroType: null },
    });
  }

  // Template Presets roadmap (P3f) - snapshots the CURRENT Brand Kit fields
  // (BRAND_KIT_SELECT) into a new named BrandKitTemplate row. Raw keys, not
  // the DTO's resolved `/brand-kit/...` URLs - a template is a server-side
  // snapshot, re-applied by copying straight back onto User.
  async createTemplate(userId: string, name: string): Promise<BrandKitTemplateDto> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: BRAND_KIT_SELECT,
    });
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

  // Copies a template's snapshot back onto the user's live Brand Kit fields -
  // the same flat fields render-enqueue resolution already reads, so
  // "applying" a template needs no new render-time code path.
  async applyTemplate(userId: string, templateId: string): Promise<BrandKitDto> {
    const template = await this.findTemplateOwnedOrThrow(userId, templateId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
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
      },
      select: BRAND_KIT_SELECT,
    });
    return this.toDto(user);
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

  private toDto(user: BrandKitRow): BrandKitDto {
    return {
      logoUrl: user.brandLogoUrl ? '/brand-kit/logo' : null,
      primaryColor: user.brandPrimaryColor,
      secondaryColor: user.brandSecondaryColor,
      fontFamily: user.brandFontFamily,
      watermarkUrl: user.brandWatermarkUrl ? '/brand-kit/watermark' : null,
      watermarkOpacity: user.brandWatermarkOpacity,
      watermarkScale: user.brandWatermarkScale,
      watermarkMargin: user.brandWatermarkMargin,
      watermarkPosition: (user.brandWatermarkPosition as WatermarkPosition | null) ?? null,
      introUrl: user.brandIntroUrl ? '/brand-kit/intro' : null,
      introType: (user.brandIntroType as IntroType | null) ?? null,
      introImageDurationSeconds: user.brandIntroImageDurationSeconds,
      outroUrl: user.brandOutroUrl ? '/brand-kit/outro' : null,
      outroType: (user.brandOutroType as IntroType | null) ?? null,
      outroImageDurationSeconds: user.brandOutroImageDurationSeconds,
    };
  }
}
