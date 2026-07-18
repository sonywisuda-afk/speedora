import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { exportFileInfo, ExportType } from '@speedora/shared';
import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportService } from './export.service';

// Sprint 03c/03d (Export Center roadmap) - async, video-scoped formats
// (PDF/EXCEL/HIGHLIGHT_REPORT/BRAND_REPORT, all joined the ExportType enum
// with zero route changes here - see exportFileInfo()). The sync formats
// (CSV/JSON/TXT/SRT/VTT) stay on VideosController's :id/export/* routes
// from Sprint 03b - this is a genuinely separate resource (ExportJob),
// not a rename of that one.
@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateExportDto) {
    return this.exportService.create(user.id, dto);
  }

  // Recent Exports / Persistent Export History - a plain `/export` GET
  // (no path param) never collides with `/export/:id` below, they're
  // structurally different paths. At least one of videoId/type is required -
  // the existing per-video tabs pass videoId; ANALYTICS_REPORT (account-wide,
  // no videoId to scope by) passes type instead. Same manual-parse-not-DTO
  // posture that controller already uses for its own query params, so `type`
  // is validated against the real enum here rather than reaching Prisma's
  // enum column and surfacing as an opaque 500 (same convention as Sprint
  // 4B's NotificationType validation).
  @Get()
  async list(
    @CurrentUser() user: SafeUser,
    @Query('videoId') videoId?: string,
    @Query('type') type?: string,
  ) {
    if (!videoId && !type) {
      throw new BadRequestException('videoId or type query parameter is required');
    }
    if (type && !Object.values(ExportType).includes(type as ExportType)) {
      throw new BadRequestException(`Invalid export type: ${type}`);
    }
    const jobs = await this.exportService.listRecent(user.id, {
      videoId,
      type: type as ExportType | undefined,
    });
    return { jobs };
  }

  @Get(':id')
  async poll(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    const job = await this.exportService.findOwnedOrThrow(id, user.id);
    return this.exportService.toDto(job);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const job = await this.exportService.findReadyOrThrow(id, user.id);
    const stream = await getObjectStream(job.resultUrl as string);
    // Prisma's own ExportType enum and @speedora/shared's are nominally
    // distinct TS enum types even though they share the same runtime string
    // values (same "narrow via a cast at the one call site that needs it"
    // convention as ExportService.toDto()).
    const { extension, contentType } = exportFileInfo(job.type as unknown as ExportType);
    const filename = job.videoId
      ? `video-${job.videoId}-report.${extension}`
      : `analytics-report-${job.id}.${extension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }
}
