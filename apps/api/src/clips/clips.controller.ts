import { Body, Controller, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { getObjectStream } from '@viral-clip-app/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClipsService } from './clips.service';
import { PublishClipDto } from './dto/publish-clip.dto';
import { UpdateClipDto } from './dto/update-clip.dto';

@Controller('clips')
@UseGuards(JwtAuthGuard)
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get(':id/download')
  async download(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const clip = await this.clipsService.findRenderedOrThrow(id, user.id);
    const stream = await getObjectStream(clip.outputUrl as string);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="clip-${clip.id}.mp4"`);
    stream.pipe(res);
  }

  // Manual trim from the timeline editor - does not trigger a re-render.
  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateClipDto) {
    return this.clipsService.update(id, user.id, dto);
  }

  // Explicit re-render action, separate from PATCH so dragging a trim
  // handle doesn't burn FFmpeg compute on every intermediate value.
  @Post(':id/render')
  render(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.render(id, user.id);
  }

  // Manual "publish now" (Fase 6b) - one clip to one already-connected
  // social account. No scheduling yet (Fase 6c).
  @Post(':id/publish')
  publish(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: PublishClipDto) {
    return this.clipsService.publish(id, user.id, dto);
  }
}
