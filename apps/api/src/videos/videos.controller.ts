import {
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  ) {
    return this.videosService.upload(user.id, file);
  }

  @Get(':id')
  findOne(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.videosService.findOne(id, user.id);
  }
}
