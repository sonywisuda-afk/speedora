import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateFolderDto } from './dto/create-folder.dto';
import { CreateProjectDto } from './dto/create-project.dto';
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
  list(@CurrentUser() user: SafeUser, @Param('workspaceId') workspaceId: string) {
    return this.projectService.listByWorkspace(user.id, workspaceId);
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
