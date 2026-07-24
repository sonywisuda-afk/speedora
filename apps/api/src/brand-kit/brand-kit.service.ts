import { Injectable } from '@nestjs/common';
import type { BrandKitDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateBrandKitDto } from './dto/update-brand-kit.dto';

interface BrandKitRow {
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  brandFontFamily: string | null;
}

const BRAND_KIT_SELECT = {
  brandLogoUrl: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  brandFontFamily: true,
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

  private toDto(user: BrandKitRow): BrandKitDto {
    return {
      logoUrl: user.brandLogoUrl ? '/brand-kit/logo' : null,
      primaryColor: user.brandPrimaryColor,
      secondaryColor: user.brandSecondaryColor,
      fontFamily: user.brandFontFamily,
    };
  }
}
