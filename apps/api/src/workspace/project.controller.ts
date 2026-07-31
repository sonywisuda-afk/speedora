import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BulkMoveProjectDto } from './dto/bulk-move-project.dto';
import { BulkProjectIdsDto } from './dto/bulk-project-ids.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { MoveProjectDto } from './dto/move-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { FolderService } from './folder.service';
import { ProjectService } from './project.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly folderService: FolderService,
  ) {}

  @Post('workspaces/:workspaceId/projects')
  create(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectService.create(user.id, workspaceId, dto.name);
  }

  @Get('workspaces/:workspaceId/projects')
  list(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectService.listByWorkspace(user.id, workspaceId, includeArchived === 'true');
  }

  // Bulk Actions roadmap - registered before the projects/:id/* routes
  // below (archive/unarchive/move) so Nest's route matching doesn't let
  // ":id" greedily capture the literal "bulk" segment - order matters here.
  @Post('projects/bulk/archive')
  bulkArchive(@CurrentUser() user: SafeUser, @Body() dto: BulkProjectIdsDto) {
    return this.projectService.bulkArchive(user.id, dto.projectIds);
  }

  @Post('projects/bulk/unarchive')
  bulkUnarchive(@CurrentUser() user: SafeUser, @Body() dto: BulkProjectIdsDto) {
    return this.projectService.bulkUnarchive(user.id, dto.projectIds);
  }

  @Post('projects/bulk/move')
  bulkMove(@CurrentUser() user: SafeUser, @Body() dto: BulkMoveProjectDto) {
    return this.projectService.bulkMove(user.id, dto.projectIds, dto.targetWorkspaceId);
  }

  @Post('projects/bulk/delete')
  bulkRemove(@CurrentUser() user: SafeUser, @Body() dto: BulkProjectIdsDto) {
    return this.projectService.bulkRemove(user.id, dto.projectIds);
  }

  @Get('projects/:id')
  get(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.projectService.get(user.id, id);
  }

  @Patch('projects/:id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return dto.name === undefined
      ? this.projectService.get(user.id, id)
      : this.projectService.update(user.id, id, dto.name);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.projectService.remove(user.id, id);
  }

  @Post('projects/:id/archive')
  archive(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.projectService.archive(user.id, id);
  }

  @Post('projects/:id/unarchive')
  unarchive(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.projectService.unarchive(user.id, id);
  }

  @Post('projects/:id/move')
  move(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: MoveProjectDto) {
    return this.projectService.move(user.id, id, dto.targetWorkspaceId);
  }

  @Post('projects/:id/folders')
  createFolder(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CreateFolderDto,
  ) {
    return this.folderService.create(user.id, id, dto);
  }

  @Get('projects/:id/folders')
  listFolders(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.folderService.listByProject(user.id, id);
  }
}
