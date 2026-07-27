import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@speedora/database';
import { migrateProcessingOptions, type ProcessingPresetDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProcessingPresetDto } from './dto/create-processing-preset.dto';
import { toProcessingOptions } from './dto/processing-options.dto';
import type { UpdateProcessingPresetDto } from './dto/update-processing-preset.dto';

function toDto(preset: {
  id: string;
  name: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ProcessingPresetDto {
  return {
    id: preset.id,
    name: preset.name,
    // Reads through migrateProcessingOptions() (not a bare cast) so an
    // older stored version is normalized the same way Video.processingOptions
    // is - see that function's own comment.
    config: migrateProcessingOptions(preset.config),
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
  };
}

// Pre-Processing Settings roadmap (Phase 0/1) - directly userId-owned CRUD,
// same shape/reasoning as SubtitlePresetsService (a personal setting, not a
// team-shared resource; findOwnedOrThrow also checks ownership so a
// mismatched id 404s rather than leaking another user's preset existence).
@Injectable()
export class ProcessingPresetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProcessingPresetDto): Promise<ProcessingPresetDto> {
    const preset = await this.prisma.processingPreset.create({
      data: {
        userId,
        name: dto.name,
        config: toProcessingOptions(dto.config) as unknown as Prisma.InputJsonValue,
      },
    });
    return toDto(preset);
  }

  async list(userId: string): Promise<{ presets: ProcessingPresetDto[] }> {
    const presets = await this.prisma.processingPreset.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { presets: presets.map(toDto) };
  }

  private async findOwnedOrThrow(userId: string, id: string) {
    const preset = await this.prisma.processingPreset.findUnique({ where: { id } });
    if (!preset || preset.userId !== userId) {
      throw new NotFoundException(`Processing preset ${id} not found`);
    }
    return preset;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProcessingPresetDto,
  ): Promise<ProcessingPresetDto> {
    await this.findOwnedOrThrow(userId, id);
    const updated = await this.prisma.processingPreset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.config !== undefined
          ? { config: toProcessingOptions(dto.config) as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(userId, id);
    await this.prisma.processingPreset.delete({ where: { id } });
  }
}
