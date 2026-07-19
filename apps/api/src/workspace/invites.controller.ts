import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceService } from './workspace.service';

// Sprint 5A (Collaboration Foundation). A separate top-level `/invites`
// resource (not nested under `/workspaces/:id`) since a raw invite token is
// already a unique lookup key - the frontend's accept page only ever has
// the token from the emailed link, not a workspace id.
@Controller('invites')
export class InvitesController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  // Deliberately unauthenticated (no JwtAuthGuard) - someone who was
  // invited but doesn't have a Speedora account yet must be able to see
  // "you've been invited to X as Editor" before being asked to sign up,
  // same reasoning as AuthController's own unauthenticated reset-password
  // flow.
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.workspaceService.previewInvite(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  accept(@CurrentUser() user: SafeUser, @Param('token') token: string) {
    return this.workspaceService.acceptInvite(user.id, user.email, token);
  }
}
