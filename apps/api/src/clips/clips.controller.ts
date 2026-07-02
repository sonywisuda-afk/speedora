import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ClipsService } from './clips.service';

@Controller('clips')
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const clip = await this.clipsService.findRenderedOrThrow(id);
    res.download(clip.outputUrl as string, `clip-${clip.id}.mp4`);
  }
}
