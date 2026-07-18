import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceService } from './workspace.service';

// Product Experience performance pass - same clamped-parse-rather-than-throw
// posture as VideosController/AnalyticsController/DashboardController's own
// parseLimit (each controller keeps its own copy rather than sharing one,
// per this codebase's existing convention).
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

// Sprint 5A (Collaboration Foundation). Every route here is scoped by the
// requester's own WorkspaceMembership (see WorkspaceAccessService) - there
// is no separate ownership concept the way VideosController used to have.
@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaceService.create(user.id, dto.name);
  }

  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.workspaceService.listMine(user.id);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.workspaceService.getDetail(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    if (dto.name === undefined) {
      return this.workspaceService.getDetail(user.id, id);
    }
    return this.workspaceService.update(user.id, id, dto.name);
  }

  @Post(':id/invites')
  createInvite(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CreateInviteDto,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    return this.workspaceService.createInvite(user.id, user.email, id, dto, webOrigin);
  }

  @Get(':id/invites')
  listInvites(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.workspaceService.listInvites(user.id, id);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.workspaceService.updateMemberRole(user.id, id, targetUserId, dto.role);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.workspaceService.removeMember(user.id, id, targetUserId);
  }

  // Sprint 5F (Audit Log) - ADMIN+-only, enforced in the service.
  @Get(':id/audit-log')
  listAuditLog(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workspaceService.listAuditLog(user.id, id, { cursor, limit: parseLimit(limit) });
  }

  // Publishing Expansion Phase 6D (Calendar view) - VIEWER+-only, enforced
  // in the service (any workspace member should see the publish calendar,
  // unlike audit-log's ADMIN+-only governance surface). start/end are ISO
  // 8601 instants; see WorkspaceService.getCalendar for the exact
  // half-open [start, end) range semantics.
  @Get(':id/calendar')
  getCalendar(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.workspaceService.getCalendar(user.id, id, new Date(start), new Date(end));
  }
}
