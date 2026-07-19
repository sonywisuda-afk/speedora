import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTrackedLinkDto } from './dto/create-tracked-link.dto';
import { TrackedLinksService } from './tracked-links.service';

// Sprint 6K (Conversion) - the authenticated management surface (create/
// list/delete a workspace's tracked links). Separate from RedirectController
// (GET /r/:slug), which is deliberately public and unauthenticated - the
// two controllers exist side by side in this module for exactly that
// reason, not merged into one.
@Controller()
@UseGuards(JwtAuthGuard)
export class TrackedLinksController {
  constructor(private readonly trackedLinks: TrackedLinksService) {}

  @Post('workspaces/:workspaceId/tracked-links')
  create(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateTrackedLinkDto,
  ) {
    return this.trackedLinks.create(user.id, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/tracked-links')
  list(@CurrentUser() user: SafeUser, @Param('workspaceId') workspaceId: string) {
    return this.trackedLinks.listByWorkspace(user.id, workspaceId);
  }

  @Delete('tracked-links/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.trackedLinks.remove(user.id, id);
  }
}
