import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { getObjectStream, getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareService } from './share.service';

// Product Experience roadmap's own convention (VideosController/
// ClipsController each keep a local copy rather than sharing one).
function thumbnailContentType(key: string): string {
  return key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

// Sprint 5B (Shared Clips). Two distinct route groups on one controller,
// same split InvitesController already established: authenticated
// management routes (create/list/revoke, JwtAuthGuard per-method) and
// public token-scoped routes (no guard - the raw token itself is the only
// credential a link holder has).
@Controller()
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post('videos/:videoId/share-links')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: SafeUser,
    @Param('videoId') videoId: string,
    @Body() dto: CreateShareLinkDto,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    return this.shareService.create(user.id, videoId, dto, webOrigin);
  }

  @Get('videos/:videoId/share-links')
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: SafeUser, @Param('videoId') videoId: string) {
    return this.shareService.listForVideo(user.id, videoId);
  }

  @Delete('share-links/:id')
  @UseGuards(JwtAuthGuard)
  async revoke(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.shareService.revoke(user.id, id);
  }

  @Get('share/:token')
  preview(@Param('token') token: string) {
    return this.shareService.getPublicView(token);
  }

  @Get('share/:token/source')
  async source(
    @Param('token') token: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const { sourceUrl } = await this.shareService.getVideoSourceForToken(token);
    const result = await getObjectStreamRange(sourceUrl, range);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', result.contentType ?? 'video/mp4');
    if (result.contentLength !== undefined) {
      res.setHeader('Content-Length', result.contentLength.toString());
    }
    if (range && result.contentRange) {
      res.status(206);
      res.setHeader('Content-Range', result.contentRange);
    }
    result.stream.pipe(res);
  }

  @Get('share/:token/thumbnail')
  async thumbnail(@Param('token') token: string, @Res() res: Response) {
    const { thumbnailUrl } = await this.shareService.getVideoThumbnailForToken(token);
    if (!thumbnailUrl) {
      throw new NotFoundException('This video has no thumbnail');
    }
    const stream = await getObjectStream(thumbnailUrl);
    res.setHeader('Content-Type', thumbnailContentType(thumbnailUrl));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  @Get('share/:token/clips/:clipId/stream')
  async clipStream(
    @Param('token') token: string,
    @Param('clipId') clipId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const { outputUrl } = await this.shareService.getClipStreamForToken(token, clipId);
    if (!outputUrl) {
      throw new NotFoundException(`Clip ${clipId} has not finished rendering yet`);
    }
    const result = await getObjectStreamRange(outputUrl, range);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', result.contentType ?? 'video/mp4');
    if (result.contentLength !== undefined) {
      res.setHeader('Content-Length', result.contentLength.toString());
    }
    if (range && result.contentRange) {
      res.status(206);
      res.setHeader('Content-Range', result.contentRange);
    }
    result.stream.pipe(res);
  }

  @Get('share/:token/clips/:clipId/thumbnail')
  async clipThumbnail(
    @Param('token') token: string,
    @Param('clipId') clipId: string,
    @Res() res: Response,
  ) {
    const { thumbnailUrl } = await this.shareService.getClipThumbnailForToken(token, clipId);
    if (!thumbnailUrl) {
      throw new NotFoundException(`Clip ${clipId} has no thumbnail`);
    }
    const stream = await getObjectStream(thumbnailUrl);
    res.setHeader('Content-Type', thumbnailContentType(thumbnailUrl));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }
}
