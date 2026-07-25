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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { recordActivityEvent, SocialPlatform } from '@speedora/database';
import { getObjectStream, getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ClipQueryParserService } from './clip-query-parser.service';
import { ClipsService } from './clips.service';
import { CreatePlatformCopyDto } from './dto/create-platform-copy.dto';
import { ParseClipQueryDto } from './dto/parse-clip-query.dto';
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

// AI Clip Library roadmap (P1) - same clamped-parse-rather-than-throw
// posture, and same per-controller-copy convention, as every other
// parseLimit in this codebase (VideosController/AnalyticsController/etc).
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

// Same "invalid/missing falls back to undefined rather than throwing"
// posture as AnalyticsController's own parsePlatform - a typo'd
// ?platform=foo degrading to "no platform filter" is friendlier than a 400
// for a display filter.
function parsePlatform(raw: string | undefined): SocialPlatform | undefined {
  return raw && (Object.values(SocialPlatform) as string[]).includes(raw)
    ? (raw as SocialPlatform)
    : undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : undefined;
}

function parseTopics(raw: string | undefined): string[] | undefined {
  const topics = raw
    ?.split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return topics && topics.length > 0 ? topics : undefined;
}

@Controller('clips')
@UseGuards(JwtAuthGuard)
export class ClipsController {
  private readonly logger = new Logger(ClipsController.name);

  constructor(
    private readonly clipsService: ClipsService,
    private readonly prisma: PrismaService,
    private readonly clipQueryParser: ClipQueryParserService,
  ) {}

  // AI Clip Library roadmap (P1) - the first cross-video clip listing this
  // app has ever had. See ClipsService.findAllFiltered for the filter/
  // pagination semantics.
  @Get()
  findAll(
    @CurrentUser() user: SafeUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('projectId') projectId?: string,
    @Query('folderId') folderId?: string,
    @Query('minScore') minScore?: string,
    @Query('platform') platform?: string,
    @Query('minDuration') minDuration?: string,
    @Query('maxDuration') maxDuration?: string,
    @Query('topics') topics?: string,
    @Query('emotion') emotion?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.clipsService.findAllFiltered(user.id, {
      cursor,
      limit: parseLimit(limit),
      workspaceId,
      projectId,
      folderId,
      minScore: parseNumber(minScore),
      platform: parsePlatform(platform),
      minDuration: parseNumber(minDuration),
      maxDuration: parseNumber(maxDuration),
      topics: parseTopics(topics),
      emotion: emotion || undefined,
      keyword: keyword || undefined,
    });
  }

  // AI Clip Library roadmap (P1) - option values for the topic filter's
  // dropdown/chips. See ClipsService.getTopicFacets.
  @Get('facets')
  getFacets(
    @CurrentUser() user: SafeUser,
    @Query('workspaceId') workspaceId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.clipsService.getTopicFacets(user.id, { workspaceId, projectId });
  }

  // Natural Language AI Search roadmap (P4) - a thin parser on top of the
  // filters above: translates dto.query into a partial ClipLibraryFilterParams
  // (see ClipQueryParserService), which the client merges into its own
  // filter state and re-issues as a normal GET /clips call - no new
  // results-rendering path, this endpoint never returns clips itself.
  @Post('ai-search')
  @HttpCode(200)
  parseAiSearchQuery(@CurrentUser() user: SafeUser, @Body() dto: ParseClipQueryDto) {
    return this.clipQueryParser.parseQuery(user.id, dto.query, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
    });
  }

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

  // Phase 3 (Animated Thumbnail) - see VideosController's own
  // animatedThumbnail endpoint for the reasoning.
  @Get(':id/animated-thumbnail')
  async animatedThumbnail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { animatedThumbnailUrl } = await this.clipsService.findAnimatedThumbnailOrThrow(
      id,
      user.id,
    );
    const stream = await getObjectStream(animatedThumbnailUrl);

    res.setHeader('Content-Type', thumbnailContentType(animatedThumbnailUrl));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  }

  // Phase 3 (Hover Preview, "Clip Preview") - see VideosController's own
  // hoverPreview endpoint for the reasoning.
  @Get(':id/hover-preview')
  async hoverPreview(@CurrentUser() user: SafeUser, @Param('id') id: string, @Res() res: Response) {
    const { hoverPreviewUrl } = await this.clipsService.findHoverPreviewOrThrow(id, user.id);
    const stream = await getObjectStream(hoverPreviewUrl);

    res.setHeader('Content-Type', thumbnailContentType(hoverPreviewUrl));
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

  // Sprint 6C (Analytics Dashboard Expansion) - a read-only, single-clip
  // view of real per-platform engagement history, distribution metadata,
  // and the same frozen AI score getExplainability returns - never an
  // aggregate across other clips (that's GET /analytics/*'s job). See
  // ClipsService.getPerformance.
  @Get(':id/performance')
  getPerformance(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.getPerformance(id, user.id);
  }

  // Publishing Expansion Phase 7A (AI SEO) - a read-only ranking of which
  // SocialPlatform this clip suits best, computed from its already-stored
  // ClipScores breakdown. See ClipsService.getPlatformFit.
  @Get(':id/platform-fit')
  getPlatformFit(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.getPlatformFit(id, user.id);
  }

  // Publishing Expansion Phase 7B (AI SEO) - on-demand, LLM-generated
  // per-platform caption/hashtags/description. Append-only: every call
  // creates a NEW row (see ClipPlatformCopy's schema comment) rather than
  // updating one in place, so "Generate" and "Regenerate" are the exact
  // same call. See ClipsService.generatePlatformCopy.
  @Post(':id/platform-copy')
  generatePlatformCopy(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CreatePlatformCopyDto,
  ) {
    return this.clipsService.generatePlatformCopy(id, user.id, dto.platform);
  }

  @Get(':id/platform-copy')
  listPlatformCopies(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.listPlatformCopies(id, user.id);
  }

  // Manual trim from the timeline editor - does not trigger a re-render.
  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateClipDto) {
    return this.clipsService.update(id, user.id, dto);
  }

  // Explicit re-render action, separate from PATCH so dragging a trim
  // handle doesn't burn FFmpeg compute on every intermediate value. Also
  // where Sprint 5E's ClipVersion snapshot gets created - see
  // ClipsService.render().
  @Post(':id/render')
  @HttpCode(200)
  render(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.render(id, user.id);
  }

  // Sprint 5E (Version Compare & History).
  @Get(':id/versions')
  listVersions(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.clipsService.listVersions(user.id, id);
  }

  @Post(':id/versions/:versionId/restore')
  restoreVersion(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.clipsService.restoreVersion(user.id, id, versionId);
  }

  @Get(':id/versions/:versionId/download')
  async downloadVersion(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ) {
    const { outputUrl } = await this.clipsService.getVersionOutputOrThrow(user.id, id, versionId);
    const stream = await getObjectStream(outputUrl);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="clip-${id}-v${versionId}.mp4"`);
    stream.pipe(res);
  }

  @Get(':id/versions/:versionId/thumbnail')
  async versionThumbnail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ) {
    const { thumbnailUrl } = await this.clipsService.getVersionThumbnailOrThrow(
      user.id,
      id,
      versionId,
    );
    const stream = await getObjectStream(thumbnailUrl);

    res.setHeader('Content-Type', thumbnailContentType(thumbnailUrl));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
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
  @HttpCode(204)
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
