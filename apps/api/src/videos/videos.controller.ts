import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TranscriptionProvider } from '@speedora/shared';
import { getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImportYoutubeDto } from './dto/import-youtube.dto';
import { UploadVideoDto } from './dto/upload-video.dto';
import { VideosService } from './videos.service';

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

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
  ) {
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
  importYoutube(@CurrentUser() user: SafeUser, @Body() dto: ImportYoutubeDto) {
    return this.videosService.importFromYoutube(
      user.id,
      dto.url,
      dto.transcriptionProvider ?? TranscriptionProvider.GROQ,
    );
  }

  @Get()
  findAll(@CurrentUser() user: SafeUser) {
    return this.videosService.findAll(user.id);
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
