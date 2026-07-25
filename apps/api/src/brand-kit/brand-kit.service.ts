import { Injectable } from '@nestjs/common';
import type { BrandKitDto, IntroType, WatermarkPosition } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateBrandKitDto } from './dto/update-brand-kit.dto';

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
    };
  }
}
