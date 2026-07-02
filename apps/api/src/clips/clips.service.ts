import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClipsService {
  constructor(private readonly prisma: PrismaService) {}

  async findRenderedOrThrow(id: string) {
    const clip = await this.prisma.clip.findUnique({ where: { id } });
    if (!clip) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    if (!clip.outputUrl) {
      throw new NotFoundException(`Clip ${id} has not finished rendering yet`);
    }
    return clip;
  }
}
