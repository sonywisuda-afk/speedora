import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { recordActivityEvent } from '@speedora/database';
import { getObjectStream, getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ClipsService } from './clips.service';
import { PublishClipDto } from './dto/publish-clip.dto';
import { ReschedulePublishDto } from './dto/reschedule-publish.dto';
import { UpdateClipDto } from './dto/update-clip.dto';

// Derived from the stored key's own extension (Phase 2, image optimization
// roadmap) rather than hardcoded - thumbnails extracted before the WebP
// switch are still `.jpg` (never backfilled), and serving those with a
// hardcoded `image/webp` header would be wrong.
function thumbnailContentType(key: string): string {
  return key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

@Controller('clips')
@UseGuards(JwtAuthGuard)
export class ClipsController {
  private readonly logger = new Logger(ClipsController.name);

  constructor(
    private readonly clipsService: ClipsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/download')
  async download(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const clip = await this.clipsService.findRenderedOrThrow(id, user.id);
    const stream = await getObjectStream(clip.outputUrl as string);

    // Sprint 1-2 (Dashboard Redesign) - Activity Timeline. Fire-and-forget:
    // a failed write here must never break an otherwise-successful
    // download, same "secondary feed, best-effort" posture as every other
    // recordActivityEvent call site.
    recordActivityEvent(this.prisma, {
      userId: user.id,
      type: 'CLIP_EXPORTED',
      videoId: clip.videoId,
      clipId: clip.id,
    }).catch((error) => {
      this.logger.warn(`failed to record CLIP_EXPORTED activity event for clip ${id}: ${error}`);
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="clip-${clip.id}.mp4"`);
    stream.pipe(res);
  }

  // Streams the rendered clip for inline playback (the dashboard's <video>
  // preview). Separate from :id/download - Chrome refuses to play media
  // served with Content-Disposition: attachment, and a <video> element
  // needs Range support to seek/read metadata; same pattern as
  // GET /videos/:id/source in VideosController.
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const clip = await this.clipsService.findRenderedOrThrow(id, user.id);
    const result = await getObjectStreamRange(clip.outputUrl as string, range);

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

  // Product Experience roadmap - the extracted thumbnail frame. A plain
  // (non-Range) stream is enough since this is a small static JPEG.
  @Get(':id/thumbnail')
  async thumbnail(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const { thumbnailUrl } = await this.clipsService.findThumbnailOrThrow(id, user.id);
    const stream = await getObjectStream(thumbnailUrl);

    res.setHeader('Content-Type', thumbnailContentType(thumbnailUrl));
    // Phase 2 (image optimization roadmap) - see VideosController's own
    // Cache-Control comment for the private/max-age=86400 reasoning.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Phase 3 (Storyboard) - see VideosController's own storyboardFrame
  // endpoint for the per-index-endpoint reasoning.
  @Get(':id/storyboard/:index')
  async storyboardFrame(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('index') index: string,
    @Res() res: Response,
  ) {
    const { frameKey } = await this.clipsService.findStoryboardFrameOrThrow(
      id,
      user.id,
      Number(index),
    );
    const stream = await getObjectStream(frameKey);

    res.setHeader('Content-Type', thumbnailContentType(frameKey));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Milestone 4 (AI Explainability) - a read-only, focused view of a clip's
  // Fusion Engine output (score/confidence/breakdown/reason/prediction/
  // recommendation), separate from the full clip DTO returned by
  // GET /videos/:id. See ClipsService.getExplainability.
  @Get(':id/explainability')
  getExplainability(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.getExplainability(id, user.id);
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

  // Permanently deletes one clip - not the parent video or its sibling
  // clips. Same ownership-based 404 as every other per-clip endpoint.
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.clipsService.remove(id, user.id);
  }

  // Manual "publish now" (Fase 6b), or a scheduled future publish (Fase 6c)
  // when dto.scheduledAt is set - one clip to one already-connected social
  // account.
  @Post(':id/publish')
  publish(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: PublishClipDto) {
    return this.clipsService.publish(id, user.id, dto);
  }

  // Cancel a publish that hasn't fired yet (Fase 6c) - only while it's still
  // SCHEDULED, see ClipsService.cancelScheduledPublish.
  @Delete(':id/publish/:recordId')
  async cancelPublish(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
  ) {
    await this.clipsService.cancelScheduledPublish(id, recordId, user.id);
  }

  // Move a scheduled publish's time (Fase 6c) - only while it's still
  // SCHEDULED, see ClipsService.reschedulePublish.
  @Patch(':id/publish/:recordId')
  reschedulePublish(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() dto: ReschedulePublishDto,
  ) {
    return this.clipsService.reschedulePublish(id, recordId, user.id, dto.scheduledAt);
  }
}
