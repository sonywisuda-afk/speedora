import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  ParseFilePipeBuilder,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { IntroType } from '@speedora/shared';
import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';
import { BrandKitService } from './brand-kit.service';
import { UpdateBrandKitDto } from './dto/update-brand-kit.dto';

// A logo, not a video - same MAX_UPLOAD_SIZE_BYTES-style constant as
// VideosController, just a much smaller cap.
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
// Watermark roadmap (P3c) - same small-image cap as the logo.
const MAX_WATERMARK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
// Intro roadmap (P3d) - a short intro clip, so far bigger than a logo/
// watermark image but nowhere near VideosController's 2GB main-video cap.
const MAX_INTRO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// getObjectStream returns just a Readable, no stored Content-Type metadata
// (same reason VideosController/ClipsController derive thumbnailContentType
// from the key's own extension rather than trusting S3 metadata) - a brand
// logo/watermark can be any common image type the user uploaded, not just
// webp/jpeg, so this covers a wider set than thumbnailContentType does.
// Shared by both the logo and watermark download endpoints below.
function imageContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

// Intro roadmap (P3d) - same key's-own-extension-sniffing reasoning as
// imageContentType above, but an intro can be either a video or a still
// image, so this covers both.
function introContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

// Sprint 03d (Export Center roadmap) - the minimal Brand Kit Brand Report
// needs. Standalone, not bolted onto AuthModule (purely an auth-flow
// module) - this is its own distinct resource.
@Controller('brand-kit')
@UseGuards(JwtAuthGuard)
export class BrandKitController {
  constructor(
    private readonly brandKit: BrandKitService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  get(@CurrentUser() user: SafeUser) {
    return this.brandKit.get(user.id);
  }

  @Put()
  update(@CurrentUser() user: SafeUser, @Body() dto: UpdateBrandKitDto) {
    return this.brandKit.update(user.id, dto);
  }

  @Post('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_SIZE_BYTES } }))
  async uploadLogo(
    @CurrentUser() user: SafeUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\// })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    const logoKey = await this.storage.saveBrandLogo(file);
    return this.brandKit.saveLogo(user.id, logoKey);
  }

  @Get('logo')
  async downloadLogo(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const { logoKey } = await this.brandKit.findLogoKeyOrThrow(user.id);
    if (!logoKey) {
      throw new NotFoundException('No brand logo has been uploaded yet');
    }

    const stream = await getObjectStream(logoKey);
    res.setHeader('Content-Type', imageContentType(logoKey));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Watermark roadmap (P3c) - same upload/download shape as logo above.
  // SVG is accepted here (unlike logo, which never needed it) - the actual
  // SVG-to-PNG rasterization happens in StorageService.saveBrandWatermark,
  // not here, so this endpoint stays a thin multipart-handling layer.
  @Post('watermark')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WATERMARK_SIZE_BYTES } }))
  async uploadWatermark(
    @CurrentUser() user: SafeUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(png|jpe?g|webp|svg\+xml)$/ })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    const watermarkKey = await this.storage.saveBrandWatermark(file);
    return this.brandKit.saveWatermark(user.id, watermarkKey);
  }

  @Get('watermark')
  async downloadWatermark(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const { watermarkKey } = await this.brandKit.findWatermarkKeyOrThrow(user.id);
    if (!watermarkKey) {
      throw new NotFoundException('No brand watermark has been uploaded yet');
    }

    const stream = await getObjectStream(watermarkKey);
    res.setHeader('Content-Type', imageContentType(watermarkKey));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Not a 1:1 mirror of logo (which has no delete endpoint) - a user will
  // want to remove a watermark outright, not just fight its opacity down
  // to 0.
  @Delete('watermark')
  @HttpCode(204)
  removeWatermark(@CurrentUser() user: SafeUser) {
    return this.brandKit.removeWatermark(user.id);
  }

  // Intro roadmap (P3d) - same upload/download/delete shape as watermark
  // above. Accepts video (MP4/MOV) or still image (PNG/JPEG/WebP), never
  // SVG (an intro asset is never rasterized the way a watermark can be).
  // introType is derived from the validated mimetype, not the file
  // extension - saveIntro() persists both together in one update.
  @Post('intro')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_INTRO_SIZE_BYTES } }))
  async uploadIntro(
    @CurrentUser() user: SafeUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(video\/(mp4|quicktime)|image\/(png|jpe?g|webp))$/ })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    const introType: IntroType = file.mimetype.startsWith('video/') ? 'video' : 'image';
    const introKey = await this.storage.saveBrandIntro(file);
    return this.brandKit.saveIntro(user.id, introKey, introType);
  }

  @Get('intro')
  async downloadIntro(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const { introKey } = await this.brandKit.findIntroKeyOrThrow(user.id);
    if (!introKey) {
      throw new NotFoundException('No brand intro has been uploaded yet');
    }

    const stream = await getObjectStream(introKey);
    res.setHeader('Content-Type', introContentType(introKey));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  @Delete('intro')
  @HttpCode(204)
  removeIntro(@CurrentUser() user: SafeUser) {
    return this.brandKit.removeIntro(user.id);
  }
}
