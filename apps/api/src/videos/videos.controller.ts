import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Video } from '@speedora/database';
import { TranscriptionProvider } from '@speedora/shared';
import { getObjectStream, getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImportYoutubeDto } from './dto/import-youtube.dto';
import { UploadVideoDto } from './dto/upload-video.dto';
import { VideosService } from './videos.service';

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

// Product Experience performance pass - same clamped-parse-rather-than-throw
// posture as AnalyticsController/DashboardController's own parseLimit (each
// controller keeps its own copy rather than sharing one, per this codebase's
// existing convention).
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

// Derived from the stored key's own extension (Phase 2, image optimization
// roadmap) rather than hardcoded - thumbnails extracted before the WebP
// switch are still `.jpg` (never backfilled), and serving those with a
// hardcoded `image/webp` header would be wrong.
function thumbnailContentType(key: string): string {
  return key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } }))
  upload(
    @CurrentUser() user: SafeUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^video\// })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadVideoDto,
  ): Promise<Video> {
    return this.videosService.upload(
      user.id,
      file,
      dto.transcriptionProvider ?? TranscriptionProvider.GROQ,
    );
  }

  // Alternate to POST / (direct file upload) - the actual download happens
  // in apps/worker's import-youtube job, not here (see CLAUDE.md's
  // "API layer never runs heavy work synchronously" principle). Returns the
  // Video immediately with status IMPORTING, same "poll GET /videos/:id"
  // contract the frontend already uses for every other stage.
  @Post('import-youtube')
  importYoutube(@CurrentUser() user: SafeUser, @Body() dto: ImportYoutubeDto): Promise<Video> {
    return this.videosService.importFromYoutube(
      user.id,
      dto.url,
      dto.transcriptionProvider ?? TranscriptionProvider.GROQ,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: SafeUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.videosService.findAll(user.id, { cursor, limit: parseLimit(limit) });
  }

  @Get(':id')
  findOne(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.videosService.findOne(id, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.videosService.remove(id, user.id);
  }

  // Streams the raw source video (not a rendered clip) for the timeline
  // editor's <video> preview. Needs Range support - unlike the
  // click-to-download clip endpoint, a <video> element issues many
  // byte-range requests while the user scrubs/seeks.
  @Get(':id/source')
  async source(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const { sourceUrl } = await this.videosService.findSourceOrThrow(id, user.id);
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

  // Product Experience roadmap - the extracted thumbnail frame. A plain
  // (non-Range) stream is enough since this is a small static image, not
  // something a <video> element seeks through.
  @Get(':id/thumbnail')
  async thumbnail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { thumbnailUrl } = await this.videosService.findThumbnailOrThrow(id, user.id);
    if (!thumbnailUrl) {
      throw new NotFoundException(`Video ${id} has no thumbnail`);
    }

    const stream = await getObjectStream(thumbnailUrl);
    res.setHeader('Content-Type', thumbnailContentType(thumbnailUrl));
    // Phase 2 (image optimization roadmap) - first Cache-Control precedent in
    // this app. `private`: still JwtAuthGuard-protected, not for a shared
    // cache. A day, not `immutable`: a retry can re-extract and overwrite the
    // same key, so this exact URL *can* legitimately change.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Phase 3 (Animated Thumbnail) - same shape/reasoning as thumbnail above,
  // for the extracted looping preview instead of the static frame. Still a
  // plain (non-Range) stream - a browser renders an animated WebP the same
  // way it renders a static one, via a plain <img>, so no seek support is
  // needed here either.
  @Get(':id/animated-thumbnail')
  async animatedThumbnail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { animatedThumbnailUrl } = await this.videosService.findAnimatedThumbnailOrThrow(
      id,
      user.id,
    );
    if (!animatedThumbnailUrl) {
      throw new NotFoundException(`Video ${id} has no animated thumbnail`);
    }

    const stream = await getObjectStream(animatedThumbnailUrl);
    res.setHeader('Content-Type', thumbnailContentType(animatedThumbnailUrl));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Phase 3 (Storyboard) - one endpoint per frame index rather than a single
  // endpoint returning all frames bundled, so each frame stays independently
  // cacheable/lazy-loadable (same reasoning as the per-resource Cache-Control
  // below - see the Phase 3 architecture plan).
  @Get(':id/storyboard/:index')
  async storyboardFrame(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('index') index: string,
    @Res() res: Response,
  ) {
    const { frameKey } = await this.videosService.findStoryboardFrameOrThrow(
      id,
      user.id,
      Number(index),
    );
    if (!frameKey) {
      throw new NotFoundException(`Video ${id} has no storyboard frame at index ${index}`);
    }

    const stream = await getObjectStream(frameKey);
    res.setHeader('Content-Type', thumbnailContentType(frameKey));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  @Post(':id/retry')
  retry(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.videosService.retry(id, user.id);
  }

  // Separate from findOne() - only the timeline editor needs transcript
  // text, and findOne() is polled every 2s elsewhere.
  @Get(':id/transcript')
  transcript(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.videosService.findTranscriptOrThrow(id, user.id);
  }
}
