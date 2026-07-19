import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { recordAuditLog, WorkspaceRole } from '@speedora/database';
import type { FolderDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from './workspace-access.service';

function toDto(folder: {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
}): FolderDto {
  return {
    id: folder.id,
    projectId: folder.projectId,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt.toISOString(),
  };
}

// Sprint 5A (Collaboration Foundation). A Folder always belongs to exactly
// one Project (never directly to a Workspace) - every permission check
// here resolves access via the parent Project's workspaceId, same
// "resolve up to the workspace, then check membership" shape as
// WorkspaceAccessService.assertVideoAccess.
@Injectable()
export class FolderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  private async findProjectOrThrow(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async findFolderOrThrow(folderId: string) {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder) {
      throw new NotFoundException(`Folder ${folderId} not found`);
    }
    return folder;
  }

  async create(
    userId: string,
    projectId: string,
    input: { name: string; parentId?: string },
  ): Promise<FolderDto> {
    const project = await this.findProjectOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.EDITOR);

    if (input.parentId) {
      const parent = await this.findFolderOrThrow(input.parentId);
      if (parent.projectId !== projectId) {
        throw new BadRequestException('parentId must belong to the same project');
      }
    }

    const folder = await this.prisma.folder.create({
      data: { projectId, name: input.name, parentId: input.parentId ?? null },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: project.workspaceId,
      action: 'FOLDER_CREATED',
      actorId: userId,
      targetType: 'Folder',
      targetId: folder.id,
      metadata: { name: input.name, projectId },
    }).catch(() => {});

    return toDto(folder);
  }

  async listByProject(userId: string, projectId: string): Promise<{ folders: FolderDto[] }> {
    const project = await this.findProjectOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.VIEWER);
    const folders = await this.prisma.folder.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
    });
    return { folders: folders.map(toDto) };
  }

  async update(
    userId: string,
    folderId: string,
    input: { name?: string; parentId?: string | null },
  ): Promise<FolderDto> {
    const folder = await this.findFolderOrThrow(folderId);
    const project = await this.findProjectOrThrow(folder.projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.EDITOR);

    if (input.parentId) {
      if (input.parentId === folderId) {
        throw new BadRequestException('A folder cannot be its own parent');
      }
      const parent = await this.findFolderOrThrow(input.parentId);
      if (parent.projectId !== folder.projectId) {
        throw new BadRequestException('parentId must belong to the same project');
      }
    }

    const updated = await this.prisma.folder.update({
      where: { id: folderId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      },
    });
    return toDto(updated);
  }

  async remove(userId: string, folderId: string): Promise<void> {
    const folder = await this.findFolderOrThrow(folderId);
    const project = await this.findProjectOrThrow(folder.projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.ADMIN);
    await this.prisma.folder.delete({ where: { id: folderId } });

    await recordAuditLog(this.prisma, {
      workspaceId: project.workspaceId,
      action: 'FOLDER_DELETED',
      actorId: userId,
      targetType: 'Folder',
      targetId: folderId,
      metadata: { name: folder.name },
    }).catch(() => {});
  }
}
