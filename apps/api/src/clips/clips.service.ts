import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClipsService {
  constructor(private readonly prisma: PrismaService) {}

  async findRenderedOrThrow(id: string, requesterId: string) {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      include: { video: true },
    });

    // Same "not found" for a missing clip and someone else's clip, so a
    // client can't use this endpoint to probe which clip IDs exist.
    if (!clip || clip.video.ownerId !== requesterId) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    if (!clip.outputUrl) {
      throw new NotFoundException(`Clip ${id} has not finished rendering yet`);
    }
    return clip;
  }
}
