import { Injectable, NotFoundException } from '@nestjs/common';
import type { SubtitlePresetDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSubtitlePresetDto } from './dto/create-subtitle-preset.dto';
import type { UpdateSubtitlePresetDto } from './dto/update-subtitle-preset.dto';

function toDto(preset: {
  id: string;
  name: string;
  captionStyle: string;
  speakerColorCaptions: boolean;
  fontFamily: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SubtitlePresetDto {
  return {
    id: preset.id,
    name: preset.name,
    captionStyle: preset.captionStyle as SubtitlePresetDto['captionStyle'],
    speakerColorCaptions: preset.speakerColorCaptions,
    fontFamily: preset.fontFamily,
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
  };
}

// Subtitle Presets roadmap (P3b) - directly userId-owned (like BrandKitService's
// `where: { userId }` guards), not workspace-scoped (a preset is a personal
// style preference, not a team-shared resource) - CRUD shape mirrors
// ProjectService (the smallest full create/list/update/delete precedent in
// this codebase), findOrThrow also checks ownership so a mismatched id
// 404s rather than leaking another user's preset existence.
@Injectable()
export class SubtitlePresetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSubtitlePresetDto): Promise<SubtitlePresetDto> {
    const preset = await this.prisma.subtitlePreset.create({
      data: {
        userId,
        name: dto.name,
        captionStyle: dto.captionStyle,
        speakerColorCaptions: dto.speakerColorCaptions,
        fontFamily: dto.fontFamily ?? null,
      },
    });
    return toDto(preset);
  }

  async list(userId: string): Promise<{ presets: SubtitlePresetDto[] }> {
    const presets = await this.prisma.subtitlePreset.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { presets: presets.map(toDto) };
  }

  private async findOwnedOrThrow(userId: string, id: string) {
    const preset = await this.prisma.subtitlePreset.findUnique({ where: { id } });
    if (!preset || preset.userId !== userId) {
      throw new NotFoundException(`Subtitle preset ${id} not found`);
    }
    return preset;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSubtitlePresetDto,
  ): Promise<SubtitlePresetDto> {
    await this.findOwnedOrThrow(userId, id);
    const updated = await this.prisma.subtitlePreset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.captionStyle !== undefined ? { captionStyle: dto.captionStyle } : {}),
        ...(dto.speakerColorCaptions !== undefined
          ? { speakerColorCaptions: dto.speakerColorCaptions }
          : {}),
        ...(dto.fontFamily !== undefined ? { fontFamily: dto.fontFamily } : {}),
      },
    });
    return toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(userId, id);
    await this.prisma.subtitlePreset.delete({ where: { id } });
  }
}
