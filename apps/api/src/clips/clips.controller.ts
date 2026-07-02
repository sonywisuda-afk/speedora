import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClipsService } from './clips.service';

@Controller('clips')
@UseGuards(JwtAuthGuard)
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get(':id/download')
  async download(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const clip = await this.clipsService.findRenderedOrThrow(id, user.id);
    res.download(clip.outputUrl as string, `clip-${clip.id}.mp4`);
  }
}
